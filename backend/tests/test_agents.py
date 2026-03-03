"""Tests for agent registration and management endpoints."""
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db


class TestAgentsRouter(unittest.TestCase):
    """Test cases for /api/agents endpoints."""

    @classmethod
    def setUpClass(cls):
        """Set up test database."""
        # Use in-memory SQLite for tests with StaticPool to share across connections
        cls.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=cls.engine)
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)

    def setUp(self):
        """Set up test client and database session."""
        self.session = self.TestingSessionLocal()

        # Override dependency
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
        # Clear all tables
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

    @patch("app.routers.agents.describe_runtime")
    @patch("app.routers.agents.list_runtime_endpoints")
    def test_register_agent_success(self, mock_list_endpoints, mock_describe):
        """Test successful agent registration."""
        # Mock AWS responses
        mock_describe.return_value = {
            "agentRuntimeName": "Test Agent",
            "status": "READY",
        }
        mock_list_endpoints.return_value = ["DEFAULT", "PROD"]

        # Register agent
        response = self.client.post(
            "/api/agents",
            json={"arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test-agent-abc123"}
        )

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["arn"], "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test-agent-abc123")
        self.assertEqual(data["runtime_id"], "test-agent-abc123")
        self.assertEqual(data["name"], "Test Agent")
        self.assertEqual(data["status"], "READY")
        self.assertEqual(data["region"], "us-east-1")
        self.assertEqual(data["account_id"], "123456789012")
        self.assertIn("DEFAULT", data["available_qualifiers"])
        self.assertIn("PROD", data["available_qualifiers"])

    def test_register_agent_invalid_arn(self):
        """Test registration with invalid ARN format."""
        response = self.client.post(
            "/api/agents",
            json={"arn": "invalid-arn-format"}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid AgentCore Runtime ARN format", response.json()["detail"])

    @patch("app.routers.agents.describe_runtime")
    @patch("app.routers.agents.list_runtime_endpoints")
    def test_register_agent_duplicate(self, mock_list_endpoints, mock_describe):
        """Test registering the same agent twice."""
        # Mock AWS responses
        mock_describe.return_value = {"agentRuntimeName": "Test Agent", "status": "READY"}
        mock_list_endpoints.return_value = ["DEFAULT"]

        arn = "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test-agent-abc123"

        # Register first time
        response1 = self.client.post("/api/agents", json={"arn": arn})
        self.assertEqual(response1.status_code, 201)

        # Register second time (should fail)
        response2 = self.client.post("/api/agents", json={"arn": arn})
        self.assertEqual(response2.status_code, 409)
        self.assertIn("already registered", response2.json()["detail"])

    @patch("app.routers.agents.describe_runtime")
    @patch("app.routers.agents.list_runtime_endpoints")
    def test_list_agents(self, mock_list_endpoints, mock_describe):
        """Test listing all registered agents."""
        # Mock AWS responses
        mock_describe.return_value = {"agentRuntimeName": "Test Agent", "status": "READY"}
        mock_list_endpoints.return_value = ["DEFAULT"]

        # Register two agents
        self.client.post(
            "/api/agents",
            json={"arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/agent1"}
        )
        self.client.post(
            "/api/agents",
            json={"arn": "arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/agent2"}
        )

        # List agents
        response = self.client.get("/api/agents")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 2)

    @patch("app.routers.agents.describe_runtime")
    @patch("app.routers.agents.list_runtime_endpoints")
    def test_get_agent_by_id(self, mock_list_endpoints, mock_describe):
        """Test getting a specific agent by ID."""
        # Mock AWS responses
        mock_describe.return_value = {"agentRuntimeName": "Test Agent", "status": "READY"}
        mock_list_endpoints.return_value = ["DEFAULT"]

        # Register agent
        register_response = self.client.post(
            "/api/agents",
            json={"arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test-agent"}
        )
        agent_id = register_response.json()["id"]

        # Get agent
        response = self.client.get(f"/api/agents/{agent_id}")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["id"], agent_id)
        self.assertEqual(data["runtime_id"], "test-agent")

    def test_get_agent_not_found(self):
        """Test getting a non-existent agent."""
        response = self.client.get("/api/agents/999")
        self.assertEqual(response.status_code, 404)

    @patch("app.routers.agents.describe_runtime")
    @patch("app.routers.agents.list_runtime_endpoints")
    def test_delete_agent(self, mock_list_endpoints, mock_describe):
        """Test deleting an agent."""
        # Mock AWS responses
        mock_describe.return_value = {"agentRuntimeName": "Test Agent", "status": "READY"}
        mock_list_endpoints.return_value = ["DEFAULT"]

        # Register agent
        register_response = self.client.post(
            "/api/agents",
            json={"arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test-agent"}
        )
        agent_id = register_response.json()["id"]

        # Delete agent
        response = self.client.delete(f"/api/agents/{agent_id}")
        self.assertEqual(response.status_code, 204)

        # Verify it's gone
        get_response = self.client.get(f"/api/agents/{agent_id}")
        self.assertEqual(get_response.status_code, 404)

    @patch("app.routers.agents.describe_runtime")
    @patch("app.routers.agents.list_runtime_endpoints")
    def test_refresh_agent(self, mock_list_endpoints, mock_describe):
        """Test refreshing agent metadata."""
        # Initial mock responses
        mock_describe.return_value = {"agentRuntimeName": "Old Name", "status": "CREATING"}
        mock_list_endpoints.return_value = ["DEFAULT"]

        # Register agent
        register_response = self.client.post(
            "/api/agents",
            json={"arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test-agent"}
        )
        agent_id = register_response.json()["id"]

        # Update mock responses
        mock_describe.return_value = {"agentRuntimeName": "New Name", "status": "READY"}

        # Refresh agent
        response = self.client.post(f"/api/agents/{agent_id}/refresh")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["name"], "New Name")
        self.assertEqual(data["status"], "READY")


if __name__ == "__main__":
    unittest.main()
