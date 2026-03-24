"""Agent registration, deployment, and management endpoints."""
import json
import logging
import os
import re
import time
from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db, SessionLocal
from app.dependencies.auth import UserInfo, require_scopes
from app.models.agent import Agent
from app.models.authorizer_config import AuthorizerConfig
from app.models.config_entry import ConfigEntry
from app.models.a2a import A2aAgent as A2aAgentModel, A2aAgentAccess
from app.models.memory import Memory
from app.models.mcp import McpServer, McpServerAccess
from app.models.session import InvocationSession
from app.models.invocation import Invocation
from app.models.tag_policy import TagPolicy
from app.routers.utils import get_agent_or_404

from app.services.agentcore import describe_runtime, list_runtime_endpoints
from app.services.deployment import (
    _merge_tags,
    build_agent_artifact,
    create_runtime,
    delete_runtime,
    delete_runtime_endpoint,
    get_runtime,
    get_runtime_endpoint,
    update_runtime,
)
from app.services.iam import (
    _iam_tags,
    create_execution_role,
    delete_execution_role,
    list_agentcore_roles,
    list_cognito_pools,
)
from app.services.credential import create_oauth2_credential_provider, delete_credential_provider
from app.services.secrets import store_secret, delete_secret

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agents", tags=["agents"])

DEFAULT_REGION = os.getenv("AWS_REGION", "us-east-1")

SUPPORTED_MODELS = [
    {"model_id": "us.anthropic.claude-opus-4-6-v1", "display_name": "Claude Opus 4.6", "group": "Anthropic", "max_tokens": 16384, "input_price_per_1k_tokens": 0.015, "output_price_per_1k_tokens": 0.075, "pricing_as_of": "2025-06-01"},
    {"model_id": "us.anthropic.claude-sonnet-4-6", "display_name": "Claude Sonnet 4.6", "group": "Anthropic", "max_tokens": 16384, "input_price_per_1k_tokens": 0.003, "output_price_per_1k_tokens": 0.015, "pricing_as_of": "2025-06-01"},
    {"model_id": "us.anthropic.claude-opus-4-5-20251101-v1:0", "display_name": "Claude Opus 4.5", "group": "Anthropic", "max_tokens": 16384, "input_price_per_1k_tokens": 0.015, "output_price_per_1k_tokens": 0.075, "pricing_as_of": "2025-06-01"},
    {"model_id": "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "display_name": "Claude Sonnet 4.5", "group": "Anthropic", "max_tokens": 16384, "input_price_per_1k_tokens": 0.003, "output_price_per_1k_tokens": 0.015, "pricing_as_of": "2025-06-01"},
    {"model_id": "us.anthropic.claude-haiku-4-5-20251001-v1:0", "display_name": "Claude Haiku 4.5", "group": "Anthropic", "max_tokens": 8192, "input_price_per_1k_tokens": 0.0008, "output_price_per_1k_tokens": 0.004, "pricing_as_of": "2025-06-01"},
    {"model_id": "us.amazon.nova-2-lite-v1:0", "display_name": "Nova 2 Lite", "group": "Amazon", "max_tokens": 5120, "input_price_per_1k_tokens": 0.00006, "output_price_per_1k_tokens": 0.00024, "pricing_as_of": "2025-06-01"},
    {"model_id": "us.amazon.nova-premier-v1:0", "display_name": "Nova Premier", "group": "Amazon", "max_tokens": 5120, "input_price_per_1k_tokens": 0.0025, "output_price_per_1k_tokens": 0.0125, "pricing_as_of": "2025-06-01"},
    {"model_id": "us.amazon.nova-pro-v1:0", "display_name": "Nova Pro", "group": "Amazon", "max_tokens": 5120, "input_price_per_1k_tokens": 0.0008, "output_price_per_1k_tokens": 0.0032, "pricing_as_of": "2025-06-01"},
    {"model_id": "us.amazon.nova-lite-v1:0", "display_name": "Nova Lite", "group": "Amazon", "max_tokens": 5120, "input_price_per_1k_tokens": 0.00006, "output_price_per_1k_tokens": 0.00024, "pricing_as_of": "2025-06-01"},
    {"model_id": "us.amazon.nova-micro-v1:0", "display_name": "Nova Micro", "group": "Amazon", "max_tokens": 5120, "input_price_per_1k_tokens": 0.000035, "output_price_per_1k_tokens": 0.00014, "pricing_as_of": "2025-06-01"},
]

# AgentCore Runtime pricing (per-hour rates) and default resource allocation
AGENTCORE_RUNTIME_PRICING = {
    "cpu_per_vcpu_hour": 0.0895,
    "memory_per_gb_hour": 0.00945,
    "default_vcpu": 1,
    "default_memory_gb": 0.5,
    "default_idle_timeout_seconds": 900,
    "pricing_as_of": "2025-06-01",
}


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
    memory_ids: list[int] = Field(default_factory=list, description="Memory resource IDs to integrate")
    mcp_servers: list[int] = Field(default_factory=list, description="MCP server IDs to integrate")
    a2a_agents: list[int] = Field(default_factory=list, description="A2A agent IDs to integrate")
    tags: dict[str, str] | None = Field(None, description="Build-time tag values")


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
    memory_ids: list[int] = Field(default_factory=list, description="Memory resource IDs to integrate")
    mcp_servers: list[int] = Field(default_factory=list, description="MCP server IDs to integrate")
    a2a_agents: list[int] = Field(default_factory=list, description="A2A agent IDs to integrate")
    tags: dict[str, str] | None = Field(None, description="Build-time tag values")


class AgentResponse(BaseModel):
    """Response model for agent details."""
    id: int
    arn: str
    runtime_id: str
    name: str | None
    description: str | None = None
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
    tags: dict[str, str] = {}
    authorizer_config: dict | None = None
    model_id: str | None = None
    deployed_at: str | None = None
    registered_at: str | None
    last_refreshed_at: str | None
    active_session_count: int
    cost_summary: dict | None = None
    memory_names: list[str] = []
    mcp_names: list[str] = []
    a2a_names: list[str] = []


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


class AgentUpdateRequest(BaseModel):
    """Request body for patching editable agent fields."""
    description: str | None = None


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
    memory_names: list[str] = []
    mcp_names: list[str] = []
    a2a_names: list[str] = []

    for entry in agent.config_entries:
        if entry.key == "AGENT_CONFIG_JSON":
            try:
                config = json.loads(entry.value)
                model_id = config.get("model_id")

                # Extract integration names from config
                integrations = config.get("integrations", {})

                # Memory resources
                memory_resources = integrations.get("memory", {}).get("resources", [])
                for mem_res in memory_resources:
                    mem_id = mem_res.get("memory_id")
                    if mem_id:
                        mem_record = db.query(Memory).filter(Memory.memory_id == mem_id).first()
                        if mem_record:
                            memory_names.append(mem_record.name)

                # MCP servers
                mcp_servers = integrations.get("mcp_servers", [])
                for mcp_server in mcp_servers:
                    mcp_name = mcp_server.get("name")
                    if mcp_name:
                        mcp_names.append(mcp_name)

                # A2A agents
                a2a_agents = integrations.get("a2a_agents", [])
                for a2a_agent in a2a_agents:
                    a2a_name = a2a_agent.get("name")
                    if a2a_name:
                        a2a_names.append(a2a_name)

            except (json.JSONDecodeError, TypeError):
                pass
            break

    agent_dict = agent.to_dict()

    # Enrich authorizer_config with the matching AuthorizerConfig name
    auth_cfg = agent_dict.get("authorizer_config")
    if auth_cfg and auth_cfg.get("pool_id"):
        ac = db.query(AuthorizerConfig).filter(AuthorizerConfig.pool_id == auth_cfg["pool_id"]).first()
        if ac:
            auth_cfg["name"] = ac.name

    # Compute cost summary from invocations.
    # Sum per-invocation pre-rounded values so totals match what the detail
    # pages display (avoids rounding discrepancies from recomputing off
    # aggregate duration).
    base_q = db.query(Invocation).join(
        InvocationSession, Invocation.session_id == InvocationSession.session_id
    ).filter(InvocationSession.agent_id == agent.id)
    total_input = base_q.with_entities(func.sum(Invocation.input_tokens)).scalar() or 0
    total_output = base_q.with_entities(func.sum(Invocation.output_tokens)).scalar() or 0
    total_est = base_q.with_entities(func.sum(Invocation.estimated_cost)).scalar() or 0.0
    total_idle_mem = base_q.with_entities(func.sum(Invocation.idle_memory_cost)).scalar() or 0.0
    total_stm = base_q.with_entities(func.sum(Invocation.stm_cost)).scalar() or 0.0
    total_ltm = base_q.with_entities(func.sum(Invocation.ltm_cost)).scalar() or 0.0
    inv_count = base_q.with_entities(func.count(Invocation.id)).scalar() or 0

    # Recompute per-invocation runtime costs at view time (matching _apply_view_time_costs)
    from app.routers.settings import get_cpu_io_wait_discount
    io_discount = get_cpu_io_wait_discount(db)
    invocations = base_q.all()
    rt_cpu = 0.0
    rt_mem_compute = 0.0
    for inv in invocations:
        dur = inv.client_duration_ms
        if dur is not None and dur > 0:
            hours = dur / 1000 / 3600
            raw_cpu = hours * AGENTCORE_RUNTIME_PRICING["default_vcpu"] * AGENTCORE_RUNTIME_PRICING["cpu_per_vcpu_hour"]
            rt_cpu += round(raw_cpu * (1.0 - io_discount), 6)
            rt_mem_compute += round(hours * AGENTCORE_RUNTIME_PRICING["default_memory_gb"] * AGENTCORE_RUNTIME_PRICING["memory_per_gb_hour"], 6)
    rt_total = rt_cpu + rt_mem_compute + total_idle_mem
    mem_total = total_stm + total_ltm
    grand_total = total_est + rt_total + mem_total

    result = AgentResponse(
        **agent_dict,
        model_id=model_id,
        active_session_count=compute_active_session_count(agent.id, db),
        memory_names=memory_names,
        mcp_names=mcp_names,
        a2a_names=a2a_names
    )
    if inv_count > 0 and grand_total > 0:
        result.cost_summary = {
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "total_model_cost": round(total_est, 6),
            "total_runtime_cost": round(rt_total, 6),
            "total_memory_cost": round(mem_total, 6),
            "total_cost": round(grand_total, 6),
            "total_invocations": inv_count,
        }
    else:
        result.cost_summary = None
    return result


def _resolve_tags(
    db: Session,
    user_tags: dict[str, str] | None = None,
) -> tuple[dict[str, str], list[dict[str, Any]]]:
    """Resolve final tag values from tag policies and user-supplied tags.

    Returns:
        Tuple of (resolved_tags dict, tag_policies as list of dicts).
    Raises:
        HTTPException if required tags are missing.
    """
    policies = db.query(TagPolicy).all()
    policy_dicts = [{"key": p.key, "default_value": p.default_value, "required": p.required} for p in policies]

    resolved: dict[str, str] = {}
    missing: list[str] = []
    user_tags = user_tags or {}

    for p in policies:
        if p.key in user_tags:
            resolved[p.key] = user_tags[p.key]
        elif p.required:
            if p.default_value:
                resolved[p.key] = p.default_value
            else:
                missing.append(p.key)
        elif p.default_value:
            resolved[p.key] = p.default_value

    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required tags: {', '.join(missing)}",
        )

    return resolved, policy_dicts


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
def list_roles(user: UserInfo = Depends(require_scopes("agent:read"))) -> list[dict]:
    """List available IAM roles with bedrock-agentcore trust policy."""
    region = os.getenv("AWS_REGION", DEFAULT_REGION)
    return list_agentcore_roles(region)


@router.get("/cognito-pools")
def get_cognito_pools(user: UserInfo = Depends(require_scopes("agent:read"))) -> list[dict]:
    """List available Cognito user pools."""
    region = os.getenv("AWS_REGION", DEFAULT_REGION)
    return list_cognito_pools(region)


@router.get("/models")
def get_models(user: UserInfo = Depends(require_scopes("agent:read"))) -> list[dict]:
    """Return list of supported Bedrock model IDs."""
    return SUPPORTED_MODELS


@router.get("/models/pricing")
def get_model_pricing(
    user: UserInfo = Depends(require_scopes("agent:read")),
) -> list[dict]:
    """Return models with pricing data."""
    return SUPPORTED_MODELS


@router.get("/defaults")
def get_defaults(user: UserInfo = Depends(require_scopes("agent:read"))) -> dict:
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
    background_tasks: BackgroundTasks,
    user: UserInfo = Depends(require_scopes("agent:write")),
    db: Session = Depends(get_db),
) -> AgentResponse:
    """Create a new agent via registration (existing ARN) or deployment (new runtime)."""
    # Enforce demo-admin group restriction
    if "g-admins-demo" in user.groups and "g-admins-super" not in user.groups:
        agent_group = (request.tags or {}).get("loom:group", "")
        if agent_group != "demo":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Demo admins can only create agents in the 'demo' group"
            )

    # Enforce demo user restrictions: name must start with "demo_"
    if "g-users-demo" in user.groups:
        name = request.name or ""
        if not name.startswith("demo_"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Demo users must prefix agent names with 'demo_'",
            )

    if request.source == "register":
        return _register_agent(request, db)
    elif request.source == "deploy":
        return _deploy_agent(request, db, background_tasks)
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

    # Extract authorizer configuration from runtime metadata
    authorizer_metadata = metadata.get("authorizerConfiguration", {})
    jwt_authorizer = authorizer_metadata.get("customJWTAuthorizer", {})
    imported_authorizer = None
    if jwt_authorizer:
        discovery_url = jwt_authorizer.get("discoveryUrl", "")
        auth_type = "cognito" if "cognito-idp" in discovery_url else "other"
        imported_authorizer = {
            "type": auth_type,
            "discovery_url": discovery_url,
            "allowed_clients": jwt_authorizer.get("allowedClients", []),
            "allowed_scopes": jwt_authorizer.get("allowedScopes", []),
        }

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
    if imported_authorizer:
        agent.set_authorizer_config(imported_authorizer)

    db.add(agent)
    db.commit()
    db.refresh(agent)

    # Fetch tags from AWS for registered agents
    aws_tags: dict[str, str] = {}
    try:
        import boto3
        control_client = boto3.client("bedrock-agentcore-control", region_name=region)
        tag_response = control_client.list_tags_for_resource(resourceArn=request.arn)
        aws_tags = tag_response.get("tags", {})
    except Exception as e:
        logger.debug("Could not fetch tags for registered agent %s: %s", request.arn, e)

    # Enforce tag policies: add missing required tags with value "missing"
    policies = db.query(TagPolicy).all()
    for p in policies:
        if p.key not in aws_tags and p.required:
            aws_tags[p.key] = p.default_value if p.default_value else "missing"

    if aws_tags:
        agent.set_tags(aws_tags)
        db.commit()

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


def _deploy_agent(request: AgentCreateRequest, db: Session, background_tasks: BackgroundTasks) -> AgentResponse:
    """Deploy a new agent runtime to AgentCore.

    Validates inputs synchronously, creates the agent record, then schedules the
    heavy work (credential providers, IAM role, artifact build, runtime creation)
    as a background task so the API returns immediately.
    """
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

    # Resolve tags from tag policies + user-supplied profile values
    resolved_tags, tag_policy_dicts = _resolve_tags(db, request.tags)

    # Build system prompt and model config
    system_prompt = _build_system_prompt(request)
    model_max_tokens = next(
        (m["max_tokens"] for m in SUPPORTED_MODELS if m["model_id"] == request.model_id),
        4096,
    )

    # Validate MCP server IDs early (before creating agent record)
    mcp_records: list[McpServer] = []
    if request.mcp_servers:
        mcp_records = db.query(McpServer).filter(McpServer.id.in_(request.mcp_servers)).all()
        found_ids = {s.id for s in mcp_records}
        missing = set(request.mcp_servers) - found_ids
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"MCP server IDs not found: {sorted(missing)}"
            )

    # Validate A2A agent IDs early
    a2a_records: list[A2aAgentModel] = []
    if request.a2a_agents:
        a2a_records = db.query(A2aAgentModel).filter(A2aAgentModel.id.in_(request.a2a_agents)).all()
        found_ids = {a.id for a in a2a_records}
        missing = set(request.a2a_agents) - found_ids
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"A2A agent IDs not found: {sorted(missing)}"
            )

    # Validate Memory IDs early
    memory_records: list[Memory] = []
    if request.memory_ids:
        memory_records = db.query(Memory).filter(Memory.id.in_(request.memory_ids)).all()
        found_ids = {m.id for m in memory_records}
        missing = set(request.memory_ids) - found_ids
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Memory IDs not found: {sorted(missing)}"
            )

    # Snapshot MCP server data for the background task (avoid lazy-load after session close)
    mcp_snapshots = [
        {
            "name": s.name,
            "endpoint_url": s.endpoint_url,
            "transport_type": s.transport_type,
            "auth_type": s.auth_type,
            "oauth2_well_known_url": s.oauth2_well_known_url,
            "oauth2_client_id": s.oauth2_client_id,
            "oauth2_client_secret": s.oauth2_client_secret,
            "oauth2_scopes": s.oauth2_scopes,
        }
        for s in mcp_records
    ]

    # Snapshot A2A agent data
    a2a_snapshots = [
        {
            "name": a.name,
            "base_url": a.base_url,
            "auth_type": a.auth_type,
            "oauth2_well_known_url": a.oauth2_well_known_url,
            "oauth2_client_id": a.oauth2_client_id,
            "oauth2_client_secret": a.oauth2_client_secret,
            "oauth2_scopes": a.oauth2_scopes,
        }
        for a in a2a_records
    ]

    # Snapshot memory data
    memory_snapshots = [
        {"name": m.name, "memory_id": m.memory_id, "arn": m.arn}
        for m in memory_records
    ]

    # Use a unique placeholder for ARN until deployment completes
    placeholder_arn = f"pending-{uuid4()}"

    # Create agent record with CREATING status — returned to frontend immediately
    agent = Agent(
        arn=placeholder_arn,
        runtime_id="",
        name=request.name,
        description=request.description or None,
        status="CREATING",
        region=region,
        account_id=account_id,
        source="deploy",
        deployment_status="initializing",
        protocol=request.protocol,
        network_mode=request.network_mode,
        registered_at=datetime.utcnow(),
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    # Apply resolved tags immediately so tag-based filtering (e.g. demo user
    # group restriction) sees the agent as soon as it enters CREATING status.
    if resolved_tags:
        agent.set_tags(resolved_tags)
        db.commit()
        db.refresh(agent)

    agent_id = agent.id
    response_data = AgentResponse(**agent.to_dict(), active_session_count=0)

    # Auto-grant access control for MCP servers and A2A agents with existing rules
    for mcp_server_id in request.mcp_servers:
        # Check if any access rules exist for this MCP server
        existing_rules = db.query(McpServerAccess).filter(
            McpServerAccess.server_id == mcp_server_id
        ).first()

        if existing_rules:
            # Check if a rule already exists for the new agent
            agent_rule = db.query(McpServerAccess).filter(
                McpServerAccess.server_id == mcp_server_id,
                McpServerAccess.persona_id == agent_id
            ).first()

            if not agent_rule:
                # Create new access rule for this agent
                new_rule = McpServerAccess(
                    server_id=mcp_server_id,
                    persona_id=agent_id,
                    access_level="all_tools",
                    allowed_tool_names=None
                )
                db.add(new_rule)

    for a2a_agent_id in request.a2a_agents:
        # Check if any access rules exist for this A2A agent
        existing_rules = db.query(A2aAgentAccess).filter(
            A2aAgentAccess.agent_id == a2a_agent_id
        ).first()

        if existing_rules:
            # Check if a rule already exists for the new agent
            agent_rule = db.query(A2aAgentAccess).filter(
                A2aAgentAccess.agent_id == a2a_agent_id,
                A2aAgentAccess.persona_id == agent_id
            ).first()

            if not agent_rule:
                # Create new access rule for this agent
                new_rule = A2aAgentAccess(
                    agent_id=a2a_agent_id,
                    persona_id=agent_id,
                    access_level="all_skills",
                    allowed_skill_ids=None
                )
                db.add(new_rule)

    # Commit all auto-granted access rules
    if request.mcp_servers or request.a2a_agents:
        db.commit()

    # Schedule heavy deployment work in the background
    background_tasks.add_task(
        _deploy_agent_background,
        agent_id=agent_id,
        request=request,
        mcp_snapshots=mcp_snapshots,
        a2a_snapshots=a2a_snapshots,
        memory_snapshots=memory_snapshots,
        resolved_tags=resolved_tags,
        tag_policy_dicts=tag_policy_dicts,
        system_prompt=system_prompt,
        model_max_tokens=model_max_tokens,
        region=region,
        account_id=account_id,
    )

    return response_data


def _deploy_agent_background(
    agent_id: int,
    request: AgentCreateRequest,
    mcp_snapshots: list[dict[str, Any]],
    a2a_snapshots: list[dict[str, Any]],
    memory_snapshots: list[dict[str, Any]],
    resolved_tags: dict[str, str],
    tag_policy_dicts: list[dict[str, Any]],
    system_prompt: str,
    model_max_tokens: int,
    region: str,
    account_id: str,
) -> None:
    """Background task that performs the actual deployment steps.

    Uses its own DB session since the request session is closed after the response.
    Updates deployment_status at each stage so the frontend can show progress.
    """
    db = SessionLocal()
    try:
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        if not agent:
            logger.error("Background deploy: agent %s not found", agent_id)
            return

        # --- Step 1: Create credential providers (if OAuth2 MCP servers or A2A agents exist) ---
        has_oauth2 = any(s["auth_type"] == "oauth2" for s in mcp_snapshots) or any(a["auth_type"] == "oauth2" for a in a2a_snapshots)
        if has_oauth2:
            agent.deployment_status = "creating_credentials"
            db.commit()

        mcp_server_configs: list[dict[str, Any]] = []
        for server in mcp_snapshots:
            entry: dict[str, Any] = {
                "name": server["name"],
                "enabled": True,
                "transport": server["transport_type"],
                "endpoint_url": server["endpoint_url"],
            }
            if server["auth_type"] == "oauth2":
                cp_name = f"loom-{request.name}-mcp-{server['name']}"
                try:
                    cp_response = create_oauth2_credential_provider(
                        name=cp_name,
                        client_id=server["oauth2_client_id"] or "",
                        client_secret=server["oauth2_client_secret"] or "",
                        auth_server_url=server["oauth2_well_known_url"] or "",
                        region=region,
                        tags=resolved_tags,
                    )
                    logger.info(
                        "Created credential provider '%s' for MCP server '%s' (callback: %s)",
                        cp_name, server["name"], cp_response.get("callbackUrl"),
                    )
                except Exception as e:
                    logger.error(
                        "Failed to create credential provider for MCP server '%s' after retries: %s",
                        server["name"], e,
                    )
                    agent.status = "FAILED"
                    agent.deployment_status = "credential_creation_failed"
                    db.commit()
                    return
                auth_entry: dict[str, str] = {
                    "type": "oauth2",
                    "credential_provider_name": cp_name,
                }
                if server["oauth2_well_known_url"]:
                    auth_entry["well_known_endpoint"] = server["oauth2_well_known_url"]
                if server["oauth2_scopes"]:
                    auth_entry["scopes"] = server["oauth2_scopes"]
                entry["auth"] = auth_entry
            mcp_server_configs.append(entry)

        # Build A2A agent configs from snapshots
        a2a_agent_configs: list[dict[str, Any]] = []
        for a2a in a2a_snapshots:
            entry: dict[str, Any] = {
                "name": a2a["name"],
                "enabled": True,
                "endpoint_url": a2a["base_url"],
            }
            if a2a["auth_type"] == "oauth2":
                cp_name = f"loom-{request.name}-a2a-{a2a['name']}"
                try:
                    cp_response = create_oauth2_credential_provider(
                        name=cp_name,
                        client_id=a2a["oauth2_client_id"] or "",
                        client_secret=a2a["oauth2_client_secret"] or "",
                        auth_server_url=a2a["oauth2_well_known_url"] or "",
                        region=region,
                        tags=resolved_tags,
                    )
                    logger.info(
                        "Created credential provider '%s' for A2A agent '%s' (callback: %s)",
                        cp_name, a2a["name"], cp_response.get("callbackUrl"),
                    )
                except Exception as e:
                    logger.error(
                        "Failed to create credential provider for A2A agent '%s' after retries: %s",
                        a2a["name"], e,
                    )
                    agent.status = "FAILED"
                    agent.deployment_status = "credential_creation_failed"
                    db.commit()
                    return
                a2a_auth: dict[str, str] = {
                    "type": "oauth2",
                    "credential_provider_name": cp_name,
                }
                if a2a["oauth2_well_known_url"]:
                    a2a_auth["well_known_endpoint"] = a2a["oauth2_well_known_url"]
                if a2a["oauth2_scopes"]:
                    a2a_auth["scopes"] = a2a["oauth2_scopes"]
                entry["auth"] = a2a_auth
            a2a_agent_configs.append(entry)

        # Build memory configs from snapshots
        memory_configs = [
            {"name": m["name"], "memory_id": m["memory_id"], "arn": m["arn"]}
            for m in memory_snapshots
        ]

        config_json = json.dumps({
            "system_prompt": system_prompt,
            "model_id": request.model_id,
            "max_tokens": model_max_tokens,
            "integrations": {
                "mcp_servers": mcp_server_configs,
                "a2a_agents": a2a_agent_configs,
                "memory": {
                    "enabled": request.memory_enabled or len(memory_configs) > 0,
                    "resources": memory_configs,
                },
            },
        })
        env_vars = {
            "AGENT_CONFIG_JSON": config_json,
            "OTEL_SERVICE_NAME": request.name,
            "AGENT_OBSERVABILITY_ENABLED": "true",
            "AWS_REGION": region,
        }

        # Store config entries
        for key, value in env_vars.items():
            db.add(ConfigEntry(
                agent_id=agent.id,
                key=key,
                value=value,
                is_secret=False,
                source="env_var",
            ))
        db.commit()

        # --- Step 2: Create or use provided IAM execution role ---
        agent.deployment_status = "creating_role"
        db.commit()

        created_role = False
        execution_role_arn = request.role_arn
        if not execution_role_arn:
            try:
                execution_role_arn = create_execution_role(
                    agent_name=request.name,
                    runtime_id=f"pending-{agent.id}",
                    region=region,
                    account_id=account_id,
                    tag_policies=tag_policy_dicts,
                    extra_tags=resolved_tags,
                )
                created_role = True
                agent.execution_role_arn = execution_role_arn
                db.commit()
            except Exception as e:
                agent.deployment_status = "failed"
                agent.status = "FAILED"
                db.commit()
                logger.error("Failed to create execution role for agent %s: %s", agent.id, e)
                return
        else:
            agent.execution_role_arn = execution_role_arn
            db.commit()

        # --- Step 3: Build agent artifact ---
        agent.deployment_status = "building_artifact"
        db.commit()

        try:
            artifact_bucket, artifact_key = build_agent_artifact(region)
        except Exception as e:
            agent.deployment_status = "failed"
            agent.status = "FAILED"
            db.commit()
            if created_role and execution_role_arn:
                _cleanup_role(execution_role_arn)
            logger.error("Failed to build artifact for agent %s: %s", agent.id, e)
            return

        # Build optional configs
        lifecycle_config = None
        if request.idle_timeout or request.max_lifetime:
            lifecycle_config = {}
            if request.idle_timeout:
                lifecycle_config["idleRuntimeSessionTimeout"] = request.idle_timeout
            if request.max_lifetime:
                lifecycle_config["maxLifetime"] = request.max_lifetime

        authorizer_config = None
        user_client_id = os.getenv("LOOM_COGNITO_USER_CLIENT_ID", "")
        if request.authorizer_type == "cognito" and request.authorizer_pool_id:
            jwt_config: dict[str, Any] = {
                "discoveryUrl": f"https://cognito-idp.{region}.amazonaws.com/{request.authorizer_pool_id}/.well-known/openid-configuration"
            }
            allowed_clients = list(request.authorizer_allowed_clients) if request.authorizer_allowed_clients else []
            if user_client_id and user_client_id not in allowed_clients:
                allowed_clients.append(user_client_id)
            if allowed_clients:
                jwt_config["allowedClients"] = allowed_clients
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

        # --- Step 4: Deploy to AgentCore ---
        agent.deployment_status = "deploying"
        db.commit()

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
                tags=resolved_tags,
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
            agent.set_tags(resolved_tags)

            # Enable USAGE_LOGS and APPLICATION_LOGS observability
            try:
                from app.services.observability import enable_runtime_observability
                obs_result = enable_runtime_observability(
                    runtime_arn=runtime_arn,
                    runtime_id=runtime_id,
                    account_id=agent.account_id,
                    region=region,
                )
                logger.info("Enabled observability for agent %s: %s", agent.id, obs_result)
            except Exception as obs_err:
                logger.warning("Failed to enable observability for agent %s: %s", agent.id, obs_err)

            # Persist authorizer config for token retrieval at invoke time
            if request.authorizer_type:
                stored_clients = list(request.authorizer_allowed_clients) if request.authorizer_allowed_clients else []
                if user_client_id and user_client_id not in stored_clients:
                    stored_clients.append(user_client_id)
                agent.set_authorizer_config({
                    "type": request.authorizer_type,
                    "pool_id": request.authorizer_pool_id,
                    "discovery_url": request.authorizer_discovery_url,
                    "allowed_clients": stored_clients,
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
        except Exception as e:
            agent.deployment_status = "failed"
            agent.status = "FAILED"
            db.commit()
            if created_role and execution_role_arn:
                _cleanup_role(execution_role_arn)
            logger.error("Failed to deploy agent %s: %s", agent.id, e)
    except Exception as e:
        logger.error("Unexpected error in background deploy for agent %s: %s", agent_id, e)
        try:
            agent = db.query(Agent).filter(Agent.id == agent_id).first()
            if agent:
                agent.deployment_status = "failed"
                agent.status = "FAILED"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


def _is_permanent_error(e: Exception) -> bool:
    """Return True if an AWS error is permanent and polling should stop."""
    from botocore.exceptions import ClientError
    if isinstance(e, ClientError):
        code = e.response.get("Error", {}).get("Code", "")
        return code in ("AccessDeniedException", "UnauthorizedException")
    return False


def _cleanup_role(role_arn: str) -> None:
    """Best-effort cleanup of an IAM role on deploy failure."""
    try:
        role_name = role_arn.split("/")[-1]
        delete_execution_role(role_name)
    except Exception as e:
        logger.warning("Failed to clean up orphaned IAM role %s: %s", role_arn, e)


@router.get("", response_model=list[AgentResponse])
def list_agents(
    user: UserInfo = Depends(require_scopes("agent:read")),
    db: Session = Depends(get_db),
) -> list[AgentResponse]:
    """List all registered agents."""
    agents = db.query(Agent).order_by(Agent.registered_at.desc()).all()

    # Tag-based filtering:
    # - Admins (t-admin): See ALL resources including untagged
    # - Users (t-user): See only resources tagged with their groups (g-users-* → strip prefix)
    if "t-admin" not in user.groups:
        # User view: filter by group tags (strip "g-users-" prefix)
        user_groups = [g for g in user.groups if g.startswith("g-users-")]
        allowed_tags = [g.replace("g-users-", "", 1) for g in user_groups]
        agents = [a for a in agents if a.get_tags().get("loom:group") in allowed_tags]

    return [_agent_response(agent, db) for agent in agents]


@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(agent_id: int, user: UserInfo = Depends(require_scopes("agent:read")), db: Session = Depends(get_db)) -> AgentResponse:
    """Get metadata for a specific registered agent."""
    agent = get_agent_or_404(agent_id, db)
    return _agent_response(agent, db)


@router.get("/{agent_id}/status", response_model=AgentResponse)
def get_agent_status(agent_id: int, user: UserInfo = Depends(require_scopes("agent:read")), db: Session = Depends(get_db)) -> AgentResponse:
    """Poll AWS for current runtime and endpoint status, update local DB.

    If the runtime is READY and no endpoint exists yet, creates one automatically.
    During local build phases (before create_runtime is called), returns current
    DB state without making AWS API calls.
    """
    agent = get_agent_or_404(agent_id, db)

    # Local build phases — runtime doesn't exist in AWS yet, just return DB state
    _local_phases = {"initializing", "creating_credentials", "creating_role", "building_artifact", "deploying"}
    if agent.deployment_status in _local_phases:
        return _agent_response(agent, db)

    if agent.runtime_id and agent.source == "deploy":
        # Check runtime status
        try:
            rt = get_runtime(agent.runtime_id, agent.region)
            agent.status = rt.get("status", agent.status)
            agent.arn = rt.get("agentRuntimeArn", agent.arn)
            agent.last_refreshed_at = datetime.utcnow()
        except Exception as e:
            logger.warning("Failed to poll runtime status for %s: %s", agent.runtime_id, e)
            # If the agent was DELETING and the runtime is gone, purge from DB
            if agent.status == "DELETING":
                logger.info("Runtime %s no longer exists; purging agent %s", agent.runtime_id, agent.id)
                db.delete(agent)
                db.flush()
                db.commit()
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent deleted")
            # Stop polling on permanent errors (auth, not found)
            if _is_permanent_error(e):
                agent.status = "FAILED"
                agent.deployment_status = "failed"
                db.commit()
                db.refresh(agent)
                return _agent_response(agent, db)

        # Use the DEFAULT endpoint that is auto-created with the runtime
        if agent.status == "READY" and not agent.endpoint_name:
            agent.endpoint_name = "DEFAULT"

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


@router.delete("/{agent_id}", response_model=AgentResponse)
def delete_agent(
    agent_id: int,
    cleanup_aws: bool = False,
    background_tasks: BackgroundTasks = None,
    user: UserInfo = Depends(require_scopes("agent:write")),
    db: Session = Depends(get_db),
) -> AgentResponse:
    """Remove an agent from the local registry.

    Args:
        cleanup_aws: If True, also delete the runtime, endpoint, and IAM role from AWS.
    """
    agent = get_agent_or_404(agent_id, db)

    # Enforce demo-admin group restriction
    if "g-admins-demo" in user.groups and "g-admins-super" not in user.groups:
        agent_group = agent.get_tags().get("loom:group", "")
        if agent_group != "demo":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Demo admins can only delete agents in the 'demo' group"
            )

    # Extract credential provider names from agent config for cleanup
    config_map = {e.key: e.value for e in agent.config_entries}
    cp_names: list[str] = []
    config_json_str = config_map.get("AGENT_CONFIG_JSON")
    if config_json_str:
        try:
            agent_config = json.loads(config_json_str)
            integrations = agent_config.get("integrations", {})
            for mcp in integrations.get("mcp_servers", []):
                cp_name = (mcp.get("auth") or {}).get("credential_provider_name")
                if cp_name:
                    cp_names.append(cp_name)
            for a2a in integrations.get("a2a_agents", []):
                cp_name = (a2a.get("auth") or {}).get("credential_provider_name")
                if cp_name:
                    cp_names.append(cp_name)
        except (json.JSONDecodeError, TypeError):
            pass

    # For local-only deletion (no AWS cleanup or no runtime)
    if not cleanup_aws or not agent.runtime_id:
        # Clean up Cognito client secret from Secrets Manager
        secret_arn = config_map.get("COGNITO_CLIENT_SECRET_ARN")
        if secret_arn:
            delete_secret(secret_arn, agent.region)

        result = _agent_response(agent, db)
        # Delete invocations before sessions to avoid FK constraint violations
        # when PRAGMA foreign_keys=ON (SQLite) or equivalent DB-level enforcement.
        session_ids = [
            s.session_id for s in
            db.query(InvocationSession.session_id).filter(InvocationSession.agent_id == agent.id).all()
        ]
        if session_ids:
            db.query(Invocation).filter(Invocation.session_id.in_(session_ids)).delete(synchronize_session="fetch")
        db.query(InvocationSession).filter(InvocationSession.agent_id == agent.id).delete()
        db.delete(agent)
        db.flush()
        db.commit()
        return result

    # Capture values needed by the background task before the request session closes
    _agent_id = agent.id
    _runtime_id = agent.runtime_id
    _endpoint_name = agent.endpoint_name
    _region = agent.region
    _secret_arn = config_map.get("COGNITO_CLIENT_SECRET_ARN")

    # Initiate async deletion in AWS
    # Skip DEFAULT endpoint — AWS removes it automatically when the runtime is deleted
    if _endpoint_name and _endpoint_name != "DEFAULT":
        try:
            delete_runtime_endpoint(_runtime_id, _endpoint_name, _region)
        except Exception as e:
            logger.warning("Failed to delete endpoint %s: %s", _endpoint_name, e)

    try:
        delete_runtime(_runtime_id, _region)
    except Exception as e:
        logger.warning("Failed to delete runtime %s: %s", _runtime_id, e)

    # Clean up credential providers
    for cp_name in cp_names:
        try:
            delete_credential_provider(cp_name, _region)
            logger.info("Deleted credential provider '%s'", cp_name)
        except Exception as e:
            logger.warning("Failed to delete credential provider '%s': %s", cp_name, e)

    # Clean up Cognito client secret from Secrets Manager
    if _secret_arn:
        delete_secret(_secret_arn, _region)

    # Mark as DELETING so frontend can poll for completion
    agent.status = "DELETING"
    agent.deployment_status = "removing"
    db.flush()
    db.commit()
    db.refresh(agent)
    result = _agent_response(agent, db)

    # Schedule background task to wait for AWS deletion and then purge the DB record
    if background_tasks is not None:
        background_tasks.add_task(
            _delete_agent_background,
            _agent_id,
            _runtime_id,
            _region,
        )

    return result


def _delete_agent_background(
    agent_id: int,
    runtime_id: str,
    region: str,
) -> None:
    """Background task: poll until the runtime is gone, then purge the DB record."""
    max_attempts = 30
    poll_interval = 5

    for attempt in range(max_attempts):
        time.sleep(poll_interval)
        try:
            rt = get_runtime(runtime_id, region)
            rt_status = rt.get("status", "")
            logger.info("Delete poll %d/%d for runtime %s: status=%s", attempt + 1, max_attempts, runtime_id, rt_status)
            if rt_status == "FAILED":
                logger.warning("Runtime %s entered FAILED state during deletion", runtime_id)
                break
        except Exception:
            # Runtime no longer exists — deletion complete
            logger.info("Runtime %s no longer exists; deletion confirmed", runtime_id)
            break
    else:
        logger.warning("Runtime %s still exists after %d poll attempts; purging DB record anyway", runtime_id, max_attempts)

    # Purge the agent record and its sessions/invocations from the database.
    # Explicitly delete sessions first to guarantee cleanup even if the ORM
    # cascade is bypassed (e.g. stale objects, ID reuse in SQLite).
    db = SessionLocal()
    try:
        session_ids = [
            s.session_id for s in
            db.query(InvocationSession.session_id).filter(InvocationSession.agent_id == agent_id).all()
        ]
        if session_ids:
            db.query(Invocation).filter(Invocation.session_id.in_(session_ids)).delete(synchronize_session="fetch")
        db.query(InvocationSession).filter(InvocationSession.agent_id == agent_id).delete()
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        if agent:
            db.delete(agent)
            db.flush()
            db.commit()
            logger.info("Purged agent %d and its sessions from database", agent_id)
        else:
            db.commit()
            logger.info("Agent %d already removed from database; cleaned up orphan sessions", agent_id)
    except Exception as e:
        db.rollback()
        logger.warning("Failed to purge agent %d from database: %s", agent_id, e)
    finally:
        db.close()


@router.delete("/{agent_id}/purge", status_code=status.HTTP_204_NO_CONTENT)
def purge_agent(
    agent_id: int,
    user: UserInfo = Depends(require_scopes("agent:write")),
    db: Session = Depends(get_db),
) -> None:
    """Remove an agent and its sessions/invocations from the local database (no AWS call)."""
    agent = get_agent_or_404(agent_id, db)
    # Delete invocations before sessions to respect FK constraints
    session_ids = [
        s.session_id for s in
        db.query(InvocationSession.session_id).filter(InvocationSession.agent_id == agent_id).all()
    ]
    if session_ids:
        db.query(Invocation).filter(Invocation.session_id.in_(session_ids)).delete(synchronize_session="fetch")
    db.query(InvocationSession).filter(InvocationSession.agent_id == agent_id).delete()
    db.delete(agent)
    db.commit()


@router.post("/{agent_id}/refresh", response_model=AgentResponse)
def refresh_agent(agent_id: int, user: UserInfo = Depends(require_scopes("agent:write")), db: Session = Depends(get_db)) -> AgentResponse:
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

    # Update authorizer config from runtime metadata (for imported agents)
    if not agent.get_authorizer_config():
        authorizer_metadata = metadata.get("authorizerConfiguration", {})
        jwt_authorizer = authorizer_metadata.get("customJWTAuthorizer", {})
        if jwt_authorizer:
            discovery_url = jwt_authorizer.get("discoveryUrl", "")
            auth_type = "cognito" if "cognito-idp" in discovery_url else "other"
            agent.set_authorizer_config({
                "type": auth_type,
                "discovery_url": discovery_url,
                "allowed_clients": jwt_authorizer.get("allowedClients", []),
                "allowed_scopes": jwt_authorizer.get("allowedScopes", []),
            })

    db.commit()
    db.refresh(agent)

    return _agent_response(agent, db)


@router.post("/{agent_id}/redeploy", response_model=AgentResponse)
def redeploy_agent_endpoint(agent_id: int, user: UserInfo = Depends(require_scopes("agent:write")), db: Session = Depends(get_db)) -> AgentResponse:
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
def get_agent_config(agent_id: int, user: UserInfo = Depends(require_scopes("agent:read")), db: Session = Depends(get_db)) -> list[ConfigEntryResponse]:
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


@router.patch("/{agent_id}", response_model=AgentResponse)
def patch_agent(
    agent_id: int,
    request: AgentUpdateRequest,
    user: UserInfo = Depends(require_scopes("agent:write")),
    db: Session = Depends(get_db),
) -> AgentResponse:
    """Update editable fields on an agent (e.g. description)."""
    agent = get_agent_or_404(agent_id, db)
    if "description" in request.model_fields_set:
        agent.description = request.description
    db.commit()
    db.refresh(agent)
    return _agent_response(agent, db)


@router.put("/{agent_id}/config", response_model=list[ConfigEntryResponse])
def update_agent_config(
    agent_id: int,
    request: ConfigUpdateRequest,
    user: UserInfo = Depends(require_scopes("agent:write")),
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
