"""
AgentCore Runtime deployment and configuration management.

This module provides functions to deploy, update, and delete AgentCore Runtime agents,
manage secrets via AWS Secrets Manager, and store large configuration values in S3.
"""

import re
from typing import Any


def deploy_agent(
    name: str,
    code_uri: str,
    execution_role_arn: str,
    env_vars: dict[str, str],
    region: str
) -> dict[str, Any]:
    """
    Deploy a new agent runtime via the AgentCore control plane.

    Uses the bedrock-agentcore-control client to create an agent runtime
    with the specified artifact location and configuration.

    Args:
        name: Name for the agent runtime
        code_uri: S3 URI for the agent code artifact
        execution_role_arn: IAM role ARN for the runtime execution
        env_vars: Environment variables to inject into the runtime
        region: AWS region name

    Returns:
        Dictionary containing the create_agent_runtime API response
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)

    response = client.create_agent_runtime(
        agentRuntimeName=name,
        agentRuntimeArtifact={'s3': {'s3BucketUri': code_uri}},
        roleArn=execution_role_arn,
        environmentVariables=env_vars
    )
    return response


def redeploy_agent(
    runtime_id: str,
    code_uri: str,
    env_vars: dict[str, str] | None,
    region: str
) -> dict[str, Any]:
    """
    Update an existing agent runtime with new code or environment variables.

    Args:
        runtime_id: AgentCore Runtime ID to update
        code_uri: S3 URI for the updated agent code artifact
        env_vars: Optional updated environment variables (None to keep existing)
        region: AWS region name

    Returns:
        Dictionary containing the update_agent_runtime API response
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)

    params: dict[str, Any] = {
        'agentRuntimeId': runtime_id,
        'agentRuntimeArtifact': {'s3': {'s3BucketUri': code_uri}},
    }
    if env_vars is not None:
        params['environmentVariables'] = env_vars

    response = client.update_agent_runtime(**params)
    return response


def delete_runtime(runtime_id: str, region: str) -> None:
    """
    Delete an agent runtime.

    Args:
        runtime_id: AgentCore Runtime ID to delete
        region: AWS region name
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)
    client.delete_agent_runtime(agentRuntimeId=runtime_id)


def get_runtime_status(runtime_id: str, region: str) -> str:
    """
    Get the current deployment status of an agent runtime.

    Args:
        runtime_id: AgentCore Runtime ID
        region: AWS region name

    Returns:
        Status string from the AgentCore API (e.g., 'ACTIVE', 'CREATING', 'FAILED')
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)
    response = client.get_agent_runtime(agentRuntimeId=runtime_id)
    return response.get('status', 'UNKNOWN')


# Patterns that indicate a value may contain a secret
_SECRET_PATTERNS = [
    re.compile(r'^sk-[a-zA-Z0-9]{20,}'),       # OpenAI-style API keys
    re.compile(r'^AKIA[A-Z0-9]{16}'),            # AWS access key IDs
    re.compile(r'^ghp_[a-zA-Z0-9]{36,}'),        # GitHub personal access tokens
    re.compile(r'^gho_[a-zA-Z0-9]{36,}'),        # GitHub OAuth tokens
    re.compile(r'^xox[bpsar]-'),                  # Slack tokens
    re.compile(r'^eyJ[a-zA-Z0-9_-]{10,}\.'),     # JWT tokens
]

_SECRET_KEYWORDS = ['password', 'secret', 'token', 'api_key', 'apikey', 'private_key']


def validate_config_values(config: dict[str, str]) -> list[str]:
    """
    Validate that configuration values do not appear to contain secrets.

    Checks values against known secret patterns (API keys, tokens, passwords)
    and flags suspicious entries.

    Args:
        config: Dictionary of configuration key-value pairs

    Returns:
        List of warning messages for suspicious values
    """
    warnings: list[str] = []

    for key, value in config.items():
        key_lower = key.lower()

        # Check if the key name suggests a secret
        for keyword in _SECRET_KEYWORDS:
            if keyword in key_lower:
                warnings.append(
                    f"Key '{key}' appears to be a secret based on its name. "
                    f"Consider using Secrets Manager instead."
                )
                break

        # Check if the value matches known secret patterns
        for pattern in _SECRET_PATTERNS:
            if pattern.match(value):
                warnings.append(
                    f"Value for key '{key}' matches a known secret pattern. "
                    f"Use Secrets Manager to store this value securely."
                )
                break

    return warnings


def store_secret(name: str, value: str, region: str) -> str:
    """
    Store a secret in AWS Secrets Manager.

    Args:
        name: Name for the secret
        value: Secret value to store
        region: AWS region name

    Returns:
        The ARN of the created secret
    """
    import boto3

    client = boto3.client('secretsmanager', region_name=region)
    response = client.create_secret(
        Name=name,
        SecretString=value
    )
    return response['ARN']


def update_secret(secret_arn: str, value: str, region: str) -> None:
    """
    Update an existing secret value in Secrets Manager.

    Args:
        secret_arn: ARN of the secret to update
        value: New secret value
        region: AWS region name
    """
    import boto3

    client = boto3.client('secretsmanager', region_name=region)
    client.put_secret_value(
        SecretId=secret_arn,
        SecretString=value
    )


def delete_secret(secret_arn: str, region: str) -> None:
    """
    Delete a secret from Secrets Manager.

    Uses ForceDeleteWithoutRecovery for immediate deletion.

    Args:
        secret_arn: ARN of the secret to delete
        region: AWS region name
    """
    import boto3

    client = boto3.client('secretsmanager', region_name=region)
    client.delete_secret(
        SecretId=secret_arn,
        ForceDeleteWithoutRecovery=True
    )


def store_large_config(
    agent_name: str,
    key: str,
    value: str,
    bucket: str,
    region: str
) -> str:
    """
    Store a large configuration value in S3.

    Args:
        agent_name: Name of the agent (used as S3 key prefix)
        key: Configuration key name
        value: Configuration value to store
        bucket: S3 bucket name
        region: AWS region name

    Returns:
        S3 URI in the format s3://{bucket}/{agent_name}/config/{key}
    """
    import boto3

    client = boto3.client('s3', region_name=region)
    s3_key = f"{agent_name}/config/{key}"

    client.put_object(
        Bucket=bucket,
        Key=s3_key,
        Body=value.encode('utf-8'),
        ContentType='text/plain'
    )

    return f"s3://{bucket}/{s3_key}"
