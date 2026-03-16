"""MCP server connection and tool discovery service stubs."""
from typing import Any


def test_mcp_connection(server: Any) -> dict:
    """Test connectivity to an MCP server.

    Stub implementation that returns success. If auth_type is oauth2,
    a real implementation would attempt to fetch a token from the well-known URL.
    """
    if server.auth_type == "oauth2":
        if not server.oauth2_well_known_url:
            return {"success": False, "message": "OAuth2 well-known URL is not configured"}
        return {"success": True, "message": f"OAuth2 configuration validated (well-known: {server.oauth2_well_known_url})"}
    return {"success": True, "message": "Connection successful (stub)"}


def fetch_mcp_tools(server: Any) -> list[dict]:
    """Fetch available tools from an MCP server.

    Stub implementation that returns an empty list. A real implementation
    would connect to the server and list available tools.
    """
    return []
