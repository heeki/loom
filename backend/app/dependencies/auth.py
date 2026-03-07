"""Authentication dependencies for FastAPI routes."""
import logging
import os
from typing import Any

from fastapi import Request

from app.services.jwt_validator import validate_cognito_token

logger = logging.getLogger(__name__)


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
