"""Tests for agent deployment endpoints and extended agent router functionality."""
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models.agent import Agent
from app.models.config_entry import ConfigEntry


class TestAgentsDeployRouter(unittest.TestCase):
    """Test cases for deployment-related /api/agents endpoints."""

    @classmethod
    def setUpClass(cls):
        """Set up test database."""
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=cls.engine)
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)

    def setUp(self):
        """Set up test client and database session."""
        self.session = self.TestingSessionLocal()

        def override_get_db():
            try:
                yield self.session
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

    def tearDown(self):
        """Clean up database after each test."""
        self.session.rollback()
        self.session.close()
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

    @patch("app.routers.agents.describe_runtime")
    @patch("app.routers.agents.list_runtime_endpoints")
    def test_register_agent_existing_behavior(self, mock_list_endpoints, mock_describe):
        """Regression test: source='register' still works as before."""
        mock_describe.return_value = {
            "agentRuntimeName": "Test Agent",
            "status": "READY",
            "protocolConfiguration": {"serverProtocol": "HTTP"},
        }
        mock_list_endpoints.return_value = ["DEFAULT"]

        response = self.client.post(
            "/api/agents",
            json={
                "source": "register",
                "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/reg-test",
            },
        )

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["source"], "register")
        self.assertEqual(data["runtime_id"], "reg-test")
        self.assertEqual(data["protocol"], "HTTP")
        self.assertIsNone(data["deployment_status"])

    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_deploy_agent_creates_deploying_record(
        self, mock_create_role, mock_build_artifact, mock_create_runtime
    ):
        """Test POST /api/agents with source='deploy' creates agent with correct initial state."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/loom-agent-pending-1"
        mock_build_artifact.return_value = ("my-bucket", "artifacts/agent.zip")
        mock_create_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-new",
            "agentRuntimeId": "rt-new",
            "status": "CREATING",
        }

        response = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "my_deploy_agent",
                "model_id": "us.anthropic.claude-sonnet-4-6-v1",
            },
        )

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["source"], "deploy")
        self.assertEqual(data["name"], "my_deploy_agent")
        self.assertEqual(data["runtime_id"], "rt-new")
        self.assertIsNotNone(data["execution_role_arn"])

    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_deploy_agent_success_updates_status(
        self, mock_create_role, mock_build_artifact, mock_create_runtime
    ):
        """Test that a successful deployment sets status to 'deployed'."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/loom-agent-pending-1"
        mock_build_artifact.return_value = ("my-bucket", "artifacts/agent.zip")
        mock_create_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-ok",
            "agentRuntimeId": "rt-ok",
            "status": "ACTIVE",
        }

        response = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "success_agent",
                "model_id": "us.anthropic.claude-sonnet-4-6-v1",
            },
        )

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["deployment_status"], "deployed")
        self.assertEqual(data["status"], "ACTIVE")
        self.assertIsNotNone(data["deployed_at"])

    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_deploy_agent_failure_sets_failed_status(
        self, mock_create_role, mock_build_artifact, mock_create_runtime
    ):
        """Test that deploy failure returns 502 and sets status to 'failed'."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/loom-agent-pending-1"
        mock_build_artifact.return_value = ("my-bucket", "artifacts/agent.zip")
        mock_create_runtime.side_effect = Exception("AWS deployment error")

        response = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "fail_agent",
                "model_id": "us.anthropic.claude-sonnet-4-6-v1",
            },
        )

        self.assertEqual(response.status_code, 502)
        self.assertIn("Failed to deploy", response.json()["detail"])

        # Verify DB record was updated to failed
        agent = self.session.query(Agent).filter(Agent.name == "fail_agent").first()
        self.assertIsNotNone(agent)
        self.assertEqual(agent.deployment_status, "failed")
        self.assertEqual(agent.status, "FAILED")

    @patch("app.routers.agents.update_runtime")
    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_redeploy_agent(
        self, mock_create_role, mock_build_artifact, mock_create_runtime, mock_update_runtime
    ):
        """Test POST /api/agents/{id}/redeploy."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/loom-agent-pending-1"
        mock_build_artifact.return_value = ("my-bucket", "artifacts/agent.zip")
        mock_create_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-redeploy",
            "agentRuntimeId": "rt-redeploy",
            "status": "ACTIVE",
        }
        mock_update_runtime.return_value = {
            "agentRuntimeId": "rt-redeploy",
            "status": "ACTIVE",
        }

        # First deploy
        create_resp = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "redeploy_agent",
                "model_id": "us.anthropic.claude-sonnet-4-6-v1",
            },
        )
        agent_id = create_resp.json()["id"]

        # Redeploy
        response = self.client.post(f"/api/agents/{agent_id}/redeploy")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["deployment_status"], "deployed")
        mock_update_runtime.assert_called_once()

    def test_redeploy_registered_agent_rejected(self):
        """Test that redeploying a registered (non-deployed) agent returns 400."""
        agent = Agent(
            arn="arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/reg-only",
            runtime_id="reg-only",
            name="Registered Agent",
            status="READY",
            region="us-east-1",
            account_id="123456789012",
            source="register",
        )
        self.session.add(agent)
        self.session.commit()
        self.session.refresh(agent)

        response = self.client.post(f"/api/agents/{agent.id}/redeploy")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Only deployed agents", response.json()["detail"])

    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_get_config(self, mock_create_role, mock_build_artifact, mock_create_runtime):
        """Test GET /api/agents/{id}/config returns config entries."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/test"
        mock_build_artifact.return_value = ("my-bucket", "artifacts/agent.zip")
        mock_create_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/cfg-test",
            "agentRuntimeId": "cfg-test",
            "status": "ACTIVE",
        }

        create_resp = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "config_agent",
                "model_id": "us.anthropic.claude-sonnet-4-6-v1",
            },
        )
        agent_id = create_resp.json()["id"]

        response = self.client.get(f"/api/agents/{agent_id}/config")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        # Deploy flow creates AGENT_CONFIG_JSON config entry
        keys = {entry["key"] for entry in data}
        self.assertIn("AGENT_CONFIG_JSON", keys)

    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_update_config(self, mock_create_role, mock_build_artifact, mock_create_runtime):
        """Test PUT /api/agents/{id}/config updates and adds config entries."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/test"
        mock_build_artifact.return_value = ("my-bucket", "artifacts/agent.zip")
        mock_create_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/cfg-up",
            "agentRuntimeId": "cfg-up",
            "status": "ACTIVE",
        }

        create_resp = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "update_config_agent",
                "model_id": "us.anthropic.claude-sonnet-4-6-v1",
            },
        )
        agent_id = create_resp.json()["id"]

        # Update existing key and add new key
        response = self.client.put(
            f"/api/agents/{agent_id}/config",
            json={"config": {"AGENT_SYSTEM_PROMPT": "new prompt", "NEW_KEY": "added"}},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        config_map = {entry["key"]: entry["value"] for entry in data}
        self.assertEqual(config_map["AGENT_SYSTEM_PROMPT"], "new prompt")
        self.assertEqual(config_map["NEW_KEY"], "added")

    @patch("app.routers.agents.delete_execution_role")
    @patch("app.routers.agents.delete_runtime")
    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_delete_deployed_agent_cleans_up(
        self, mock_create_role, mock_build_artifact, mock_create_runtime, mock_delete_rt, mock_delete_role
    ):
        """Test that deleting a deployed agent calls AWS cleanup."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/loom-agent-pending-1"
        mock_build_artifact.return_value = ("my-bucket", "artifacts/agent.zip")
        mock_create_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-del",
            "agentRuntimeId": "rt-del",
            "status": "ACTIVE",
        }

        create_resp = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "delete_agent",
                "model_id": "us.anthropic.claude-sonnet-4-6-v1",
            },
        )
        agent_id = create_resp.json()["id"]

        # Without cleanup_aws, should NOT call AWS delete
        response = self.client.delete(f"/api/agents/{agent_id}")
        self.assertEqual(response.status_code, 204)
        mock_delete_rt.assert_not_called()

    @patch("app.routers.agents.delete_execution_role")
    @patch("app.routers.agents.delete_runtime")
    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_delete_deployed_agent_with_cleanup_aws(
        self, mock_create_role, mock_build_artifact, mock_create_runtime, mock_delete_rt, mock_delete_role
    ):
        """Test that deleting a deployed agent with cleanup_aws=true calls AWS cleanup."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/loom-agent-pending-1"
        mock_build_artifact.return_value = ("my-bucket", "artifacts/agent.zip")
        mock_create_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-del2",
            "agentRuntimeId": "rt-del2",
            "status": "ACTIVE",
        }

        create_resp = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "delete_agent_cleanup",
                "model_id": "us.anthropic.claude-sonnet-4-6-v1",
            },
        )
        agent_id = create_resp.json()["id"]

        response = self.client.delete(f"/api/agents/{agent_id}?cleanup_aws=true")
        self.assertEqual(response.status_code, 204)
        mock_delete_rt.assert_called_once_with("rt-del2", "us-east-1")

    def test_deploy_agent_missing_name(self):
        """Test deploy without name returns 400."""
        response = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "model_id": "us.anthropic.claude-sonnet-4-6-v1",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.json()["detail"].lower())

    def test_deploy_agent_missing_model_id(self):
        """Test deploy without model_id returns 400."""
        response = self.client.post(
            "/api/agents",
            json={"source": "deploy", "name": "my_agent"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("model_id", response.json()["detail"].lower())

    def test_deploy_agent_invalid_name_hyphen(self):
        """Test deploy with hyphenated name returns 400."""
        response = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "my-agent",
                "model_id": "us.anthropic.claude-sonnet-4-6-v1",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid agent name", response.json()["detail"])

    def test_deploy_agent_invalid_name_starts_with_digit(self):
        """Test deploy with name starting with digit returns 400."""
        response = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "1agent",
                "model_id": "us.anthropic.claude-sonnet-4-6-v1",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid agent name", response.json()["detail"])

    def test_invalid_source(self):
        """Test invalid source returns 400."""
        response = self.client.post(
            "/api/agents",
            json={"source": "invalid", "name": "test"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid source", response.json()["detail"])

    # -------------------------------------------------------------------
    # New endpoint tests
    # -------------------------------------------------------------------
    @patch("app.routers.agents.get_runtime")
    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_status_endpoint_polls_runtime(
        self, mock_create_role, mock_build_artifact, mock_create_runtime, mock_get_runtime
    ):
        """Test GET /api/agents/{id}/status polls AWS for runtime status."""
        mock_create_role.return_value = "arn:aws:iam::123:role/r"
        mock_build_artifact.return_value = ("b", "k")
        mock_create_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123:runtime/rt-status",
            "agentRuntimeId": "rt-status",
            "status": "CREATING",
        }
        mock_get_runtime.return_value = {
            "status": "READY",
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123:runtime/rt-status",
        }

        create_resp = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "status_agent",
                "model_id": "us.anthropic.claude-sonnet-4-6-v1",
            },
        )
        agent_id = create_resp.json()["id"]

        with patch("app.routers.agents.create_runtime_endpoint") as mock_ep:
            mock_ep.return_value = {
                "name": "status-agent-ep",
                "agentRuntimeEndpointArn": "arn:ep",
                "status": "CREATING",
            }
            with patch("app.routers.agents.get_runtime_endpoint") as mock_get_ep:
                mock_get_ep.return_value = {"status": "CREATING", "agentRuntimeEndpointArn": "arn:ep"}
                response = self.client.get(f"/api/agents/{agent_id}/status")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "READY")

    def test_roles_endpoint(self):
        """Test GET /api/agents/roles returns roles list."""
        with patch("app.routers.agents.list_agentcore_roles") as mock_list:
            mock_list.return_value = [
                {"role_name": "loom-role", "role_arn": "arn:iam::123:role/loom-role", "description": ""}
            ]
            response = self.client.get("/api/agents/roles")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["role_name"], "loom-role")

    def test_cognito_pools_endpoint(self):
        """Test GET /api/agents/cognito-pools returns pools list."""
        with patch("app.routers.agents.list_cognito_pools") as mock_list:
            mock_list.return_value = [
                {"pool_id": "us-east-1_abc", "pool_name": "my-pool"}
            ]
            response = self.client.get("/api/agents/cognito-pools")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["pool_id"], "us-east-1_abc")

    def test_models_endpoint(self):
        """Test GET /api/agents/models returns supported models."""
        response = self.client.get("/api/agents/models")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(len(data) > 0)
        model_ids = [m["model_id"] for m in data]
        self.assertIn("us.anthropic.claude-sonnet-4-6-v1", model_ids)


if __name__ == "__main__":
    unittest.main()
