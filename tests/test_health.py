"""Tests for GET /api/health registered directly on app.py.

The health endpoint lives on the main Flask app object (not a blueprint),
so we import the fully-configured app from app.py.

No real Wiz or Gemini credentials are required — env vars are monkeypatched
at test time via pytest's monkeypatch fixture so the os.environ reads inside
api_health() see the desired values.

Run with:
    python -m pytest tests/test_health.py -v
"""
from __future__ import annotations

import os
import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def health_client():
    """Import the full Flask app and return a test client.

    We use scope="module" so the potentially slow app import (DB creation,
    orphan-scan cleanup) only runs once per test module.
    """
    # Ensure no real credentials interfere before importing app
    os.environ.pop("GEMINI_API_KEY", None)
    os.environ.pop("WIZI_CLIENT_ID", None)
    os.environ.pop("WIZI_CLIENT_SECRET", None)
    os.environ.pop("GOOGLE_CLIENT_ID", None)
    os.environ.pop("APP_TOKEN", None)

    from app import app  # noqa: PLC0415 — intentional deferred import

    app.config["TESTING"] = True
    return app.test_client()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestApiHealth:
    def test_status_is_always_ok(self, health_client):
        """The 'status' field must always be 'ok' regardless of env config."""
        response = health_client.get("/api/health")
        assert response.status_code == 200
        data = response.get_json()
        assert data["status"] == "ok"

    def test_ai_enabled_false_when_no_api_key(self, health_client, monkeypatch):
        """ai_enabled must be False when GEMINI_API_KEY is not set."""
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        response = health_client.get("/api/health")
        data = response.get_json()
        assert data["ai_enabled"] is False

    def test_wizi_enabled_false_when_no_wiz_creds(self, health_client, monkeypatch):
        """wizi_enabled must be False when Wiz env vars are not set."""
        monkeypatch.delenv("WIZI_CLIENT_ID", raising=False)
        monkeypatch.delenv("WIZI_CLIENT_SECRET", raising=False)
        response = health_client.get("/api/health")
        data = response.get_json()
        assert data["wizi_enabled"] is False

    def test_wizi_enabled_false_when_only_client_id_set(self, health_client, monkeypatch):
        """wizi_enabled requires BOTH client_id and client_secret."""
        monkeypatch.setenv("WIZI_CLIENT_ID", "dummy-id")
        monkeypatch.delenv("WIZI_CLIENT_SECRET", raising=False)
        response = health_client.get("/api/health")
        data = response.get_json()
        assert data["wizi_enabled"] is False

    def test_wizi_enabled_true_when_both_creds_set(self, health_client, monkeypatch):
        """wizi_enabled must be True when both Wiz env vars are present."""
        monkeypatch.setenv("WIZI_CLIENT_ID", "dummy-id")
        monkeypatch.setenv("WIZI_CLIENT_SECRET", "dummy-secret")
        response = health_client.get("/api/health")
        data = response.get_json()
        assert data["wizi_enabled"] is True

    def test_ai_models_key_present_when_api_key_set(self, health_client, monkeypatch):
        """ai_models must be present in the response when GEMINI_API_KEY is set."""
        monkeypatch.setenv("GEMINI_API_KEY", "dummy-gemini-key")
        response = health_client.get("/api/health")
        data = response.get_json()
        assert data["ai_enabled"] is True
        assert "ai_models" in data
        assert isinstance(data["ai_models"], list)

    def test_ai_models_key_absent_when_no_api_key(self, health_client, monkeypatch):
        """ai_models must NOT be present when GEMINI_API_KEY is not set."""
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        response = health_client.get("/api/health")
        data = response.get_json()
        assert "ai_models" not in data

    def test_response_is_json(self, health_client):
        """Response Content-Type must be application/json."""
        response = health_client.get("/api/health")
        assert "application/json" in response.content_type

    def test_no_auth_required(self, health_client):
        """/api/health must return 200 without any auth token."""
        response = health_client.get("/api/health")
        assert response.status_code == 200
