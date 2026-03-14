"""
Bedrock AgentCore Runtime API wrapper.

This module provides functions to interact with AWS Bedrock AgentCore Runtime API
for describing runtimes, listing endpoints, and invoking agents with streaming responses.
"""

import json
from typing import Any, Generator


def describe_runtime(arn: str, region: str) -> dict[str, Any]:
    """
    Describe an AgentCore Runtime by ARN.

    Uses the bedrock-agentcore-control client (control plane).
    See: https://docs.aws.amazon.com/boto3/latest/reference/services/bedrock-agentcore-control/client/get_agent_runtime.html

    Args:
        arn: AgentCore Runtime ARN (e.g., 'arn:aws:bedrock-agentcore:us-east-1:...:runtime/...')
        region: AWS region name

    Returns:
        Dictionary containing runtime metadata from the AgentCore API response

    Raises:
        Exception: If the runtime does not exist or API call fails
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)

    # Extract runtime ID from ARN
    # ARN format: arn:aws:bedrock-agentcore:{region}:{account_id}:runtime/{runtime_id}
    runtime_id = arn.split('/')[-1]

    response = client.get_agent_runtime(agentRuntimeId=runtime_id)
    return response


def list_runtime_endpoints(runtime_id: str, region: str) -> list[str]:
    """
    List available endpoint qualifiers for an AgentCore Runtime.

    Uses the bedrock-agentcore-control client (control plane).
    See: https://docs.aws.amazon.com/boto3/latest/reference/services/bedrock-agentcore-control/client/list_agent_runtime_endpoints.html

    Args:
        runtime_id: AgentCore Runtime ID (extracted from ARN)
        region: AWS region name

    Returns:
        List of endpoint qualifier names (e.g., ['DEFAULT'])
        Falls back to ['DEFAULT'] if the API call fails or returns no endpoints
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)

    try:
        response = client.list_agent_runtime_endpoints(agentRuntimeId=runtime_id)
        endpoints = response.get('runtimeEndpoints', [])

        # Extract qualifier names from endpoint objects
        qualifiers = [ep.get('name', 'DEFAULT') for ep in endpoints if 'name' in ep]

        return qualifiers if qualifiers else ['DEFAULT']

    except Exception:
        # Fallback to DEFAULT if API call fails
        return ['DEFAULT']


def invoke_agent(
    arn: str,
    qualifier: str,
    session_id: str,
    prompt: str,
    region: str,
    access_token: str | None = None,
) -> Generator[dict[str, Any], None, None]:
    """
    Invoke an AgentCore Runtime agent and stream the response.

    Calls the AgentCore invoke_agent_runtime API and yields structured chunks
    as they arrive from the streaming response.

    The boto3 API returns a 'response' field containing a StreamingBody.
    See: https://docs.aws.amazon.com/boto3/latest/reference/services/bedrock-agentcore/client/invoke_agent_runtime.html

    Args:
        arn: AgentCore Runtime ARN
        qualifier: Endpoint qualifier (e.g., 'DEFAULT')
        session_id: Unique session ID (typically a UUID) for this invocation
        prompt: Input prompt text to send to the agent
        region: AWS region name

    Yields:
        Structured dicts: {"type": "text", "content": str} for text payloads,
        {"type": "structured", "content": dict} for dict payloads (e.g. thinking data)

    Raises:
        Exception: If the agent invocation fails
    """
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config

    payload_bytes = json.dumps({"prompt": prompt}).encode('utf-8')

    params: dict[str, Any] = {
        "agentRuntimeArn": arn,
        "qualifier": qualifier,
        "runtimeSessionId": session_id,
        "payload": payload_bytes,
        "contentType": "application/json",
        "accept": "application/json",
    }

    if access_token:
        # OAuth-authorized agents: skip SigV4, use Bearer token only
        client = boto3.client(
            'bedrock-agentcore',
            region_name=region,
            config=Config(signature_version=UNSIGNED),
        )

        def _add_auth_header(request, **kwargs):
            request.headers["Authorization"] = f"Bearer {access_token}"

        client.meta.events.register("before-send.bedrock-agentcore.InvokeAgentRuntime", _add_auth_header)
    else:
        client = boto3.client('bedrock-agentcore', region_name=region)

    response = client.invoke_agent_runtime(**params)

    # The API returns 'response' as a StreamingBody.
    # The agent's response is SSE-formatted: each token arrives as a
    # "data: <json-string>\n\n" line within the stream.  We parse these
    # inner SSE events and yield individual text tokens so the caller
    # can forward them one-by-one.
    streaming_body = response.get('response')
    if streaming_body is None:
        return

    for line in streaming_body.iter_lines():
        decoded = line.decode('utf-8').strip()
        if not decoded.startswith('data:'):
            continue
        payload = decoded[5:].strip()  # strip "data:" prefix
        if not payload:
            continue
        try:
            parsed = json.loads(payload)
            if isinstance(parsed, dict):
                yield {"type": "structured", "content": parsed}
            elif isinstance(parsed, str) and parsed:
                yield {"type": "text", "content": parsed}
        except json.JSONDecodeError:
            if payload:
                yield {"type": "text", "content": payload}
