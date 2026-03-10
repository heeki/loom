"""AgentCore Memory integration using Strands hooks."""

import logging
import os
from typing import Any

import boto3
from strands.hooks.registry import HookRegistry
from strands.hooks.events import BeforeInvocationEvent, AfterInvocationEvent

logger = logging.getLogger(__name__)


class MemoryHook:
    """Strands HookProvider that loads/saves conversation context via AgentCore Memory.

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

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        """Register callbacks for invocation lifecycle events."""
        registry.add_callback(BeforeInvocationEvent, self._on_before_invocation)
        registry.add_callback(AfterInvocationEvent, self._on_after_invocation)

    def _on_before_invocation(self, event: BeforeInvocationEvent) -> None:
        """Load conversation history from AgentCore Memory before invocation."""
        if not self.memory_store_id:
            return

        try:
            query = ""
            if event.messages:
                for msg in reversed(event.messages):
                    content = msg.get("content", [])
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict) and "text" in block:
                                query = block["text"]
                                break
                    if query:
                        break

            response = self.client.retrieve_memory(
                memoryStoreId=self.memory_store_id,
                query=query,
            )
            memories = response.get("memories", [])
            if memories:
                event.invocation_state["memory"] = memories
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

    def _on_after_invocation(self, event: AfterInvocationEvent) -> None:
        """Save updated conversation context to AgentCore Memory after invocation."""
        if not self.memory_store_id:
            return

        try:
            result = event.result
            if not result:
                logger.debug("No result to save to memory store")
                return

            messages = getattr(result, "messages", None) or []
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
