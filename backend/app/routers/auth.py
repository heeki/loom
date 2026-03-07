"""Authentication configuration endpoints."""
import logging
import os
from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/config")
def get_auth_config() -> dict:
    """Return Cognito configuration for the frontend.

    Returns pool ID, user client ID, and region. Does NOT expose client secrets.
    """
    region = os.getenv("LOOM_COGNITO_REGION", os.getenv("AWS_REGION", "us-east-1"))
    user_pool_id = os.getenv("LOOM_COGNITO_USER_POOL_ID", "")
    user_client_id = os.getenv("LOOM_COGNITO_USER_CLIENT_ID", "")

    return {
        "user_pool_id": user_pool_id,
        "user_client_id": user_client_id,
        "region": region,
    }
