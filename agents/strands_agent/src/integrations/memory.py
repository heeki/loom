"""AgentCore Memory integration using Strands hooks."""

import logging
import os
from typing import Any

import boto3

logger = logging.getLogger(__name__)


class MemoryHook:
    """Strands hook that loads/saves conversation context via AgentCore Memory.

    The hook reads the memory store ID from the ``MEMORY_STORE_ID``
    environment variable. If the variable is unset or empty the hook
    operates as a no-op so callers can safely attach it regardless of
    whether memory is enabled.
    """

    def __init__(self) -> None:
        store_id = os.environ.get("MEMORY_STORE_ID", "")
        self.memory_store_id: str | None = store_id if store_id else None
        self._client: Any = None

        if not self.memory_store_id:
            logger.info("MEMORY_STORE_ID not set; MemoryHook is disabled")

    @property
    def client(self) -> Any:
        """Lazy-initialise the bedrock-agentcore client."""
        if self._client is None and self.memory_store_id:
            self._client = boto3.client("bedrock-agentcore")
        return self._client

    def pre_invoke(self, context: dict[str, Any]) -> None:
        """Load conversation history from AgentCore Memory before invocation.

        Args:
            context: Strands invocation context dict.
        """
        if not self.memory_store_id:
            return

        try:
            response = self.client.retrieve_memory(
                memoryStoreId=self.memory_store_id,
                query=context.get("input", ""),
            )
            memories = response.get("memories", [])
            if memories:
                context["memory"] = memories
                logger.debug(
                    "Loaded %d memory item(s) from store '%s'",
                    len(memories),
                    self.memory_store_id,
                )
        except Exception:
            logger.exception(
                "Failed to retrieve memory from store '%s'",
                self.memory_store_id,
            )

    def post_invoke(self, context: dict[str, Any]) -> None:
        """Save updated conversation context to AgentCore Memory after invocation.

        Args:
            context: Strands invocation context dict.
        """
        if not self.memory_store_id:
            return

        try:
            messages = context.get("messages", [])
            if not messages:
                logger.debug("No messages to save to memory store")
                return

            self.client.save_memory(
                memoryStoreId=self.memory_store_id,
                messages=messages,
            )
            logger.debug(
                "Saved %d message(s) to memory store '%s'",
                len(messages),
                self.memory_store_id,
            )
        except Exception:
            logger.exception(
                "Failed to save memory to store '%s'",
                self.memory_store_id,
            )
