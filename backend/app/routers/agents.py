"""Agent registration and management endpoints."""
import re
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.agent import Agent

from app.services.agentcore import describe_runtime, list_runtime_endpoints


router = APIRouter(prefix="/api/agents", tags=["agents"])


# Pydantic models for request/response
class AgentRegisterRequest(BaseModel):
    """Request body for registering a new agent."""
    arn: str = Field(..., description="AgentCore Runtime ARN")


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
    registered_at: str | None
    last_refreshed_at: str | None


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


@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
def register_agent(
    request: AgentRegisterRequest,
    db: Session = Depends(get_db)
) -> AgentResponse:
    """
    Register a new agent by ARN.

    Calls the AgentCore describe API to fetch metadata and stores it in the local database.
    """
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
        # Fallback to DEFAULT if endpoint listing fails
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
        registered_at=datetime.utcnow(),
        last_refreshed_at=datetime.utcnow(),
    )
    agent.set_available_qualifiers(qualifiers)
    agent.set_raw_metadata(metadata)

    db.add(agent)
    db.commit()
    db.refresh(agent)

    return AgentResponse(**agent.to_dict())


@router.get("", response_model=List[AgentResponse])
def list_agents(db: Session = Depends(get_db)) -> List[AgentResponse]:
    """List all registered agents."""
    agents = db.query(Agent).order_by(Agent.registered_at.desc()).all()
    return [AgentResponse(**agent.to_dict()) for agent in agents]


@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(agent_id: int, db: Session = Depends(get_db)) -> AgentResponse:
    """Get metadata for a specific registered agent."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent with ID {agent_id} not found"
        )
    return AgentResponse(**agent.to_dict())


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent(agent_id: int, db: Session = Depends(get_db)) -> None:
    """Remove an agent from the local registry."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent with ID {agent_id} not found"
        )
    db.delete(agent)
    db.commit()


@router.post("/{agent_id}/refresh", response_model=AgentResponse)
def refresh_agent(agent_id: int, db: Session = Depends(get_db)) -> AgentResponse:
    """Re-fetch metadata from AgentCore and update the local record."""
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent with ID {agent_id} not found"
        )

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

    return AgentResponse(**agent.to_dict())
