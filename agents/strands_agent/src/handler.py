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

from src.config import AgentConfig, load_config
from src.agent import attach_mcp_tools, build_agent
from src.integrations.mcp_client import has_oauth2_servers
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


def _get_agent():
    """Get or initialize the singleton agent instance.

    If the configuration includes OAuth2-authenticated MCP servers,
    MCP client initialization is deferred until the first invocation
    when the workload access token is available in the request context.
    """
    global _agent, _config
    if _agent is None:
        _config = load_config()
        defer_mcp = has_oauth2_servers(_config.integrations.mcp_servers)
        if defer_mcp:
            logger.info("Deferring MCP client init — OAuth2 servers require invocation context")
        _agent = build_agent(_config, defer_mcp=defer_mcp)
        logger.info("Agent initialized successfully")
    return _agent


def _ensure_mcp_tools():
    """Attach MCP tools on the first invocation when context is available."""
    global _mcp_attached
    if _mcp_attached or _config is None:
        return
    _mcp_attached = True

    enabled_servers = [s for s in _config.integrations.mcp_servers if s.enabled]
    if not enabled_servers:
        return

    logger.info("Attaching MCP tools (first invocation with context)")
    try:
        attach_mcp_tools(_agent, _config.integrations.mcp_servers)
    except Exception as e:
        logger.warning("Failed to attach MCP tools: %s. Agent will continue without MCP tools.", e)


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
    _ensure_mcp_tools()

    prompt = payload.get("prompt", "")
    session_id = payload.get("session_id", "")

    logger.info("Processing invocation session_id=%s", session_id)

    with trace_invocation(invocation_id=session_id) as span:
        span.set_attribute("agent.session_id", session_id)
        try:
            stream = agent.stream_async(prompt)
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
