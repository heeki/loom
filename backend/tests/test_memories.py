"""Tests for memory resource management endpoints."""
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models.memory import Memory


class TestMemoriesRouter(unittest.TestCase):
    """Test cases for /api/memories endpoints."""

    @classmethod
    def setUpClass(cls):
        """Set up test database."""
        cls.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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

    @patch("app.routers.memories.svc_create_memory")
    def test_create_memory_semantic_strategy(self, mock_create):
        """Test creating a memory with a semantic strategy."""
        mock_create.return_value = {
            "memoryArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-abc123",
            "memoryId": "mem-abc123",
            "status": "CREATING",
            "memoryStrategies": [{"semanticMemoryStrategy": {"name": "default-semantic"}}],
        }

        response = self.client.post("/api/memories", json={
            "name": "test-memory",
            "event_expiry_duration": 30,
            "memory_strategies": [{"strategy_type": "semantic", "name": "default-semantic"}],
        })

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["name"], "test-memory")
        self.assertEqual(data["memory_id"], "mem-abc123")
        self.assertEqual(data["status"], "CREATING")
        self.assertEqual(data["arn"], "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-abc123")
        self.assertEqual(data["event_expiry_duration"], 30)
        self.assertEqual(data["account_id"], "123456789012")

    @patch("app.routers.memories.svc_create_memory")
    def test_create_memory_summary_strategy(self, mock_create):
        """Test creating a memory with a summary strategy."""
        mock_create.return_value = {
            "memoryArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-sum123",
            "memoryId": "mem-sum123",
            "status": "CREATING",
        }

        response = self.client.post("/api/memories", json={
            "name": "summary-memory",
            "event_expiry_duration": 60,
            "memory_strategies": [{"strategy_type": "summary", "name": "default-summary"}],
        })

        self.assertEqual(response.status_code, 201)
        # Verify the service was called with correct AWS tagged union format
        call_args = mock_create.call_args
        strategies = call_args.kwargs.get("memory_strategies") or call_args[1].get("memory_strategies")
        self.assertEqual(strategies, [{"summaryMemoryStrategy": {"name": "default-summary"}}])

    @patch("app.routers.memories.svc_create_memory")
    def test_create_memory_user_preference_strategy(self, mock_create):
        """Test creating a memory with a user_preference strategy."""
        mock_create.return_value = {
            "memoryArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-up123",
            "memoryId": "mem-up123",
            "status": "CREATING",
        }

        response = self.client.post("/api/memories", json={
            "name": "pref-memory",
            "event_expiry_duration": 30,
            "memory_strategies": [{"strategy_type": "user_preference", "name": "default-pref"}],
        })

        self.assertEqual(response.status_code, 201)
        call_args = mock_create.call_args
        strategies = call_args.kwargs.get("memory_strategies") or call_args[1].get("memory_strategies")
        self.assertEqual(strategies, [{"userPreferenceMemoryStrategy": {"name": "default-pref"}}])

    @patch("app.routers.memories.svc_create_memory")
    def test_create_memory_episodic_strategy(self, mock_create):
        """Test creating a memory with an episodic strategy."""
        mock_create.return_value = {
            "memoryArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-ep123",
            "memoryId": "mem-ep123",
            "status": "CREATING",
        }

        response = self.client.post("/api/memories", json={
            "name": "episodic-memory",
            "event_expiry_duration": 30,
            "memory_strategies": [{"strategy_type": "episodic", "name": "default-episodic"}],
        })

        self.assertEqual(response.status_code, 201)
        call_args = mock_create.call_args
        strategies = call_args.kwargs.get("memory_strategies") or call_args[1].get("memory_strategies")
        self.assertEqual(strategies, [{"episodicMemoryStrategy": {"name": "default-episodic"}}])

    @patch("app.routers.memories.svc_create_memory")
    def test_create_memory_custom_strategy(self, mock_create):
        """Test creating a memory with a custom strategy."""
        mock_create.return_value = {
            "memoryArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-cust123",
            "memoryId": "mem-cust123",
            "status": "CREATING",
        }

        response = self.client.post("/api/memories", json={
            "name": "custom-memory",
            "event_expiry_duration": 30,
            "memory_strategies": [{"strategy_type": "custom", "name": "my-custom"}],
        })

        self.assertEqual(response.status_code, 201)
        call_args = mock_create.call_args
        strategies = call_args.kwargs.get("memory_strategies") or call_args[1].get("memory_strategies")
        self.assertEqual(strategies, [{"customMemoryStrategy": {"name": "my-custom"}}])

    def test_strategy_type_mapping(self):
        """Test that all strategy types are correctly mapped to AWS parameter keys."""
        from app.routers.memories import STRATEGY_TYPE_MAP

        self.assertEqual(STRATEGY_TYPE_MAP["semantic"], "semanticMemoryStrategy")
        self.assertEqual(STRATEGY_TYPE_MAP["summary"], "summaryMemoryStrategy")
        self.assertEqual(STRATEGY_TYPE_MAP["user_preference"], "userPreferenceMemoryStrategy")
        self.assertEqual(STRATEGY_TYPE_MAP["episodic"], "episodicMemoryStrategy")
        self.assertEqual(STRATEGY_TYPE_MAP["custom"], "customMemoryStrategy")
        self.assertEqual(len(STRATEGY_TYPE_MAP), 5)

    @patch("app.routers.memories.svc_create_memory")
    def test_list_memories(self, mock_create):
        """Test listing memory resources."""
        mock_create.return_value = {
            "memoryArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-1",
            "memoryId": "mem-1",
            "status": "ACTIVE",
        }

        self.client.post("/api/memories", json={
            "name": "memory-1",
            "event_expiry_duration": 30,
        })

        mock_create.return_value = {
            "memoryArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-2",
            "memoryId": "mem-2",
            "status": "ACTIVE",
        }

        self.client.post("/api/memories", json={
            "name": "memory-2",
            "event_expiry_duration": 60,
        })

        response = self.client.get("/api/memories")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 2)

    @patch("app.routers.memories.svc_create_memory")
    def test_get_memory(self, mock_create):
        """Test getting a single memory resource."""
        mock_create.return_value = {
            "memoryArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-get1",
            "memoryId": "mem-get1",
            "status": "ACTIVE",
        }

        create_response = self.client.post("/api/memories", json={
            "name": "get-test",
            "event_expiry_duration": 30,
        })
        mem_id = create_response.json()["id"]

        response = self.client.get(f"/api/memories/{mem_id}")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["id"], mem_id)
        self.assertEqual(data["name"], "get-test")

    @patch("app.routers.memories.svc_get_memory")
    @patch("app.routers.memories.svc_create_memory")
    def test_refresh_memory(self, mock_create, mock_get):
        """Test refreshing memory status from AWS."""
        mock_create.return_value = {
            "memoryArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-ref1",
            "memoryId": "mem-ref1",
            "status": "CREATING",
        }

        create_response = self.client.post("/api/memories", json={
            "name": "refresh-test",
            "event_expiry_duration": 30,
        })
        mem_id = create_response.json()["id"]

        mock_get.return_value = {
            "status": "ACTIVE",
            "memoryArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-ref1",
            "memoryStrategies": [{"semanticMemoryStrategy": {"name": "default"}}],
        }

        response = self.client.post(f"/api/memories/{mem_id}/refresh")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ACTIVE")

    @patch("app.routers.memories.svc_delete_memory")
    @patch("app.routers.memories.svc_create_memory")
    def test_delete_memory(self, mock_create, mock_delete):
        """Test deleting a memory resource."""
        mock_create.return_value = {
            "memoryArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-del1",
            "memoryId": "mem-del1",
            "status": "ACTIVE",
        }
        mock_delete.return_value = {}

        create_response = self.client.post("/api/memories", json={
            "name": "delete-test",
            "event_expiry_duration": 30,
        })
        mem_id = create_response.json()["id"]

        response = self.client.delete(f"/api/memories/{mem_id}")
        self.assertEqual(response.status_code, 204)

        # Verify it's gone
        get_response = self.client.get(f"/api/memories/{mem_id}")
        self.assertEqual(get_response.status_code, 404)

    def test_invalid_strategy_type(self):
        """Test that an invalid strategy type returns 400."""
        response = self.client.post("/api/memories", json={
            "name": "bad-strategy",
            "event_expiry_duration": 30,
            "memory_strategies": [{"strategy_type": "nonexistent", "name": "bad"}],
        })

        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid strategy type", response.json()["detail"])

    def test_missing_required_fields(self):
        """Test that missing required fields returns 422."""
        # Missing event_expiry_duration
        response = self.client.post("/api/memories", json={
            "name": "no-expiry",
        })
        self.assertEqual(response.status_code, 422)

        # Missing name
        response = self.client.post("/api/memories", json={
            "event_expiry_duration": 30,
        })
        self.assertEqual(response.status_code, 422)

        # Empty body
        response = self.client.post("/api/memories", json={})
        self.assertEqual(response.status_code, 422)

    def test_get_nonexistent_memory(self):
        """Test that getting a non-existent memory returns 404."""
        response = self.client.get("/api/memories/999")
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
