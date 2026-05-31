"""
Unit tests for GeminiService (backend/services/ai_service.py).

Tests cover:
- Text improvement success and error scenarios
- Remediation summarization
- Model fallback on 429 rate limit errors
- API error handling
"""

import json
import urllib.error
import urllib.request
from io import BytesIO
from unittest.mock import Mock, patch, MagicMock

import pytest

from backend.services.ai_service import GeminiService


@pytest.fixture
def gemini_service():
    """Create a GeminiService instance for testing."""
    return GeminiService(
        api_key="test-api-key-12345",
        models=["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
        timeout=30,
        max_retries=3
    )


class TestImproveText:
    """Tests for the improve_text method."""

    def test_improve_text_success(self, gemini_service):
        """Test successful text improvement."""
        mock_response = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": "משתמשי IAM לא מאובטחים כראוי במערכת"}
                        ]
                    }
                }
            ]
        }

        mock_urlopen = MagicMock()
        mock_urlopen.__enter__ = Mock(
            return_value=Mock(read=Mock(return_value=json.dumps(mock_response).encode("utf-8")))
        )
        mock_urlopen.__exit__ = Mock(return_value=False)

        with patch("urllib.request.urlopen", return_value=mock_urlopen):
            result, model_used = gemini_service.improve_text(
                text="IAM users are not secure",
                field_context="title"
            )

            assert result == "משתמשי IAM לא מאובטחים כראוי במערכת"
            assert model_used == "gemini-2.0-flash"

    def test_improve_text_api_error(self, gemini_service):
        """Test improve_text handling API error (400 bad request)."""
        error_body = json.dumps({
            "error": {
                "code": 400,
                "message": "Invalid request format",
                "status": "INVALID_ARGUMENT"
            }
        })

        mock_http_error = urllib.error.HTTPError(
            url="https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
            code=400,
            msg="Bad Request",
            hdrs={},
            fp=BytesIO(error_body.encode("utf-8"))
        )

        with patch("urllib.request.urlopen", side_effect=mock_http_error):
            with pytest.raises(RuntimeError, match="API error 400"):
                gemini_service.improve_text(text="test text")


class TestSummarizeRemediation:
    """Tests for the summarize_remediation method."""

    def test_summarize_remediation(self, gemini_service):
        """Test successful remediation summarization."""
        mock_response = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": "הסיכון: משתמשי IAM ללא MFA חשופים להשתלטות על חשבון. "
                                "התיקון: הפעלת MFA מונעת גישה לא מורשית גם אם הסיסמה נחשפה. "
                                "ללא תיקון: תוקף יכול לגשת למשאבים רגישים עם סיסמה בלבד."
                            }
                        ]
                    }
                }
            ]
        }

        mock_urlopen = MagicMock()
        mock_urlopen.__enter__ = Mock(
            return_value=Mock(read=Mock(return_value=json.dumps(mock_response).encode("utf-8")))
        )
        mock_urlopen.__exit__ = Mock(return_value=False)

        with patch("urllib.request.urlopen", return_value=mock_urlopen):
            result, model_used = gemini_service.summarize_remediation(
                title="IAM users without MFA",
                description="Users can access without multi-factor authentication",
                remediation="Enable MFA for all IAM users in the AWS console"
            )

            assert "MFA" in result
            assert "IAM" in result
            assert model_used == "gemini-2.0-flash"


class TestModelFallback:
    """Tests for model fallback behavior on 429 rate limit errors."""

    def test_model_fallback_on_429_error(self, gemini_service):
        """Test that service falls back to next model on 429 rate limit error."""
        # First call returns 429, second call succeeds
        error_body = json.dumps({
            "error": {
                "code": 429,
                "message": "Resource exhausted",
                "status": "RESOURCE_EXHAUSTED"
            }
        })

        mock_http_error = urllib.error.HTTPError(
            url="https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
            code=429,
            msg="Too Many Requests",
            hdrs={},
            fp=BytesIO(error_body.encode("utf-8"))
        )

        success_response = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": "סיכום תיקון מוצלח"}
                        ]
                    }
                }
            ]
        }

        # Mock urlopen to fail first, then succeed
        call_count = 0

        def urlopen_side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1

            if call_count == 1:
                # First model fails with 429
                raise mock_http_error
            else:
                # Second model succeeds
                mock_urlopen = MagicMock()
                mock_urlopen.__enter__ = Mock(
                    return_value=Mock(read=Mock(return_value=json.dumps(success_response).encode("utf-8")))
                )
                mock_urlopen.__exit__ = Mock(return_value=False)
                return mock_urlopen

        with patch("urllib.request.urlopen", side_effect=urlopen_side_effect):
            # summarize_remediation has enable_fallback=True
            result, model_used = gemini_service.summarize_remediation(
                title="Test finding",
                remediation="Test remediation steps"
            )

            assert result == "סיכום תיקון מוצלח"
            # Should have fallen back to second model
            assert model_used == "gemini-2.5-flash"
            assert call_count == 2
