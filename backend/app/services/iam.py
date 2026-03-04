"""
IAM execution role management for AgentCore Runtime agents.

This module provides functions to create, update, and delete IAM roles
used by AgentCore Runtime agents, including trust policies and
integration-specific permissions.
"""

import json
from typing import Any


def create_execution_role(
    agent_name: str,
    runtime_id: str,
    region: str,
    account_id: str
) -> str:
    """
    Create an IAM execution role for an agent runtime.

    Creates a role with a trust policy allowing bedrock-agentcore.amazonaws.com
    and attaches a base inline policy with workload access token permissions.

    Args:
        agent_name: Name of the agent (used for resource scoping)
        runtime_id: AgentCore Runtime ID (used in role naming)
        region: AWS region name
        account_id: AWS account ID

    Returns:
        ARN of the created IAM role
    """
    import boto3

    client = boto3.client('iam')

    role_name = f"loom-agent-{runtime_id}"
    trust_policy = build_trust_policy()
    base_policy = build_base_policy(region, account_id, agent_name)

    response = client.create_role(
        RoleName=role_name,
        AssumeRolePolicyDocument=json.dumps(trust_policy),
        Description=f"Execution role for Loom agent: {agent_name}",
        MaxSessionDuration=3600
    )

    client.put_role_policy(
        RoleName=role_name,
        PolicyName='loom-agent-base-policy',
        PolicyDocument=json.dumps(base_policy)
    )

    return response['Role']['Arn']


def build_trust_policy() -> dict:
    """
    Build the trust policy document for an AgentCore Runtime execution role.

    Returns:
        IAM trust policy allowing bedrock-agentcore.amazonaws.com as service principal
    """
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Service": "bedrock-agentcore.amazonaws.com"
                },
                "Action": "sts:AssumeRole"
            }
        ]
    }


def build_base_policy(region: str, account_id: str, agent_name: str) -> dict:
    """
    Build the base IAM policy for workload access token permissions.

    Args:
        region: AWS region name
        account_id: AWS account ID
        agent_name: Name of the agent (used for resource scoping)

    Returns:
        IAM policy document with bedrock-agentcore workload identity permissions
    """
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "bedrock-agentcore:GetWorkloadAccessToken",
                    "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
                    "bedrock-agentcore:GetWorkloadAccessTokenForUserId"
                ],
                "Resource": [
                    f"arn:aws:bedrock-agentcore:{region}:{account_id}:workload-identity-directory/default",
                    f"arn:aws:bedrock-agentcore:{region}:{account_id}:workload-identity-directory/default/workload-identity/{agent_name}-*"
                ]
            }
        ]
    }


def build_integration_policy_statements(integrations: list[dict]) -> list[dict]:
    """
    Generate IAM policy statements for each enabled integration.

    Supports integration types: s3, bedrock, lambda, dynamodb, sqs, sns.

    Args:
        integrations: List of integration dicts, each with:
            - integration_type: Type of integration (e.g., 's3', 'bedrock')
            - integration_config: JSON string with integration-specific config

    Returns:
        List of IAM policy statement dicts
    """
    statements: list[dict] = []

    for integration in integrations:
        integration_type = integration.get('integration_type', '')
        config_str = integration.get('integration_config', '{}')

        try:
            config = json.loads(config_str) if isinstance(config_str, str) else config_str
        except json.JSONDecodeError:
            continue

        if integration_type == 's3':
            bucket = config.get('bucket', '*')
            prefix = config.get('prefix', '*')
            statements.append({
                "Effect": "Allow",
                "Action": [
                    "s3:GetObject",
                    "s3:PutObject",
                    "s3:ListBucket"
                ],
                "Resource": [
                    f"arn:aws:s3:::{bucket}",
                    f"arn:aws:s3:::{bucket}/{prefix}"
                ]
            })

        elif integration_type == 'bedrock':
            region = config.get('region', '*')
            model_id = config.get('model_id', '*')
            statements.append({
                "Effect": "Allow",
                "Action": [
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream"
                ],
                "Resource": f"arn:aws:bedrock:{region}::foundation-model/{model_id}"
            })

        elif integration_type == 'lambda':
            function_arn = config.get('function_arn', '*')
            statements.append({
                "Effect": "Allow",
                "Action": "lambda:InvokeFunction",
                "Resource": function_arn
            })

        elif integration_type == 'dynamodb':
            table_arn = config.get('table_arn', '*')
            statements.append({
                "Effect": "Allow",
                "Action": [
                    "dynamodb:GetItem",
                    "dynamodb:PutItem",
                    "dynamodb:Query",
                    "dynamodb:UpdateItem",
                    "dynamodb:DeleteItem"
                ],
                "Resource": [
                    table_arn,
                    f"{table_arn}/index/*"
                ]
            })

        elif integration_type == 'sqs':
            queue_arn = config.get('queue_arn', '*')
            statements.append({
                "Effect": "Allow",
                "Action": [
                    "sqs:SendMessage",
                    "sqs:ReceiveMessage",
                    "sqs:DeleteMessage"
                ],
                "Resource": queue_arn
            })

        elif integration_type == 'sns':
            topic_arn = config.get('topic_arn', '*')
            statements.append({
                "Effect": "Allow",
                "Action": "sns:Publish",
                "Resource": topic_arn
            })

    return statements


def update_role_policy(
    role_name: str,
    integrations: list[dict],
    region: str,
    account_id: str,
    agent_name: str
) -> None:
    """
    Update the inline policy on an execution role.

    Rebuilds the full policy from the base policy plus any integration-specific
    statements.

    Args:
        role_name: IAM role name to update
        integrations: List of integration dicts for policy generation
        region: AWS region name
        account_id: AWS account ID
        agent_name: Name of the agent (used for resource scoping)
    """
    import boto3

    client = boto3.client('iam')

    base_policy = build_base_policy(region, account_id, agent_name)
    integration_statements = build_integration_policy_statements(integrations)

    if integration_statements:
        base_policy['Statement'].extend(integration_statements)

    client.put_role_policy(
        RoleName=role_name,
        PolicyName='loom-agent-base-policy',
        PolicyDocument=json.dumps(base_policy)
    )


def delete_execution_role(role_name: str) -> None:
    """
    Delete an IAM role and its inline policies.

    Removes all inline policies before deleting the role itself.

    Args:
        role_name: IAM role name to delete
    """
    import boto3

    client = boto3.client('iam')

    # Remove all inline policies before deleting the role
    policies_response = client.list_role_policies(RoleName=role_name)
    for policy_name in policies_response.get('PolicyNames', []):
        client.delete_role_policy(RoleName=role_name, PolicyName=policy_name)

    client.delete_role(RoleName=role_name)
