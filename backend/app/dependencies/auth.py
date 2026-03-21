"""Authentication dependencies for FastAPI routes."""
import dataclasses
import logging
import os
from typing import Any

from fastapi import Depends, HTTPException, Request, Security
from fastapi.security import OAuth2AuthorizationCodeBearer, SecurityScopes

from app.services.jwt_validator import validate_cognito_token

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Group-to-scope mapping (must match frontend GROUP_SCOPES)
# ---------------------------------------------------------------------------
# Users belong to two dimensions:
# - Type (t-*): Defines UI view (t-admin or t-user). Type groups grant no scopes.
# - Group (g-*): Defines page visibility and resource access. Groups grant scopes.
#
# Admin users (t-admin): Must have exactly ONE g-admins-* group
# User users (t-user): Must have at least ONE g-users-* group (can have multiple)
GROUP_SCOPES: dict[str, list[str]] = {
    # Type groups (for UI routing - don't grant scopes directly)
    "t-admin": [],
    "t-user": [],

    # Admin groups (t-admin users - single group only)
    "g-admins-super": [
        "catalog:read", "catalog:write", "agent:read", "agent:write",
        "memory:read", "memory:write", "security:read", "security:write",
        "settings:read", "settings:write", "tagging:read", "tagging:write",
        "costs:read", "costs:write",
        "mcp:read", "mcp:write", "a2a:read", "a2a:write", "invoke",
        "admin:read", "admin:write",
    ],
    "g-admins-demo": [
        "catalog:read", "agent:read", "agent:write", "memory:read", "memory:write",
        "security:read", "settings:read", "settings:write", "tagging:read", "costs:read", "costs:write",
        "mcp:read", "a2a:read", "invoke",
    ],
    "g-admins-security": [
        "security:read", "security:write", "settings:read", "settings:write", "tagging:read",
    ],
    "g-admins-memory": [
        "memory:read", "memory:write", "settings:read", "settings:write", "tagging:read",
    ],
    "g-admins-mcp": [
        "mcp:read", "mcp:write", "settings:read", "settings:write", "tagging:read",
    ],
    "g-admins-a2a": [
        "a2a:read", "a2a:write", "settings:read", "settings:write", "tagging:read",
    ],

    # User groups (t-user users - can have multiple)
    "g-users-demo": ["catalog:read", "agent:read", "agent:write", "memory:read", "memory:write", "costs:read", "costs:write", "mcp:read", "a2a:read", "invoke"],
    "g-users-test": ["catalog:read", "agent:read", "agent:write", "memory:read", "memory:write", "costs:read", "costs:write", "mcp:read", "a2a:read", "invoke"],
    "g-users-strategics": ["catalog:read", "agent:read", "agent:write", "memory:read", "memory:write", "costs:read", "costs:write", "mcp:read", "a2a:read", "invoke"],
}

ALL_SCOPES: set[str] = {s for scopes in GROUP_SCOPES.values() for s in scopes}

# ---------------------------------------------------------------------------
# OAuth2 scheme for OpenAPI docs
# ---------------------------------------------------------------------------
oauth2_scheme = OAuth2AuthorizationCodeBearer(
    authorizationUrl="",
    tokenUrl="",
    scopes={
        "catalog:read": "Read catalog",
        "catalog:write": "Write catalog",
        "agent:read": "Read agents",
        "agent:write": "Write agents",
        "memory:read": "Read memory",
        "memory:write": "Write memory",
        "security:read": "Read security",
        "security:write": "Write security",
        "settings:read": "Read settings",
        "settings:write": "Write settings",
        "tagging:read": "View tag policies and profiles",
        "tagging:write": "Manage tag policies and profiles",
        "costs:read": "View cost data",
        "costs:write": "Manage cost settings",
        "mcp:read": "Read MCP",
        "mcp:write": "Write MCP",
        "a2a:read": "Read A2A",
        "a2a:write": "Write A2A",
        "admin:read": "View admin dashboard",
        "admin:write": "Manage admin settings",
        "invoke": "Invoke agents",
    },
    auto_error=False,
)

# ---------------------------------------------------------------------------
# UserInfo dataclass
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class UserInfo:
    sub: str
    username: str
    groups: list[str]
    scopes: set[str]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def derive_scopes(groups: list[str]) -> set[str]:
    """Return the union of all scopes for the given groups."""
    result: set[str] = set()
    for group in groups:
        result.update(GROUP_SCOPES.get(group, []))
    return result


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

def get_current_user(request: Request) -> UserInfo:
    """Extract and validate the Bearer token, returning a UserInfo with derived scopes.

    In bypass mode (LOOM_COGNITO_USER_POOL_ID not set) returns a user with all scopes.
    """
    user_pool_id = os.getenv("LOOM_COGNITO_USER_POOL_ID", "")
    region = os.getenv("LOOM_COGNITO_REGION", os.getenv("AWS_REGION", "us-east-1"))

    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else ""

    # Bypass mode — no Cognito configured
    if not user_pool_id:
        logger.warning("LOOM_COGNITO_USER_POOL_ID not configured; bypassing auth")
        return UserInfo(
            sub="local",
            username="local-dev",
            groups=["t-admin", "g-admins-super"],
            scopes=ALL_SCOPES.copy(),
        )

    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")

    try:
        claims = validate_cognito_token(token, user_pool_id, region)
    except Exception as e:
        logger.warning("Invalid token: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token") from e

    groups: list[str] = claims.get("cognito:groups", [])
    username: str = claims.get("cognito:username", claims.get("username", claims.get("sub", "")))

    return UserInfo(
        sub=claims.get("sub", ""),
        username=username,
        groups=groups,
        scopes=derive_scopes(groups),
    )


def require_scopes(*required: str):
    """Create a dependency that checks the user has ALL required scopes.

    Uses Security() with the oauth2_scheme so that required scopes appear
    in the OpenAPI specification for each endpoint.
    """
    def checker(
        security_scopes: SecurityScopes = Security(oauth2_scheme, scopes=list(required)),
        user: UserInfo = Depends(get_current_user),
    ) -> UserInfo:
        for scope in required:
            if scope not in user.scopes:
                raise HTTPException(status_code=403, detail=f"Missing required scope: {scope}")
        return user
    return checker


# ---------------------------------------------------------------------------
# Legacy helpers (used by invocations.py for token forwarding)
# ---------------------------------------------------------------------------

def get_current_user_token(request: Request) -> str | None:
    """
    Extract and validate the user's access token from the Authorization header.

    Returns the raw access token string if valid, None otherwise.
    For now, allows unauthenticated requests to pass through with a warning.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header[7:]  # Strip "Bearer "

    user_pool_id = os.getenv("LOOM_COGNITO_USER_POOL_ID", "")
    region = os.getenv("LOOM_COGNITO_REGION", os.getenv("AWS_REGION", "us-east-1"))

    if not user_pool_id:
        logger.warning("LOOM_COGNITO_USER_POOL_ID not configured; skipping token validation")
        return token  # Pass through if not configured

    try:
        claims = validate_cognito_token(token, user_pool_id, region)
        logger.debug("Validated user token for sub=%s", claims.get("sub"))
        return token
    except Exception as e:
        logger.warning("Invalid user token: %s", e)
        return None


def get_token_claims(request: Request) -> dict[str, Any] | None:
    """
    Extract, validate, and decode the user's access token.

    Returns decoded claims if valid, None otherwise.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header[7:]

    user_pool_id = os.getenv("LOOM_COGNITO_USER_POOL_ID", "")
    region = os.getenv("LOOM_COGNITO_REGION", os.getenv("AWS_REGION", "us-east-1"))

    if not user_pool_id:
        return None

    try:
        return validate_cognito_token(token, user_pool_id, region)
    except Exception as e:
        logger.warning("Invalid user token: %s", e)
        return None
