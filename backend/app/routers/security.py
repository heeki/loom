"""Security management endpoints for roles, authorizers, and permission requests."""
import json
import logging
import os
from typing import Any

import boto3

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.managed_role import ManagedRole
from app.models.authorizer_config import AuthorizerConfig
from app.models.authorizer_credential import AuthorizerCredential
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

        # Fetch tags from AWS IAM
        tags: dict[str, str] = {}
        try:
            iam_client = boto3.client("iam", region_name=region)
            response = iam_client.list_role_tags(RoleName=role_name)
            for tag in response.get("Tags", []):
                tags[tag["Key"]] = tag["Value"]
        except Exception as e:
            logger.warning("Could not fetch tags for role %s: %s", role_name, e)

        role = ManagedRole(
            role_name=role_name,
            role_arn=request.role_arn,
            description=request.description,
            policy_document=json.dumps(policy_doc),
        )
        role.set_tags(tags)
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
# Cognito Pools (discovery)
# ---------------------------------------------------------------------------
@router.get("/cognito-pools")
def list_cognito_pools() -> list[dict]:
    """List available Cognito User Pools in the current region."""
    region = _get_region()
    client = boto3.client("cognito-idp", region_name=region)
    pools: list[dict] = []

    paginator = client.get_paginator("list_user_pools")
    for page in paginator.paginate(MaxResults=60):
        for pool in page.get("UserPools", []):
            pool_id = pool["Id"]
            pool_name = pool["Name"]
            discovery_url = (
                f"https://cognito-idp.{region}.amazonaws.com/{pool_id}"
                "/.well-known/openid-configuration"
            )
            pools.append({
                "pool_id": pool_id,
                "pool_name": pool_name,
                "discovery_url": discovery_url,
            })

    return pools


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

    # Fetch tags from the Cognito User Pool if applicable
    tags: dict[str, str] = {}
    if request.authorizer_type == "cognito" and request.pool_id:
        try:
            region = _get_region()
            cognito_client = boto3.client("cognito-idp", region_name=region)
            pool_info = cognito_client.describe_user_pool(UserPoolId=request.pool_id)
            raw_tags = pool_info.get("UserPool", {}).get("UserPoolTags", {})
            tags = {k: v for k, v in raw_tags.items()}
        except Exception as e:
            logger.warning("Could not fetch tags for Cognito pool %s: %s", request.pool_id, e)

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
    auth.set_tags(tags)
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
    """Delete an authorizer configuration and its credentials."""
    auth = db.query(AuthorizerConfig).filter(AuthorizerConfig.id == auth_id).first()
    if not auth:
        raise HTTPException(status_code=404, detail="Authorizer not found")

    region = _get_region()

    # Clean up secrets for child credentials
    creds = db.query(AuthorizerCredential).filter(
        AuthorizerCredential.authorizer_config_id == auth_id
    ).all()
    for cred in creds:
        if cred.client_secret_arn:
            delete_secret(cred.client_secret_arn, region)

    # Bulk-delete credentials before the parent to satisfy FK constraint
    db.query(AuthorizerCredential).filter(
        AuthorizerCredential.authorizer_config_id == auth_id
    ).delete(synchronize_session="fetch")

    if auth.client_secret_arn:
        delete_secret(auth.client_secret_arn, region)

    db.delete(auth)
    db.commit()


# ---------------------------------------------------------------------------
# Authorizer Credentials
# ---------------------------------------------------------------------------
class CreateCredentialRequest(BaseModel):
    label: str
    client_id: str
    client_secret: str | None = None


@router.post("/authorizers/{auth_id}/credentials", status_code=status.HTTP_201_CREATED)
def create_credential(auth_id: int, request: CreateCredentialRequest, db: Session = Depends(get_db)) -> dict:
    """Add a client credential to an authorizer configuration."""
    auth = db.query(AuthorizerConfig).filter(AuthorizerConfig.id == auth_id).first()
    if not auth:
        raise HTTPException(status_code=404, detail="Authorizer not found")

    client_secret_arn = None
    if request.client_secret:
        region = _get_region()
        secret_name = f"loom/authorizers/{auth.name}/credentials/{request.label}"
        try:
            client_secret_arn = store_secret(
                name=secret_name,
                secret_value=request.client_secret,
                region=region,
                description=f"Client secret for credential '{request.label}' on authorizer '{auth.name}'",
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to store client secret: {e}")

    cred = AuthorizerCredential(
        authorizer_config_id=auth_id,
        label=request.label,
        client_id=request.client_id,
        client_secret_arn=client_secret_arn,
    )
    db.add(cred)
    db.commit()
    db.refresh(cred)
    return cred.to_dict()


@router.get("/authorizers/{auth_id}/credentials")
def list_credentials(auth_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """List credentials for an authorizer."""
    creds = db.query(AuthorizerCredential).filter(
        AuthorizerCredential.authorizer_config_id == auth_id
    ).order_by(AuthorizerCredential.id).all()
    return [c.to_dict() for c in creds]


@router.delete("/authorizers/{auth_id}/credentials/{cred_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_credential(auth_id: int, cred_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a credential from an authorizer."""
    cred = db.query(AuthorizerCredential).filter(
        AuthorizerCredential.id == cred_id,
        AuthorizerCredential.authorizer_config_id == auth_id,
    ).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    if cred.client_secret_arn:
        region = _get_region()
        delete_secret(cred.client_secret_arn, region)
    db.delete(cred)
    db.commit()


@router.post("/authorizers/{auth_id}/credentials/{cred_id}/token")
def get_credential_token(auth_id: int, cred_id: int, db: Session = Depends(get_db)) -> dict:
    """Generate an access token using a credential's client_id and client_secret."""
    from app.services.cognito import get_cognito_token

    auth = db.query(AuthorizerConfig).filter(AuthorizerConfig.id == auth_id).first()
    if not auth:
        raise HTTPException(status_code=404, detail="Authorizer not found")

    cred = db.query(AuthorizerCredential).filter(
        AuthorizerCredential.id == cred_id,
        AuthorizerCredential.authorizer_config_id == auth_id,
    ).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")

    if not auth.pool_id:
        raise HTTPException(status_code=400, detail="Authorizer has no Cognito pool configured")
    if not cred.client_secret_arn:
        raise HTTPException(status_code=400, detail="Credential has no client secret stored")

    region = _get_region()
    try:
        client_secret = get_secret(cred.client_secret_arn, region)
        allowed_scopes = json.loads(auth.allowed_scopes) if auth.allowed_scopes else None
        token_response = get_cognito_token(
            pool_id=auth.pool_id,
            client_id=cred.client_id,
            client_secret=client_secret,
            scopes=allowed_scopes or None,
        )
        return {
            "access_token": token_response["access_token"],
            "token_type": token_response.get("token_type", "Bearer"),
            "expires_in": token_response.get("expires_in"),
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to get token: {e}")


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
