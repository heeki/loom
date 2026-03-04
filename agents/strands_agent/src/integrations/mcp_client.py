"""Dynamic MCP tool client creation from agent configuration."""

import logging
from functools import partial
from typing import Any

from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

from src.config import MCPServerConfig

logger = logging.getLogger(__name__)


def _build_transport_callable(config: MCPServerConfig) -> Any:
    """Build a transport callable for the given MCP server configuration.

    Args:
        config: MCP server configuration with endpoint and optional auth.

    Returns:
        A callable that returns an async context manager providing the MCP transport.
    """
    if config.auth and config.auth.type == "oauth2":
        logger.info(
            "MCP server '%s' uses oauth2 auth (well_known_endpoint=%s, secret_arn=%s)",
            config.name,
            config.auth.well_known_endpoint,
            config.auth.credentials_secret_arn,
        )
        # TODO: Resolve credentials from credentials_secret_arn via Secrets Manager
        # and configure OAuth2 headers/token on the HTTP client.

    return partial(streamablehttp_client, url=config.endpoint_url)


def create_mcp_clients(servers: list[MCPServerConfig]) -> list[MCPClient]:
    """Create MCP clients for all enabled server configurations.

    Only servers with ``enabled=True`` are instantiated. Currently supports
    the ``streamable_http`` transport; other transports log a warning and
    are skipped.

    Args:
        servers: List of MCP server configurations.

    Returns:
        List of initialised MCPClient instances.
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
            logger.info("Created MCP client for server '%s'", server.name)
        else:
            logger.warning(
                "Unsupported transport '%s' for MCP server '%s'; skipping",
                server.transport,
                server.name,
            )

    logger.info("Initialised %d MCP client(s)", len(clients))
    return clients
