"""A2A agent service layer for Agent Card fetching and connection testing."""
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

A2A_REQUEST_TIMEOUT = 30


def _get_oauth2_token(agent: Any) -> str | None:
    """Exchange OAuth2 client credentials for an access token."""
    if agent.auth_type != "oauth2" or not agent.oauth2_client_id or not agent.oauth2_client_secret:
        return None

    token_url = None

    if agent.oauth2_well_known_url:
        try:
            resp = httpx.get(agent.oauth2_well_known_url, timeout=10)
            resp.raise_for_status()
            token_url = resp.json().get("token_endpoint")
        except Exception as e:
            logger.warning("Failed to discover token endpoint from %s: %s", agent.oauth2_well_known_url, e)

    if not token_url:
        return None

    try:
        data: dict[str, str] = {
            "grant_type": "client_credentials",
            "client_id": agent.oauth2_client_id,
            "client_secret": agent.oauth2_client_secret,
        }
        if agent.oauth2_scopes:
            data["scope"] = agent.oauth2_scopes
        resp = httpx.post(token_url, data=data, timeout=10)
        if resp.status_code == 400 and agent.oauth2_scopes:
            logger.info("Token request with scopes failed, retrying without scopes")
            data.pop("scope", None)
            resp = httpx.post(token_url, data=data, timeout=10)
        resp.raise_for_status()
        return resp.json().get("access_token")
    except Exception as e:
        logger.warning("Failed to obtain OAuth2 token: %s", e)
        return None


def _build_headers(agent: Any) -> dict[str, str]:
    """Build request headers, including auth if configured."""
    headers: dict[str, str] = {"Accept": "application/json"}
    if agent.auth_type == "oauth2":
        token = _get_oauth2_token(agent)
        if token:
            headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_agent_card(base_url: str, auth_headers: dict[str, str] | None = None) -> dict:
    """Fetch the Agent Card from the well-known endpoint.

    Args:
        base_url: The base URL of the A2A agent.
        auth_headers: Optional headers for authenticated requests.

    Returns:
        The parsed Agent Card JSON.

    Raises:
        ValueError: If the Agent Card cannot be fetched or is invalid.
    """
    url = base_url.rstrip("/") + "/.well-known/agent.json"
    headers = auth_headers or {"Accept": "application/json"}

    try:
        resp = httpx.get(url, headers=headers, timeout=A2A_REQUEST_TIMEOUT, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise ValueError(f"Agent Card fetch returned HTTP {e.response.status_code}: {e.response.text[:200]}") from e
    except Exception as e:
        raise ValueError(f"Failed to fetch Agent Card from {url}: {e}") from e

    try:
        card = resp.json()
    except Exception as e:
        raise ValueError(f"Agent Card response is not valid JSON: {e}") from e

    # Validate required fields
    for field in ("name", "description", "url", "version"):
        if not card.get(field):
            raise ValueError(f"Agent Card missing required field: {field}")

    return card


def parse_agent_card(card: dict) -> dict:
    """Extract structured data from a raw Agent Card.

    Returns a dict with fields matching the A2aAgent model columns.
    """
    provider = card.get("provider") or {}
    capabilities = card.get("capabilities") or {}
    authentication = card.get("authentication") or {}

    return {
        "name": card["name"],
        "description": card["description"],
        "agent_version": card["version"],
        "documentation_url": card.get("documentationUrl"),
        "provider_organization": provider.get("organization"),
        "provider_url": provider.get("url"),
        "capabilities": capabilities,
        "authentication_schemes": authentication.get("schemes", []),
        "default_input_modes": card.get("defaultInputModes", []),
        "default_output_modes": card.get("defaultOutputModes", []),
    }


def parse_skills(card: dict) -> list[dict]:
    """Extract skills from an Agent Card.

    Returns a list of dicts with fields matching the A2aAgentSkill model columns.
    """
    skills_data = card.get("skills", [])
    skills: list[dict] = []
    for s in skills_data:
        skill: dict[str, Any] = {
            "skill_id": s.get("id", ""),
            "name": s.get("name", ""),
            "description": s.get("description", ""),
            "tags": s.get("tags", []),
        }
        if s.get("examples"):
            skill["examples"] = s["examples"]
        if s.get("inputModes"):
            skill["input_modes"] = s["inputModes"]
        if s.get("outputModes"):
            skill["output_modes"] = s["outputModes"]
        skills.append(skill)
    return skills


def test_a2a_connection(agent: Any) -> dict:
    """Test connectivity to an A2A agent by fetching its Agent Card.

    If the agent has OAuth2 configured, acquires a token first.
    """
    try:
        headers = _build_headers(agent)
        card = fetch_agent_card(agent.base_url, auth_headers=headers)
        name = card.get("name", "Unknown")
        version = card.get("version", "")
        version_str = f" v{version}" if version else ""
        return {"success": True, "message": f"Connected to {name}{version_str}"}
    except ValueError as e:
        return {"success": False, "message": str(e)}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {e}"}
