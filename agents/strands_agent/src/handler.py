"""AgentCore Runtime entry point for the Strands agent.

This module uses ``BedrockAgentCoreApp`` from the ``bedrock-agentcore``
SDK to expose the agent via the ``/invocations`` and ``/ping`` endpoints
required by AgentCore Runtime (port 8080, linux/arm64 container).

The ``@app.entrypoint`` decorator registers the handler so the SDK
manages the HTTP plumbing, health-check, and invocation lifecycle.

The handler is async and yields streaming events via
``agent.stream_async()`` so partial text chunks are emitted as they are
generated (R5).
"""

import logging
import os
import sys
from typing import Any, AsyncGenerator

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands.types.exceptions import MaxTokensReachedException

from strands.models.bedrock import BedrockModel

from src.config import AgentConfig, MCPServerConfig, AuthConfig, load_config
from src.agent import attach_mcp_tools, build_agent
from src.integrations.mcp_client import has_deferred_auth_servers, _build_transport_callable
from src.telemetry import trace_invocation

# Configure the root Python logger so all modules (agent, mcp_client, etc.)
# emit to stdout where AgentCore Runtime captures them for CloudWatch.
_log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, _log_level, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    stream=sys.stdout,
    force=True,
)

app = BedrockAgentCoreApp()
logger = app.logger

# Module-level state, initialized once at cold start
_agent = None
_config: AgentConfig | None = None
_mcp_attached = False
_dynamic_mcp_clients: dict[str, Any] = {}  # keyed by (server_name, actor_id)
_default_model: BedrockModel | None = None
_model_cache: dict[str, BedrockModel] = {}  # keyed by model_id


def _get_agent():
    """Get or initialize the singleton agent instance.

    If the configuration includes OAuth2-authenticated MCP servers,
    MCP client initialization is deferred until the first invocation
    when the workload access token is available in the request context.
    """
    global _agent, _config, _default_model
    if _agent is None:
        _config = load_config()
        defer_mcp = has_deferred_auth_servers(_config.integrations.mcp_servers)
        if defer_mcp:
            logger.info("Deferring MCP client init — authenticated servers require invocation context")
        _agent = build_agent(_config, defer_mcp=defer_mcp)
        _default_model = _agent.model
        logger.info("Agent initialized successfully")
    return _agent


def _ensure_mcp_tools(actor_id: str = ""):
    """Attach MCP tools on the first invocation when context is available."""
    global _mcp_attached
    if _mcp_attached or _config is None:
        return
    _mcp_attached = True

    enabled_servers = [s for s in _config.integrations.mcp_servers if s.enabled]
    if not enabled_servers:
        return

    if actor_id:
        for server in _config.integrations.mcp_servers:
            if server.auth and server.auth.type == "api_key" and "{actor_id}" in server.auth.credentials_secret_arn:
                server.auth.credentials_secret_arn = server.auth.credentials_secret_arn.replace("{actor_id}", actor_id)

    logger.info("Attaching MCP tools (first invocation with context)")
    try:
        attach_mcp_tools(_agent, _config.integrations.mcp_servers)
    except Exception as e:
        logger.warning("Failed to attach MCP tools: %s. Agent will continue without MCP tools.", e)


def _attach_dynamic_mcp_servers(agent_instance, dynamic_servers: list[dict[str, Any]], actor_id: str) -> None:
    """Attach dynamically-requested MCP servers for this invocation.

    Maintains a pool keyed by (server_name, actor_id). New servers are
    started and registered; previously-connected servers are reused.
    """
    from strands.tools.mcp import MCPClient

    for server_data in dynamic_servers:
        name = server_data.get("name", "")
        pool_key = f"{name}:{actor_id}"

        if pool_key in _dynamic_mcp_clients:
            logger.debug("Reusing cached dynamic MCP client for '%s'", name)
            continue

        auth_data = server_data.get("auth")
        auth_config = None
        if auth_data:
            auth_config = AuthConfig(
                type=auth_data.get("type", ""),
                credentials_secret_arn=auth_data.get("credentials_secret_arn", ""),
                api_key_header_name=auth_data.get("api_key_header_name", "x-api-key"),
                well_known_endpoint=auth_data.get("well_known_endpoint", ""),
                credential_provider_name=auth_data.get("credential_provider_name", ""),
                scopes=auth_data.get("scopes", ""),
            )

        config = MCPServerConfig(
            name=name,
            enabled=True,
            transport=server_data.get("transport", "streamable_http"),
            endpoint_url=server_data.get("endpoint_url", ""),
            auth=auth_config,
        )

        transport_callable = _build_transport_callable(config)
        client = MCPClient(transport_callable)
        try:
            agent_instance.tool_registry.process_tools([client])
            _dynamic_mcp_clients[pool_key] = client
            logger.info("Attached dynamic MCP server '%s' for actor '%s'", name, actor_id)
        except BaseException as e:
            logger.warning("Failed to attach dynamic MCP server '%s' for actor '%s': %s", name, actor_id, e)
            try:
                client.stop()
            except BaseException:
                pass


@app.entrypoint
async def invoke(payload: dict[str, Any]) -> AsyncGenerator[Any, None]:
    """Handle an AgentCore Runtime invocation with streaming response.

    This is an async generator decorated with ``@app.entrypoint``.  The
    ``BedrockAgentCoreApp`` SDK forwards ``POST /invocations`` requests
    here and streams each yielded event back to the caller.

    Using ``agent.stream_async()`` ensures partial text chunks are emitted
    as they are generated rather than buffered (R5).

    Args:
        payload: The invocation payload containing at minimum a ``prompt`` key.

    Yields:
        Streaming events produced by the agent.
    """
    agent = _get_agent()

    prompt = payload.get("prompt", "")
    session_id = payload.get("session_id", "")
    actor_id = payload.get("actor_id") or "loom-agent"

    _ensure_mcp_tools(actor_id)

    dynamic_servers = payload.get("dynamic_mcp_servers")
    if dynamic_servers:
        _attach_dynamic_mcp_servers(agent, dynamic_servers, actor_id)

    # Runtime model override
    runtime_model_id = payload.get("model_id")
    if runtime_model_id and _config:
        if runtime_model_id not in _model_cache:
            _model_cache[runtime_model_id] = BedrockModel(
                model_id=runtime_model_id,
                max_tokens=_config.max_tokens,
                streaming=True,
            )
            logger.info("Created cached BedrockModel for runtime override: %s", runtime_model_id)
        agent.model = _model_cache[runtime_model_id]
    elif _default_model:
        agent.model = _default_model

    logger.info("Processing invocation session_id=%s actor_id=%s model=%s", session_id, actor_id, runtime_model_id or _config.model_id if _config else "unknown")

    with trace_invocation(invocation_id=session_id) as span:
        span.set_attribute("agent.session_id", session_id)
        try:
            stream = agent.stream_async(prompt, invocation_state={"session_id": session_id, "actor_id": actor_id})
            async for event in stream:
                if isinstance(event, dict):
                    text = None
                    data = event.get("data")
                    if isinstance(data, str):
                        text = data
                    elif isinstance(event.get("delta"), dict):
                        text = event["delta"].get("text")
                    if text:
                        yield text
                        continue
                    # Log non-text event keys for diagnostics
                    event_keys = list(event.keys())
                    logger.info("Stream event keys: %s", event_keys)
                    # Check for tool_use in contentBlockStart (Strands SDK stream event)
                    chunk = event.get("event")
                    if isinstance(chunk, dict):
                        if "contentBlockStart" in chunk:
                            start = chunk["contentBlockStart"].get("start", {})
                            tool_use = start.get("toolUse")
                            if isinstance(tool_use, dict) and tool_use.get("name"):
                                logger.info("Tool call detected: %s", tool_use["name"])
                                yield {"tool_use": {"name": tool_use["name"], "id": tool_use.get("toolUseId", "")}}
        except MaxTokensReachedException:
            logger.warning("Max tokens reached for session_id=%s", session_id)
            yield "\n\n[Response truncated: the model reached its maximum output token limit. Try a shorter prompt or a model with a higher token limit.]"


def main() -> None:
    """Local development entry point for running the agent interactively."""
    agent = _get_agent()
    print("Agent ready. Type your prompt (Ctrl+C to exit):")

    while True:
        try:
            prompt = input("\n> ")
            if not prompt.strip():
                continue
            result = agent(prompt)
            for chunk in result:
                if hasattr(chunk, "text") and chunk.text:
                    print(chunk.text, end="", flush=True)
                elif isinstance(chunk, str):
                    print(chunk, end="", flush=True)
            print()
        except KeyboardInterrupt:
            print("\nExiting.")
            break
        except Exception as e:
            print(f"Error: {e}")


if __name__ == "__main__":
    app.run()
