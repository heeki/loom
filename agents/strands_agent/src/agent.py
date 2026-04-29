"""Strands Agent initialization and configuration."""

import logging
from typing import Optional

from strands import Agent
from strands.models.bedrock import BedrockModel

from src.config import AgentConfig, MCPServerConfig
from src.integrations.approval import ApprovalHook
from src.integrations.mcp_client import build_mcp_clients, create_mcp_clients, has_oauth2_servers
from src.integrations.a2a_client import create_a2a_clients
from src.integrations.memory import MemoryHook
from src.telemetry import TelemetryHook

logger = logging.getLogger(__name__)


def build_agent(config: AgentConfig, defer_mcp: bool = False) -> tuple[Agent, ApprovalHook]:
    """Build a Strands Agent from the provided configuration.

    Initializes the Bedrock model, loads enabled integrations
    (MCP tools, memory hooks), and returns a configured Agent
    ready for invocation.

    Args:
        config: The agent configuration specifying model, system prompt,
                and integration settings.
        defer_mcp: If True, skip MCP client initialization.  Used when
                   OAuth2-authenticated MCP servers require a workload
                   access token that is only available during invocation.

    Returns:
        A configured Strands Agent instance.
    """
    model = BedrockModel(
        model_id=config.model_id,
        max_tokens=config.max_tokens,
        streaming=True,
    )
    logger.info("Initialized BedrockModel with model_id=%s", config.model_id)

    tools: list = []
    hooks: list = []

    # MCP tool clients (R3) — may be deferred for authenticated servers
    if not defer_mcp and config.integrations.mcp_servers:
        enabled_servers = [s for s in config.integrations.mcp_servers if s.enabled]
        if enabled_servers:
            mcp_clients = build_mcp_clients(config.integrations.mcp_servers)
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

    # Approval hook (HITL Method 1) — policies injected at invocation time
    approval_hook = ApprovalHook(agent_tags=config.tags if hasattr(config, "tags") else None)
    hooks.append(approval_hook)
    if approval_hook.policies:
        logger.info("Enabled approval hook with %d static policy(ies)", len(approval_hook.policies))

    # Telemetry hook (R7)
    telemetry_hook = TelemetryHook()
    hooks.append(telemetry_hook)
    logger.info("Enabled telemetry hook")

    # Memory hooks (R8)
    if config.integrations.memory.enabled:
        memory_store_id = None
        if config.integrations.memory.resources:
            memory_store_id = config.integrations.memory.resources[0].memory_id
        memory_hook = MemoryHook(memory_store_id=memory_store_id)
        hooks.append(memory_hook)
        logger.info("Enabled AgentCore Memory hook (store_id=%s)", memory_store_id)

    try:
        agent = Agent(
            model=model,
            system_prompt=config.system_prompt,
            tools=tools,
            hooks=hooks,
        )
    except BaseException as e:
        if tools:
            logger.warning(
                "Agent init failed with %d tool(s): %s. Retrying without tools.",
                len(tools), e,
            )
            for tool in tools:
                if hasattr(tool, "stop"):
                    try:
                        tool.stop()
                    except BaseException:
                        pass
            agent = Agent(
                model=model,
                system_prompt=config.system_prompt,
                tools=[],
                hooks=hooks,
            )
        else:
            raise
    logger.info("Agent initialized with %d tool(s) and %d hook(s)", len(agent.tool_registry.registry), len(hooks))
    return agent, approval_hook


def attach_mcp_tools(agent: Agent, servers: list[MCPServerConfig]) -> None:
    """Attach MCP tool clients to an already-initialized agent.

    Called during the first invocation when the workload access token
    is available in the request context.

    Args:
        agent: The running Strands Agent instance.
        servers: MCP server configurations to connect.
    """
    mcp_clients = build_mcp_clients(servers)
    for client in mcp_clients:
        agent.tool_registry.process_tools([client])
    logger.info("Attached %d MCP tool client(s) to agent", len(mcp_clients))
