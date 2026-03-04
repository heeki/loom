"""Tests for AgentCore Memory hooks."""

import os
import unittest
from unittest.mock import patch, MagicMock

from src.integrations.memory import MemoryHook


class TestMemoryHook(unittest.TestCase):
    """Tests for MemoryHook pre/post invoke."""

    @patch.dict(os.environ, {"MEMORY_STORE_ID": "ms-test123", "AWS_REGION": "us-east-1"})
    @patch("src.integrations.memory.boto3")
    def test_init_with_memory_store_id(self, mock_boto3: MagicMock) -> None:
        hook = MemoryHook()
        self.assertEqual(hook.memory_store_id, "ms-test123")

    @patch.dict(os.environ, {}, clear=False)
    def test_init_without_memory_store_id(self) -> None:
        os.environ.pop("MEMORY_STORE_ID", None)
        hook = MemoryHook()
        self.assertIsNone(hook.memory_store_id)
        self.assertIsNone(hook.client)

    @patch.dict(os.environ, {"MEMORY_STORE_ID": "ms-test123", "AWS_REGION": "us-east-1"})
    @patch("src.integrations.memory.boto3")
    def test_pre_invoke_loads_context(self, mock_boto3: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.retrieve_memory.return_value = {
            "memories": [{"content": "previous context"}]
        }
        mock_boto3.client.return_value = mock_client

        hook = MemoryHook()
        context: dict = {"input": "hello"}
        hook.pre_invoke(context)

        mock_client.retrieve_memory.assert_called_once_with(
            memoryStoreId="ms-test123",
            query="hello",
        )
        self.assertEqual(context["memory"], [{"content": "previous context"}])

    @patch.dict(os.environ, {"MEMORY_STORE_ID": "ms-test123", "AWS_REGION": "us-east-1"})
    @patch("src.integrations.memory.boto3")
    def test_post_invoke_saves_context(self, mock_boto3: MagicMock) -> None:
        mock_client = MagicMock()
        mock_boto3.client.return_value = mock_client

        hook = MemoryHook()
        context: dict = {"messages": [{"role": "user", "content": "hello"}]}
        hook.post_invoke(context)

        mock_client.save_memory.assert_called_once_with(
            memoryStoreId="ms-test123",
            messages=[{"role": "user", "content": "hello"}],
        )

    def test_pre_invoke_noop_without_store_id(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("MEMORY_STORE_ID", None)
            hook = MemoryHook()
            context: dict = {"input": "test"}
            hook.pre_invoke(context)
            self.assertNotIn("memory", context)

    def test_post_invoke_noop_without_store_id(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("MEMORY_STORE_ID", None)
            hook = MemoryHook()
            context: dict = {"messages": [{"role": "user", "content": "test"}]}
            hook.post_invoke(context)

    @patch.dict(os.environ, {"MEMORY_STORE_ID": "ms-test123", "AWS_REGION": "us-east-1"})
    @patch("src.integrations.memory.boto3")
    def test_post_invoke_skips_empty_messages(self, mock_boto3: MagicMock) -> None:
        mock_client = MagicMock()
        mock_boto3.client.return_value = mock_client

        hook = MemoryHook()
        context: dict = {"messages": []}
        hook.post_invoke(context)

        mock_client.save_memory.assert_not_called()

    @patch.dict(os.environ, {"MEMORY_STORE_ID": "ms-test123", "AWS_REGION": "us-east-1"})
    @patch("src.integrations.memory.boto3")
    def test_pre_invoke_handles_error_gracefully(self, mock_boto3: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.retrieve_memory.side_effect = Exception("API error")
        mock_boto3.client.return_value = mock_client

        hook = MemoryHook()
        context: dict = {"input": "test"}
        # Should not raise
        hook.pre_invoke(context)


if __name__ == "__main__":
    unittest.main()
