"""Tests for A2A client scaffold."""

import unittest
from unittest.mock import patch

from src.config import A2AAgentConfig, AuthConfig
from src.integrations.a2a_client import create_a2a_clients


class TestCreateA2AClients(unittest.TestCase):
    """Tests for A2A agent client vending (scaffold)."""

    def test_empty_agents_list(self) -> None:
        clients = create_a2a_clients([])
        self.assertEqual(clients, [])

    def test_disabled_agents_skipped(self) -> None:
        agents = [
            A2AAgentConfig(name="disabled", enabled=False, endpoint_url="https://example.com"),
        ]
        clients = create_a2a_clients(agents)
        self.assertEqual(clients, [])

    def test_enabled_agent_returns_empty_with_warning(self) -> None:
        agents = [
            A2AAgentConfig(
                name="summarizer",
                enabled=True,
                endpoint_url="https://a2a.example.com/summarizer",
                auth=AuthConfig(
                    type="oauth2",
                    well_known_endpoint="https://auth.example.com/.well-known/openid-configuration",
                    credentials_secret_arn="arn:aws:secretsmanager:us-east-1:123:secret:test",
                ),
            )
        ]
        with patch("src.integrations.a2a_client.logger") as mock_logger:
            clients = create_a2a_clients(agents)
            mock_logger.warning.assert_called()
        self.assertEqual(clients, [])


if __name__ == "__main__":
    unittest.main()
