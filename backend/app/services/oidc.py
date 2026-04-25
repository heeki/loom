"""OIDC discovery document fetcher."""

import json
import logging
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)


class OIDCDiscoveryError(Exception):
    """Raised when OIDC discovery fails."""


def fetch_discovery(issuer_url: str) -> dict[str, Any]:
    """Fetch and parse the OIDC discovery document from an issuer.

    Args:
        issuer_url: The OIDC issuer base URL (e.g. https://login.microsoftonline.com/{tenant}/v2.0)

    Returns:
        Dict with keys: jwks_uri, authorization_endpoint, token_endpoint, scopes_supported

    Raises:
        OIDCDiscoveryError: If the document is unreachable or missing required fields
    """
    url = issuer_url.rstrip("/") + "/.well-known/openid-configuration"
    logger.info("Fetching OIDC discovery from %s", url)

    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            doc = json.loads(resp.read().decode())
    except Exception as e:
        raise OIDCDiscoveryError(f"Failed to fetch discovery document from {url}: {e}") from e

    required_fields = ["jwks_uri", "authorization_endpoint", "token_endpoint"]
    missing = [f for f in required_fields if not doc.get(f)]
    if missing:
        raise OIDCDiscoveryError(f"Discovery document missing required fields: {', '.join(missing)}")

    return {
        "jwks_uri": doc["jwks_uri"],
        "authorization_endpoint": doc["authorization_endpoint"],
        "token_endpoint": doc["token_endpoint"],
        "scopes_supported": doc.get("scopes_supported", []),
        "issuer": doc.get("issuer", issuer_url),
    }
