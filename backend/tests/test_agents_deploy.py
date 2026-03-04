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
        mock_describe.return_value = {"agentRuntimeName": "Test Agent", "status": "READY"}
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
        self.assertIsNone(data["deployment_status"])

    @patch("app.routers.agents.deploy_agent")
    @patch("app.routers.agents.create_execution_role")
    def test_deploy_agent_creates_deploying_record(self, mock_create_role, mock_deploy):
        """Test POST /api/agents with source='deploy' creates agent with correct initial state."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/loom-agent-pending-1"
        mock_deploy.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-new",
            "agentRuntimeId": "rt-new",
            "status": "CREATING",
        }

        response = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "my-deploy-agent",
                "code_uri": "s3://bucket/code.zip",
                "config": {"ENV_VAR": "value1"},
            },
        )

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["source"], "deploy")
        self.assertEqual(data["name"], "my-deploy-agent")
        self.assertEqual(data["runtime_id"], "rt-new")
        self.assertEqual(data["code_uri"], "s3://bucket/code.zip")
        self.assertIsNotNone(data["execution_role_arn"])

    @patch("app.routers.agents.deploy_agent")
    @patch("app.routers.agents.create_execution_role")
    def test_deploy_agent_success_updates_status(self, mock_create_role, mock_deploy):
        """Test that a successful deployment sets status to 'deployed'."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/loom-agent-pending-1"
        mock_deploy.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-ok",
            "agentRuntimeId": "rt-ok",
            "status": "ACTIVE",
        }

        response = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "success-agent",
                "code_uri": "s3://bucket/code.zip",
            },
        )

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["deployment_status"], "deployed")
        self.assertEqual(data["status"], "ACTIVE")
        self.assertIsNotNone(data["deployed_at"])

    @patch("app.routers.agents.deploy_agent")
    @patch("app.routers.agents.create_execution_role")
    def test_deploy_agent_failure_sets_failed_status(self, mock_create_role, mock_deploy):
        """Test that deploy failure returns 502 and sets status to 'failed'."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/loom-agent-pending-1"
        mock_deploy.side_effect = Exception("AWS deployment error")

        response = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "fail-agent",
                "code_uri": "s3://bucket/code.zip",
            },
        )

        self.assertEqual(response.status_code, 502)
        self.assertIn("Failed to deploy", response.json()["detail"])

        # Verify DB record was updated to failed
        agent = self.session.query(Agent).filter(Agent.name == "fail-agent").first()
        self.assertIsNotNone(agent)
        self.assertEqual(agent.deployment_status, "failed")
        self.assertEqual(agent.status, "FAILED")

    @patch("app.routers.agents.redeploy_agent")
    @patch("app.routers.agents.deploy_agent")
    @patch("app.routers.agents.create_execution_role")
    def test_redeploy_agent(self, mock_create_role, mock_deploy, mock_redeploy):
        """Test POST /api/agents/{id}/redeploy."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/loom-agent-pending-1"
        mock_deploy.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-redeploy",
            "agentRuntimeId": "rt-redeploy",
            "status": "ACTIVE",
        }
        mock_redeploy.return_value = {
            "agentRuntimeId": "rt-redeploy",
            "status": "ACTIVE",
        }

        # First deploy
        create_resp = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "redeploy-agent",
                "code_uri": "s3://bucket/code.zip",
                "config": {"KEY": "val"},
            },
        )
        agent_id = create_resp.json()["id"]

        # Redeploy
        response = self.client.post(f"/api/agents/{agent_id}/redeploy")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["deployment_status"], "deployed")
        mock_redeploy.assert_called_once()

    @patch("app.routers.agents.deploy_agent")
    @patch("app.routers.agents.create_execution_role")
    def test_redeploy_registered_agent_rejected(self, mock_create_role, mock_deploy):
        """Test that redeploying a registered (non-deployed) agent returns 400."""
        # Create a registered agent directly in DB
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

    @patch("app.routers.agents.deploy_agent")
    @patch("app.routers.agents.create_execution_role")
    def test_get_config(self, mock_create_role, mock_deploy):
        """Test GET /api/agents/{id}/config returns config entries."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/test"
        mock_deploy.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/cfg-test",
            "agentRuntimeId": "cfg-test",
            "status": "ACTIVE",
        }

        create_resp = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "config-agent",
                "code_uri": "s3://bucket/code.zip",
                "config": {"APP_ENV": "prod", "LOG_LEVEL": "DEBUG"},
            },
        )
        agent_id = create_resp.json()["id"]

        response = self.client.get(f"/api/agents/{agent_id}/config")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 2)
        keys = {entry["key"] for entry in data}
        self.assertIn("APP_ENV", keys)
        self.assertIn("LOG_LEVEL", keys)

    @patch("app.routers.agents.deploy_agent")
    @patch("app.routers.agents.create_execution_role")
    def test_update_config(self, mock_create_role, mock_deploy):
        """Test PUT /api/agents/{id}/config updates and adds config entries."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/test"
        mock_deploy.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/cfg-up",
            "agentRuntimeId": "cfg-up",
            "status": "ACTIVE",
        }

        create_resp = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "update-config-agent",
                "code_uri": "s3://bucket/code.zip",
                "config": {"KEY1": "old_value"},
            },
        )
        agent_id = create_resp.json()["id"]

        # Update existing key and add new key
        response = self.client.put(
            f"/api/agents/{agent_id}/config",
            json={"config": {"KEY1": "new_value", "KEY2": "added"}},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        config_map = {entry["key"]: entry["value"] for entry in data}
        self.assertEqual(config_map["KEY1"], "new_value")
        self.assertEqual(config_map["KEY2"], "added")

    @patch("app.routers.agents.delete_execution_role")
    @patch("app.routers.agents.delete_runtime")
    @patch("app.routers.agents.deploy_agent")
    @patch("app.routers.agents.create_execution_role")
    def test_delete_deployed_agent_cleans_up(self, mock_create_role, mock_deploy, mock_delete_rt, mock_delete_role):
        """Test that deleting a deployed agent calls AWS cleanup."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/loom-agent-pending-1"
        mock_deploy.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-del",
            "agentRuntimeId": "rt-del",
            "status": "ACTIVE",
        }

        create_resp = self.client.post(
            "/api/agents",
            json={
                "source": "deploy",
                "name": "delete-agent",
                "code_uri": "s3://bucket/code.zip",
            },
        )
        agent_id = create_resp.json()["id"]

        response = self.client.delete(f"/api/agents/{agent_id}")
        self.assertEqual(response.status_code, 204)

        mock_delete_rt.assert_called_once_with("rt-del", "us-east-1")
        mock_delete_role.assert_called_once()

    def test_deploy_agent_missing_name(self):
        """Test deploy without name returns 400."""
        response = self.client.post(
            "/api/agents",
            json={"source": "deploy", "code_uri": "s3://bucket/code.zip"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.json()["detail"].lower())

    def test_deploy_agent_missing_code_uri(self):
        """Test deploy without code_uri returns 400."""
        response = self.client.post(
            "/api/agents",
            json={"source": "deploy", "name": "my-agent"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code_uri", response.json()["detail"].lower())

    def test_invalid_source(self):
        """Test invalid source returns 400."""
        response = self.client.post(
            "/api/agents",
            json={"source": "invalid", "name": "test"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid source", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
