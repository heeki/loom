"""AgentCore Harness API wrapper.

Provides functions to create, get, delete, and invoke harness-based managed agents
via the bedrock-agentcore-control (control plane) and bedrock-agentcore (data plane) clients.
"""

import json
import logging
from typing import Any, Generator

logger = logging.getLogger(__name__)


def create_harness(
    name: str,
    execution_role_arn: str,
    model_id: str,
    system_prompt: str,
    tools: list[dict[str, Any]] | None = None,
    allowed_tools: list[str] | None = None,
    max_iterations: int | None = None,
    max_tokens: int | None = None,
    authorizer_config: dict[str, Any] | None = None,
    network_mode: str = "PUBLIC",
    idle_timeout: int | None = None,
    max_lifetime: int | None = None,
    tags: dict[str, str] | None = None,
    region: str = "us-east-1",
) -> dict[str, Any]:
    """Create a new AgentCore Harness (managed agent loop).

    Returns the CreateHarness API response containing harnessId, harnessArn, status, etc.
    """
    import boto3

    client = boto3.client("bedrock-agentcore-control", region_name=region)

    params: dict[str, Any] = {
        "harnessName": name,
        "executionRoleArn": execution_role_arn,
        "model": {
            "bedrockModelConfig": {"modelId": model_id},
        },
        "systemPrompt": [{"text": system_prompt}],
    }

    if max_tokens is not None:
        params["model"]["bedrockModelConfig"]["maxTokens"] = max_tokens

    if tools:
        params["tools"] = tools
    if allowed_tools:
        params["allowedTools"] = allowed_tools
    else:
        params["allowedTools"] = ["*"]

    if max_iterations is not None:
        params["maxIterations"] = max_iterations
    if authorizer_config:
        params["authorizerConfiguration"] = authorizer_config

    lifecycle_config: dict[str, int] = {}
    if idle_timeout is not None:
        lifecycle_config["idleRuntimeSessionTimeout"] = idle_timeout
    if max_lifetime is not None:
        lifecycle_config["maxLifetime"] = max_lifetime

    if lifecycle_config or network_mode != "PUBLIC":
        env_config: dict[str, Any] = {}
        if lifecycle_config:
            env_config["lifecycleConfiguration"] = lifecycle_config
        if network_mode != "PUBLIC":
            env_config["networkConfiguration"] = {"networkMode": network_mode}
        params["environment"] = {"agentCoreRuntimeEnvironment": env_config}

    if tags:
        params["tags"] = tags

    response = client.create_harness(**params)
    result = response.get("harness", response)
    logger.info("Created harness '%s': id=%s status=%s", name, result.get("harnessId"), result.get("status"))
    return result


def get_harness(harness_id: str, region: str = "us-east-1") -> dict[str, Any]:
    """Get the current state of a harness."""
    import boto3

    client = boto3.client("bedrock-agentcore-control", region_name=region)
    response = client.get_harness(harnessId=harness_id)
    return response.get("harness", response)


def delete_harness(harness_id: str, region: str = "us-east-1") -> dict[str, Any]:
    """Delete a harness."""
    import boto3

    client = boto3.client("bedrock-agentcore-control", region_name=region)
    response = client.delete_harness(harnessId=harness_id)
    logger.info("Deleted harness %s", harness_id)
    return response


def invoke_harness_stream(
    harness_arn: str,
    session_id: str,
    prompt: str,
    region: str = "us-east-1",
    model_id: str | None = None,
    system_prompt: str | None = None,
    tools: list[dict[str, Any]] | None = None,
    allowed_tools: list[str] | None = None,
    max_iterations: int | None = None,
    timeout_seconds: int | None = None,
    max_tokens: int | None = None,
    actor_id: str | None = None,
    access_token: str | None = None,
) -> Generator[dict[str, Any], None, None]:
    """Invoke a harness and yield translated SSE events.

    Translates the Converse API-style streaming response into the same event
    format used by invoke_agent (text chunks, tool_use, metadata) so the
    frontend chat UI works without modification.

    Yields dicts with keys:
        - {"type": "text", "content": str} for text deltas
        - {"type": "structured", "content": {"tool_use": {"name": str}}} for tool use
        - {"type": "metadata", "content": dict} for token usage/metrics
    """
    import boto3

    if access_token:
        from botocore import UNSIGNED
        from botocore.config import Config

        client = boto3.client(
            "bedrock-agentcore",
            region_name=region,
            config=Config(signature_version=UNSIGNED),
        )

        def _add_auth_header(request, **kwargs):
            request.headers["Authorization"] = f"Bearer {access_token}"

        client.meta.events.register("before-send.bedrock-agentcore.InvokeHarness", _add_auth_header)
    else:
        client = boto3.client("bedrock-agentcore", region_name=region)

    params: dict[str, Any] = {
        "harnessArn": harness_arn,
        "runtimeSessionId": session_id,
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
    }

    if model_id:
        params["model"] = {"bedrockModelConfig": {"modelId": model_id}}
    if system_prompt:
        params["systemPrompt"] = [{"text": system_prompt}]
    if tools:
        params["tools"] = tools
    if allowed_tools:
        params["allowedTools"] = allowed_tools
    if max_iterations is not None:
        params["maxIterations"] = max_iterations
    if timeout_seconds is not None:
        params["timeoutSeconds"] = timeout_seconds
    if max_tokens is not None:
        params["maxTokens"] = max_tokens
    if actor_id:
        params["actorId"] = actor_id

    response = client.invoke_harness(**params)

    stream = response.get("stream") or response.get("body") or response.get("response")
    if stream is None:
        return

    total_input_tokens = 0
    total_output_tokens = 0
    current_tool_name: str | None = None

    for event in stream:
        if "contentBlockStart" in event:
            start = event["contentBlockStart"].get("start", {})
            tool_use = start.get("toolUse")
            if tool_use:
                current_tool_name = tool_use.get("name")
                if current_tool_name:
                    yield {"type": "structured", "content": {"tool_use": {"name": current_tool_name}}}

        elif "contentBlockDelta" in event:
            delta = event["contentBlockDelta"].get("delta", {})
            text = delta.get("text")
            if text:
                yield {"type": "text", "content": text}

        elif "contentBlockStop" in event:
            current_tool_name = None

        elif "messageStart" in event:
            pass

        elif "messageStop" in event:
            pass

        elif "metadata" in event:
            meta = event["metadata"]
            usage = meta.get("usage", {})
            total_input_tokens += usage.get("inputTokens", 0)
            total_output_tokens += usage.get("outputTokens", 0)

    if total_input_tokens > 0 or total_output_tokens > 0:
        yield {
            "type": "metadata",
            "content": {
                "input_tokens": total_input_tokens,
                "output_tokens": total_output_tokens,
                "total_tokens": total_input_tokens + total_output_tokens,
            },
        }
