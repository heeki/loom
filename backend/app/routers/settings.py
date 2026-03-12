"""Settings endpoints for managing tag policies."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.tag_policy import TagPolicy

router = APIRouter(prefix="/api/settings", tags=["settings"])


class TagPolicyRequest(BaseModel):
    """Request body for creating/updating a tag policy."""
    key: str = Field(..., description="Tag key name")
    default_value: str | None = Field(None, description="Default value for the tag")
    source: str = Field(..., description="'deploy-time' or 'build-time'")
    required: bool = Field(True, description="Whether this tag is required")
    show_on_card: bool = Field(False, description="Whether to display on agent cards")


class TagPolicyResponse(BaseModel):
    """Response model for a tag policy."""
    id: int
    key: str
    default_value: str | None
    source: str
    required: bool
    show_on_card: bool
    created_at: str | None
    updated_at: str | None


@router.get("/tags", response_model=list[TagPolicyResponse])
def list_tag_policies(db: Session = Depends(get_db)) -> list[TagPolicyResponse]:
    """List all tag policies."""
    policies = db.query(TagPolicy).order_by(TagPolicy.id).all()
    return [TagPolicyResponse(**p.to_dict()) for p in policies]


@router.post("/tags", response_model=TagPolicyResponse, status_code=status.HTTP_201_CREATED)
def create_tag_policy(
    request: TagPolicyRequest,
    db: Session = Depends(get_db),
) -> TagPolicyResponse:
    """Create a new tag policy."""
    if request.source not in ("deploy-time", "build-time"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source must be 'deploy-time' or 'build-time'",
        )

    existing = db.query(TagPolicy).filter(TagPolicy.key == request.key).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tag policy with key '{request.key}' already exists",
        )

    policy = TagPolicy(
        key=request.key,
        default_value=request.default_value,
        source=request.source,
        required=request.required,
        show_on_card=request.show_on_card,
    )
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return TagPolicyResponse(**policy.to_dict())


@router.put("/tags/{tag_id}", response_model=TagPolicyResponse)
def update_tag_policy(
    tag_id: int,
    request: TagPolicyRequest,
    db: Session = Depends(get_db),
) -> TagPolicyResponse:
    """Update an existing tag policy."""
    policy = db.query(TagPolicy).filter(TagPolicy.id == tag_id).first()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag policy not found")

    if request.source not in ("deploy-time", "build-time"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source must be 'deploy-time' or 'build-time'",
        )

    # Check uniqueness if key changed
    if request.key != policy.key:
        conflict = db.query(TagPolicy).filter(TagPolicy.key == request.key).first()
        if conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Tag policy with key '{request.key}' already exists",
            )

    policy.key = request.key
    policy.default_value = request.default_value
    policy.source = request.source
    policy.required = request.required
    policy.show_on_card = request.show_on_card
    policy.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(policy)
    return TagPolicyResponse(**policy.to_dict())


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag_policy(
    tag_id: int,
    db: Session = Depends(get_db),
) -> None:
    """Delete a tag policy."""
    policy = db.query(TagPolicy).filter(TagPolicy.id == tag_id).first()
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag policy not found")
    db.delete(policy)
    db.commit()
