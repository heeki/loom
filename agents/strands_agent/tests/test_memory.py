"""Tests for AgentCore Memory hooks."""

import os
import unittest
from unittest.mock import patch, MagicMock

from src.integrations.memory import MemoryHook


class TestMemoryHook(unittest.TestCase):
    """Tests for MemoryHook HookProvider."""

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

    def test_register_hooks_registers_callbacks(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("MEMORY_STORE_ID", None)
            hook = MemoryHook()
            registry = MagicMock()
            hook.register_hooks(registry)
            self.assertEqual(registry.add_callback.call_count, 2)

    @patch.dict(os.environ, {"MEMORY_STORE_ID": "ms-test123", "AWS_REGION": "us-east-1"})
    @patch("src.integrations.memory.boto3")
    def test_before_invocation_loads_context(self, mock_boto3: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.retrieve_memory.return_value = {
            "memories": [{"content": "previous context"}]
        }
        mock_boto3.client.return_value = mock_client

        hook = MemoryHook()
        event = MagicMock()
        event.messages = [{"content": [{"text": "hello"}]}]
        event.invocation_state = {}
        hook._on_before_invocation(event)

        mock_client.retrieve_memory.assert_called_once_with(
            memoryStoreId="ms-test123",
            query="hello",
        )
        self.assertEqual(event.invocation_state["memory"], [{"content": "previous context"}])

    @patch.dict(os.environ, {"MEMORY_STORE_ID": "ms-test123", "AWS_REGION": "us-east-1"})
    @patch("src.integrations.memory.boto3")
    def test_after_invocation_saves_context(self, mock_boto3: MagicMock) -> None:
        mock_client = MagicMock()
        mock_boto3.client.return_value = mock_client

        hook = MemoryHook()
        event = MagicMock()
        event.result.messages = [{"role": "user", "content": "hello"}]
        hook._on_after_invocation(event)

        mock_client.save_memory.assert_called_once_with(
            memoryStoreId="ms-test123",
            messages=[{"role": "user", "content": "hello"}],
        )

    def test_before_invocation_noop_without_store_id(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("MEMORY_STORE_ID", None)
            hook = MemoryHook()
            event = MagicMock()
            event.invocation_state = {}
            hook._on_before_invocation(event)
            self.assertNotIn("memory", event.invocation_state)

    def test_after_invocation_noop_without_store_id(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("MEMORY_STORE_ID", None)
            hook = MemoryHook()
            event = MagicMock()
            hook._on_after_invocation(event)

    @patch.dict(os.environ, {"MEMORY_STORE_ID": "ms-test123", "AWS_REGION": "us-east-1"})
    @patch("src.integrations.memory.boto3")
    def test_after_invocation_skips_empty_messages(self, mock_boto3: MagicMock) -> None:
        mock_client = MagicMock()
        mock_boto3.client.return_value = mock_client

        hook = MemoryHook()
        event = MagicMock()
        event.result.messages = []
        hook._on_after_invocation(event)

        mock_client.save_memory.assert_not_called()

    @patch.dict(os.environ, {"MEMORY_STORE_ID": "ms-test123", "AWS_REGION": "us-east-1"})
    @patch("src.integrations.memory.boto3")
    def test_before_invocation_handles_error_gracefully(self, mock_boto3: MagicMock) -> None:
        mock_client = MagicMock()
        mock_client.retrieve_memory.side_effect = Exception("API error")
        mock_boto3.client.return_value = mock_client

        hook = MemoryHook()
        event = MagicMock()
        event.messages = [{"content": [{"text": "test"}]}]
        event.invocation_state = {}
        # Should not raise
        hook._on_before_invocation(event)


if __name__ == "__main__":
    unittest.main()
