"""
Credential provider management via AgentCore APIs.

This module provides functions to create and delete OAuth2 credential providers
through the AgentCore control plane for agent integrations.
"""

import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

_MAX_RETRIES = 4
_BASE_DELAY = 2.0  # seconds


def create_oauth2_credential_provider(
    name: str,
    client_id: str,
    client_secret: str,
    auth_server_url: str,
    region: str,
    tags: dict[str, str] | None = None,
) -> dict[str, Any]:
    """
    Create an OAuth2 credential provider via the AgentCore control plane.

    Retries with exponential backoff on transient failures (e.g.
    ConflictException from Secrets Manager).

    Args:
        name: Name for the credential provider
        client_id: OAuth2 client ID
        client_secret: OAuth2 client secret
        auth_server_url: OAuth2 authorization server URL
        region: AWS region name
        tags: Optional dict of tags to apply to the credential provider

    Returns:
        Dictionary with provider details from the API response,
        including callback_url for OAuth2 flow completion

    Raises:
        Exception: If creation fails after all retries.
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)

    kwargs: dict[str, Any] = {
        'name': name,
        'credentialProviderVendor': 'CustomOauth2',
        'oauth2ProviderConfigInput': {
            'customOauth2ProviderConfig': {
                'clientId': client_id,
                'clientSecret': client_secret,
                'oauthDiscovery': {
                    'discoveryUrl': auth_server_url,
                },
            }
        },
    }
    if tags:
        kwargs['tags'] = tags

    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            response = client.create_oauth2_credential_provider(**kwargs)
            return response
        except client.exceptions.ValidationException as e:
            if "already exists" in str(e):
                logger.info(
                    "Credential provider '%s' already exists, updating instead",
                    name,
                )
                update_kwargs = {k: v for k, v in kwargs.items() if k != 'tags'}
                response = client.update_oauth2_credential_provider(**update_kwargs)
                return response
            raise
        except Exception as e:
            last_exc = e
            if attempt < _MAX_RETRIES:
                delay = _BASE_DELAY * (2 ** attempt)
                logger.warning(
                    "Credential provider '%s' creation failed (attempt %d/%d), "
                    "retrying in %.1fs: %s",
                    name, attempt + 1, _MAX_RETRIES + 1, delay, e,
                )
                time.sleep(delay)
            else:
                logger.error(
                    "Credential provider '%s' creation failed after %d attempts: %s",
                    name, _MAX_RETRIES + 1, e,
                )

    raise last_exc  # type: ignore[misc]


def delete_credential_provider(provider_name: str, region: str) -> None:
    """
    Delete a credential provider.

    Args:
        provider_name: Name of the credential provider to delete
        region: AWS region name
    """
    import boto3

    client = boto3.client('bedrock-agentcore-control', region_name=region)
    client.delete_oauth2_credential_provider(name=provider_name)
