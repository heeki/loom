"""Memory resource management endpoints."""
import json
import logging
import os
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies.auth import UserInfo, require_scopes
from app.models.memory import Memory
from app.models.tag_policy import TagPolicy
from app.services.memory import (
    create_memory as svc_create_memory,
    get_memory as svc_get_memory,
    list_memories as svc_list_memories,
    delete_memory as svc_delete_memory,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memories", tags=["memories"])

DEFAULT_REGION = os.getenv("AWS_REGION", "us-east-1")

STRATEGY_TYPE_MAP = {
    "semantic": "semanticMemoryStrategy",
    "summary": "summaryMemoryStrategy",
    "user_preference": "userPreferenceMemoryStrategy",
    "episodic": "episodicMemoryStrategy",
    "custom": "customMemoryStrategy",
}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class MemoryStrategyRequest(BaseModel):
    """A single memory strategy configuration."""
    strategy_type: str = Field(..., description="Strategy type: semantic, summary, user_preference, episodic, custom")
    name: str = Field(..., description="Strategy name")
    description: str | None = Field(None, description="Strategy description")
    namespaces: list[str] | None = Field(None, description="Namespaces for the strategy")
    configuration: dict | None = Field(None, description="Additional strategy configuration")


class MemoryCreateRequest(BaseModel):
    """Request body for creating a memory resource."""
    name: str = Field(..., description="Name for the memory resource")
    description: str | None = Field(None, description="Memory resource description")
    event_expiry_duration: int = Field(..., description="Duration in days before events expire")
    memory_execution_role_arn: str | None = Field(None, description="IAM role ARN for memory execution")
    encryption_key_arn: str | None = Field(None, description="KMS key ARN for encryption")
    memory_strategies: list[MemoryStrategyRequest] | None = Field(None, description="Memory strategy configurations")
    tags: dict[str, str] | None = Field(None, description="Build-time tag values from a tag profile")


class MemoryImportRequest(BaseModel):
    """Request body for importing an existing memory resource by its AWS memory ID."""
    memory_id: str = Field(..., description="AWS memory ID (e.g. my_memory-zYcvlyGXsK)")


class MemoryResponse(BaseModel):
    """Response model for memory resource details."""
    id: int
    name: str
    description: str | None = None
    arn: str | None = None
    memory_id: str | None = None
    status: str
    event_expiry_duration: int
    strategies_config: Any | None = None
    strategies_response: Any | None = None
    tags: dict[str, str] = {}
    failure_reason: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    region: str
    account_id: str
    memory_execution_role_arn: str | None = None
    encryption_key_arn: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _handle_aws_error(e: Exception) -> None:
    """Map AWS exceptions to HTTP errors."""
    error_name = type(e).__name__
    error_map = {
        "ValidationException": status.HTTP_400_BAD_REQUEST,
        "ConflictException": status.HTTP_409_CONFLICT,
        "ResourceNotFoundException": status.HTTP_404_NOT_FOUND,
        "ServiceQuotaExceededException": status.HTTP_429_TOO_MANY_REQUESTS,
        "AccessDeniedException": status.HTTP_403_FORBIDDEN,
        "ThrottledException": status.HTTP_429_TOO_MANY_REQUESTS,
    }
    status_code = error_map.get(error_name, status.HTTP_502_BAD_GATEWAY)
    raise HTTPException(status_code=status_code, detail=str(e))


AGENTCORE_NAME_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{0,47}$")


def _validate_agentcore_name(name: str, field_label: str) -> None:
    """Validate that a name matches the AgentCore naming convention."""
    if not AGENTCORE_NAME_PATTERN.match(name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid {field_label} '{name}'. "
                "Must start with a letter, contain only letters, digits, and underscores, "
                "and be at most 48 characters."
            )
        )


def _transform_strategies(strategies: list[MemoryStrategyRequest]) -> list[dict]:
    """Transform simplified strategy format to AWS tagged union format."""
    aws_strategies = []
    for strategy in strategies:
        if strategy.strategy_type not in STRATEGY_TYPE_MAP:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid strategy type: '{strategy.strategy_type}'. Must be one of: {', '.join(STRATEGY_TYPE_MAP.keys())}"
            )
        _validate_agentcore_name(strategy.name, "strategy name")
        aws_key = STRATEGY_TYPE_MAP[strategy.strategy_type]
        strategy_config: dict[str, Any] = {"name": strategy.name}
        if strategy.description:
            strategy_config["description"] = strategy.description
        if strategy.namespaces:
            strategy_config["namespaces"] = strategy.namespaces
        if strategy.configuration:
            strategy_config.update(strategy.configuration)
        aws_strategies.append({aws_key: strategy_config})
    return aws_strategies


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------
@router.post("", response_model=MemoryResponse, status_code=status.HTTP_201_CREATED)
def create_memory(
    request: MemoryCreateRequest,
    user: UserInfo = Depends(require_scopes("memory:write")),
    db: Session = Depends(get_db),
) -> MemoryResponse:
    """Create a new memory resource."""
    # demo-admins can only create resources tagged with loom:group=demo-admins
    if "demo-admins" in user.groups and "super-admins" not in user.groups:
        tags = request.tags or {}
        if tags.get("loom:group") and tags["loom:group"] != "demo-admins":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="demo-admins can only create resources tagged with loom:group=demo-admins",
            )

    region = os.getenv("AWS_REGION", DEFAULT_REGION)
    account_id = os.getenv("AWS_ACCOUNT_ID", "")

    _validate_agentcore_name(request.name, "memory name")

    # Resolve tags from tag policies + user-supplied profile tags
    resolved_tags: dict[str, str] = {}
    user_tags = request.tags or {}
    policies = db.query(TagPolicy).all()
    for p in policies:
        if p.key in user_tags:
            resolved_tags[p.key] = user_tags[p.key]
        elif p.default_value:
            resolved_tags[p.key] = p.default_value
        elif p.required:
            resolved_tags[p.key] = "missing"

    # Transform strategies
    aws_strategies = None
    if request.memory_strategies:
        aws_strategies = _transform_strategies(request.memory_strategies)

    try:
        response = svc_create_memory(
            name=request.name,
            event_expiry_duration=request.event_expiry_duration,
            description=request.description,
            encryption_key_arn=request.encryption_key_arn,
            memory_execution_role_arn=request.memory_execution_role_arn,
            memory_strategies=aws_strategies,
            tags=resolved_tags or None,
            region=region,
        )
    except Exception as e:
        _handle_aws_error(e)

    # Response is nested: {"memory": {"arn": ..., "id": ..., "status": ..., ...}}
    mem_data = response.get("memory", {})
    logger.info("create_memory response: %s", json.dumps(mem_data, default=str))

    memory_arn = mem_data.get("arn", "")
    memory_id = mem_data.get("id", "")

    # Extract account_id from ARN if available
    # ARN format: arn:aws:bedrock-agentcore:{region}:{account_id}:memory/{memory_id}
    if memory_arn:
        try:
            parts = memory_arn.split(":")
            if len(parts) >= 5:
                account_id = parts[4]
        except (IndexError, ValueError):
            pass

    logger.info("create_memory resolved: memory_id=%s memory_arn=%s account_id=%s", memory_id, memory_arn, account_id)

    memory = Memory(
        name=mem_data.get("name", request.name),
        description=request.description,
        arn=memory_arn,
        memory_id=memory_id,
        region=region,
        account_id=account_id,
        status=mem_data.get("status", "CREATING"),
        event_expiry_duration=request.event_expiry_duration,
        memory_execution_role_arn=request.memory_execution_role_arn,
        encryption_key_arn=request.encryption_key_arn,
    )

    if aws_strategies:
        memory.set_strategies_config(aws_strategies)

    strategies_resp = mem_data.get("strategies")
    if strategies_resp:
        memory.set_strategies_response(strategies_resp)

    if resolved_tags:
        memory.set_tags(resolved_tags)

    db.add(memory)
    db.commit()
    db.refresh(memory)

    return MemoryResponse(**memory.to_dict())


@router.post("/import", response_model=MemoryResponse, status_code=status.HTTP_201_CREATED)
def import_memory(
    request: MemoryImportRequest,
    user: UserInfo = Depends(require_scopes("memory:write")),
    db: Session = Depends(get_db),
) -> MemoryResponse:
    """Import an existing memory resource from AWS by its memory ID."""
    region = os.getenv("AWS_REGION", DEFAULT_REGION)
    account_id = os.getenv("AWS_ACCOUNT_ID", "")

    # Check if already imported
    existing = db.query(Memory).filter(Memory.memory_id == request.memory_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Memory '{request.memory_id}' is already imported (id={existing.id})"
        )

    try:
        response = svc_get_memory(request.memory_id, region)
    except Exception as e:
        _handle_aws_error(e)

    # Response is nested: {"memory": {"arn": ..., "id": ..., "status": ..., ...}}
    mem_data = response.get("memory", {})

    memory_arn = mem_data.get("arn", "")
    memory_name = mem_data.get("name", request.memory_id)
    memory_status = mem_data.get("status", "UNKNOWN")
    description = mem_data.get("description")
    event_expiry = mem_data.get("eventExpiryDuration", 0)
    encryption_key_arn = mem_data.get("encryptionKeyArn")
    memory_execution_role_arn = mem_data.get("memoryExecutionRoleArn")

    # Extract account_id from ARN
    if memory_arn:
        try:
            parts = memory_arn.split(":")
            if len(parts) >= 5:
                account_id = parts[4]
        except (IndexError, ValueError):
            pass

    logger.info("import_memory: memoryId=%s name=%s status=%s arn=%s",
                request.memory_id, memory_name, memory_status, memory_arn)

    memory = Memory(
        name=memory_name,
        description=description,
        arn=memory_arn,
        memory_id=mem_data.get("id", request.memory_id),
        region=region,
        account_id=account_id,
        status=memory_status,
        event_expiry_duration=event_expiry,
        memory_execution_role_arn=memory_execution_role_arn,
        encryption_key_arn=encryption_key_arn,
    )

    strategies_resp = mem_data.get("strategies")
    if strategies_resp:
        memory.set_strategies_response(strategies_resp)

    # Enforce tag policies: fetch AWS tags and fill missing required tags with "missing"
    aws_tags: dict[str, str] = {}
    try:
        import boto3
        control_client = boto3.client("bedrock-agentcore-control", region_name=region)
        tag_response = control_client.list_tags_for_resource(resourceArn=memory_arn)
        aws_tags = tag_response.get("tags", {})
    except Exception as e:
        logger.debug("Could not fetch tags for imported memory %s: %s", request.memory_id, e)

    policies = db.query(TagPolicy).all()
    for p in policies:
        if p.key not in aws_tags:
            if p.default_value:
                aws_tags[p.key] = p.default_value
            elif p.required:
                aws_tags[p.key] = "missing"

    if aws_tags:
        memory.set_tags(aws_tags)

    db.add(memory)
    db.commit()
    db.refresh(memory)

    return MemoryResponse(**memory.to_dict())


@router.get("", response_model=list[MemoryResponse])
def list_memories(
    user: UserInfo = Depends(require_scopes("memory:read")),
    db: Session = Depends(get_db),
) -> list[MemoryResponse]:
    """List all memory resources."""
    memories = db.query(Memory).order_by(Memory.created_at.desc()).all()

    # Tag-based filtering: users group can only see memories tagged with loom:group=users
    if "users" in user.groups and "super-admins" not in user.groups:
        memories = [m for m in memories if m.get_tags().get("loom:group") == "users"]

    return [MemoryResponse(**m.to_dict()) for m in memories]


@router.get("/{memory_id}", response_model=MemoryResponse)
def get_memory(memory_id: int, user: UserInfo = Depends(require_scopes("memory:read")), db: Session = Depends(get_db)) -> MemoryResponse:
    """Get a specific memory resource by DB ID."""
    memory = db.query(Memory).filter(Memory.id == memory_id).first()
    if not memory:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Memory with id {memory_id} not found"
        )
    return MemoryResponse(**memory.to_dict())


@router.post("/{memory_id}/refresh", response_model=MemoryResponse)
def refresh_memory(memory_id: int, user: UserInfo = Depends(require_scopes("memory:read")), db: Session = Depends(get_db)) -> MemoryResponse:
    """Refresh memory status from AWS."""
    memory = db.query(Memory).filter(Memory.id == memory_id).first()
    if not memory:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Memory with id {memory_id} not found"
        )

    # Resolve the AWS memory ID: prefer stored memory_id, fallback to ARN extraction
    aws_memory_id = memory.memory_id
    if not aws_memory_id and memory.arn:
        try:
            resource = memory.arn.split(":")[-1]
            if resource.startswith("memory/"):
                aws_memory_id = resource[len("memory/"):]
                logger.info("refresh_memory: extracted memory_id from ARN: %s", aws_memory_id)
        except (IndexError, ValueError):
            pass

    if not aws_memory_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Memory does not have an AWS memory_id"
        )

    logger.info("refresh_memory: using aws_memory_id=%s for DB id=%d", aws_memory_id, memory_id)

    try:
        response = svc_get_memory(aws_memory_id, memory.region)
    except Exception as e:
        _handle_aws_error(e)

    # Response is nested: {"memory": {"arn": ..., "id": ..., "status": ..., ...}}
    mem_data = response.get("memory", {})

    # Backfill memory_id if it was missing
    if not memory.memory_id and aws_memory_id:
        memory.memory_id = aws_memory_id

    memory.status = mem_data.get("status", memory.status)
    memory.arn = mem_data.get("arn", memory.arn)
    memory.failure_reason = mem_data.get("failureReason", memory.failure_reason)

    strategies_resp = mem_data.get("strategies")
    if strategies_resp:
        memory.set_strategies_response(strategies_resp)

    memory.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(memory)

    return MemoryResponse(**memory.to_dict())


@router.delete("/{memory_id}", response_model=MemoryResponse)
def delete_memory(
    memory_id: int,
    cleanup_aws: bool = True,
    user: UserInfo = Depends(require_scopes("memory:write")),
    db: Session = Depends(get_db),
) -> MemoryResponse:
    """Delete a memory resource. When cleanup_aws=True, initiates async deletion in AWS."""
    memory = db.query(Memory).filter(Memory.id == memory_id).first()
    if not memory:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Memory with id {memory_id} not found"
        )

    # demo-admins can only delete resources tagged with loom:group=demo-admins
    if "demo-admins" in user.groups and "super-admins" not in user.groups:
        if memory.get_tags().get("loom:group") != "demo-admins":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot modify resources outside your group",
            )

    # If not cleaning up AWS, just remove from DB
    if not cleanup_aws or not memory.memory_id or memory.status in ("FAILED",):
        result = MemoryResponse(**memory.to_dict())
        db.delete(memory)
        db.commit()
        return result

    # Initiate async deletion in AWS
    try:
        svc_delete_memory(memory.memory_id, memory.region)
    except Exception as e:
        error_name = type(e).__name__
        if error_name == "ResourceNotFoundException":
            # Already gone from AWS — remove locally
            result = MemoryResponse(**memory.to_dict())
            db.delete(memory)
            db.commit()
            return result
        logger.warning("Failed to delete memory %s from AWS: %s", memory.memory_id, e)

    # Mark as DELETING so the frontend can poll for completion
    memory.status = "DELETING"
    memory.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(memory)
    return MemoryResponse(**memory.to_dict())


@router.delete("/{memory_id}/purge", status_code=status.HTTP_204_NO_CONTENT)
def purge_memory(memory_id: int, user: UserInfo = Depends(require_scopes("memory:write")), db: Session = Depends(get_db)) -> None:
    """Remove a memory resource from the local database (no AWS call)."""
    memory = db.query(Memory).filter(Memory.id == memory_id).first()
    if not memory:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Memory with id {memory_id} not found"
        )
    db.delete(memory)
    db.commit()
