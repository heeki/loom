"""Tests for the handler entry point."""

import asyncio
import unittest
from unittest.mock import patch, MagicMock, AsyncMock

from src.handler import invoke, _get_agent


class TestInvokeHandler(unittest.TestCase):
    """Tests for the async invoke entrypoint."""

    def _run_async(self, coro):
        """Helper to run an async generator and collect results."""
        return asyncio.get_event_loop().run_until_complete(coro)

    async def _collect_events(self, payload: dict) -> list:
        """Collect all events from the async generator."""
        events = []
        async for event in invoke(payload):
            events.append(event)
        return events

    @patch("src.handler._get_agent")
    def test_invoke_streams_events(self, mock_get_agent: MagicMock) -> None:
        mock_agent = MagicMock()

        async def mock_stream(prompt):
            for chunk in ["Hello ", "world"]:
                yield chunk

        mock_agent.stream_async = mock_stream
        mock_get_agent.return_value = mock_agent

        payload = {"prompt": "Hi", "session_id": "test-session"}
        events = self._run_async(self._collect_events(payload))

        self.assertEqual(events, ["Hello ", "world"])

    @patch("src.handler._get_agent")
    def test_invoke_empty_prompt(self, mock_get_agent: MagicMock) -> None:
        mock_agent = MagicMock()

        async def mock_stream(prompt):
            return
            yield  # make it an async generator

        mock_agent.stream_async = mock_stream
        mock_get_agent.return_value = mock_agent

        payload = {"prompt": ""}
        events = self._run_async(self._collect_events(payload))

        self.assertEqual(events, [])

    @patch("src.handler._get_agent")
    def test_invoke_uses_prompt_from_payload(self, mock_get_agent: MagicMock) -> None:
        mock_agent = MagicMock()
        captured_prompt = None

        async def mock_stream(prompt):
            nonlocal captured_prompt
            captured_prompt = prompt
            yield "ok"

        mock_agent.stream_async = mock_stream
        mock_get_agent.return_value = mock_agent

        payload = {"prompt": "What is 2+2?"}
        self._run_async(self._collect_events(payload))

        self.assertEqual(captured_prompt, "What is 2+2?")


class TestGetAgent(unittest.TestCase):
    """Tests for agent singleton initialization."""

    @patch("src.handler._agent", None)
    @patch("src.handler.build_agent")
    @patch("src.handler.load_config")
    def test_get_agent_initializes_once(
        self, mock_load_config: MagicMock, mock_build_agent: MagicMock
    ) -> None:
        mock_config = MagicMock()
        mock_load_config.return_value = mock_config
        mock_agent = MagicMock()
        mock_build_agent.return_value = mock_agent

        result = _get_agent()

        mock_load_config.assert_called_once()
        mock_build_agent.assert_called_once_with(mock_config)
        self.assertEqual(result, mock_agent)


if __name__ == "__main__":
    unittest.main()
