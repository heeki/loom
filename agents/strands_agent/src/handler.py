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

from typing import Any, AsyncGenerator

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands.types.exceptions import MaxTokensReachedException

from src.config import load_config
from src.agent import build_agent
from src.telemetry import trace_invocation

app = BedrockAgentCoreApp()
logger = app.logger

# Module-level agent instance, initialized once at cold start
_agent = None


def _get_agent():
    """Get or initialize the singleton agent instance."""
    global _agent
    if _agent is None:
        config = load_config()
        _agent = build_agent(config)
        logger.info("Agent initialized successfully")
    return _agent


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
