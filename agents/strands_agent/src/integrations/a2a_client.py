"""Scaffold for A2A (Agent-to-Agent) client vending from agent configuration."""

import logging
from typing import Any

from src.config import A2AAgentConfig

logger = logging.getLogger(__name__)


def create_a2a_clients(agents: list[A2AAgentConfig]) -> list[Any]:
    """Create A2A clients for all enabled agent configurations.

    This is a scaffold — the full implementation will follow once the A2A
    SDK and protocol details are finalised.

    Only agents with ``enabled=True`` are considered.

    Args:
        agents: List of A2A agent configurations.

    Returns:
        An empty list (not yet implemented).
    """
    enabled = [a for a in agents if a.enabled]

    if not enabled:
        logger.debug("No enabled A2A agents configured; nothing to create")
        return []

    for agent in enabled:
        logger.warning(
            "A2A agent '%s' configured (endpoint=%s) but not yet implemented; skipping",
            agent.name,
            agent.endpoint_url,
        )

    # TODO: Implement A2A client creation using the A2A SDK.
    # Expected pattern (mirrors MCP client creation):
    #   1. Iterate over enabled agent configs.
    #   2. Build transport/client per agent using endpoint_url and auth.
    #   3. Return list of A2A client instances.
    return []
