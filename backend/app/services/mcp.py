"""MCP server connection and tool discovery service."""
import json
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Timeout for MCP server requests (seconds)
MCP_REQUEST_TIMEOUT = 30


def _get_oauth2_token(server: Any) -> str | None:
    """Exchange OAuth2 client credentials for an access token."""
    if server.auth_type != "oauth2" or not server.oauth2_client_id or not server.oauth2_client_secret:
        return None

    token_url = None

    # Discover token endpoint from well-known URL
    if server.oauth2_well_known_url:
        try:
            resp = httpx.get(server.oauth2_well_known_url, timeout=10)
            resp.raise_for_status()
            token_url = resp.json().get("token_endpoint")
        except Exception as e:
            logger.warning("Failed to discover token endpoint from %s: %s", server.oauth2_well_known_url, e)

    if not token_url:
        return None

    try:
        data: dict[str, str] = {
            "grant_type": "client_credentials",
            "client_id": server.oauth2_client_id,
            "client_secret": server.oauth2_client_secret,
        }
        if server.oauth2_scopes:
            data["scope"] = server.oauth2_scopes
        resp = httpx.post(token_url, data=data, timeout=10)
        if resp.status_code == 400 and server.oauth2_scopes:
            # Retry without scopes — some providers reject unknown scope values
            logger.info("Token request with scopes failed, retrying without scopes")
            data.pop("scope", None)
            resp = httpx.post(token_url, data=data, timeout=10)
        resp.raise_for_status()
        return resp.json().get("access_token")
    except Exception as e:
        logger.warning("Failed to obtain OAuth2 token: %s", e)
        return None


def _build_headers(server: Any) -> dict[str, str]:
    """Build request headers, including auth if configured."""
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if server.auth_type == "oauth2":
        token = _get_oauth2_token(server)
        if token:
            headers["Authorization"] = f"Bearer {token}"
    return headers


def _jsonrpc_request(method: str, params: dict | None = None, req_id: int = 1) -> dict:
    """Build a JSON-RPC 2.0 request."""
    msg: dict[str, Any] = {
        "jsonrpc": "2.0",
        "method": method,
        "id": req_id,
    }
    if params:
        msg["params"] = params
    return msg


def _call_streamable_http(server: Any, method: str, params: dict | None = None) -> dict | None:
    """Call an MCP server using Streamable HTTP (POST JSON-RPC)."""
    headers = _build_headers(server)
    body = _jsonrpc_request(method, params)

    try:
        resp = httpx.post(
            server.endpoint_url,
            json=body,
            headers=headers,
            timeout=MCP_REQUEST_TIMEOUT,
        )
        resp.raise_for_status()

        content_type = resp.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            # Server responded with SSE — parse the stream for JSON-RPC result
            return _parse_sse_response(resp.text)
        else:
            return resp.json()
    except Exception as e:
        logger.error("Streamable HTTP call to %s failed: %s", server.endpoint_url, e)
        return None


def _call_sse(server: Any, method: str, params: dict | None = None) -> dict | None:
    """Call an MCP server using SSE transport.

    SSE transport: POST JSON-RPC to the endpoint, receive SSE stream back.
    Some SSE servers accept POST directly; others require establishing an SSE
    connection first. We try the POST approach which is the MCP standard.
    """
    headers = _build_headers(server)
    headers["Accept"] = "text/event-stream"
    body = _jsonrpc_request(method, params)

    try:
        resp = httpx.post(
            server.endpoint_url,
            json=body,
            headers=headers,
            timeout=MCP_REQUEST_TIMEOUT,
        )
        resp.raise_for_status()

        content_type = resp.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            return _parse_sse_response(resp.text)
        else:
            return resp.json()
    except Exception as e:
        logger.error("SSE call to %s failed: %s", server.endpoint_url, e)
        return None


def _parse_sse_response(text: str) -> dict | None:
    """Parse an SSE stream text and extract the JSON-RPC result."""
    data_lines: list[str] = []
    for line in text.splitlines():
        if line.startswith("data:"):
            data_lines.append(line[5:].strip())

    # Try each data line — the result is typically the last one
    for data_str in reversed(data_lines):
        if not data_str or data_str == "[DONE]":
            continue
        try:
            parsed = json.loads(data_str)
            if "result" in parsed or "error" in parsed:
                return parsed
        except json.JSONDecodeError:
            continue
    return None


def _call_mcp(server: Any, method: str, params: dict | None = None) -> dict | None:
    """Call an MCP server using the configured transport."""
    if server.transport_type == "streamable_http":
        return _call_streamable_http(server, method, params)
    else:
        return _call_sse(server, method, params)


def test_mcp_connection(server: Any) -> dict:
    """Test connectivity to an MCP server.

    Sends an `initialize` JSON-RPC request to verify the server is reachable
    and responds to the MCP protocol.
    """
    init_params = {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "loom", "version": "1.0.0"},
    }

    result = _call_mcp(server, "initialize", init_params)

    if result is None:
        return {"success": False, "message": f"Failed to connect to {server.endpoint_url}"}

    if "error" in result:
        error = result["error"]
        msg = error.get("message", "Unknown error") if isinstance(error, dict) else str(error)
        return {"success": False, "message": f"Server error: {msg}"}

    server_info = result.get("result", {}).get("serverInfo", {})
    server_name = server_info.get("name", "Unknown")
    server_version = server_info.get("version", "")
    version_str = f" v{server_version}" if server_version else ""
    return {"success": True, "message": f"Connected to {server_name}{version_str}"}


def fetch_mcp_tools(server: Any) -> list[dict]:
    """Fetch available tools from an MCP server via the tools/list method."""
    result = _call_mcp(server, "tools/list")

    if result is None:
        logger.warning("No response from %s for tools/list", server.endpoint_url)
        return []

    if "error" in result:
        error = result["error"]
        msg = error.get("message", "Unknown error") if isinstance(error, dict) else str(error)
        logger.warning("tools/list error from %s: %s", server.endpoint_url, msg)
        return []

    tools_data = result.get("result", {}).get("tools", [])
    tools: list[dict] = []
    for t in tools_data:
        tool: dict[str, Any] = {
            "name": t.get("name", ""),
            "description": t.get("description"),
        }
        if "inputSchema" in t:
            tool["input_schema"] = t["inputSchema"]
        tools.append(tool)

    logger.info("Discovered %d tools from %s", len(tools), server.endpoint_url)
    return tools


def invoke_mcp_tool(server: Any, tool_name: str, arguments: dict) -> dict:
    """Invoke a tool on an MCP server via the tools/call method.

    Returns a dict with 'success', 'result' (on success), and 'error' (on failure).
    The 'request' field always contains the sent arguments for display purposes.
    """
    params = {"name": tool_name, "arguments": arguments}
    result = _call_mcp(server, "tools/call", params)

    if result is None:
        return {
            "success": False,
            "request": params,
            "error": f"No response from {server.endpoint_url}",
        }

    if "error" in result:
        error = result["error"]
        msg = error.get("message", "Unknown error") if isinstance(error, dict) else str(error)
        return {
            "success": False,
            "request": params,
            "error": msg,
        }

    return {
        "success": True,
        "request": params,
        "result": result.get("result", {}),
    }
