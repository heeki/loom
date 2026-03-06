"""Security management endpoints for roles, authorizers, and permission requests."""
import json
import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.managed_role import ManagedRole
from app.models.authorizer_config import AuthorizerConfig
from app.models.permission_request import PermissionRequest
from app.models.agent import Agent
from app.services.security import (
    apply_permissions_to_role,
    create_iam_role_with_policy,
    delete_iam_role,
    get_role_policy_details,
    update_iam_role_policy,
)
from app.services.secrets import store_secret, delete_secret

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/security", tags=["security"])

DEFAULT_REGION = os.getenv("AWS_REGION", "us-east-1")


def _get_region() -> str:
    return os.getenv("AWS_REGION", DEFAULT_REGION)


def _get_account_id() -> str:
    return os.getenv("AWS_ACCOUNT_ID", "")


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------
class CreateRoleRequest(BaseModel):
    mode: str = Field(..., description="'import' or 'wizard'")
    role_arn: str | None = Field(None, description="Existing role ARN (import mode)")
    role_name: str | None = Field(None, description="New role name (wizard mode)")
    description: str = Field(default="", description="Role description")
    policy_document: dict = Field(default_factory=dict, description="IAM policy document (wizard mode)")


class UpdateRoleRequest(BaseModel):
    description: str | None = None
    policy_document: dict | None = None


class CreateAuthorizerRequest(BaseModel):
    name: str
    authorizer_type: str  # "cognito" or "other"
    pool_id: str | None = None
    discovery_url: str | None = None
    allowed_clients: list[str] = Field(default_factory=list)
    allowed_scopes: list[str] = Field(default_factory=list)
    client_id: str | None = None
    client_secret: str | None = None


class UpdateAuthorizerRequest(BaseModel):
    name: str | None = None
    authorizer_type: str | None = None
    pool_id: str | None = None
    discovery_url: str | None = None
    allowed_clients: list[str] | None = None
    allowed_scopes: list[str] | None = None
    client_id: str | None = None
    client_secret: str | None = None


class CreatePermissionRequestBody(BaseModel):
    managed_role_id: int
    requested_actions: list[str]
    requested_resources: list[str]
    justification: str


class ReviewPermissionRequestBody(BaseModel):
    status: str  # "approved" or "denied"
    reviewer_notes: str | None = None


# ---------------------------------------------------------------------------
# Managed Roles
# ---------------------------------------------------------------------------
@router.post("/roles", status_code=status.HTTP_201_CREATED)
def create_role(request: CreateRoleRequest, db: Session = Depends(get_db)) -> dict:
    """Create or import a managed role."""
    region = _get_region()
    account_id = _get_account_id()

    if request.mode == "import":
        if not request.role_arn:
            raise HTTPException(status_code=400, detail="role_arn is required for import mode")

        # Check for duplicate
        existing = db.query(ManagedRole).filter(ManagedRole.role_arn == request.role_arn).first()
        if existing:
            raise HTTPException(status_code=409, detail="Role ARN already managed")

        # Extract role name from ARN
        role_name = request.role_arn.split("/")[-1]

        # Fetch existing policy from AWS
        try:
            policy_details = get_role_policy_details(role_name, region)
            policy_doc = {"Version": "2012-10-17", "Statement": policy_details["statements"]}
        except Exception as e:
            logger.warning("Could not fetch policy for %s: %s", role_name, e)
            policy_doc = {}

        role = ManagedRole(
            role_name=role_name,
            role_arn=request.role_arn,
            description=request.description,
            policy_document=json.dumps(policy_doc),
        )
        db.add(role)
        db.commit()
        db.refresh(role)
        return role.to_dict()

    elif request.mode == "wizard":
        if not request.role_name:
            raise HTTPException(status_code=400, detail="role_name is required for wizard mode")

        try:
            role_arn = create_iam_role_with_policy(
                role_name=request.role_name,
                policy_document=request.policy_document,
                region=region,
                account_id=account_id,
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to create IAM role: {e}")

        role = ManagedRole(
            role_name=request.role_name,
            role_arn=role_arn,
            description=request.description,
            policy_document=json.dumps(request.policy_document),
        )
        db.add(role)
        db.commit()
        db.refresh(role)
        return role.to_dict()

    else:
        raise HTTPException(status_code=400, detail="mode must be 'import' or 'wizard'")


@router.get("/roles")
def list_roles(db: Session = Depends(get_db)) -> list[dict]:
    """List all managed roles."""
    roles = db.query(ManagedRole).order_by(ManagedRole.id).all()
    return [r.to_dict() for r in roles]


@router.get("/roles/{role_id}")
def get_role(role_id: int, db: Session = Depends(get_db)) -> dict:
    """Get a managed role with its policy details."""
    role = db.query(ManagedRole).filter(ManagedRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    result = role.to_dict()

    # Try to fetch live policy from AWS
    region = _get_region()
    try:
        live_policy = get_role_policy_details(role.role_name, region)
        result["live_policy"] = live_policy
    except Exception:
        result["live_policy"] = None

    return result


@router.put("/roles/{role_id}")
def update_role(role_id: int, request: UpdateRoleRequest, db: Session = Depends(get_db)) -> dict:
    """Update a managed role's description and/or policy."""
    role = db.query(ManagedRole).filter(ManagedRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    if request.description is not None:
        role.description = request.description

    if request.policy_document is not None:
        region = _get_region()
        try:
            update_iam_role_policy(role.role_name, request.policy_document, region)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to update IAM policy: {e}")
        role.policy_document = json.dumps(request.policy_document)

    db.commit()
    db.refresh(role)
    return role.to_dict()


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(role_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a managed role. Refuses if any agent uses it."""
    role = db.query(ManagedRole).filter(ManagedRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    # Check if any agent references this role
    agent_using = db.query(Agent).filter(Agent.execution_role_arn == role.role_arn).first()
    if agent_using:
        raise HTTPException(
            status_code=409,
            detail=f"Role is in use by agent '{agent_using.name}' (id={agent_using.id})",
        )

    db.delete(role)
    db.commit()


# ---------------------------------------------------------------------------
# Authorizer Configs
# ---------------------------------------------------------------------------
@router.post("/authorizers", status_code=status.HTTP_201_CREATED)
def create_authorizer(request: CreateAuthorizerRequest, db: Session = Depends(get_db)) -> dict:
    """Create an authorizer configuration."""
    existing = db.query(AuthorizerConfig).filter(AuthorizerConfig.name == request.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="Authorizer with this name already exists")

    client_secret_arn = None
    if request.client_secret:
        region = _get_region()
        secret_name = f"loom/authorizers/{request.name}/client-secret"
        try:
            client_secret_arn = store_secret(
                name=secret_name,
                secret_value=request.client_secret,
                region=region,
                description=f"Client secret for Loom authorizer '{request.name}'",
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to store client secret: {e}")

    auth = AuthorizerConfig(
        name=request.name,
        authorizer_type=request.authorizer_type,
        pool_id=request.pool_id,
        discovery_url=request.discovery_url,
        allowed_clients=json.dumps(request.allowed_clients),
        allowed_scopes=json.dumps(request.allowed_scopes),
        client_id=request.client_id,
        client_secret_arn=client_secret_arn,
    )
    db.add(auth)
    db.commit()
    db.refresh(auth)
    return auth.to_dict()


@router.get("/authorizers")
def list_authorizers(db: Session = Depends(get_db)) -> list[dict]:
    """List all authorizer configurations."""
    auths = db.query(AuthorizerConfig).order_by(AuthorizerConfig.id).all()
    return [a.to_dict() for a in auths]


@router.get("/authorizers/{auth_id}")
def get_authorizer(auth_id: int, db: Session = Depends(get_db)) -> dict:
    """Get an authorizer configuration."""
    auth = db.query(AuthorizerConfig).filter(AuthorizerConfig.id == auth_id).first()
    if not auth:
        raise HTTPException(status_code=404, detail="Authorizer not found")
    return auth.to_dict()


@router.put("/authorizers/{auth_id}")
def update_authorizer(
    auth_id: int, request: UpdateAuthorizerRequest, db: Session = Depends(get_db)
) -> dict:
    """Update an authorizer configuration."""
    auth = db.query(AuthorizerConfig).filter(AuthorizerConfig.id == auth_id).first()
    if not auth:
        raise HTTPException(status_code=404, detail="Authorizer not found")

    if request.name is not None:
        auth.name = request.name
    if request.authorizer_type is not None:
        auth.authorizer_type = request.authorizer_type
    if request.pool_id is not None:
        auth.pool_id = request.pool_id
    if request.discovery_url is not None:
        auth.discovery_url = request.discovery_url
    if request.allowed_clients is not None:
        auth.allowed_clients = json.dumps(request.allowed_clients)
    if request.allowed_scopes is not None:
        auth.allowed_scopes = json.dumps(request.allowed_scopes)
    if request.client_id is not None:
        auth.client_id = request.client_id
    if request.client_secret is not None:
        region = _get_region()
        secret_name = f"loom/authorizers/{auth.name}/client-secret"
        try:
            client_secret_arn = store_secret(
                name=secret_name,
                secret_value=request.client_secret,
                region=region,
                description=f"Client secret for Loom authorizer '{auth.name}'",
            )
            auth.client_secret_arn = client_secret_arn
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to store client secret: {e}")

    db.commit()
    db.refresh(auth)
    return auth.to_dict()


@router.delete("/authorizers/{auth_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_authorizer(auth_id: int, db: Session = Depends(get_db)) -> None:
    """Delete an authorizer configuration."""
    auth = db.query(AuthorizerConfig).filter(AuthorizerConfig.id == auth_id).first()
    if not auth:
        raise HTTPException(status_code=404, detail="Authorizer not found")

    if auth.client_secret_arn:
        region = _get_region()
        delete_secret(auth.client_secret_arn, region)

    db.delete(auth)
    db.commit()


# ---------------------------------------------------------------------------
# Permission Requests
# ---------------------------------------------------------------------------
@router.post("/permission-requests", status_code=status.HTTP_201_CREATED)
def create_permission_request(
    request: CreatePermissionRequestBody, db: Session = Depends(get_db)
) -> dict:
    """Create a new permission request."""
    role = db.query(ManagedRole).filter(ManagedRole.id == request.managed_role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Managed role not found")

    perm_req = PermissionRequest(
        managed_role_id=request.managed_role_id,
        requested_actions=json.dumps(request.requested_actions),
        requested_resources=json.dumps(request.requested_resources),
        justification=request.justification,
    )
    db.add(perm_req)
    db.commit()
    db.refresh(perm_req)
    return perm_req.to_dict()


@router.get("/permission-requests")
def list_permission_requests(
    request_status: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
) -> list[dict]:
    """List permission requests, optionally filtered by status."""
    query = db.query(PermissionRequest)
    if request_status:
        query = query.filter(PermissionRequest.status == request_status)
    requests = query.order_by(PermissionRequest.id.desc()).all()
    return [r.to_dict() for r in requests]


@router.put("/permission-requests/{request_id}")
def review_permission_request(
    request_id: int, body: ReviewPermissionRequestBody, db: Session = Depends(get_db)
) -> dict:
    """Approve or deny a permission request."""
    perm_req = db.query(PermissionRequest).filter(PermissionRequest.id == request_id).first()
    if not perm_req:
        raise HTTPException(status_code=404, detail="Permission request not found")

    if perm_req.status != "pending":
        raise HTTPException(status_code=400, detail="Permission request is not pending")

    if body.status not in ("approved", "denied"):
        raise HTTPException(status_code=400, detail="status must be 'approved' or 'denied'")

    perm_req.status = body.status
    perm_req.reviewer_notes = body.reviewer_notes

    if body.status == "approved":
        role = db.query(ManagedRole).filter(ManagedRole.id == perm_req.managed_role_id).first()
        if not role:
            raise HTTPException(status_code=404, detail="Associated managed role not found")

        actions = json.loads(perm_req.requested_actions) if perm_req.requested_actions else []
        resources = json.loads(perm_req.requested_resources) if perm_req.requested_resources else []
        region = _get_region()

        try:
            updated_doc = apply_permissions_to_role(role.role_name, actions, resources, region)
            role.policy_document = json.dumps(updated_doc)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to apply permissions: {e}")

    db.commit()
    db.refresh(perm_req)
    return perm_req.to_dict()
