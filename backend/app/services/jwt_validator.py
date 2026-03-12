"""JWT token validation for Cognito user tokens."""
import json
import logging
import time
import urllib.request
from typing import Any

import jwt
from jwt import algorithms as jwt_algorithms

logger = logging.getLogger(__name__)

# Cache for JWKS keys: {issuer_url: (keys, fetch_time)}
_jwks_cache: dict[str, tuple[dict[str, Any], float]] = {}
JWKS_CACHE_TTL = 3600  # 1 hour


def _get_jwks(issuer: str) -> dict[str, Any]:
    """Fetch and cache JWKS keys from the Cognito issuer."""
    now = time.time()
    if issuer in _jwks_cache:
        keys, fetch_time = _jwks_cache[issuer]
        if now - fetch_time < JWKS_CACHE_TTL:
            return keys

    jwks_url = f"{issuer}/.well-known/jwks.json"
    logger.info("Fetching JWKS from %s", jwks_url)
    req = urllib.request.Request(jwks_url)
    with urllib.request.urlopen(req, timeout=10) as resp:
        jwks = json.loads(resp.read().decode())

    _jwks_cache[issuer] = (jwks, now)
    return jwks


def _get_signing_key(jwks: dict[str, Any], kid: str) -> jwt_algorithms.RSAAlgorithm:
    """Find the signing key matching the given kid."""
    for key_data in jwks.get("keys", []):
        if key_data.get("kid") == kid:
            return jwt_algorithms.RSAAlgorithm.from_jwk(key_data)
    raise ValueError(f"Key with kid={kid} not found in JWKS")


def validate_cognito_token(
    token: str,
    user_pool_id: str,
    region: str,
    client_id: str | None = None,
) -> dict[str, Any]:
    """
    Validate a Cognito JWT token.

    Args:
        token: The JWT token string
        user_pool_id: Cognito User Pool ID
        region: AWS region
        client_id: Expected client_id (audience). If None, audience is not validated.

    Returns:
        Decoded token claims

    Raises:
        jwt.InvalidTokenError: If the token is invalid
    """
    issuer = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"

    # Decode header to get kid
    unverified_header = jwt.get_unverified_header(token)
    kid = unverified_header.get("kid")
    if not kid:
        raise jwt.InvalidTokenError("Token header missing 'kid'")

    # Get JWKS and find signing key
    jwks = _get_jwks(issuer)
    public_key = _get_signing_key(jwks, kid)

    # Validate and decode
    options = {}
    if client_id is None:
        options["verify_aud"] = False

    claims = jwt.decode(
        token,
        key=public_key,
        algorithms=["RS256"],
        issuer=issuer,
        audience=client_id,
        options=options,
    )

    return claims
