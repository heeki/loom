"""A2A (Agent-to-Agent) client vending from agent configuration.

Uses the Strands Agents SDK A2AAgent class to create callable wrappers
around remote A2A-compliant agents.  Each enabled A2A agent in the
configuration becomes a Strands ``@tool`` function that the orchestrating
agent can invoke during a conversation.
"""

import logging
from typing import Any

from strands import tool
from strands.agent.a2a_agent import A2AAgent

from src.config import A2AAgentConfig

logger = logging.getLogger(__name__)


def _build_a2a_tool(config: A2AAgentConfig) -> Any:
    """Build a Strands tool function that delegates to a remote A2A agent.

    Args:
        config: A2A agent configuration with endpoint and optional auth.

    Returns:
        A ``@tool``-decorated callable suitable for passing to a Strands Agent.
    """
    a2a_agent = A2AAgent(
        endpoint=config.endpoint_url,
        name=config.name,
    )

    if config.auth and config.auth.type == "oauth2":
        logger.info(
            "A2A agent '%s' uses oauth2 auth (well_known_endpoint=%s, secret_arn=%s)",
            config.name,
            config.auth.well_known_endpoint,
            config.auth.credentials_secret_arn,
        )
        # TODO: Resolve credentials from credentials_secret_arn via Secrets Manager
        # and configure an authenticated httpx client / A2AClientFactory.

    agent_name = config.name
    agent_description = f"Send a message to the '{agent_name}' A2A agent."

    @tool(name=f"a2a_{agent_name}", description=agent_description)
    def a2a_tool(message: str) -> str:
        """Forward a message to the remote A2A agent and return its response."""
        result = a2a_agent(message)
        return str(result.message)

    logger.info("Created A2A tool for agent '%s' at %s", config.name, config.endpoint_url)
    return a2a_tool


def create_a2a_clients(agents: list[A2AAgentConfig]) -> list[Any]:
    """Create A2A tool wrappers for all enabled agent configurations.

    Each enabled A2A agent is wrapped in a Strands ``@tool`` function using
    ``A2AAgent`` from the Strands SDK.  The returned tools can be passed
    directly to a Strands ``Agent`` constructor.

    Args:
        agents: List of A2A agent configurations.

    Returns:
        List of ``@tool``-decorated callables, one per enabled agent.
    """
    tools: list[Any] = []

    for agent_cfg in agents:
        if not agent_cfg.enabled:
            logger.debug("Skipping disabled A2A agent '%s'", agent_cfg.name)
            continue

        a2a_tool = _build_a2a_tool(agent_cfg)
        tools.append(a2a_tool)

    logger.info("Initialised %d A2A tool(s)", len(tools))
    return tools
