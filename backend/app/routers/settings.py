"""Settings endpoints for managing tag policies."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.tag_policy import TagPolicy
from app.models.tag_profile import TagProfile

router = APIRouter(prefix="/api/settings", tags=["settings"])


class TagPolicyRequest(BaseModel):
    """Request body for creating/updating a tag policy."""
    key: str = Field(..., description="Tag key name")
    default_value: str | None = Field(None, description="Default value for the tag")
    required: bool = Field(True, description="Whether this tag is required")
    show_on_card: bool = Field(False, description="Whether to display on agent cards")


class TagPolicyResponse(BaseModel):
    """Response model for a tag policy."""
    id: int
    key: str
    default_value: str | None
    designation: str
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
    existing = db.query(TagPolicy).filter(TagPolicy.key == request.key).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tag policy with key '{request.key}' already exists",
        )

    policy = TagPolicy(
        key=request.key,
        default_value=request.default_value,
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


# ---------------------------------------------------------------------------
# Tag Profile CRUD
# ---------------------------------------------------------------------------
class TagProfileRequest(BaseModel):
    """Request body for creating/updating a tag profile."""
    name: str = Field(..., description="Profile name")
    tags: dict[str, str] = Field(..., description="Tag key-value pairs")


class TagProfileResponse(BaseModel):
    """Response model for a tag profile."""
    id: int
    name: str
    tags: dict[str, str]
    created_at: str | None
    updated_at: str | None


@router.get("/tag-profiles", response_model=list[TagProfileResponse])
def list_tag_profiles(db: Session = Depends(get_db)) -> list[TagProfileResponse]:
    """List all tag profiles."""
    profiles = db.query(TagProfile).order_by(TagProfile.name).all()
    return [TagProfileResponse(**p.to_dict()) for p in profiles]


@router.post("/tag-profiles", response_model=TagProfileResponse, status_code=status.HTTP_201_CREATED)
def create_tag_profile(
    request: TagProfileRequest,
    db: Session = Depends(get_db),
) -> TagProfileResponse:
    """Create a new tag profile."""
    existing = db.query(TagProfile).filter(TagProfile.name == request.name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tag profile with name '{request.name}' already exists",
        )

    # Validate that all required tag policies have values
    policies = db.query(TagPolicy).filter(TagPolicy.required == True).all()
    missing = [p.key for p in policies if not request.tags.get(p.key, "").strip()]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required tag values: {', '.join(missing)}",
        )

    profile = TagProfile(name=request.name)
    profile.set_tags(request.tags)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return TagProfileResponse(**profile.to_dict())


@router.put("/tag-profiles/{profile_id}", response_model=TagProfileResponse)
def update_tag_profile(
    profile_id: int,
    request: TagProfileRequest,
    db: Session = Depends(get_db),
) -> TagProfileResponse:
    """Update an existing tag profile."""
    profile = db.query(TagProfile).filter(TagProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag profile not found")

    # Check name uniqueness if changed
    if request.name != profile.name:
        conflict = db.query(TagProfile).filter(TagProfile.name == request.name).first()
        if conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Tag profile with name '{request.name}' already exists",
            )

    # Validate required tags
    policies = db.query(TagPolicy).filter(TagPolicy.required == True).all()
    missing = [p.key for p in policies if not request.tags.get(p.key, "").strip()]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required tag values: {', '.join(missing)}",
        )

    profile.name = request.name
    profile.set_tags(request.tags)
    profile.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(profile)
    return TagProfileResponse(**profile.to_dict())


@router.delete("/tag-profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag_profile(
    profile_id: int,
    db: Session = Depends(get_db),
) -> None:
    """Delete a tag profile."""
    profile = db.query(TagProfile).filter(TagProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag profile not found")
    db.delete(profile)
    db.commit()
