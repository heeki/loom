"""Authentication configuration endpoints."""
import logging
import os
from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/config")
def get_auth_config() -> dict:
    """Return authentication configuration for the frontend.

    Returns the active IdP configuration if one exists, otherwise falls back to Cognito.
    """
    region = os.getenv("LOOM_COGNITO_REGION", os.getenv("AWS_REGION", "us-east-1"))
    user_pool_id = os.getenv("LOOM_COGNITO_USER_POOL_ID", "")

    # Check for an active external IdP
    try:
        from app.db import SessionLocal
        from app.models.identity_provider import IdentityProvider
        db = SessionLocal()
        try:
            idp = db.query(IdentityProvider).filter(IdentityProvider.status == "active").first()
            if idp:
                return {
                    "provider_type": idp.provider_type,
                    "authorization_endpoint": idp.authorization_endpoint,
                    "token_endpoint": idp.token_endpoint,
                    "client_id": idp.client_id,
                    "scopes": idp.scopes or "",
                    "issuer_url": idp.issuer_url,
                    "redirect_uri": os.getenv("LOOM_OIDC_REDIRECT_URI", ""),
                    "group_claim_path": idp.group_claim_path or "groups",
                    "group_mappings": idp.get_group_mappings(),
                    # Backward compat
                    "user_pool_id": user_pool_id,
                    "region": region,
                }
        finally:
            db.close()
    except Exception as e:
        logger.warning("Failed to check for active IdP: %s", e)

    # Default: Cognito
    return {
        "provider_type": "cognito",
        "user_pool_id": user_pool_id,
        "region": region,
    }
