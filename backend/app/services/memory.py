"""
Bedrock AgentCore Memory API wrapper.

This module provides functions to interact with AWS Bedrock AgentCore Memory API
for creating, describing, listing, and deleting memory resources.
"""
from typing import Any


def create_memory(
    name: str,
    event_expiry_duration: int,
    description: str | None = None,
    encryption_key_arn: str | None = None,
    memory_execution_role_arn: str | None = None,
    memory_strategies: list[dict] | None = None,
    tags: dict[str, str] | None = None,
    region: str = "us-east-1",
) -> dict[str, Any]:
    """
    Create a new AgentCore Memory resource.

    The create_memory API does not accept tags inline. Tags are applied
    separately via ``tag_resource`` after creation.

    Args:
        name: Name for the memory resource
        event_expiry_duration: Duration in days before memory events expire
        description: Optional description
        encryption_key_arn: Optional KMS key ARN for encryption
        memory_execution_role_arn: Optional IAM role ARN for memory execution
        memory_strategies: Optional list of memory strategy configurations
        tags: Optional tags (applied via tag_resource after creation)
        region: AWS region name

    Returns:
        Dictionary containing the create_memory API response
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)

    params: dict[str, Any] = {
        "name": name,
        "eventExpiryDuration": event_expiry_duration,
    }
    if description:
        params["description"] = description
    if encryption_key_arn:
        params["encryptionKeyArn"] = encryption_key_arn
    if memory_execution_role_arn:
        params["memoryExecutionRoleArn"] = memory_execution_role_arn
    if memory_strategies:
        params["memoryStrategies"] = memory_strategies

    response = client.create_memory(**params)

    # Apply tags via tag_resource (not supported inline by create_memory)
    if tags:
        memory_arn = response.get("memory", {}).get("arn")
        if memory_arn:
            try:
                client.tag_resource(resourceArn=memory_arn, tags=tags)
            except Exception:
                pass  # Best-effort; tags stored locally regardless

    return response


def get_memory(memory_id: str, region: str = "us-east-1") -> dict[str, Any]:
    """
    Get details of an AgentCore Memory resource.

    Args:
        memory_id: The memory resource ID
        region: AWS region name

    Returns:
        Dictionary containing the get_memory API response
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)
    response = client.get_memory(memoryId=memory_id)
    return response


def list_memories(region: str = "us-east-1") -> dict[str, Any]:
    """
    List all AgentCore Memory resources.

    Args:
        region: AWS region name

    Returns:
        Dictionary containing the list_memories API response
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)
    response = client.list_memories()
    return response


def delete_memory(memory_id: str, region: str = "us-east-1") -> dict[str, Any]:
    """
    Delete an AgentCore Memory resource.

    Args:
        memory_id: The memory resource ID
        region: AWS region name

    Returns:
        Dictionary containing the delete_memory API response
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)
    response = client.delete_memory(memoryId=memory_id)
    return response
