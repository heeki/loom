"""Tests for deployment service functions."""
import unittest
from unittest.mock import MagicMock, patch

from app.services.deployment import (
    deploy_agent,
    redeploy_agent,
    delete_runtime,
    get_runtime_status,
    validate_config_values,
    store_secret,
    update_secret,
    delete_secret,
    store_large_config,
)


class TestDeployAgent(unittest.TestCase):
    """Test cases for deploy_agent function."""

    @patch("boto3.client")
    def test_deploy_agent(self, mock_boto_client: MagicMock) -> None:
        """Test deploying a new agent runtime."""
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client
        mock_client.create_agent_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-123",
            "agentRuntimeId": "rt-123",
            "status": "CREATING",
        }

        result = deploy_agent(
            name="test-agent",
            code_uri="s3://bucket/code.zip",
            execution_role_arn="arn:aws:iam::123456789012:role/test-role",
            env_vars={"KEY": "value"},
            region="us-east-1",
        )

        mock_boto_client.assert_called_once_with("bedrock-agentcore-control", region_name="us-east-1")
        mock_client.create_agent_runtime.assert_called_once_with(
            agentRuntimeName="test-agent",
            agentRuntimeArtifact={"s3": {"s3BucketUri": "s3://bucket/code.zip"}},
            roleArn="arn:aws:iam::123456789012:role/test-role",
            environmentVariables={"KEY": "value"},
        )
        self.assertEqual(result["agentRuntimeId"], "rt-123")


class TestRedeployAgent(unittest.TestCase):
    """Test cases for redeploy_agent function."""

    @patch("boto3.client")
    def test_redeploy_agent(self, mock_boto_client: MagicMock) -> None:
        """Test redeploying an existing agent runtime."""
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client
        mock_client.update_agent_runtime.return_value = {
            "agentRuntimeId": "rt-123",
            "status": "UPDATING",
        }

        result = redeploy_agent(
            runtime_id="rt-123",
            code_uri="s3://bucket/code-v2.zip",
            env_vars={"KEY": "new_value"},
            region="us-east-1",
        )

        mock_client.update_agent_runtime.assert_called_once_with(
            agentRuntimeId="rt-123",
            agentRuntimeArtifact={"s3": {"s3BucketUri": "s3://bucket/code-v2.zip"}},
            environmentVariables={"KEY": "new_value"},
        )
        self.assertEqual(result["status"], "UPDATING")

    @patch("boto3.client")
    def test_redeploy_agent_no_env_vars(self, mock_boto_client: MagicMock) -> None:
        """Test redeploying without updating env vars."""
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client
        mock_client.update_agent_runtime.return_value = {"status": "UPDATING"}

        redeploy_agent(
            runtime_id="rt-123",
            code_uri="s3://bucket/code.zip",
            env_vars=None,
            region="us-east-1",
        )

        mock_client.update_agent_runtime.assert_called_once_with(
            agentRuntimeId="rt-123",
            agentRuntimeArtifact={"s3": {"s3BucketUri": "s3://bucket/code.zip"}},
        )


class TestDeleteRuntime(unittest.TestCase):
    """Test cases for delete_runtime function."""

    @patch("boto3.client")
    def test_delete_runtime(self, mock_boto_client: MagicMock) -> None:
        """Test deleting an agent runtime."""
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client

        delete_runtime("rt-123", "us-east-1")

        mock_boto_client.assert_called_once_with("bedrock-agentcore-control", region_name="us-east-1")
        mock_client.delete_agent_runtime.assert_called_once_with(agentRuntimeId="rt-123")


class TestGetRuntimeStatus(unittest.TestCase):
    """Test cases for get_runtime_status function."""

    @patch("boto3.client")
    def test_get_runtime_status(self, mock_boto_client: MagicMock) -> None:
        """Test getting runtime status."""
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client
        mock_client.get_agent_runtime.return_value = {"status": "ACTIVE"}

        result = get_runtime_status("rt-123", "us-east-1")

        mock_client.get_agent_runtime.assert_called_once_with(agentRuntimeId="rt-123")
        self.assertEqual(result, "ACTIVE")

    @patch("boto3.client")
    def test_get_runtime_status_unknown(self, mock_boto_client: MagicMock) -> None:
        """Test getting runtime status when status key is missing."""
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client
        mock_client.get_agent_runtime.return_value = {}

        result = get_runtime_status("rt-123", "us-east-1")

        self.assertEqual(result, "UNKNOWN")


class TestValidateConfigValues(unittest.TestCase):
    """Test cases for validate_config_values function."""

    def test_validate_config_values_clean(self) -> None:
        """Test that normal config values produce no warnings."""
        config = {
            "APP_NAME": "my-agent",
            "LOG_LEVEL": "DEBUG",
            "REGION": "us-east-1",
        }
        warnings = validate_config_values(config)
        self.assertEqual(warnings, [])

    def test_validate_config_values_secret_patterns(self) -> None:
        """Test detection of secret-like patterns in values."""
        config = {
            "OPENAI_KEY": "sk-abcdefghijklmnopqrstuvwx",
            "AWS_KEY": "AKIAIOSFODNN7EXAMPLE",
        }
        warnings = validate_config_values(config)
        self.assertTrue(len(warnings) >= 2)
        self.assertTrue(any("sk-" in w or "secret pattern" in w for w in warnings))
        self.assertTrue(any("AKIA" in w or "secret pattern" in w for w in warnings))

    def test_validate_config_values_secret_keyword_in_key(self) -> None:
        """Test detection of secret keywords in key names."""
        config = {
            "db_password": "some-value",
            "api_key": "some-value",
        }
        warnings = validate_config_values(config)
        self.assertTrue(len(warnings) >= 2)
        self.assertTrue(any("password" in w.lower() for w in warnings))

    def test_validate_config_values_github_token(self) -> None:
        """Test detection of GitHub personal access token pattern."""
        config = {
            "GH_TOKEN": "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        }
        warnings = validate_config_values(config)
        self.assertTrue(len(warnings) >= 1)


class TestStoreSecret(unittest.TestCase):
    """Test cases for store_secret function."""

    @patch("boto3.client")
    def test_store_secret(self, mock_boto_client: MagicMock) -> None:
        """Test storing a secret in Secrets Manager."""
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client
        mock_client.create_secret.return_value = {
            "ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-abc123",
        }

        result = store_secret("my-secret", "secret-value", "us-east-1")

        mock_boto_client.assert_called_once_with("secretsmanager", region_name="us-east-1")
        mock_client.create_secret.assert_called_once_with(
            Name="my-secret",
            SecretString="secret-value",
        )
        self.assertEqual(result, "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-abc123")


class TestUpdateSecret(unittest.TestCase):
    """Test cases for update_secret function."""

    @patch("boto3.client")
    def test_update_secret(self, mock_boto_client: MagicMock) -> None:
        """Test updating an existing secret."""
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client

        secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret"
        update_secret(secret_arn, "new-value", "us-east-1")

        mock_client.put_secret_value.assert_called_once_with(
            SecretId=secret_arn,
            SecretString="new-value",
        )


class TestDeleteSecret(unittest.TestCase):
    """Test cases for delete_secret function."""

    @patch("boto3.client")
    def test_delete_secret(self, mock_boto_client: MagicMock) -> None:
        """Test deleting a secret from Secrets Manager."""
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client

        secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret"
        delete_secret(secret_arn, "us-east-1")

        mock_client.delete_secret.assert_called_once_with(
            SecretId=secret_arn,
            ForceDeleteWithoutRecovery=True,
        )


class TestStoreLargeConfig(unittest.TestCase):
    """Test cases for store_large_config function."""

    @patch("boto3.client")
    def test_store_large_config(self, mock_boto_client: MagicMock) -> None:
        """Test storing large config in S3."""
        mock_client = MagicMock()
        mock_boto_client.return_value = mock_client

        result = store_large_config(
            agent_name="my-agent",
            key="large-config",
            value="a" * 10000,
            bucket="my-bucket",
            region="us-east-1",
        )

        mock_boto_client.assert_called_once_with("s3", region_name="us-east-1")
        mock_client.put_object.assert_called_once_with(
            Bucket="my-bucket",
            Key="my-agent/config/large-config",
            Body=("a" * 10000).encode("utf-8"),
            ContentType="text/plain",
        )
        self.assertEqual(result, "s3://my-bucket/my-agent/config/large-config")


if __name__ == "__main__":
    unittest.main()
