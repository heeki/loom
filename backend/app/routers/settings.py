"""Settings endpoints for managing tag policies and site settings."""
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies.auth import UserInfo, get_current_user, require_scopes
from app.models.tag_policy import TagPolicy
from app.models.tag_profile import TagProfile
from app.models.site_setting import SiteSetting

router = APIRouter(prefix="/api/settings", tags=["settings"])


# ---------------------------------------------------------------------------
# Site settings defaults and helpers
# ---------------------------------------------------------------------------
SITE_SETTING_DEFAULTS: dict[str, str] = {
    "cpu_io_wait_discount": "75",
}


def get_site_setting(db: Session, key: str) -> str:
    """Get a site setting value, returning the default if not set."""
    row = db.query(SiteSetting).filter(SiteSetting.key == key).first()
    if row:
        return row.value
    return SITE_SETTING_DEFAULTS.get(key, "")


def get_cpu_io_wait_discount(db: Session) -> float:
    """Get the CPU I/O wait discount as a float (0.0–0.99).

    Stored as an integer percentage (0–99). Returns the decimal equivalent.
    """
    val = get_site_setting(db, "cpu_io_wait_discount")
    try:
        pct = int(float(val))
        pct = max(0, min(99, pct))
        return pct / 100.0
    except (ValueError, TypeError):
        return 0.75




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
def list_tag_policies(user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db)) -> list[TagPolicyResponse]:
    """List all tag policies. Requires authentication but no specific scope (used for displaying tags on cards)."""
    policies = db.query(TagPolicy).order_by(TagPolicy.id).all()
    return [TagPolicyResponse(**p.to_dict()) for p in policies]


@router.post("/tags", response_model=TagPolicyResponse, status_code=status.HTTP_201_CREATED)
def create_tag_policy(
    request: TagPolicyRequest,
    user: UserInfo = Depends(require_scopes("tagging:write")),
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
    user: UserInfo = Depends(require_scopes("tagging:write")),
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
    user: UserInfo = Depends(require_scopes("tagging:write")),
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
def list_tag_profiles(user: UserInfo = Depends(get_current_user), db: Session = Depends(get_db)) -> list[TagProfileResponse]:
    """List all tag profiles. Requires authentication but no specific scope (used for resource creation forms)."""
    profiles = db.query(TagProfile).order_by(TagProfile.name).all()
    return [TagProfileResponse(**p.to_dict()) for p in profiles]


@router.post("/tag-profiles", response_model=TagProfileResponse, status_code=status.HTTP_201_CREATED)
def create_tag_profile(
    request: TagProfileRequest,
    user: UserInfo = Depends(require_scopes("tagging:write")),
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
    user: UserInfo = Depends(require_scopes("tagging:write")),
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
    user: UserInfo = Depends(require_scopes("tagging:write")),
    db: Session = Depends(get_db),
) -> None:
    """Delete a tag profile."""
    profile = db.query(TagProfile).filter(TagProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag profile not found")
    db.delete(profile)
    db.commit()


# ---------------------------------------------------------------------------
# Site Settings CRUD
# ---------------------------------------------------------------------------
class SiteSettingRequest(BaseModel):
    """Request body for creating/updating a site setting."""
    key: str = Field(..., description="Setting key")
    value: str = Field(..., description="Setting value")


class SiteSettingResponse(BaseModel):
    """Response model for a site setting."""
    id: int | None
    key: str
    value: str
    updated_at: str | None


@router.get("/site", response_model=list[SiteSettingResponse])
def list_site_settings(
    user: UserInfo = Depends(require_scopes("settings:read")),
    db: Session = Depends(get_db),
) -> list[SiteSettingResponse]:
    """List all site settings, including defaults for unset keys."""
    stored = {s.key: s for s in db.query(SiteSetting).all()}
    result = []
    for key, default in SITE_SETTING_DEFAULTS.items():
        if key in stored:
            result.append(SiteSettingResponse(**stored[key].to_dict()))
        else:
            result.append(SiteSettingResponse(id=None, key=key, value=default, updated_at=None))
    # Include any stored settings not in defaults
    for key, setting in stored.items():
        if key not in SITE_SETTING_DEFAULTS:
            result.append(SiteSettingResponse(**setting.to_dict()))
    return result


@router.put("/site/{key}", response_model=SiteSettingResponse)
def update_site_setting(
    key: str,
    request: SiteSettingRequest,
    user: UserInfo = Depends(require_scopes("settings:write")),
    db: Session = Depends(get_db),
) -> SiteSettingResponse:
    """Create or update a site setting."""
    setting = db.query(SiteSetting).filter(SiteSetting.key == key).first()
    if setting:
        setting.value = request.value
        setting.updated_at = datetime.utcnow()
    else:
        setting = SiteSetting(key=key, value=request.value)
        db.add(setting)
    db.commit()
    db.refresh(setting)
    return SiteSettingResponse(**setting.to_dict())
