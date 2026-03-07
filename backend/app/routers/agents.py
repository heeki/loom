"""Agent registration, deployment, and management endpoints."""
import json
import logging
import os
import re
import time
from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.agent import Agent
from app.models.config_entry import ConfigEntry
from app.models.session import InvocationSession
from app.models.invocation import Invocation
from app.routers.utils import get_agent_or_404

from app.services.agentcore import describe_runtime, list_runtime_endpoints
from app.services.deployment import (
    build_agent_artifact,
    create_runtime,
    create_runtime_endpoint,
    delete_runtime,
    delete_runtime_endpoint,
    get_runtime,
    get_runtime_endpoint,
    update_runtime,
)
from app.services.iam import (
    create_execution_role,
    delete_execution_role,
    list_agentcore_roles,
    list_cognito_pools,
)
from app.services.secrets import store_secret, delete_secret

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agents", tags=["agents"])

DEFAULT_REGION = os.getenv("AWS_REGION", "us-east-1")

SUPPORTED_MODELS = [
    {"model_id": "us.anthropic.claude-opus-4-6-v1", "display_name": "Claude Opus 4.6", "group": "Anthropic"},
    {"model_id": "us.anthropic.claude-sonnet-4-6", "display_name": "Claude Sonnet 4.6", "group": "Anthropic"},
    {"model_id": "us.anthropic.claude-opus-4-5-20251101-v1:0", "display_name": "Claude Opus 4.5", "group": "Anthropic"},
    {"model_id": "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "display_name": "Claude Sonnet 4.5", "group": "Anthropic"},
    {"model_id": "us.anthropic.claude-haiku-4-5-20251001-v1:0", "display_name": "Claude Haiku 4.5", "group": "Anthropic"},
    {"model_id": "us.amazon.nova-2-lite-v1:0", "display_name": "Nova 2 Lite", "group": "Amazon"},
    {"model_id": "us.amazon.nova-premier-v1:0", "display_name": "Nova Premier", "group": "Amazon"},
    {"model_id": "us.amazon.nova-pro-v1:0", "display_name": "Nova Pro", "group": "Amazon"},
    {"model_id": "us.amazon.nova-lite-v1:0", "display_name": "Nova Lite", "group": "Amazon"},
    {"model_id": "us.amazon.nova-micro-v1:0", "display_name": "Nova Micro", "group": "Amazon"},
]


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class AgentRegisterRequest(BaseModel):
    """Request body for registering an existing agent by ARN."""
    source: str = Field(default="register", description="Must be 'register'")
    arn: str = Field(..., description="AgentCore Runtime ARN")


class AgentDeployRequest(BaseModel):
    """Request body for deploying a new agent."""
    source: str = Field(default="deploy", description="Must be 'deploy'")
    name: str = Field(..., description="Name for the agent runtime")
    description: str = Field(default="", description="Agent description")
    agent_description: str = Field(default="", description="What the agent does")
    behavioral_guidelines: str = Field(default="", description="How it should behave")
    output_expectations: str = Field(default="", description="Output format/style")
    model_id: str = Field(..., description="Bedrock model ID")
    role_arn: str | None = Field(None, description="Existing IAM role ARN or null to create new")
    protocol: str = Field(default="HTTP", description="HTTP, MCP, or A2A")
    network_mode: str = Field(default="PUBLIC", description="PUBLIC or VPC")
    idle_timeout: int | None = Field(None, description="Idle runtime session timeout (seconds)")
    max_lifetime: int | None = Field(None, description="Max lifetime (seconds)")
    authorizer_type: str | None = Field(None, description="Authorizer type: 'cognito' or 'other'")
    authorizer_pool_id: str | None = Field(None, description="Cognito pool ID for authorizer (when type is 'cognito')")
    authorizer_discovery_url: str | None = Field(None, description="OIDC discovery URL (when type is 'other')")
    authorizer_allowed_clients: list[str] = Field(default_factory=list, description="Allowed client IDs")
    authorizer_allowed_scopes: list[str] = Field(default_factory=list, description="Allowed OAuth scopes")
    authorizer_client_id: str | None = Field(None, description="App client ID for Cognito token retrieval")
    authorizer_client_secret: str | None = Field(None, description="App client secret for Cognito token retrieval")
    memory_enabled: bool = Field(default=False, description="Enable memory integration")
    mcp_servers: list = Field(default_factory=list, description="MCP server configs")
    a2a_agents: list = Field(default_factory=list, description="A2A agent configs")


class AgentCreateRequest(BaseModel):
    """Unified request model that accepts either register or deploy payloads."""
    source: str = Field(default="register", description="Creation mode: 'register' or 'deploy'")
    # Register fields
    arn: str | None = Field(None, description="AgentCore Runtime ARN (required for register)")
    # Deploy fields
    name: str | None = Field(None, description="Agent name (required for deploy)")
    description: str = Field(default="", description="Agent description")
    agent_description: str = Field(default="", description="What the agent does")
    behavioral_guidelines: str = Field(default="", description="How it should behave")
    output_expectations: str = Field(default="", description="Output format/style")
    model_id: str | None = Field(None, description="Bedrock model ID (required for deploy)")
    role_arn: str | None = Field(None, description="Existing IAM role ARN or null to create new")
    protocol: str = Field(default="HTTP", description="HTTP, MCP, or A2A")
    network_mode: str = Field(default="PUBLIC", description="PUBLIC or VPC")
    idle_timeout: int | None = Field(None, description="Idle runtime session timeout (seconds)")
    max_lifetime: int | None = Field(None, description="Max lifetime (seconds)")
    authorizer_type: str | None = Field(None, description="Authorizer type: 'cognito' or 'other'")
    authorizer_pool_id: str | None = Field(None, description="Cognito pool ID for authorizer (when type is 'cognito')")
    authorizer_discovery_url: str | None = Field(None, description="OIDC discovery URL (when type is 'other')")
    authorizer_allowed_clients: list[str] = Field(default_factory=list, description="Allowed client IDs")
    authorizer_allowed_scopes: list[str] = Field(default_factory=list, description="Allowed OAuth scopes")
    authorizer_client_id: str | None = Field(None, description="App client ID for Cognito token retrieval")
    authorizer_client_secret: str | None = Field(None, description="App client secret for Cognito token retrieval")
    memory_enabled: bool = Field(default=False, description="Enable memory integration")
    mcp_servers: list = Field(default_factory=list, description="MCP server configs")
    a2a_agents: list = Field(default_factory=list, description="A2A agent configs")


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
    available_qualifiers: list[str]
    source: str | None = None
    deployment_status: str | None = None
    execution_role_arn: str | None = None
    config_hash: str | None = None
    endpoint_name: str | None = None
    endpoint_arn: str | None = None
    endpoint_status: str | None = None
    protocol: str | None = None
    network_mode: str | None = None
    model_id: str | None = None
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def parse_arn(arn: str) -> tuple[str, str, str]:
    """
    Parse AgentCore Runtime ARN to extract region, account_id, and runtime_id.

    Returns:
        tuple of (region, account_id, runtime_id)
    """
    pattern = r"^arn:aws:bedrock-agentcore:([^:]+):([^:]+):runtime/(.+)$"
    match = re.match(pattern, arn)
    if not match:
        raise ValueError(f"Invalid AgentCore Runtime ARN format: {arn}")
    return match.group(1), match.group(2), match.group(3)


def derive_log_group(runtime_id: str, qualifier: str) -> str:
    """Derive CloudWatch log group name for a runtime and qualifier."""
    return f"/aws/bedrock-agentcore/runtimes/{runtime_id}-{qualifier}"


def compute_active_session_count(agent_id: int, db: Session) -> int:
    """Count sessions that are likely still warm in AWS."""
    timeout_seconds = int(os.getenv("LOOM_SESSION_IDLE_TIMEOUT_SECONDS", "300"))
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
    model_id = None
    for entry in agent.config_entries:
        if entry.key == "AGENT_CONFIG_JSON":
            try:
                model_id = json.loads(entry.value).get("model_id")
            except (json.JSONDecodeError, TypeError):
                pass
            break
    return AgentResponse(
        **agent.to_dict(),
        model_id=model_id,
        active_session_count=compute_active_session_count(agent.id, db)
    )


def _build_system_prompt(request: AgentCreateRequest) -> str:
    """Combine agent_description, behavioral_guidelines, output_expectations into a system prompt."""
    parts = []
    if request.agent_description:
        parts.append(request.agent_description)
    if request.behavioral_guidelines:
        parts.append(request.behavioral_guidelines)
    if request.output_expectations:
        parts.append(request.output_expectations)
    return "\n\n".join(parts) if parts else "You are a helpful assistant."


# ---------------------------------------------------------------------------
# Discovery endpoints
# ---------------------------------------------------------------------------
@router.get("/roles")
def list_roles() -> list[dict]:
    """List available IAM roles with bedrock-agentcore trust policy."""
    region = os.getenv("AWS_REGION", DEFAULT_REGION)
    return list_agentcore_roles(region)


@router.get("/cognito-pools")
def get_cognito_pools() -> list[dict]:
    """List available Cognito user pools."""
    region = os.getenv("AWS_REGION", DEFAULT_REGION)
    return list_cognito_pools(region)


@router.get("/models")
def get_models() -> list[dict]:
    """Return list of supported Bedrock model IDs."""
    return SUPPORTED_MODELS


@router.get("/defaults")
def get_defaults() -> dict:
    """Return configurable default values for the frontend."""
    return {
        "idle_timeout_seconds": int(os.getenv("LOOM_SESSION_IDLE_TIMEOUT_SECONDS", "300")),
        "max_lifetime_seconds": int(os.getenv("LOOM_SESSION_MAX_LIFETIME_SECONDS", "3600")),
    }


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------
@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
def create_agent(
    request: AgentCreateRequest,
    db: Session = Depends(get_db)
) -> AgentResponse:
    """Create a new agent via registration (existing ARN) or deployment (new runtime)."""
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

    existing_agent = db.query(Agent).filter(Agent.arn == request.arn).first()
    if existing_agent:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Agent with ARN {request.arn} is already registered with ID {existing_agent.id}"
        )

    try:
        region, account_id, runtime_id = parse_arn(request.arn)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    try:
        metadata = describe_runtime(request.arn, region)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to describe runtime: {str(e)}"
        )

    try:
        qualifiers = list_runtime_endpoints(runtime_id, region)
    except Exception:
        qualifiers = ["DEFAULT"]

    protocol_config = metadata.get("protocolConfiguration", {})
    protocol = protocol_config.get("serverProtocol", "HTTP")
    network_config = metadata.get("networkConfiguration", {})
    network_mode = network_config.get("networkMode", "PUBLIC")

    agent = Agent(
        arn=request.arn,
        runtime_id=runtime_id,
        name=metadata.get("agentRuntimeName"),
        status=metadata.get("status"),
        region=region,
        account_id=account_id,
        log_group=derive_log_group(runtime_id, qualifiers[0]) if qualifiers else None,
        source="register",
        protocol=protocol,
        network_mode=network_mode,
        registered_at=datetime.utcnow(),
        last_refreshed_at=datetime.utcnow(),
    )
    agent.set_available_qualifiers(qualifiers)
    agent.set_raw_metadata(metadata)

    db.add(agent)
    db.commit()
    db.refresh(agent)

    # Store model_id as config entry if provided
    if request.model_id:
        config_json = json.dumps({"model_id": request.model_id})
        entry = ConfigEntry(
            agent_id=agent.id,
            key="AGENT_CONFIG_JSON",
            value=config_json,
            is_secret=False,
            source="env_var",
        )
        db.add(entry)

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
    if not request.model_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Field 'model_id' is required when source is 'deploy'"
        )

    # AgentCore runtime names must match [a-zA-Z][a-zA-Z0-9_]{0,47}
    runtime_name_pattern = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{0,47}$")
    if not runtime_name_pattern.match(request.name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid agent name '{request.name}'. "
                "Must start with a letter, contain only letters, digits, and underscores, "
                "and be at most 48 characters."
            )
        )

    region = os.getenv("AWS_REGION", DEFAULT_REGION)
    account_id = os.getenv("AWS_ACCOUNT_ID", "")

    # Build config JSON (includes system prompt, model, and integrations)
    system_prompt = _build_system_prompt(request)
    config_json = json.dumps({
        "system_prompt": system_prompt,
        "model_id": request.model_id,
        "integrations": {
            "mcp_servers": request.mcp_servers,
            "a2a_agents": request.a2a_agents,
            "memory": {"enabled": request.memory_enabled},
        },
    })
    env_vars = {
        "AGENT_CONFIG_JSON": config_json,
        "OTEL_SERVICE_NAME": request.name,
    }

    # Use a unique placeholder for ARN until deployment completes
    placeholder_arn = f"pending-{uuid4()}"

    # Create agent record with CREATING status
    agent = Agent(
        arn=placeholder_arn,
        runtime_id="",
        name=request.name,
        status="CREATING",
        region=region,
        account_id=account_id,
        source="deploy",
        deployment_status="deploying",
        protocol=request.protocol,
        network_mode=request.network_mode,
        registered_at=datetime.utcnow(),
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    # Store config entries
    for key, value in env_vars.items():
        entry = ConfigEntry(
            agent_id=agent.id,
            key=key,
            value=value,
            is_secret=False,
            source="env_var",
        )
        db.add(entry)
    db.commit()

    # Create or use provided IAM execution role
    created_role = False
    execution_role_arn = request.role_arn
    if not execution_role_arn:
        try:
            execution_role_arn = create_execution_role(
                agent_name=request.name,
                runtime_id=f"pending-{agent.id}",
                region=region,
                account_id=account_id,
            )
            created_role = True
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
    else:
        agent.execution_role_arn = execution_role_arn
        db.commit()

    # Build agent artifact
    try:
        artifact_bucket, artifact_key = build_agent_artifact(region)
    except Exception as e:
        agent.deployment_status = "failed"
        agent.status = "FAILED"
        db.commit()
        if created_role and execution_role_arn:
            _cleanup_role(execution_role_arn)
        logger.error("Failed to build artifact for agent %s: %s", agent.id, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to build agent artifact: {str(e)}"
        )

    # Build optional configs
    lifecycle_config = None
    if request.idle_timeout or request.max_lifetime:
        lifecycle_config = {}
        if request.idle_timeout:
            lifecycle_config["idleRuntimeSessionTimeout"] = request.idle_timeout
        if request.max_lifetime:
            lifecycle_config["maxLifetime"] = request.max_lifetime

    authorizer_config = None
    if request.authorizer_type == "cognito" and request.authorizer_pool_id:
        jwt_config: dict[str, Any] = {
            "discoveryUrl": f"https://cognito-idp.{region}.amazonaws.com/{request.authorizer_pool_id}/.well-known/openid-configuration"
        }
        if request.authorizer_allowed_clients:
            jwt_config["allowedClients"] = request.authorizer_allowed_clients
        if request.authorizer_allowed_scopes:
            jwt_config["allowedScopes"] = request.authorizer_allowed_scopes
        authorizer_config = {"customJWTAuthorizer": jwt_config}
    elif request.authorizer_type == "other" and request.authorizer_discovery_url:
        jwt_config = {"discoveryUrl": request.authorizer_discovery_url}
        if request.authorizer_allowed_clients:
            jwt_config["allowedClients"] = request.authorizer_allowed_clients
        if request.authorizer_allowed_scopes:
            jwt_config["allowedScopes"] = request.authorizer_allowed_scopes
        authorizer_config = {"customJWTAuthorizer": jwt_config}

    # Deploy to AgentCore
    try:
        response = create_runtime(
            name=request.name,
            description=request.description,
            role_arn=execution_role_arn,
            env_vars=env_vars,
            network_mode=request.network_mode,
            protocol=request.protocol,
            lifecycle_config=lifecycle_config,
            authorizer_config=authorizer_config,
            artifact_bucket=artifact_bucket,
            artifact_prefix=artifact_key,
            region=region,
        )

        runtime_arn = response.get("agentRuntimeArn", "")
        runtime_id = response.get("agentRuntimeId", "")

        # Extract account_id from the returned ARN
        try:
            _, arn_account_id, _ = parse_arn(runtime_arn)
            agent.account_id = arn_account_id
        except ValueError:
            pass

        agent.arn = runtime_arn
        agent.runtime_id = runtime_id
        agent.deployment_status = "deployed"
        agent.status = response.get("status", "CREATING")
        agent.deployed_at = datetime.utcnow()
        agent.last_refreshed_at = datetime.utcnow()
        agent.log_group = derive_log_group(runtime_id, "DEFAULT") if runtime_id else None
        agent.set_available_qualifiers(["DEFAULT"])

        # Persist authorizer config for token retrieval at invoke time
        if request.authorizer_type:
            agent.set_authorizer_config({
                "type": request.authorizer_type,
                "pool_id": request.authorizer_pool_id,
                "discovery_url": request.authorizer_discovery_url,
                "allowed_clients": request.authorizer_allowed_clients,
                "allowed_scopes": request.authorizer_allowed_scopes,
            })

            # Store Cognito client credentials for token retrieval
            if request.authorizer_client_id:
                db.add(ConfigEntry(
                    agent_id=agent.id,
                    key="COGNITO_CLIENT_ID",
                    value=request.authorizer_client_id,
                    is_secret=False,
                    source="env_var",
                ))
            if request.authorizer_client_id and request.authorizer_client_secret:
                secret_name = f"loom/agents/{agent.id}/cognito-client-secret"
                secret_arn = store_secret(
                    name=secret_name,
                    secret_value=request.authorizer_client_secret,
                    region=region,
                    description=f"Cognito client secret for Loom agent {agent.id} (client_id: {request.authorizer_client_id})",
                )
                db.add(ConfigEntry(
                    agent_id=agent.id,
                    key="COGNITO_CLIENT_SECRET_ARN",
                    value=secret_arn,
                    is_secret=True,
                    source="secrets_manager",
                ))

        db.commit()
        db.refresh(agent)
    except Exception as e:
        agent.deployment_status = "failed"
        agent.status = "FAILED"
        db.commit()
        if created_role and execution_role_arn:
            _cleanup_role(execution_role_arn)
        logger.error("Failed to deploy agent %s: %s", agent.id, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to deploy agent runtime: {str(e)}"
        )

    return AgentResponse(**agent.to_dict(), active_session_count=0)


def _cleanup_role(role_arn: str) -> None:
    """Best-effort cleanup of an IAM role on deploy failure."""
    try:
        role_name = role_arn.split("/")[-1]
        delete_execution_role(role_name)
    except Exception as e:
        logger.warning("Failed to clean up orphaned IAM role %s: %s", role_arn, e)


@router.get("", response_model=list[AgentResponse])
def list_agents(db: Session = Depends(get_db)) -> list[AgentResponse]:
    """List all registered agents."""
    agents = db.query(Agent).order_by(Agent.registered_at.desc()).all()
    return [_agent_response(agent, db) for agent in agents]


@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(agent_id: int, db: Session = Depends(get_db)) -> AgentResponse:
    """Get metadata for a specific registered agent."""
    agent = get_agent_or_404(agent_id, db)
    return _agent_response(agent, db)


@router.get("/{agent_id}/status", response_model=AgentResponse)
def get_agent_status(agent_id: int, db: Session = Depends(get_db)) -> AgentResponse:
    """Poll AWS for current runtime and endpoint status, update local DB.

    If the runtime is READY and no endpoint exists yet, creates one automatically.
    """
    agent = get_agent_or_404(agent_id, db)

    if agent.runtime_id and agent.source == "deploy":
        # Check runtime status
        try:
            rt = get_runtime(agent.runtime_id, agent.region)
            agent.status = rt.get("status", agent.status)
            agent.arn = rt.get("agentRuntimeArn", agent.arn)
            agent.last_refreshed_at = datetime.utcnow()
        except Exception as e:
            logger.warning("Failed to poll runtime status for %s: %s", agent.runtime_id, e)

        # If runtime is READY and no endpoint exists, create one
        if agent.status == "READY" and not agent.endpoint_name:
            try:
                ep_response = create_runtime_endpoint(
                    runtime_id=agent.runtime_id,
                    name=f"{agent.name}-ep",
                    description=f"Endpoint for {agent.name}",
                    region=agent.region,
                )
                agent.endpoint_name = ep_response.get("name", f"{agent.name}-ep")
                agent.endpoint_arn = ep_response.get("agentRuntimeEndpointArn")
                agent.endpoint_status = ep_response.get("status", "CREATING")
                agent.deployment_status = "ENDPOINT_CREATING"
            except Exception as e:
                logger.warning("Failed to create endpoint for %s: %s", agent.runtime_id, e)

        # If endpoint exists, check its status
        if agent.endpoint_name:
            try:
                ep = get_runtime_endpoint(agent.runtime_id, agent.endpoint_name, agent.region)
                agent.endpoint_status = ep.get("status", agent.endpoint_status)
                agent.endpoint_arn = ep.get("agentRuntimeEndpointArn", agent.endpoint_arn)
                if agent.endpoint_status == "READY":
                    agent.deployment_status = "READY"
            except Exception as e:
                logger.warning("Failed to poll endpoint status for %s: %s", agent.endpoint_name, e)

    db.commit()
    db.refresh(agent)

    return _agent_response(agent, db)


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent(
    agent_id: int,
    cleanup_aws: bool = False,
    db: Session = Depends(get_db),
) -> None:
    """Remove an agent from the local registry.

    Args:
        cleanup_aws: If True, also delete the runtime, endpoint, and IAM role from AWS.
    """
    agent = get_agent_or_404(agent_id, db)

    if cleanup_aws and agent.runtime_id:
        # Delete endpoint first
        if agent.endpoint_name:
            try:
                delete_runtime_endpoint(agent.runtime_id, agent.endpoint_name, agent.region)
            except Exception as e:
                logger.warning("Failed to delete endpoint %s: %s", agent.endpoint_name, e)

        # Delete runtime
        try:
            delete_runtime(agent.runtime_id, agent.region)
        except Exception as e:
            logger.warning("Failed to delete runtime %s: %s", agent.runtime_id, e)

    # Clean up Cognito client secret from Secrets Manager
    config_map = {e.key: e.value for e in agent.config_entries}
    secret_arn = config_map.get("COGNITO_CLIENT_SECRET_ARN")
    if secret_arn:
        delete_secret(secret_arn, agent.region)

    db.delete(agent)
    db.commit()


@router.post("/{agent_id}/refresh", response_model=AgentResponse)
def refresh_agent(agent_id: int, db: Session = Depends(get_db)) -> AgentResponse:
    """Re-fetch metadata from AgentCore and update the local record."""
    agent = get_agent_or_404(agent_id, db)

    try:
        metadata = describe_runtime(agent.arn, agent.region)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to describe runtime: {str(e)}"
        )

    try:
        qualifiers = list_runtime_endpoints(agent.runtime_id, agent.region)
    except Exception:
        qualifiers = agent.get_available_qualifiers()

    agent.name = metadata.get("agentRuntimeName")
    agent.status = metadata.get("status")
    protocol_config = metadata.get("protocolConfiguration", {})
    agent.protocol = protocol_config.get("serverProtocol", agent.protocol or "HTTP")
    network_config = metadata.get("networkConfiguration", {})
    agent.network_mode = network_config.get("networkMode", agent.network_mode or "PUBLIC")
    if not agent.account_id:
        try:
            _, arn_account_id, _ = parse_arn(agent.arn)
            agent.account_id = arn_account_id
        except ValueError:
            pass
    agent.set_available_qualifiers(qualifiers)
    agent.set_raw_metadata(metadata)
    agent.last_refreshed_at = datetime.utcnow()

    db.commit()
    db.refresh(agent)

    return _agent_response(agent, db)


@router.post("/{agent_id}/redeploy", response_model=AgentResponse)
def redeploy_agent_endpoint(agent_id: int, db: Session = Depends(get_db)) -> AgentResponse:
    """Redeploy an agent with its current code and config."""
    agent = get_agent_or_404(agent_id, db)

    if agent.source != "deploy":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only deployed agents can be redeployed"
        )

    if not agent.runtime_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Agent is missing runtime_id"
        )

    config_entries = db.query(ConfigEntry).filter(ConfigEntry.agent_id == agent_id).all()
    env_vars = {entry.key: entry.value for entry in config_entries if entry.value is not None}

    agent.deployment_status = "deploying"
    db.commit()

    try:
        response = update_runtime(
            runtime_id=agent.runtime_id,
            env_vars=env_vars if env_vars else None,
            region=agent.region,
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


@router.get("/{agent_id}/config", response_model=list[ConfigEntryResponse])
def get_agent_config(agent_id: int, db: Session = Depends(get_db)) -> list[ConfigEntryResponse]:
    """Get all configuration entries for an agent. Secret values are masked."""
    get_agent_or_404(agent_id, db)
    entries = db.query(ConfigEntry).filter(ConfigEntry.agent_id == agent_id).all()
    result = []
    for entry in entries:
        d = entry.to_dict()
        if entry.is_secret:
            d["value"] = "********"
        result.append(ConfigEntryResponse(**d))
    return result


@router.put("/{agent_id}/config", response_model=list[ConfigEntryResponse])
def update_agent_config(
    agent_id: int,
    request: ConfigUpdateRequest,
    db: Session = Depends(get_db),
) -> list[ConfigEntryResponse]:
    """Update configuration entries for an agent. Adds new keys and updates existing ones."""
    get_agent_or_404(agent_id, db)

    for key, value in request.config.items():
        existing = db.query(ConfigEntry).filter(
            ConfigEntry.agent_id == agent_id,
            ConfigEntry.key == key,
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
    result = []
    for entry in entries:
        d = entry.to_dict()
        if entry.is_secret:
            d["value"] = "********"
        result.append(ConfigEntryResponse(**d))
    return result
