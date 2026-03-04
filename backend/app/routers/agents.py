"""Agent registration, deployment, and management endpoints."""
import json
import logging
import os
import re
import time
from datetime import datetime
from typing import List, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.agent import Agent
from app.models.config_entry import ConfigEntry
from app.models.session import InvocationSession
from app.models.invocation import Invocation

from app.services.agentcore import describe_runtime, list_runtime_endpoints
from app.services.deployment import deploy_agent, redeploy_agent, delete_runtime
from app.services.iam import create_execution_role, delete_execution_role, update_role_policy

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agents", tags=["agents"])

DEFAULT_REGION = os.getenv("AWS_REGION", "us-east-1")


# Pydantic models for request/response
class AgentRegisterRequest(BaseModel):
    """Request body for registering an existing agent by ARN."""
    source: str = Field(default="register", description="Must be 'register'")
    arn: str = Field(..., description="AgentCore Runtime ARN")


class AgentDeployRequest(BaseModel):
    """Request body for deploying a new agent."""
    source: str = Field(default="deploy", description="Must be 'deploy'")
    name: str = Field(..., description="Name for the agent runtime")
    code_uri: str = Field(..., description="S3 URI for the agent code artifact")
    config: dict[str, str] = Field(default_factory=dict, description="Environment variables for the runtime")


class AgentCreateRequest(BaseModel):
    """Unified request model that accepts either register or deploy payloads."""
    source: str = Field(default="register", description="Creation mode: 'register' or 'deploy'")
    # Register fields
    arn: Optional[str] = Field(None, description="AgentCore Runtime ARN (required for register)")
    # Deploy fields
    name: Optional[str] = Field(None, description="Agent name (required for deploy)")
    code_uri: Optional[str] = Field(None, description="S3 URI for code artifact (required for deploy)")
    config: dict[str, str] = Field(default_factory=dict, description="Environment variables (deploy only)")


class AgentResponse(BaseModel):
    """Response model for agent details."""
    id: int
    arn: str
    runtime_id: str
    name: str | None
    status: str | None
    region: str
    account_id: str
    log_group: str | None
    available_qualifiers: List[str]
    source: str | None = None
    deployment_status: str | None = None
    execution_role_arn: str | None = None
    code_uri: str | None = None
    config_hash: str | None = None
    deployed_at: str | None = None
    registered_at: str | None
    last_refreshed_at: str | None
    active_session_count: int


class ConfigEntryResponse(BaseModel):
    """Response model for a config entry."""
    id: int
    agent_id: int
    key: str
    value: str | None
    is_secret: bool
    source: str | None
    created_at: str | None
    updated_at: str | None


class ConfigUpdateRequest(BaseModel):
    """Request body for updating agent config entries."""
    config: dict[str, str] = Field(..., description="Key-value pairs to set")


def parse_arn(arn: str) -> tuple[str, str, str]:
    """
    Parse AgentCore Runtime ARN to extract region, account_id, and runtime_id.

    ARN format: arn:aws:bedrock-agentcore:{region}:{account_id}:runtime/{runtime_id}

    Returns:
        tuple of (region, account_id, runtime_id)

    Raises:
        ValueError: If ARN format is invalid
    """
    pattern = r"^arn:aws:bedrock-agentcore:([^:]+):([^:]+):runtime/(.+)$"
    match = re.match(pattern, arn)
    if not match:
        raise ValueError(f"Invalid AgentCore Runtime ARN format: {arn}")
    return match.group(1), match.group(2), match.group(3)


def derive_log_group(runtime_id: str, qualifier: str) -> str:
    """
    Derive CloudWatch log group name for a runtime and qualifier.

    Format: /aws/bedrock-agentcore/runtimes/{runtime_id}-{qualifier}
    """
    return f"/aws/bedrock-agentcore/runtimes/{runtime_id}-{qualifier}"


def compute_active_session_count(agent_id: int, db: Session) -> int:
    """
    Count sessions that are likely still warm in AWS.

    Sessions with status pending/streaming are always active.
    For complete/error sessions, check if the most recent invocation's
    client_done_time is within SESSION_IDLE_TIMEOUT_MINUTES of now.
    Falls back to created_at if no client_done_time exists.
    """
    timeout_minutes = int(os.getenv("SESSION_IDLE_TIMEOUT_MINUTES", "15"))
    timeout_seconds = timeout_minutes * 60
    now_ts = time.time()
    now_dt = datetime.utcnow()

    sessions = db.query(InvocationSession).filter(
        InvocationSession.agent_id == agent_id
    ).all()

    count = 0
    for session in sessions:
        if session.status in ("pending", "streaming"):
            count += 1
            continue

        # For complete/error sessions, check recency
        max_done_time = db.query(func.max(Invocation.client_done_time)).filter(
            Invocation.session_id == session.session_id
        ).scalar()

        if max_done_time is not None:
            if (now_ts - max_done_time) < timeout_seconds:
                count += 1
        elif session.created_at:
            if (now_dt - session.created_at).total_seconds() < timeout_seconds:
                count += 1

    return count


def _agent_response(agent: Agent, db: Session) -> AgentResponse:
    """Build an AgentResponse from an Agent ORM object."""
    return AgentResponse(
        **agent.to_dict(),
        active_session_count=compute_active_session_count(agent.id, db)
    )


def _get_agent_or_404(agent_id: int, db: Session) -> Agent:
    """Fetch an agent by ID or raise 404."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent with ID {agent_id} not found"
        )
    return agent


@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
def create_agent(
    request: AgentCreateRequest,
    db: Session = Depends(get_db)
) -> AgentResponse:
    """
    Create a new agent via registration (existing ARN) or deployment (new runtime).
    """
    if request.source == "register":
        return _register_agent(request, db)
    elif request.source == "deploy":
        return _deploy_agent(request, db)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid source: {request.source}. Must be 'register' or 'deploy'."
        )


def _register_agent(request: AgentCreateRequest, db: Session) -> AgentResponse:
    """Register an existing agent by ARN."""
    if not request.arn:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Field 'arn' is required when source is 'register'"
        )

    # Check if agent already registered
    existing_agent = db.query(Agent).filter(Agent.arn == request.arn).first()
    if existing_agent:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Agent with ARN {request.arn} is already registered with ID {existing_agent.id}"
        )

    # Parse ARN
    try:
        region, account_id, runtime_id = parse_arn(request.arn)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Fetch metadata from AWS
    try:
        metadata = describe_runtime(request.arn, region)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to describe runtime: {str(e)}"
        )

    # Fetch available qualifiers
    try:
        qualifiers = list_runtime_endpoints(runtime_id, region)
    except Exception:
        qualifiers = ["DEFAULT"]

    # Create agent record
    agent = Agent(
        arn=request.arn,
        runtime_id=runtime_id,
        name=metadata.get("agentRuntimeName"),
        status=metadata.get("status"),
        region=region,
        account_id=account_id,
        log_group=derive_log_group(runtime_id, qualifiers[0]) if qualifiers else None,
        source="register",
        registered_at=datetime.utcnow(),
        last_refreshed_at=datetime.utcnow(),
    )
    agent.set_available_qualifiers(qualifiers)
    agent.set_raw_metadata(metadata)

    db.add(agent)
    db.commit()
    db.refresh(agent)

    return AgentResponse(**agent.to_dict(), active_session_count=0)


def _deploy_agent(request: AgentCreateRequest, db: Session) -> AgentResponse:
    """Deploy a new agent runtime to AgentCore."""
    if not request.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Field 'name' is required when source is 'deploy'"
        )
    if not request.code_uri:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Field 'code_uri' is required when source is 'deploy'"
        )

    region = os.getenv("AWS_REGION", DEFAULT_REGION)
    account_id = os.getenv("AWS_ACCOUNT_ID", "")

    # Create agent record with deploying status
    agent = Agent(
        arn="",  # placeholder until deployment completes
        runtime_id="",
        name=request.name,
        status="CREATING",
        region=region,
        account_id=account_id,
        source="deploy",
        deployment_status="deploying",
        code_uri=request.code_uri,
        registered_at=datetime.utcnow(),
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    # Store config entries
    for key, value in request.config.items():
        entry = ConfigEntry(
            agent_id=agent.id,
            key=key,
            value=value,
            is_secret=False,
            source="env_var",
        )
        db.add(entry)
    db.commit()

    # Create IAM execution role
    try:
        execution_role_arn = create_execution_role(
            agent_name=request.name,
            runtime_id=f"pending-{agent.id}",
            region=region,
            account_id=account_id
        )
        agent.execution_role_arn = execution_role_arn
        db.commit()
    except Exception as e:
        agent.deployment_status = "failed"
        agent.status = "FAILED"
        db.commit()
        logger.error("Failed to create execution role for agent %s: %s", agent.id, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to create execution role: {str(e)}"
        )

    # Deploy to AgentCore
    try:
        env_vars = request.config.copy()
        response = deploy_agent(
            name=request.name,
            code_uri=request.code_uri,
            execution_role_arn=execution_role_arn,
            env_vars=env_vars,
            region=region
        )

        # Extract runtime details from response
        runtime_arn = response.get("agentRuntimeArn", "")
        runtime_id = response.get("agentRuntimeId", "")

        agent.arn = runtime_arn
        agent.runtime_id = runtime_id
        agent.deployment_status = "deployed"
        agent.status = response.get("status", "ACTIVE")
        agent.deployed_at = datetime.utcnow()
        agent.last_refreshed_at = datetime.utcnow()
        agent.log_group = derive_log_group(runtime_id, "DEFAULT") if runtime_id else None
        agent.set_available_qualifiers(["DEFAULT"])

        db.commit()
        db.refresh(agent)
    except Exception as e:
        agent.deployment_status = "failed"
        agent.status = "FAILED"
        db.commit()
        logger.error("Failed to deploy agent %s: %s", agent.id, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to deploy agent runtime: {str(e)}"
        )

    return AgentResponse(**agent.to_dict(), active_session_count=0)


@router.get("", response_model=List[AgentResponse])
def list_agents(db: Session = Depends(get_db)) -> List[AgentResponse]:
    """List all registered agents."""
    agents = db.query(Agent).order_by(Agent.registered_at.desc()).all()
    return [_agent_response(agent, db) for agent in agents]


@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(agent_id: int, db: Session = Depends(get_db)) -> AgentResponse:
    """Get metadata for a specific registered agent."""
    agent = _get_agent_or_404(agent_id, db)
    return _agent_response(agent, db)


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent(agent_id: int, db: Session = Depends(get_db)) -> None:
    """Remove an agent from the local registry. For deployed agents, also clean up AWS resources."""
    agent = _get_agent_or_404(agent_id, db)

    # Clean up AWS resources for deployed agents
    if agent.source == "deploy" and agent.runtime_id:
        try:
            delete_runtime(agent.runtime_id, agent.region)
        except Exception as e:
            logger.warning("Failed to delete runtime %s: %s", agent.runtime_id, e)

        if agent.execution_role_arn:
            try:
                role_name = agent.execution_role_arn.split("/")[-1]
                delete_execution_role(role_name)
            except Exception as e:
                logger.warning("Failed to delete execution role: %s", e)

    db.delete(agent)
    db.commit()


@router.post("/{agent_id}/refresh", response_model=AgentResponse)
def refresh_agent(agent_id: int, db: Session = Depends(get_db)) -> AgentResponse:
    """Re-fetch metadata from AgentCore and update the local record."""
    agent = _get_agent_or_404(agent_id, db)

    # Fetch updated metadata
    try:
        metadata = describe_runtime(agent.arn, agent.region)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to describe runtime: {str(e)}"
        )

    # Fetch updated qualifiers
    try:
        qualifiers = list_runtime_endpoints(agent.runtime_id, agent.region)
    except Exception:
        qualifiers = agent.get_available_qualifiers()

    # Update agent record
    agent.name = metadata.get("agentRuntimeName")
    agent.status = metadata.get("status")
    agent.set_available_qualifiers(qualifiers)
    agent.set_raw_metadata(metadata)
    agent.last_refreshed_at = datetime.utcnow()

    db.commit()
    db.refresh(agent)

    return _agent_response(agent, db)


@router.post("/{agent_id}/redeploy", response_model=AgentResponse)
def redeploy_agent_endpoint(agent_id: int, db: Session = Depends(get_db)) -> AgentResponse:
    """Redeploy an agent with its current code and config."""
    agent = _get_agent_or_404(agent_id, db)

    if agent.source != "deploy":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only deployed agents can be redeployed"
        )

    if not agent.runtime_id or not agent.code_uri:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Agent is missing runtime_id or code_uri"
        )

    # Build env vars from config entries
    config_entries = db.query(ConfigEntry).filter(ConfigEntry.agent_id == agent_id).all()
    env_vars = {entry.key: entry.value for entry in config_entries if entry.value is not None}

    agent.deployment_status = "deploying"
    db.commit()

    try:
        response = redeploy_agent(
            runtime_id=agent.runtime_id,
            code_uri=agent.code_uri,
            env_vars=env_vars if env_vars else None,
            region=agent.region
        )
        agent.deployment_status = "deployed"
        agent.status = response.get("status", "ACTIVE")
        agent.deployed_at = datetime.utcnow()
        agent.last_refreshed_at = datetime.utcnow()
        db.commit()
        db.refresh(agent)
    except Exception as e:
        agent.deployment_status = "failed"
        db.commit()
        logger.error("Failed to redeploy agent %s: %s", agent.id, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to redeploy agent: {str(e)}"
        )

    return _agent_response(agent, db)


@router.get("/{agent_id}/config", response_model=List[ConfigEntryResponse])
def get_agent_config(agent_id: int, db: Session = Depends(get_db)) -> List[ConfigEntryResponse]:
    """Get all configuration entries for an agent. Secret values are masked."""
    _get_agent_or_404(agent_id, db)
    entries = db.query(ConfigEntry).filter(ConfigEntry.agent_id == agent_id).all()
    result = []
    for entry in entries:
        d = entry.to_dict()
        if entry.is_secret:
            d["value"] = "********"
        result.append(ConfigEntryResponse(**d))
    return result


@router.put("/{agent_id}/config", response_model=List[ConfigEntryResponse])
def update_agent_config(
    agent_id: int,
    request: ConfigUpdateRequest,
    db: Session = Depends(get_db)
) -> List[ConfigEntryResponse]:
    """Update configuration entries for an agent. Adds new keys and updates existing ones."""
    _get_agent_or_404(agent_id, db)

    for key, value in request.config.items():
        existing = db.query(ConfigEntry).filter(
            ConfigEntry.agent_id == agent_id,
            ConfigEntry.key == key
        ).first()
        if existing:
            existing.value = value
        else:
            entry = ConfigEntry(
                agent_id=agent_id,
                key=key,
                value=value,
                is_secret=False,
                source="env_var",
            )
            db.add(entry)

    db.commit()

    entries = db.query(ConfigEntry).filter(ConfigEntry.agent_id == agent_id).all()
    return [ConfigEntryResponse(**entry.to_dict()) for entry in entries]
