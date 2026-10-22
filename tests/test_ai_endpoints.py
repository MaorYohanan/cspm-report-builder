"""Integration tests for AI routes in backend/routes/ai.py.

Tests the /api/generate-diff-summary endpoint with a Flask test client.

Run with:
    python -m pytest tests/test_ai_endpoints.py -v
"""
from __future__ import annotations

import os
import pytest
from unittest.mock import patch, MagicMock
from flask import Flask

import backend.routes.ai as ai_module


@pytest.fixture
def app():
    """Flask application with AI blueprint registered."""
    application = Flask(__name__)
    application.config["TESTING"] = True

    # Patch GEMINI_API_KEY at module level
    with patch.object(ai_module, 'GEMINI_API_KEY', 'test-key'):
        application.register_blueprint(ai_module.ai_bp)
        yield application


@pytest.fixture
def app_no_key():
    """Flask application with no GEMINI_API_KEY."""
    application = Flask(__name__)
    application.config["TESTING"] = True

    # Patch GEMINI_API_KEY to empty string
    with patch.object(ai_module, 'GEMINI_API_KEY', ''):
        application.register_blueprint(ai_module.ai_bp)
        yield application


@pytest.fixture
def client(app):
    """Flask test client."""
    return app.test_client()


@pytest.fixture
def client_no_key(app_no_key):
    """Flask test client with no API key."""
    return app_no_key.test_client()


@pytest.fixture
def mock_gemini_service():
    """Mock GeminiService for testing without real API calls."""
    with patch.object(ai_module, 'get_gemini_service') as mock_get_service:
        mock_service = MagicMock()
        mock_get_service.return_value = mock_service
        yield mock_service


# ---------------------------------------------------------------------------
# /api/generate-diff-summary endpoint tests
# ---------------------------------------------------------------------------


class TestGenerateDiffSummary:
    """Tests for the /api/generate-diff-summary endpoint (BL-29)."""

    def test_happy_path_with_valid_diff_stats(self, client, mock_gemini_service):
        """Valid diff stats + sample titles → 200 with Hebrew summary text."""
        # Arrange
        mock_gemini_service.generate_diff_summary.return_value = (
            "הדוח החדש כולל 5 ממצאים חדשים ו-2 ממצאים שנסגרו.",
            "gemini-2.5-flash"
        )

        payload = {
            "added_count": 5,
            "resolved_count": 2,
            "changed_count": 3,
            "risk_delta": 10,
            "baseline_version": "1.0",
            "target_version": "1.1",
            "sample_titles": ["ממצא אבטחה 1", "ממצא אבטחה 2"],
            "model": "gemini-2.5-flash"
        }

        # Act
        rv = client.post("/api/generate-diff-summary", json=payload)

        # Assert
        assert rv.status_code == 200
        body = rv.get_json()
        assert "summary" in body
        assert body["summary"] == "הדוח החדש כולל 5 ממצאים חדשים ו-2 ממצאים שנסגרו."
        assert body["model"] == "gemini-2.5-flash"

        # Verify service was called with correct args
        mock_gemini_service.generate_diff_summary.assert_called_once()
        call_kwargs = mock_gemini_service.generate_diff_summary.call_args.kwargs
        assert call_kwargs["added_count"] == 5
        assert call_kwargs["resolved_count"] == 2
        assert call_kwargs["changed_count"] == 3
        assert call_kwargs["risk_delta"] == 10
        assert call_kwargs["baseline_version"] == "1.0"
        assert call_kwargs["target_version"] == "1.1"
        assert call_kwargs["sample_titles"] == ["ממצא אבטחה 1", "ממצא אבטחה 2"]

    def test_negative_added_count_returns_400(self, client):
        """Negative added_count → 400."""
        payload = {
            "added_count": -1,
            "resolved_count": 0,
            "changed_count": 0,
            "baseline_version": "1.0",
            "target_version": "1.1"
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 400
        assert "added_count must be a non-negative integer" in rv.get_json()["error"]

    def test_negative_resolved_count_returns_400(self, client):
        """Negative resolved_count → 400."""
        payload = {
            "added_count": 0,
            "resolved_count": -5,
            "changed_count": 0,
            "baseline_version": "1.0",
            "target_version": "1.1"
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 400
        assert "resolved_count must be a non-negative integer" in rv.get_json()["error"]

    def test_negative_changed_count_returns_400(self, client):
        """Negative changed_count → 400."""
        payload = {
            "added_count": 0,
            "resolved_count": 0,
            "changed_count": -3,
            "baseline_version": "1.0",
            "target_version": "1.1"
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 400
        assert "changed_count must be a non-negative integer" in rv.get_json()["error"]

    def test_version_too_long_returns_400(self, client):
        """Version string >50 chars → 400."""
        payload = {
            "added_count": 1,
            "resolved_count": 0,
            "changed_count": 0,
            "baseline_version": "1.0",
            "target_version": "x" * 51  # 51 chars
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 400
        assert "version strings too long" in rv.get_json()["error"]

    def test_sample_titles_capped_to_5_items(self, client, mock_gemini_service):
        """sample_titles with >5 items gets capped to 5."""
        mock_gemini_service.generate_diff_summary.return_value = (
            "סיכום",
            "gemini-2.5-flash"
        )

        payload = {
            "added_count": 10,
            "resolved_count": 0,
            "changed_count": 0,
            "baseline_version": "1.0",
            "target_version": "1.1",
            "sample_titles": ["title1", "title2", "title3", "title4", "title5", "title6", "title7"]
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 200

        # Verify service received only 5 titles
        call_kwargs = mock_gemini_service.generate_diff_summary.call_args.kwargs
        assert len(call_kwargs["sample_titles"]) == 5

    def test_sample_titles_truncated_to_150_chars(self, client, mock_gemini_service):
        """Each sample title is truncated to 150 chars (not 200)."""
        mock_gemini_service.generate_diff_summary.return_value = (
            "סיכום",
            "gemini-2.5-flash"
        )

        long_title = "x" * 200  # 200 chars
        payload = {
            "added_count": 1,
            "resolved_count": 0,
            "changed_count": 0,
            "baseline_version": "1.0",
            "target_version": "1.1",
            "sample_titles": [long_title]
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 200

        # Verify title was truncated to 150 chars
        call_kwargs = mock_gemini_service.generate_diff_summary.call_args.kwargs
        assert len(call_kwargs["sample_titles"][0]) == 150

    def test_missing_gemini_api_key_returns_501(self, client_no_key):
        """GEMINI_API_KEY unset → 501."""
        payload = {
            "added_count": 1,
            "resolved_count": 0,
            "changed_count": 0,
            "baseline_version": "1.0",
            "target_version": "1.1"
        }

        rv = client_no_key.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 501
        assert "AI assist not configured" in rv.get_json()["error"]

    def test_gemini_failure_returns_502(self, client, mock_gemini_service):
        """Gemini service raises RuntimeError → 502."""
        mock_gemini_service.generate_diff_summary.side_effect = RuntimeError("Gemini API failed")

        payload = {
            "added_count": 1,
            "resolved_count": 0,
            "changed_count": 0,
            "baseline_version": "1.0",
            "target_version": "1.1"
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 502
        assert "Gemini API failed" in rv.get_json()["error"]

    def test_empty_diff_returns_valid_summary(self, client, mock_gemini_service):
        """0/0/0 counts → valid summary (Gemini handles gracefully)."""
        mock_gemini_service.generate_diff_summary.return_value = (
            "לא חלו שינויים בין הגרסאות",
            "gemini-2.5-flash"
        )

        payload = {
            "added_count": 0,
            "resolved_count": 0,
            "changed_count": 0,
            "baseline_version": "1.0",
            "target_version": "1.1"
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 200
        body = rv.get_json()
        assert "summary" in body
        assert body["summary"] == "לא חלו שינויים בין הגרסאות"

    def test_null_risk_delta_handled_correctly(self, client, mock_gemini_service):
        """Null risk_delta is accepted and passed to service as None."""
        mock_gemini_service.generate_diff_summary.return_value = (
            "סיכום",
            "gemini-2.5-flash"
        )

        payload = {
            "added_count": 1,
            "resolved_count": 0,
            "changed_count": 0,
            "risk_delta": None,
            "baseline_version": "1.0",
            "target_version": "1.1"
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 200

        # Verify None was passed to service
        call_kwargs = mock_gemini_service.generate_diff_summary.call_args.kwargs
        assert call_kwargs["risk_delta"] is None

    def test_invalid_risk_delta_type_returns_400(self, client):
        """risk_delta as string → 400."""
        payload = {
            "added_count": 1,
            "resolved_count": 0,
            "changed_count": 0,
            "risk_delta": "invalid",
            "baseline_version": "1.0",
            "target_version": "1.1"
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 400
        assert "risk_delta must be a number or null" in rv.get_json()["error"]

    def test_missing_baseline_version_returns_400(self, client):
        """Missing baseline_version → 400."""
        payload = {
            "added_count": 1,
            "resolved_count": 0,
            "changed_count": 0,
            "target_version": "1.1"
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 400
        assert "baseline_version and target_version are required" in rv.get_json()["error"]

    def test_missing_target_version_returns_400(self, client):
        """Missing target_version → 400."""
        payload = {
            "added_count": 1,
            "resolved_count": 0,
            "changed_count": 0,
            "baseline_version": "1.0"
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 400
        assert "baseline_version and target_version are required" in rv.get_json()["error"]

    def test_value_error_from_service_returns_400(self, client, mock_gemini_service):
        """Service raises ValueError → 400."""
        mock_gemini_service.generate_diff_summary.side_effect = ValueError("Invalid input")

        payload = {
            "added_count": 1,
            "resolved_count": 0,
            "changed_count": 0,
            "baseline_version": "1.0",
            "target_version": "1.1"
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 400
        assert "Invalid input" in rv.get_json()["error"]

    def test_generic_exception_returns_502(self, client, mock_gemini_service):
        """Unexpected exception → 502."""
        mock_gemini_service.generate_diff_summary.side_effect = Exception("Unexpected error")

        payload = {
            "added_count": 1,
            "resolved_count": 0,
            "changed_count": 0,
            "baseline_version": "1.0",
            "target_version": "1.1"
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 502
        assert "Internal error" in rv.get_json()["error"]

    def test_sample_titles_non_list_returns_400(self, client):
        """sample_titles as non-list → 400."""
        payload = {
            "added_count": 1,
            "resolved_count": 0,
            "changed_count": 0,
            "baseline_version": "1.0",
            "target_version": "1.1",
            "sample_titles": "not a list"
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 400
        assert "sample_titles must be a list" in rv.get_json()["error"]

    def test_sample_titles_with_non_string_items_ignored(self, client, mock_gemini_service):
        """Non-string items in sample_titles are filtered out."""
        mock_gemini_service.generate_diff_summary.return_value = (
            "סיכום",
            "gemini-2.5-flash"
        )

        payload = {
            "added_count": 1,
            "resolved_count": 0,
            "changed_count": 0,
            "baseline_version": "1.0",
            "target_version": "1.1",
            "sample_titles": ["valid", 123, None, "another valid", {"key": "value"}]
        }

        rv = client.post("/api/generate-diff-summary", json=payload)

        assert rv.status_code == 200

        # Only string items should be passed
        call_kwargs = mock_gemini_service.generate_diff_summary.call_args.kwargs
        assert call_kwargs["sample_titles"] == ["valid", "another valid"]
