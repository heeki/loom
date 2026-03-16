"""Dynamic MCP tool client creation from agent configuration."""

import logging
import os
from functools import partial
from typing import Any, Generator

import httpx
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

from bedrock_agentcore.runtime.context import BedrockAgentCoreContext
from bedrock_agentcore.services.identity import IdentityClient

from src.config import MCPServerConfig

logger = logging.getLogger(__name__)


class _OAuth2Auth(httpx.Auth):
    """httpx Auth that injects a Bearer token from the AgentCore Identity service.

    On each outbound HTTP request the auth handler:
      1. Reads the workload access token from ``BedrockAgentCoreContext``
         (set automatically by the AgentCore Runtime per invocation).
      2. Exchanges it for a downstream OAuth2 access token via the
         AgentCore data plane ``get_resource_oauth2_token`` M2M flow.
      3. Sets the ``Authorization: Bearer <token>`` header.

    Because the workload access token is scoped to each invocation, every
    MCP request carries a fresh, valid credential.
    """

    def __init__(self, credential_provider_name: str, scopes: list[str]) -> None:
        self._credential_provider_name = credential_provider_name
        self._scopes = scopes
        self._region = os.environ.get("AWS_REGION", "us-east-1")

    def auth_flow(self, request: httpx.Request) -> Generator[httpx.Request, httpx.Response, None]:
        workload_token = BedrockAgentCoreContext.get_workload_access_token()
        if not workload_token:
            logger.warning("No workload access token in context; sending unauthenticated request")
            yield request
            return

        try:
            identity_client = IdentityClient(self._region)
            resp = identity_client.dp_client.get_resource_oauth2_token(
                workloadIdentityToken=workload_token,
                resourceCredentialProviderName=self._credential_provider_name,
                scopes=self._scopes,
                oauth2Flow="M2M",
            )
            token = resp.get("accessToken")
            if token:
                request.headers["Authorization"] = f"Bearer {token}"
                logger.debug("Injected OAuth2 token for credential provider '%s'", self._credential_provider_name)
            else:
                logger.warning("No accessToken in response for credential provider '%s'", self._credential_provider_name)
        except Exception as e:
            logger.warning("Failed to acquire OAuth2 token for '%s': %s", self._credential_provider_name, e)

        yield request


def _build_transport_callable(config: MCPServerConfig) -> Any:
    """Build a transport callable for the given MCP server configuration.

    For OAuth2-authenticated servers, attaches an ``_OAuth2Auth`` handler
    that dynamically fetches tokens from the AgentCore Identity service
    on each request using the per-invocation workload access token.

    Args:
        config: MCP server configuration with endpoint and optional auth.

    Returns:
        A callable that returns an async context manager providing the MCP transport.
    """
    if config.auth and config.auth.type == "oauth2" and config.auth.credential_provider_name:
        scope_list = config.auth.scopes.split() if config.auth.scopes else []
        auth = _OAuth2Auth(
            credential_provider_name=config.auth.credential_provider_name,
            scopes=scope_list,
        )
        logger.info(
            "MCP server '%s' configured with OAuth2 auth (credential_provider=%s, scopes=%s)",
            config.name,
            config.auth.credential_provider_name,
            scope_list,
        )
        return partial(streamablehttp_client, url=config.endpoint_url, auth=auth)

    return partial(streamablehttp_client, url=config.endpoint_url)


def _try_create_client(server: MCPServerConfig) -> MCPClient | None:
    """Attempt to create and validate an MCP client for a server.

    Returns the client if successful, or None if the server is unreachable
    or returns an auth error (e.g. 401/403).  Catches BaseException to
    handle ExceptionGroup raised by the MCP SDK background thread.
    """
    transport_callable = _build_transport_callable(server)
    client = MCPClient(transport_callable)

    # Temporarily suppress the strands MCP client logger during start()
    # to avoid noisy ERROR tracebacks for expected auth failures.
    strands_mcp_logger = logging.getLogger("strands.tools.mcp.mcp_client")
    prev_level = strands_mcp_logger.level
    strands_mcp_logger.setLevel(logging.CRITICAL)
    try:
        client.start()
        logger.info("MCP client for server '%s' started successfully", server.name)
        return client
    except BaseException as e:
        logger.warning(
            "Failed to start MCP client for server '%s': %s. "
            "The agent will continue without this server's tools.",
            server.name,
            e,
        )
        try:
            client.stop()
        except BaseException:
            pass
        return None
    finally:
        strands_mcp_logger.setLevel(prev_level)


def create_mcp_clients(servers: list[MCPServerConfig]) -> list[MCPClient]:
    """Create MCP clients for all enabled server configurations.

    Must be called within an invocation context so that the workload
    access token is available for OAuth2-authenticated servers.

    Only servers with ``enabled=True`` are instantiated. Currently supports
    the ``streamable_http`` transport; other transports log a warning and
    are skipped. Servers that fail to connect (e.g. 401 Unauthorized) are
    skipped gracefully so the agent can still operate with its remaining tools.

    Args:
        servers: List of MCP server configurations.

    Returns:
        List of successfully initialised MCPClient instances.
    """
    clients: list[MCPClient] = []

    for server in servers:
        if not server.enabled:
            logger.debug("Skipping disabled MCP server '%s'", server.name)
            continue

        if server.transport == "streamable_http":
            client = _try_create_client(server)
            if client is not None:
                clients.append(client)
        else:
            logger.warning(
                "Unsupported transport '%s' for MCP server '%s'; skipping",
                server.transport,
                server.name,
            )

    logger.info("Initialised %d MCP client(s)", len(clients))
    return clients


def build_mcp_clients(servers: list[MCPServerConfig]) -> list[MCPClient]:
    """Build MCP clients without starting them.

    Used when clients will be registered via ``agent.tool_registry.process_tools``
    which handles starting internally.

    Args:
        servers: List of MCP server configurations.

    Returns:
        List of MCPClient instances (not yet started).
    """
    clients: list[MCPClient] = []

    for server in servers:
        if not server.enabled:
            logger.debug("Skipping disabled MCP server '%s'", server.name)
            continue

        if server.transport == "streamable_http":
            transport_callable = _build_transport_callable(server)
            client = MCPClient(transport_callable)
            clients.append(client)
            logger.info("Built MCP client for server '%s' (not yet started)", server.name)
        else:
            logger.warning(
                "Unsupported transport '%s' for MCP server '%s'; skipping",
                server.transport,
                server.name,
            )

    return clients


def has_oauth2_servers(servers: list[MCPServerConfig]) -> bool:
    """Check if any enabled MCP servers require OAuth2 authentication."""
    return any(
        s.enabled and s.auth and s.auth.type == "oauth2" and s.auth.credential_provider_name
        for s in servers
    )
