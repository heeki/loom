"""Tests for tag policy CRUD, tag resolution, and tag enforcement during deployment."""
import json
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db, _seed_default_tags
from app.models.agent import Agent
from app.models.tag_policy import TagPolicy
from app.services.deployment import _merge_tags
from app.services.iam import _iam_tags


class TestTagPolicyModel(unittest.TestCase):
    """Test TagPolicy model and seeding."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=cls.engine)
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)

    def setUp(self):
        self.session = self.TestingSessionLocal()

    def tearDown(self):
        self.session.rollback()
        self.session.close()
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

    def test_seed_default_tags(self):
        """Test that _seed_default_tags creates the three default tag policies."""
        _seed_default_tags(self.engine)
        policies = self.session.query(TagPolicy).all()
        keys = {p.key for p in policies}
        self.assertEqual(keys, {"loom:application", "loom:group", "loom:owner"})

        # Verify build-time tags
        app_tag = self.session.query(TagPolicy).filter(TagPolicy.key == "loom:application").first()
        self.assertIsNone(app_tag.default_value)
        self.assertEqual(app_tag.source, "build-time")
        self.assertTrue(app_tag.show_on_card)

        group_tag = self.session.query(TagPolicy).filter(TagPolicy.key == "loom:group").first()
        self.assertIsNone(group_tag.default_value)
        self.assertEqual(group_tag.source, "build-time")
        self.assertTrue(group_tag.show_on_card)

    def test_seed_default_tags_idempotent(self):
        """Test that seeding twice does not duplicate tags."""
        _seed_default_tags(self.engine)
        _seed_default_tags(self.engine)
        count = self.session.query(TagPolicy).count()
        self.assertEqual(count, 3)

    def test_tag_policy_to_dict(self):
        """Test TagPolicy.to_dict() serialization."""
        policy = TagPolicy(
            key="test-key",
            default_value="test-val",
            source="deploy-time",
            required=True,
            show_on_card=False,
        )
        self.session.add(policy)
        self.session.commit()
        self.session.refresh(policy)

        d = policy.to_dict()
        self.assertEqual(d["key"], "test-key")
        self.assertEqual(d["default_value"], "test-val")
        self.assertEqual(d["source"], "deploy-time")
        self.assertTrue(d["required"])
        self.assertFalse(d["show_on_card"])
        self.assertIn("id", d)


class TestTagPolicyCRUD(unittest.TestCase):
    """Test /api/settings/tags CRUD endpoints."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
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

    def tearDown(self):
        self.session.rollback()
        self.session.close()
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

    def test_list_tag_policies_empty(self):
        """Test listing tag policies when none exist."""
        response = self.client.get("/api/settings/tags")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_create_tag_policy(self):
        """Test creating a new tag policy."""
        response = self.client.post("/api/settings/tags", json={
            "key": "environment",
            "default_value": "dev",
            "source": "deploy-time",
            "required": True,
            "show_on_card": False,
        })
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["key"], "environment")
        self.assertEqual(data["default_value"], "dev")
        self.assertEqual(data["source"], "deploy-time")

    def test_create_tag_policy_invalid_source(self):
        """Test creating a tag policy with invalid source."""
        response = self.client.post("/api/settings/tags", json={
            "key": "bad",
            "source": "invalid",
        })
        self.assertEqual(response.status_code, 400)

    def test_create_tag_policy_duplicate_key(self):
        """Test creating a tag policy with duplicate key."""
        self.client.post("/api/settings/tags", json={
            "key": "dup",
            "source": "deploy-time",
        })
        response = self.client.post("/api/settings/tags", json={
            "key": "dup",
            "source": "build-time",
        })
        self.assertEqual(response.status_code, 409)

    def test_update_tag_policy(self):
        """Test updating an existing tag policy."""
        create_resp = self.client.post("/api/settings/tags", json={
            "key": "team",
            "source": "build-time",
            "required": True,
            "show_on_card": True,
        })
        tag_id = create_resp.json()["id"]

        update_resp = self.client.put(f"/api/settings/tags/{tag_id}", json={
            "key": "team",
            "default_value": "platform",
            "source": "build-time",
            "required": False,
            "show_on_card": True,
        })
        self.assertEqual(update_resp.status_code, 200)
        self.assertEqual(update_resp.json()["default_value"], "platform")
        self.assertFalse(update_resp.json()["required"])

    def test_update_tag_policy_not_found(self):
        """Test updating a non-existent tag policy."""
        response = self.client.put("/api/settings/tags/999", json={
            "key": "x",
            "source": "deploy-time",
        })
        self.assertEqual(response.status_code, 404)

    def test_delete_tag_policy(self):
        """Test deleting a tag policy."""
        create_resp = self.client.post("/api/settings/tags", json={
            "key": "temp",
            "source": "deploy-time",
        })
        tag_id = create_resp.json()["id"]

        del_resp = self.client.delete(f"/api/settings/tags/{tag_id}")
        self.assertEqual(del_resp.status_code, 204)

        # Verify deleted
        list_resp = self.client.get("/api/settings/tags")
        self.assertEqual(list_resp.json(), [])

    def test_delete_tag_policy_not_found(self):
        """Test deleting a non-existent tag policy."""
        response = self.client.delete("/api/settings/tags/999")
        self.assertEqual(response.status_code, 404)

    def test_list_tag_policies_returns_all(self):
        """Test listing returns all created tag policies."""
        for key in ["a", "b", "c"]:
            self.client.post("/api/settings/tags", json={
                "key": key,
                "source": "deploy-time",
            })
        response = self.client.get("/api/settings/tags")
        self.assertEqual(len(response.json()), 3)


class TestMergeTags(unittest.TestCase):
    """Test _merge_tags function with tag policies."""

    def test_merge_tags_no_policies(self):
        """Test _merge_tags with no policies returns empty dict."""
        result = _merge_tags()
        self.assertEqual(result, {})

    def test_merge_tags_with_policies(self):
        """Test _merge_tags uses default values from policies."""
        policies = [
            {"key": "loom:application", "default_value": "myapp", "source": "build-time"},
            {"key": "loom:group", "default_value": "platform", "source": "build-time"},
        ]
        result = _merge_tags(tag_policies=policies)
        self.assertEqual(result, {"loom:application": "myapp", "loom:group": "platform"})

    def test_merge_tags_extra_overrides(self):
        """Test _merge_tags extra overrides policy defaults."""
        policies = [
            {"key": "loom:group", "default_value": "old", "source": "build-time"},
        ]
        result = _merge_tags(tag_policies=policies, extra={"loom:group": "new", "custom": "val"})
        self.assertEqual(result["loom:group"], "new")
        self.assertEqual(result["custom"], "val")

    def test_merge_tags_skips_none_defaults(self):
        """Test _merge_tags skips policies without default values."""
        policies = [
            {"key": "app", "default_value": None, "source": "build-time"},
        ]
        result = _merge_tags(tag_policies=policies)
        self.assertNotIn("app", result)


class TestIamTags(unittest.TestCase):
    """Test _iam_tags function with tag policies."""

    def test_iam_tags_with_policies(self):
        """Test _iam_tags returns IAM-format tags from policies."""
        policies = [
            {"key": "loom:application", "default_value": "myapp", "source": "build-time"},
        ]
        result = _iam_tags(tag_policies=policies)
        self.assertEqual(result, [{"Key": "loom:application", "Value": "myapp"}])

    def test_iam_tags_no_policies(self):
        """Test _iam_tags with no policies returns empty list."""
        result = _iam_tags()
        self.assertEqual(result, [])


class TestAgentTagModel(unittest.TestCase):
    """Test Agent model tags column."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=cls.engine)
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)

    def setUp(self):
        self.session = self.TestingSessionLocal()

    def tearDown(self):
        self.session.rollback()
        self.session.close()
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

    def test_get_set_tags(self):
        """Test Agent.get_tags() and set_tags()."""
        agent = Agent(
            arn="arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/tag-test",
            runtime_id="tag-test",
            name="Tag Test",
            region="us-east-1",
            account_id="123456789012",
        )
        self.session.add(agent)
        self.session.commit()

        self.assertEqual(agent.get_tags(), {})

        agent.set_tags({"loom:group": "platform", "loom:owner": "alice"})
        self.session.commit()
        self.session.refresh(agent)

        self.assertEqual(agent.get_tags(), {"loom:group": "platform", "loom:owner": "alice"})

    def test_tags_in_to_dict(self):
        """Test that tags appear in Agent.to_dict() output."""
        agent = Agent(
            arn="arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/dict-test",
            runtime_id="dict-test",
            name="Dict Test",
            region="us-east-1",
            account_id="123456789012",
        )
        agent.set_tags({"loom:application": "myapp"})
        self.session.add(agent)
        self.session.commit()
        self.session.refresh(agent)

        d = agent.to_dict()
        self.assertEqual(d["tags"], {"loom:application": "myapp"})


class TestDeployWithTags(unittest.TestCase):
    """Test tag enforcement during agent deployment."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
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

    def tearDown(self):
        self.session.rollback()
        self.session.close()
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_deploy_with_tags_stored_on_agent(
        self, mock_create_role, mock_build_artifact, mock_create_runtime
    ):
        """Test that tags are resolved and stored on the agent after deployment."""
        # Seed tag policies
        self.session.add(TagPolicy(key="loom:application", default_value=None, source="build-time", required=True, show_on_card=True))
        self.session.add(TagPolicy(key="loom:group", default_value=None, source="build-time", required=True, show_on_card=True))
        self.session.commit()

        mock_create_role.return_value = "arn:aws:iam::123456789012:role/test"
        mock_build_artifact.return_value = ("bucket", "key")
        mock_create_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-tags",
            "agentRuntimeId": "rt-tags",
            "status": "CREATING",
        }

        response = self.client.post("/api/agents", json={
            "source": "deploy",
            "name": "tagged_agent",
            "model_id": "us.anthropic.claude-sonnet-4-6",
            "tags": {"loom:application": "myapp", "loom:group": "platform"},
        })

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["tags"]["loom:application"], "myapp")
        self.assertEqual(data["tags"]["loom:group"], "platform")

    def test_deploy_missing_required_build_time_tag(self):
        """Test that deployment fails when required build-time tags are missing."""
        # Seed tag policies with required build-time tag
        self.session.add(TagPolicy(key="loom:group", default_value=None, source="build-time", required=True))
        self.session.commit()

        response = self.client.post("/api/agents", json={
            "source": "deploy",
            "name": "missing_tag_agent",
            "model_id": "us.anthropic.claude-sonnet-4-6",
        })

        self.assertEqual(response.status_code, 400)
        self.assertIn("Missing required build-time tags", response.json()["detail"])
        self.assertIn("loom:group", response.json()["detail"])

    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_deploy_no_policies_succeeds(
        self, mock_create_role, mock_build_artifact, mock_create_runtime
    ):
        """Test deployment succeeds when no tag policies are configured."""
        mock_create_role.return_value = "arn:aws:iam::123456789012:role/test"
        mock_build_artifact.return_value = ("bucket", "key")
        mock_create_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-notags",
            "agentRuntimeId": "rt-notags",
            "status": "CREATING",
        }

        response = self.client.post("/api/agents", json={
            "source": "deploy",
            "name": "no_policy_agent",
            "model_id": "us.anthropic.claude-sonnet-4-6",
        })

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["tags"], {})

    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_tags_passed_to_create_runtime(
        self, mock_create_role, mock_build_artifact, mock_create_runtime
    ):
        """Test that resolved tags are passed to create_runtime."""
        self.session.add(TagPolicy(key="loom:application", default_value="testapp", source="deploy-time", required=True))
        self.session.commit()

        mock_create_role.return_value = "arn:aws:iam::123456789012:role/test"
        mock_build_artifact.return_value = ("bucket", "key")
        mock_create_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-pass",
            "agentRuntimeId": "rt-pass",
            "status": "CREATING",
        }

        self.client.post("/api/agents", json={
            "source": "deploy",
            "name": "pass_tags_agent",
            "model_id": "us.anthropic.claude-sonnet-4-6",
        })

        call_kwargs = mock_create_runtime.call_args[1]
        self.assertIn("tags", call_kwargs)
        self.assertEqual(call_kwargs["tags"]["loom:application"], "testapp")

    @patch("app.routers.agents.create_runtime")
    @patch("app.routers.agents.build_agent_artifact")
    @patch("app.routers.agents.create_execution_role")
    def test_tags_in_agent_response(
        self, mock_create_role, mock_build_artifact, mock_create_runtime
    ):
        """Test that agent list/detail endpoints include tags."""
        self.session.add(TagPolicy(key="loom:application", default_value="testapp", source="deploy-time", required=True))
        self.session.commit()

        mock_create_role.return_value = "arn:aws:iam::123456789012:role/test"
        mock_build_artifact.return_value = ("bucket", "key")
        mock_create_runtime.return_value = {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-resp",
            "agentRuntimeId": "rt-resp",
            "status": "CREATING",
        }

        create_resp = self.client.post("/api/agents", json={
            "source": "deploy",
            "name": "resp_tags_agent",
            "model_id": "us.anthropic.claude-sonnet-4-6",
        })
        agent_id = create_resp.json()["id"]

        # Get single agent
        get_resp = self.client.get(f"/api/agents/{agent_id}")
        self.assertEqual(get_resp.status_code, 200)
        self.assertIn("tags", get_resp.json())
        self.assertEqual(get_resp.json()["tags"]["loom:application"], "testapp")

        # List agents
        list_resp = self.client.get("/api/agents")
        self.assertEqual(list_resp.status_code, 200)
        agent_data = [a for a in list_resp.json() if a["id"] == agent_id][0]
        self.assertIn("tags", agent_data)


class TestRegisterWithTags(unittest.TestCase):
    """Test tag fetching for registered agents."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
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

    def tearDown(self):
        self.session.rollback()
        self.session.close()
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

    @patch("boto3.client")
    @patch("app.routers.agents.describe_runtime")
    @patch("app.routers.agents.list_runtime_endpoints")
    def test_register_agent_fetches_aws_tags(self, mock_list_ep, mock_describe, mock_boto_client):
        """Test that registering an agent fetches tags from AWS."""
        mock_describe.return_value = {
            "agentRuntimeName": "Tagged Agent",
            "status": "READY",
        }
        mock_list_ep.return_value = ["DEFAULT"]

        mock_control_client = MagicMock()
        mock_boto_client.return_value = mock_control_client
        mock_control_client.list_tags_for_resource.return_value = {
            "tags": {"loom:group": "data", "loom:owner": "bob"},
        }

        response = self.client.post("/api/agents", json={
            "source": "register",
            "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/reg-tags",
        })

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["tags"]["loom:group"], "data")
        self.assertEqual(response.json()["tags"]["loom:owner"], "bob")

    @patch("boto3.client")
    @patch("app.routers.agents.describe_runtime")
    @patch("app.routers.agents.list_runtime_endpoints")
    def test_register_agent_tag_fetch_failure_non_fatal(self, mock_list_ep, mock_describe, mock_boto_client):
        """Test that tag fetch failure doesn't break registration."""
        mock_describe.return_value = {
            "agentRuntimeName": "No Tags Agent",
            "status": "READY",
        }
        mock_list_ep.return_value = ["DEFAULT"]

        mock_control_client = MagicMock()
        mock_boto_client.return_value = mock_control_client
        mock_control_client.list_tags_for_resource.side_effect = Exception("API unavailable")

        response = self.client.post("/api/agents", json={
            "source": "register",
            "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/reg-notags",
        })

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["tags"], {})


if __name__ == "__main__":
    unittest.main()
