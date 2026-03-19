"""Tests for trace retrieval endpoints."""
import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models.agent import Agent
from app.models.session import InvocationSession
from app.models.invocation import Invocation


class TestTracesRouter(unittest.TestCase):
    """Test cases for /api/agents/{id}/sessions/{sid}/traces and /api/agents/{id}/traces/{tid}."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

        @event.listens_for(cls.engine, "connect")
        def _set_sqlite_pragma(dbapi_conn, connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        Base.metadata.create_all(bind=cls.engine)
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)

    def setUp(self):
        self.session = self.TestingSessionLocal()

        def override_get_db():
            try:
                yield self.session
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        # Create test agent
        self.agent = Agent(
            arn="arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test-agent",
            runtime_id="test-agent",
            name="Test Agent",
            status="READY",
            region="us-east-1",
            account_id="123456789012",
            log_group="/aws/bedrock-agentcore/runtimes/test-agent-DEFAULT",
        )
        self.agent.set_available_qualifiers(["DEFAULT"])
        self.session.add(self.agent)
        self.session.commit()
        self.session.refresh(self.agent)

        # Create test session with invocation
        self.inv_session = InvocationSession(
            session_id="test-session-1",
            agent_id=self.agent.id,
            qualifier="DEFAULT",
        )
        self.session.add(self.inv_session)
        self.session.commit()

        self.invocation = Invocation(
            session_id="test-session-1",
            invocation_id="inv-uuid-1",
            prompt_text="Hello",
            status="complete",
            client_invoke_time=1708000000.0,
            client_done_time=1708000002.0,
        )
        self.session.add(self.invocation)
        self.session.commit()

    def tearDown(self):
        self.session.rollback()
        self.session.close()
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

    @patch("app.routers.traces.get_trace_summaries_for_invocations")
    def test_get_session_traces_success(self, mock_get_summaries):
        """Test successful trace retrieval for a session."""
        mock_get_summaries.return_value = [
            {
                "Id": "1-abc-def",
                "ResponseTime": datetime(2026, 2, 15, 10, 0, 0, tzinfo=timezone.utc),
                "Duration": 2.5,
                "HasError": False,
                "HasFault": False,
                "Annotations": {
                    "agent_invocation_id": [
                        {"AnnotationValue": {"StringValue": "inv-uuid-1"}}
                    ]
                },
                "ServiceIds": [{"Name": "agent.invocation"}],
            }
        ]

        resp = self.client.get(
            f"/api/agents/{self.agent.id}/sessions/test-session-1/traces"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["traces"]), 1)
        trace = data["traces"][0]
        self.assertEqual(trace["trace_id"], "1-abc-def")
        self.assertEqual(trace["duration_ms"], 2500.0)
        self.assertEqual(trace["status"], "ok")
        self.assertEqual(trace["invocation_id"], "inv-uuid-1")

    @patch("app.routers.traces.get_trace_summaries_for_invocations")
    def test_get_session_traces_empty(self, mock_get_summaries):
        """Test empty trace list for a session with no traces."""
        mock_get_summaries.return_value = []

        resp = self.client.get(
            f"/api/agents/{self.agent.id}/sessions/test-session-1/traces"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["traces"], [])

    def test_get_session_traces_agent_not_found(self):
        """Test 404 when agent doesn't exist."""
        resp = self.client.get("/api/agents/999/sessions/test-session-1/traces")
        self.assertEqual(resp.status_code, 404)

    def test_get_session_traces_session_not_found(self):
        """Test 404 when session doesn't exist."""
        resp = self.client.get(
            f"/api/agents/{self.agent.id}/sessions/nonexistent-session/traces"
        )
        self.assertEqual(resp.status_code, 404)

    @patch("app.routers.traces.batch_get_traces")
    def test_get_trace_detail_success(self, mock_batch):
        """Test successful trace detail retrieval."""
        mock_batch.return_value = [
            {
                "Id": "1-abc-def",
                "Segments": [
                    {
                        "Id": "seg-1",
                        "Document": json.dumps({
                            "id": "span-root",
                            "name": "agent.invocation",
                            "start_time": 1708000000.0,
                            "end_time": 1708000002.5,
                            "annotations": {"agent_invocation_id": "inv-uuid-1"},
                            "subsegments": [
                                {
                                    "id": "span-model-1",
                                    "name": "model.call",
                                    "start_time": 1708000000.5,
                                    "end_time": 1708000001.5,
                                },
                                {
                                    "id": "span-tool-1",
                                    "name": "tool.call",
                                    "start_time": 1708000001.5,
                                    "end_time": 1708000002.0,
                                    "annotations": {"tool.name": "search"},
                                    "error": True,
                                },
                            ],
                        }),
                    }
                ],
            }
        ]

        resp = self.client.get(
            f"/api/agents/{self.agent.id}/traces/1-abc-def"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["trace_id"], "1-abc-def")
        self.assertEqual(data["root_span_name"], "agent.invocation")
        self.assertEqual(data["span_count"], 3)
        self.assertEqual(data["status"], "error")  # tool span has error

        # Verify span hierarchy
        spans = data["spans"]
        root_span = next(s for s in spans if s["name"] == "agent.invocation")
        model_span = next(s for s in spans if s["name"] == "model.call")
        tool_span = next(s for s in spans if s["name"] == "tool.call")

        self.assertIsNone(root_span["parent_span_id"])
        self.assertEqual(model_span["parent_span_id"], root_span["span_id"])
        self.assertEqual(tool_span["parent_span_id"], root_span["span_id"])
        self.assertEqual(root_span["span_type"], "invocation")
        self.assertEqual(model_span["span_type"], "model")
        self.assertEqual(tool_span["span_type"], "tool")
        self.assertEqual(tool_span["status"], "error")

    @patch("app.routers.traces.batch_get_traces")
    def test_get_trace_detail_not_found(self, mock_batch):
        """Test 404 when trace doesn't exist."""
        mock_batch.return_value = []

        resp = self.client.get(
            f"/api/agents/{self.agent.id}/traces/nonexistent-trace"
        )
        self.assertEqual(resp.status_code, 404)

    def test_get_trace_detail_agent_not_found(self):
        """Test 404 when agent doesn't exist."""
        resp = self.client.get("/api/agents/999/traces/1-abc-def")
        self.assertEqual(resp.status_code, 404)


class TestXRayService(unittest.TestCase):
    """Test cases for X-Ray service functions."""

    def test_parse_trace_to_spans(self):
        """Test parsing X-Ray trace segments into flat span list."""
        from app.services.xray import parse_trace_to_spans

        trace = {
            "Id": "1-abc",
            "Segments": [
                {
                    "Id": "seg-1",
                    "Document": json.dumps({
                        "id": "root-id",
                        "name": "agent.invocation",
                        "start_time": 100.0,
                        "end_time": 105.0,
                        "subsegments": [
                            {
                                "id": "child-1",
                                "name": "model.call",
                                "start_time": 100.5,
                                "end_time": 103.0,
                            }
                        ],
                    }),
                }
            ],
        }

        spans = parse_trace_to_spans(trace)
        self.assertEqual(len(spans), 2)
        self.assertEqual(spans[0]["name"], "agent.invocation")
        self.assertEqual(spans[0]["span_type"], "invocation")
        self.assertIsNone(spans[0]["parent_span_id"])
        self.assertEqual(spans[1]["name"], "model.call")
        self.assertEqual(spans[1]["span_type"], "model")
        self.assertEqual(spans[1]["parent_span_id"], "root-id")
        self.assertAlmostEqual(spans[0]["duration_ms"], 5000.0)
        self.assertAlmostEqual(spans[1]["duration_ms"], 2500.0)

    def test_classify_span_type(self):
        """Test span type classification."""
        from app.services.xray import _classify_span_type

        self.assertEqual(_classify_span_type("agent.invocation"), "invocation")
        self.assertEqual(_classify_span_type("model.call"), "model")
        self.assertEqual(_classify_span_type("tool.call"), "tool")
        self.assertEqual(_classify_span_type("something.else"), "other")

    def test_parse_empty_trace(self):
        """Test parsing a trace with no segments."""
        from app.services.xray import parse_trace_to_spans

        trace = {"Id": "1-abc", "Segments": []}
        spans = parse_trace_to_spans(trace)
        self.assertEqual(spans, [])


if __name__ == "__main__":
    unittest.main()
