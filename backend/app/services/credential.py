"""
Credential provider management via AgentCore APIs.

This module provides functions to create and delete OAuth2 credential providers
through the AgentCore control plane for agent integrations.
"""

from typing import Any


def create_oauth2_credential_provider(
    name: str,
    client_id: str,
    client_secret: str,
    auth_server_url: str,
    scopes: list[str],
    region: str
) -> dict[str, Any]:
    """
    Create an OAuth2 credential provider via the AgentCore control plane.

    Args:
        name: Name for the credential provider
        client_id: OAuth2 client ID
        client_secret: OAuth2 client secret
        auth_server_url: OAuth2 authorization server URL
        scopes: List of OAuth2 scopes to request
        region: AWS region name

    Returns:
        Dictionary with provider details from the API response,
        including callback_url for OAuth2 flow completion
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)

    response = client.create_oauth2_credential_provider(
        name=name,
        credentialProviderVendor='CustomOAuth2',
        oauth2ProviderConfigInput={
            'customOAuth2ProviderConfig': {
                'authorizationServerUrl': auth_server_url,
                'clientId': client_id,
                'clientSecret': client_secret,
                'oauthDiscovery': {
                    'authorizationServerUrl': auth_server_url
                }
            }
        },
        scopes=scopes
    )
    return response


def delete_credential_provider(provider_name: str, region: str) -> None:
    """
    Delete a credential provider.

    Args:
        provider_name: Name of the credential provider to delete
        region: AWS region name
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)
    client.delete_credential_provider(name=provider_name)
