"""AWS Agent Registry service for managing registry records."""
import json
import logging
import os
import time
from typing import Any

import boto3

from app.models.a2a import A2aAgent
from app.models.mcp import McpServer, McpTool

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Singleton client
# ---------------------------------------------------------------------------
_client: "RegistryClient | None" = None


def get_registry_client() -> "RegistryClient":
    """Return (or lazily create) the module-level RegistryClient singleton."""
    global _client
    if _client is None:
        registry_id = os.getenv("LOOM_REGISTRY_ID", "")
        region = os.getenv("AWS_REGION", "us-east-1")
        _client = RegistryClient(registry_id=registry_id, region=region)
    return _client


# ---------------------------------------------------------------------------
# RegistryClient
# ---------------------------------------------------------------------------
class RegistryClient:
    """Thin wrapper around the Bedrock AgentCore registry APIs."""

    def __init__(self, registry_id: str, region: str) -> None:
        self.registry_id = registry_id
        self.region = region

        if self.registry_id:
            session = boto3.Session(region_name=region)
            self.control = session.client("bedrock-agentcore-control")
            self.data = session.client("bedrock-agentcore")
        else:
            self.control = None
            self.data = None
            logger.warning("LOOM_REGISTRY_ID not set; registry operations will return empty results")

    # -- guard ---------------------------------------------------------------
    def _require_registry(self) -> bool:
        """Return True when the registry is configured, False otherwise."""
        if not self.registry_id or self.control is None:
            logger.debug("Registry not configured; skipping operation")
            return False
        return True

    # -- control-plane -------------------------------------------------------
    def list_registries(self) -> dict[str, Any]:
        if not self._require_registry():
            return {"registries": []}
        return self.control.list_registries()

    def create_record(
        self,
        name: str,
        descriptor_type: str,
        descriptors: list[dict[str, Any]],
        record_version: str,
        description: str | None = None,
    ) -> dict[str, Any]:
        if not self._require_registry():
            return {}
        kwargs: dict[str, Any] = dict(
            registryId=self.registry_id,
            name=name,
            descriptorType=descriptor_type,
            descriptors=descriptors,
            recordVersion=record_version,
        )
        if description:
            kwargs["description"] = description
        return self.control.create_registry_record(**kwargs)

    def get_record(self, record_id: str) -> dict[str, Any]:
        if not self._require_registry():
            return {}
        return self.control.get_registry_record(
            registryId=self.registry_id,
            recordId=record_id,
        )

    def wait_for_record(self, record_id: str, poll_interval: int = 5) -> dict[str, Any]:
        """Poll until the record leaves the CREATING state."""
        if not self._require_registry():
            return {}
        while True:
            rec = self.get_record(record_id)
            status = rec.get("status", "")
            if status != "CREATING":
                logger.info("Record %s reached status %s", record_id, status)
                return rec
            logger.debug("Record %s still CREATING; polling in %ds", record_id, poll_interval)
            time.sleep(poll_interval)

    def list_records(self) -> dict[str, Any]:
        if not self._require_registry():
            return {"registryRecords": []}
        return self.control.list_registry_records(registryId=self.registry_id)

    def submit_for_approval(self, record_id: str) -> dict[str, Any]:
        if not self._require_registry():
            return {}
        return self.control.submit_registry_record_for_approval(
            registryId=self.registry_id,
            recordId=record_id,
        )

    def approve_record(self, record_id: str) -> dict[str, Any]:
        if not self._require_registry():
            return {}
        return self.control.update_registry_record_status(
            registryId=self.registry_id,
            recordId=record_id,
            status="APPROVED",
            statusReason="Approved via Loom",
        )

    def reject_record(self, record_id: str, reason: str) -> dict[str, Any]:
        if not self._require_registry():
            return {}
        return self.control.update_registry_record_status(
            registryId=self.registry_id,
            recordId=record_id,
            status="REJECTED",
            statusReason=reason,
        )

    def update_record_status(self, record_id: str, status: str, reason: str) -> dict[str, Any]:
        if not self._require_registry():
            return {}
        return self.control.update_registry_record_status(
            registryId=self.registry_id,
            recordId=record_id,
            status=status,
            statusReason=reason,
        )

    def delete_record(self, record_id: str) -> dict[str, Any]:
        if not self._require_registry():
            return {}
        return self.control.delete_registry_record(
            registryId=self.registry_id,
            recordId=record_id,
        )

    # -- data-plane ----------------------------------------------------------
    def search_records(self, query: str, max_results: int = 10) -> dict[str, Any]:
        if not self._require_registry():
            return {"results": []}
        return self.data.search_registry_records(
            registryIds=[self.registry_id],
            searchQuery=query,
            maxResults=max_results,
        )

    # -- descriptor builders -------------------------------------------------
    @staticmethod
    def build_mcp_descriptors(server: McpServer, tools: list[McpTool]) -> list[dict[str, Any]]:
        """Build MCP-type descriptors from a Loom McpServer and its tools."""
        server_manifest = {
            "name": server.name,
            "description": server.description or "",
            "endpoint_url": server.endpoint_url,
            "transport_type": server.transport_type,
        }

        tool_definitions = []
        for tool in tools:
            tool_def: dict[str, Any] = {
                "name": tool.tool_name,
                "description": tool.description or "",
            }
            schema = tool.get_input_schema()
            if schema:
                tool_def["inputSchema"] = schema
            tool_definitions.append(tool_def)

        return [
            {
                "descriptorType": "MCP",
                "serverManifest": json.dumps(server_manifest),
                "toolDefinitions": json.dumps(tool_definitions),
            }
        ]

    @staticmethod
    def build_a2a_descriptors(agent: A2aAgent) -> list[dict[str, Any]]:
        """Build A2A-type descriptors from a Loom A2aAgent."""
        agent_card = agent.agent_card_raw or "{}"
        if isinstance(agent_card, str):
            # Already a JSON string
            card_str = agent_card
        else:
            card_str = json.dumps(agent_card)

        return [
            {
                "descriptorType": "A2A",
                "agentCard": card_str,
            }
        ]
