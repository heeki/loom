"""Tests for the handler entry point."""

import json
import unittest
from unittest.mock import patch, MagicMock

from src.handler import handler, handle_invocation


class TestHandler(unittest.TestCase):
    """Tests for the AgentCore Runtime handler."""

    @patch("src.handler._get_agent")
    def test_handler_success(self, mock_get_agent: MagicMock) -> None:
        mock_agent = MagicMock()
        mock_chunk1 = MagicMock()
        mock_chunk1.text = "Hello "
        mock_chunk2 = MagicMock()
        mock_chunk2.text = "world"
        mock_agent.return_value = [mock_chunk1, mock_chunk2]
        mock_get_agent.return_value = mock_agent

        event = {"prompt": "Hi", "session_id": "test-session"}
        result = handler(event)

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(result["body"], "Hello world")

    @patch("src.handler._get_agent")
    def test_handler_error(self, mock_get_agent: MagicMock) -> None:
        mock_get_agent.side_effect = RuntimeError("Agent init failed")

        event = {"prompt": "Hi"}
        result = handler(event)

        self.assertEqual(result["statusCode"], 500)
        body = json.loads(result["body"])
        self.assertIn("Agent init failed", body["error"])

    @patch("src.handler._get_agent")
    def test_handle_invocation_streaming(self, mock_get_agent: MagicMock) -> None:
        mock_agent = MagicMock()
        mock_chunk = MagicMock()
        mock_chunk.text = "response"
        mock_agent.return_value = [mock_chunk]
        mock_get_agent.return_value = mock_agent

        event = {"prompt": "test", "session_id": "s1"}
        chunks = list(handle_invocation(event))

        self.assertEqual(chunks, ["response"])

    @patch("src.handler._get_agent")
    def test_handle_invocation_string_chunks(self, mock_get_agent: MagicMock) -> None:
        mock_agent = MagicMock()
        mock_agent.return_value = ["hello", " ", "there"]
        mock_get_agent.return_value = mock_agent

        event = {"prompt": "test"}
        chunks = list(handle_invocation(event))

        self.assertEqual(chunks, ["hello", " ", "there"])

    @patch("src.handler._get_agent")
    def test_handler_empty_prompt(self, mock_get_agent: MagicMock) -> None:
        mock_agent = MagicMock()
        mock_agent.return_value = []
        mock_get_agent.return_value = mock_agent

        event = {"prompt": ""}
        result = handler(event)

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(result["body"], "")


if __name__ == "__main__":
    unittest.main()
