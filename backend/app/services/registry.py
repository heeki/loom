"""AWS Agent Registry service for managing registry records."""
import json
import logging
import os
import re
import time
from typing import Any

import boto3

from app.models.a2a import A2aAgent
from app.models.mcp import McpServer, McpTool

logger = logging.getLogger(__name__)

# ARN pattern: arn:aws:bedrock-agentcore:{region}:{account}:registry/{id}
_REGISTRY_ARN_PATTERN = re.compile(
    r"^arn:aws:bedrock-agentcore:[a-z0-9-]+:\d{12}:registry/[a-zA-Z0-9_-]+$"
)

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


def configure_registry(registry_id: str, region: str | None = None) -> "RegistryClient":
    """Reconfigure the singleton with a new registry ID. Called on settings update."""
    global _client
    rgn = region or os.getenv("AWS_REGION", "us-east-1")
    _client = RegistryClient(registry_id=registry_id, region=rgn)
    return _client


def init_registry_from_db(db_session) -> None:
    """Load registry config from site_settings on startup. Falls back to env var."""
    from app.models.site_setting import SiteSetting
    setting = db_session.query(SiteSetting).filter(SiteSetting.key == "loom_registry_id").first()
    registry_id = ""
    if setting and setting.value:
        registry_id = parse_registry_id_from_arn(setting.value)
    if not registry_id:
        registry_id = os.getenv("LOOM_REGISTRY_ID", "")
    if registry_id:
        configure_registry(registry_id)
        logger.info("Registry client initialized with registry_id=%s", registry_id)
    else:
        logger.info("No registry configured; governance features disabled")


def validate_registry_arn(arn: str) -> str:
    """Validate a registry ARN and return the registry ID, or raise ValueError."""
    if not _REGISTRY_ARN_PATTERN.match(arn):
        raise ValueError(
            f"Invalid registry ARN: {arn}. "
            "Expected format: arn:aws:bedrock-agentcore:<region>:<account>:registry/<id>"
        )
    return parse_registry_id_from_arn(arn)


def parse_registry_id_from_arn(arn: str) -> str:
    """Extract registry ID from an ARN string. Returns empty string if not parseable."""
    parts = arn.split("/")
    return parts[-1] if len(parts) >= 2 else ""


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
    def get_registry(self) -> dict[str, Any]:
        if not self._require_registry():
            return {}
        return self.control.get_registry(registryId=self.registry_id)

    def create_record(
        self,
        name: str,
        descriptor_type: str,
        descriptors: dict[str, Any],
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
        result = self.control.create_registry_record(**kwargs)
        # create response may only have recordArn; extract recordId from it
        if "recordId" not in result and "recordArn" in result:
            arn_parts = result["recordArn"].split("/")
            if len(arn_parts) >= 2:
                result["recordId"] = arn_parts[-1]
        return result

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

    def approve_record(self, record_id: str, reason: str = "Approved via Loom") -> dict[str, Any]:
        if not self._require_registry():
            return {}
        return self.control.update_registry_record_status(
            registryId=self.registry_id,
            recordId=record_id,
            status="APPROVED",
            statusReason=reason,
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
    def build_mcp_descriptors(server: McpServer, tools: list[McpTool]) -> dict[str, Any]:
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

        return {
            "mcp": {
                "server": {"inlineContent": json.dumps(server_manifest)},
                "tools": {"inlineContent": json.dumps(tool_definitions)},
            }
        }

    @staticmethod
    def build_agent_descriptors(agent) -> dict[str, Any]:
        """Build A2A-type descriptors from a Loom Agent."""
        agent_card = {
            "name": agent.name or agent.runtime_id,
            "description": agent.description or "",
            "version": "1.0.0",
            "url": agent.endpoint_arn or agent.arn,
            "protocolVersion": "0.3.0",
            "capabilities": {
                "streaming": False,
                "pushNotifications": False,
            },
            "defaultInputModes": ["text/plain"],
            "defaultOutputModes": ["text/plain"],
            "skills": [
                {
                    "id": "default",
                    "name": agent.name or agent.runtime_id,
                    "description": agent.description or "Default skill",
                    "tags": ["loom"],
                }
            ],
            "provider": {
                "organization": "Loom",
                "url": agent.arn,
            },
            "_meta": {
                "loom": {
                    "source": "loom",
                    "runtime_id": agent.runtime_id,
                    "arn": agent.arn,
                    "region": agent.region,
                    "protocol": agent.protocol or "HTTP",
                    "network_mode": agent.network_mode or "PUBLIC",
                }
            },
        }
        return {
            "a2a": {
                "agentCard": {"inlineContent": json.dumps(agent_card)},
            }
        }

    @staticmethod
    def build_a2a_descriptors(agent: A2aAgent) -> dict[str, Any]:
        """Build A2A-type descriptors from a Loom A2aAgent."""
        agent_card = agent.agent_card_raw or "{}"
        card_str = agent_card if isinstance(agent_card, str) else json.dumps(agent_card)
        return {
            "a2a": {
                "agentCard": {"inlineContent": card_str},
            }
        }
