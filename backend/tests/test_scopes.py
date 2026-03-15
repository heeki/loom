"""Tests for fine-grained permission scoping (issue #25)."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.dependencies.auth import (
    GROUP_SCOPES,
    ALL_SCOPES,
    UserInfo,
    derive_scopes,
    get_current_user,
    require_scopes,
)


# ---------------------------------------------------------------------------
# Unit tests for auth helpers
# ---------------------------------------------------------------------------
class TestDeriveScopes(unittest.TestCase):
    """Test derive_scopes function."""

    def test_super_admins_get_all_scopes(self) -> None:
        scopes = derive_scopes(["super-admins"])
        self.assertEqual(scopes, ALL_SCOPES)

    def test_users_group_only_has_invoke(self) -> None:
        scopes = derive_scopes(["users"])
        self.assertEqual(scopes, {"invoke"})

    def test_multiple_groups_union(self) -> None:
        scopes = derive_scopes(["security-admins", "memory-admins"])
        self.assertEqual(scopes, {"security:read", "security:write", "memory:read", "memory:write"})

    def test_unknown_group_returns_empty(self) -> None:
        scopes = derive_scopes(["nonexistent-group"])
        self.assertEqual(scopes, set())

    def test_demo_admins_have_all_read_write_except_invoke(self) -> None:
        scopes = derive_scopes(["demo-admins"])
        self.assertNotIn("invoke", scopes)
        self.assertIn("catalog:read", scopes)
        self.assertIn("catalog:write", scopes)
        self.assertIn("agent:read", scopes)
        self.assertIn("agent:write", scopes)

    def test_group_scopes_consistency(self) -> None:
        """Every scope in ALL_SCOPES should appear in at least one group."""
        all_from_groups: set[str] = set()
        for scopes in GROUP_SCOPES.values():
            all_from_groups.update(scopes)
        self.assertEqual(all_from_groups, ALL_SCOPES)


# ---------------------------------------------------------------------------
# Integration tests for scope-guarded endpoints
# ---------------------------------------------------------------------------
class TestScopeEnforcement(unittest.TestCase):
    """Test that endpoints enforce correct scopes."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=cls.engine)
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)

    def setUp(self) -> None:
        self.session = self.TestingSessionLocal()

        def override_get_db():
            try:
                yield self.session
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.session.rollback()
        self.session.close()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

    def _override_user(self, groups: list[str]) -> None:
        """Override get_current_user to return a user with the given groups."""
        user = UserInfo(
            sub="test-sub",
            username="test-user",
            groups=groups,
            scopes=derive_scopes(groups),
        )
        app.dependency_overrides[get_current_user] = lambda: user

    # -- Agents endpoints --
    def test_agents_list_requires_agent_read(self) -> None:
        self._override_user(["users"])  # users only have invoke
        response = self.client.get("/api/agents")
        self.assertEqual(response.status_code, 403)

    def test_agents_list_allowed_with_agent_read(self) -> None:
        self._override_user(["demo-admins"])
        response = self.client.get("/api/agents")
        self.assertEqual(response.status_code, 200)

    # -- Settings endpoints --
    def test_settings_tags_requires_settings_read(self) -> None:
        self._override_user(["memory-admins"])  # no settings scope
        response = self.client.get("/api/settings/tags")
        self.assertEqual(response.status_code, 403)

    def test_settings_tags_allowed_with_settings_read(self) -> None:
        self._override_user(["super-admins"])
        response = self.client.get("/api/settings/tags")
        self.assertEqual(response.status_code, 200)

    # -- Security endpoints --
    def test_security_requires_security_read(self) -> None:
        self._override_user(["users"])
        response = self.client.get("/api/security/roles")
        self.assertEqual(response.status_code, 403)

    def test_security_allowed_with_security_read(self) -> None:
        self._override_user(["security-admins"])
        response = self.client.get("/api/security/roles")
        # May return 200 or 500 depending on AWS config, but NOT 403
        self.assertNotEqual(response.status_code, 403)

    # -- Memory endpoints --
    def test_memories_requires_memory_read(self) -> None:
        self._override_user(["security-admins"])  # no memory scope
        response = self.client.get("/api/memories")
        self.assertEqual(response.status_code, 403)

    def test_memories_allowed_with_memory_read(self) -> None:
        self._override_user(["memory-admins"])
        response = self.client.get("/api/memories")
        self.assertEqual(response.status_code, 200)

    # -- Auth config is public (no scope guard) --
    def test_auth_config_is_public(self) -> None:
        # No user override — but bypass mode should still work
        response = self.client.get("/api/auth/config")
        self.assertEqual(response.status_code, 200)


class TestBypassMode(unittest.TestCase):
    """Test that bypass mode grants all scopes when Cognito is not configured."""

    def setUp(self) -> None:
        self.client = TestClient(app)

    @patch.dict("os.environ", {}, clear=True)
    def test_bypass_mode_returns_all_scopes(self) -> None:
        """When LOOM_COGNITO_USER_POOL_ID is not set, all scopes are granted."""
        response = self.client.get("/api/agents")
        # Should succeed because bypass mode gives all scopes
        self.assertIn(response.status_code, [200, 500])  # 200 or 500 (no AWS), but not 401/403


if __name__ == "__main__":
    unittest.main()
