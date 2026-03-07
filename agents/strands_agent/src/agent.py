"""Strands Agent initialization and configuration."""

import logging
from typing import Optional

from strands import Agent
from strands.models.bedrock import BedrockModel

from src.config import AgentConfig
from src.integrations.mcp_client import create_mcp_clients
from src.integrations.a2a_client import create_a2a_clients
from src.integrations.memory import MemoryHook
from src.telemetry import setup_telemetry, TelemetryHook

logger = logging.getLogger(__name__)


def build_agent(config: AgentConfig) -> Agent:
    """Build a Strands Agent from the provided configuration.

    Initializes the Bedrock model, loads enabled integrations
    (MCP tools, memory hooks), and returns a configured Agent
    ready for invocation.

    Args:
        config: The agent configuration specifying model, system prompt,
                and integration settings.

    Returns:
        A configured Strands Agent instance.
    """
    setup_telemetry()

    model = BedrockModel(
        model_id=config.model_id,
        streaming=True,
    )
    logger.info("Initialized BedrockModel with model_id=%s", config.model_id)

    tools: list = []
    hooks: list = []

    # MCP tool clients (R3)
    if config.integrations.mcp_servers:
        enabled_servers = [s for s in config.integrations.mcp_servers if s.enabled]
        if enabled_servers:
            mcp_clients = create_mcp_clients(config.integrations.mcp_servers)
            tools.extend(mcp_clients)
            logger.info("Loaded %d MCP tool client(s)", len(mcp_clients))

    # A2A agent clients (R4 - scaffold)
    if config.integrations.a2a_agents:
        enabled_agents = [a for a in config.integrations.a2a_agents if a.enabled]
        if enabled_agents:
            a2a_clients = create_a2a_clients(config.integrations.a2a_agents)
            if a2a_clients:
                tools.extend(a2a_clients)
                logger.info("Loaded %d A2A client(s)", len(a2a_clients))

    # Telemetry hook (R7)
    telemetry_hook = TelemetryHook()
    hooks.append(telemetry_hook)
    logger.info("Enabled telemetry hook")

    # Memory hooks (R8)
    if config.integrations.memory.enabled:
        memory_hook = MemoryHook()
        hooks.append(memory_hook)
        logger.info("Enabled AgentCore Memory hook")

    agent = Agent(
        model=model,
        system_prompt=config.system_prompt,
        tools=tools,
        hooks=hooks,
    )
    logger.info("Agent initialized with %d tool(s) and %d hook(s)", len(tools), len(hooks))
    return agent
