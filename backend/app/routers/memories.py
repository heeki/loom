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
from app.models.memory import Memory
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
    db: Session = Depends(get_db),
) -> MemoryResponse:
    """Create a new memory resource."""
    region = os.getenv("AWS_REGION", DEFAULT_REGION)
    account_id = os.getenv("AWS_ACCOUNT_ID", "")

    _validate_agentcore_name(request.name, "memory name")

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
            region=region,
        )
    except Exception as e:
        _handle_aws_error(e)

    memory_arn = response.get("memoryArn", "")
    memory_id = response.get("memoryId", "")

    # Extract account_id from ARN if available
    if memory_arn:
        try:
            parts = memory_arn.split(":")
            if len(parts) >= 5:
                account_id = parts[4]
        except (IndexError, ValueError):
            pass

    memory = Memory(
        name=request.name,
        description=request.description,
        arn=memory_arn,
        memory_id=memory_id,
        region=region,
        account_id=account_id,
        status=response.get("status", "CREATING"),
        event_expiry_duration=request.event_expiry_duration,
        memory_execution_role_arn=request.memory_execution_role_arn,
        encryption_key_arn=request.encryption_key_arn,
    )

    if aws_strategies:
        memory.set_strategies_config(aws_strategies)

    strategies_resp = response.get("memoryStrategies")
    if strategies_resp:
        memory.set_strategies_response(strategies_resp)

    db.add(memory)
    db.commit()
    db.refresh(memory)

    return MemoryResponse(**memory.to_dict())


@router.get("", response_model=list[MemoryResponse])
def list_memories(db: Session = Depends(get_db)) -> list[MemoryResponse]:
    """List all memory resources."""
    memories = db.query(Memory).order_by(Memory.created_at.desc()).all()
    return [MemoryResponse(**m.to_dict()) for m in memories]


@router.get("/{memory_id}", response_model=MemoryResponse)
def get_memory(memory_id: int, db: Session = Depends(get_db)) -> MemoryResponse:
    """Get a specific memory resource by DB ID."""
    memory = db.query(Memory).filter(Memory.id == memory_id).first()
    if not memory:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Memory with id {memory_id} not found"
        )
    return MemoryResponse(**memory.to_dict())


@router.post("/{memory_id}/refresh", response_model=MemoryResponse)
def refresh_memory(memory_id: int, db: Session = Depends(get_db)) -> MemoryResponse:
    """Refresh memory status from AWS."""
    memory = db.query(Memory).filter(Memory.id == memory_id).first()
    if not memory:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Memory with id {memory_id} not found"
        )

    if not memory.memory_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Memory does not have an AWS memory_id"
        )

    try:
        response = svc_get_memory(memory.memory_id, memory.region)
    except Exception as e:
        _handle_aws_error(e)

    memory.status = response.get("status", memory.status)
    memory.arn = response.get("memoryArn", memory.arn)
    memory.failure_reason = response.get("failureReason", memory.failure_reason)

    strategies_resp = response.get("memoryStrategies")
    if strategies_resp:
        memory.set_strategies_response(strategies_resp)

    memory.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(memory)

    return MemoryResponse(**memory.to_dict())


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory(memory_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a memory resource."""
    memory = db.query(Memory).filter(Memory.id == memory_id).first()
    if not memory:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Memory with id {memory_id} not found"
        )

    # Delete from AWS if we have a memory_id
    if memory.memory_id:
        try:
            svc_delete_memory(memory.memory_id, memory.region)
        except Exception as e:
            logger.warning("Failed to delete memory %s from AWS: %s", memory.memory_id, e)

    db.delete(memory)
    db.commit()
