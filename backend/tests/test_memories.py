"""Tests for memory resource management endpoints."""
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
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

        @event.listens_for(cls.engine, "connect")
        def _set_sqlite_pragma(dbapi_conn, connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

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
            "memory": {
                "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-abc123",
                "id": "mem-abc123",
                "name": "test_memory",
                "status": "CREATING",
                "eventExpiryDuration": 30,
                "strategies": [{"name": "default_semantic", "type": "SEMANTIC"}],
            }
        }

        response = self.client.post("/api/memories", json={
            "name": "test_memory",
            "event_expiry_duration": 30,
            "memory_strategies": [{"strategy_type": "semantic", "name": "default_semantic"}],
        })

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["name"], "test_memory")
        self.assertEqual(data["memory_id"], "mem-abc123")
        self.assertEqual(data["status"], "CREATING")
        self.assertEqual(data["arn"], "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-abc123")
        self.assertEqual(data["event_expiry_duration"], 30)
        self.assertEqual(data["account_id"], "123456789012")

    @patch("app.routers.memories.svc_create_memory")
    def test_create_memory_summary_strategy(self, mock_create):
        """Test creating a memory with a summary strategy."""
        mock_create.return_value = {
            "memory": {
                "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-sum123",
                "id": "mem-sum123",
                "name": "summary_memory",
                "status": "CREATING",
                "eventExpiryDuration": 60,
            }
        }

        response = self.client.post("/api/memories", json={
            "name": "summary_memory",
            "event_expiry_duration": 60,
            "memory_strategies": [{"strategy_type": "summary", "name": "default_summary"}],
        })

        self.assertEqual(response.status_code, 201)
        # Verify the service was called with correct AWS tagged union format
        call_args = mock_create.call_args
        strategies = call_args.kwargs.get("memory_strategies") or call_args[1].get("memory_strategies")
        self.assertEqual(strategies, [{"summaryMemoryStrategy": {"name": "default_summary"}}])

    @patch("app.routers.memories.svc_create_memory")
    def test_create_memory_user_preference_strategy(self, mock_create):
        """Test creating a memory with a user_preference strategy."""
        mock_create.return_value = {
            "memory": {
                "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-up123",
                "id": "mem-up123",
                "name": "pref_memory",
                "status": "CREATING",
                "eventExpiryDuration": 30,
            }
        }

        response = self.client.post("/api/memories", json={
            "name": "pref_memory",
            "event_expiry_duration": 30,
            "memory_strategies": [{"strategy_type": "user_preference", "name": "default_pref"}],
        })

        self.assertEqual(response.status_code, 201)
        call_args = mock_create.call_args
        strategies = call_args.kwargs.get("memory_strategies") or call_args[1].get("memory_strategies")
        self.assertEqual(strategies, [{"userPreferenceMemoryStrategy": {"name": "default_pref"}}])

    @patch("app.routers.memories.svc_create_memory")
    def test_create_memory_episodic_strategy(self, mock_create):
        """Test creating a memory with an episodic strategy."""
        mock_create.return_value = {
            "memory": {
                "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-ep123",
                "id": "mem-ep123",
                "name": "episodic_memory",
                "status": "CREATING",
                "eventExpiryDuration": 30,
            }
        }

        response = self.client.post("/api/memories", json={
            "name": "episodic_memory",
            "event_expiry_duration": 30,
            "memory_strategies": [{"strategy_type": "episodic", "name": "default_episodic"}],
        })

        self.assertEqual(response.status_code, 201)
        call_args = mock_create.call_args
        strategies = call_args.kwargs.get("memory_strategies") or call_args[1].get("memory_strategies")
        self.assertEqual(strategies, [{"episodicMemoryStrategy": {"name": "default_episodic"}}])

    @patch("app.routers.memories.svc_create_memory")
    def test_create_memory_custom_strategy(self, mock_create):
        """Test creating a memory with a custom strategy."""
        mock_create.return_value = {
            "memory": {
                "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-cust123",
                "id": "mem-cust123",
                "name": "custom_memory",
                "status": "CREATING",
                "eventExpiryDuration": 30,
            }
        }

        response = self.client.post("/api/memories", json={
            "name": "custom_memory",
            "event_expiry_duration": 30,
            "memory_strategies": [{"strategy_type": "custom", "name": "my_custom"}],
        })

        self.assertEqual(response.status_code, 201)
        call_args = mock_create.call_args
        strategies = call_args.kwargs.get("memory_strategies") or call_args[1].get("memory_strategies")
        self.assertEqual(strategies, [{"customMemoryStrategy": {"name": "my_custom"}}])

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
            "memory": {
                "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-1",
                "id": "mem-1",
                "name": "memory_one",
                "status": "ACTIVE",
                "eventExpiryDuration": 30,
            }
        }

        self.client.post("/api/memories", json={
            "name": "memory_one",
            "event_expiry_duration": 30,
        })

        mock_create.return_value = {
            "memory": {
                "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-2",
                "id": "mem-2",
                "name": "memory_two",
                "status": "ACTIVE",
                "eventExpiryDuration": 60,
            }
        }

        self.client.post("/api/memories", json={
            "name": "memory_two",
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
            "memory": {
                "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-get1",
                "id": "mem-get1",
                "name": "get_test",
                "status": "ACTIVE",
                "eventExpiryDuration": 30,
            }
        }

        create_response = self.client.post("/api/memories", json={
            "name": "get_test",
            "event_expiry_duration": 30,
        })
        mem_id = create_response.json()["id"]

        response = self.client.get(f"/api/memories/{mem_id}")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["id"], mem_id)
        self.assertEqual(data["name"], "get_test")

    @patch("app.routers.memories.svc_get_memory")
    @patch("app.routers.memories.svc_create_memory")
    def test_refresh_memory(self, mock_create, mock_get):
        """Test refreshing memory status from AWS."""
        mock_create.return_value = {
            "memory": {
                "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-ref1",
                "id": "mem-ref1",
                "name": "refresh_test",
                "status": "CREATING",
                "eventExpiryDuration": 30,
            }
        }

        create_response = self.client.post("/api/memories", json={
            "name": "refresh_test",
            "event_expiry_duration": 30,
        })
        mem_id = create_response.json()["id"]

        mock_get.return_value = {
            "memory": {
                "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-ref1",
                "id": "mem-ref1",
                "name": "refresh_test",
                "status": "ACTIVE",
                "strategies": [{"name": "default", "type": "SEMANTIC"}],
            }
        }

        response = self.client.post(f"/api/memories/{mem_id}/refresh")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ACTIVE")

    @patch("app.routers.memories.svc_delete_memory")
    @patch("app.routers.memories.svc_create_memory")
    def test_delete_memory(self, mock_create, mock_delete):
        """Test deleting a memory resource (async deletion)."""
        mock_create.return_value = {
            "memory": {
                "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/mem-del1",
                "id": "mem-del1",
                "name": "delete_test",
                "status": "ACTIVE",
                "eventExpiryDuration": 30,
            }
        }
        mock_delete.return_value = {"memoryId": "mem-del1", "status": "DELETING"}

        create_response = self.client.post("/api/memories", json={
            "name": "delete_test",
            "event_expiry_duration": 30,
        })
        mem_id = create_response.json()["id"]

        # Delete initiates async deletion — returns DELETING status
        response = self.client.delete(f"/api/memories/{mem_id}")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "DELETING")

        # Record still exists in DB with DELETING status
        get_response = self.client.get(f"/api/memories/{mem_id}")
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.json()["status"], "DELETING")

        # Purge removes from DB
        purge_response = self.client.delete(f"/api/memories/{mem_id}/purge")
        self.assertEqual(purge_response.status_code, 204)

        # Now it's gone
        get_response = self.client.get(f"/api/memories/{mem_id}")
        self.assertEqual(get_response.status_code, 404)

    def test_invalid_strategy_type(self):
        """Test that an invalid strategy type returns 400."""
        response = self.client.post("/api/memories", json={
            "name": "bad_strategy",
            "event_expiry_duration": 30,
            "memory_strategies": [{"strategy_type": "nonexistent", "name": "bad"}],
        })

        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid strategy type", response.json()["detail"])

    def test_invalid_memory_name(self):
        """Test that a hyphenated memory name returns 400."""
        response = self.client.post("/api/memories", json={
            "name": "bad-name",
            "event_expiry_duration": 30,
        })

        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid memory name", response.json()["detail"])

    def test_invalid_strategy_name(self):
        """Test that a hyphenated strategy name returns 400."""
        response = self.client.post("/api/memories", json={
            "name": "valid_name",
            "event_expiry_duration": 30,
            "memory_strategies": [{"strategy_type": "semantic", "name": "bad-strategy-name"}],
        })

        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid strategy name", response.json()["detail"])

    def test_missing_required_fields(self):
        """Test that missing required fields returns 422."""
        # Missing event_expiry_duration
        response = self.client.post("/api/memories", json={
            "name": "no_expiry",
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
