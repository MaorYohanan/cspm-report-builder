"""Unit tests for GeminiService in backend/services/ai_service.py.

All tests mock _single_api_call — no real HTTP calls are made.

Run with:
    python -m pytest tests/test_ai_service.py -v
"""
from __future__ import annotations

import urllib.error

import pytest
from unittest.mock import patch, MagicMock

from backend.services.ai_service import GeminiService

# A minimal valid model list for test instances
_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash"]
_DEFAULT_MODEL = "gemini-2.0-flash"


def _make_service(api_key: str = "test-api-key", models=None, default_model=None) -> GeminiService:
    return GeminiService(
        api_key=api_key,
        models=models or _MODELS,
        default_model=default_model or _DEFAULT_MODEL,
    )


# ---------------------------------------------------------------------------
# __init__ validation
# ---------------------------------------------------------------------------


class TestGeminiServiceInit:
    def test_raises_value_error_on_empty_api_key(self):
        with pytest.raises(ValueError, match="API key"):
            GeminiService(api_key="", models=_MODELS, default_model=_DEFAULT_MODEL)

    def test_raises_value_error_on_none_api_key(self):
        with pytest.raises(ValueError, match="API key"):
            GeminiService(api_key=None, models=_MODELS, default_model=_DEFAULT_MODEL)

    def test_raises_value_error_when_default_model_not_in_list(self):
        with pytest.raises(ValueError, match="not in models"):
            GeminiService(
                api_key="key",
                models=["gemini-2.0-flash"],
                default_model="gemini-nonexistent-model",
            )

    def test_valid_init_succeeds(self):
        svc = _make_service()
        assert svc.api_key == "test-api-key"
        assert svc.default_model == _DEFAULT_MODEL


# ---------------------------------------------------------------------------
# improve_text validation
# ---------------------------------------------------------------------------


class TestImproveText:
    def test_raises_value_error_on_empty_string(self):
        svc = _make_service()
        with pytest.raises(ValueError, match="empty"):
            svc.improve_text("")

    def test_raises_value_error_on_whitespace_only(self):
        svc = _make_service()
        with pytest.raises(ValueError, match="empty"):
            svc.improve_text("   ")

    def test_raises_value_error_when_text_too_long(self):
        svc = _make_service()
        with pytest.raises(ValueError, match="too long"):
            svc.improve_text("a" * 5001)

    def test_exactly_5000_chars_does_not_raise(self):
        svc = _make_service()
        with patch.object(svc, "_single_api_call", return_value="improved text"):
            result_text, model_used = svc.improve_text("a" * 5000)
        assert result_text == "improved text"
        assert model_used == _DEFAULT_MODEL

    def test_returns_improved_text_and_model_name(self):
        svc = _make_service()
        with patch.object(svc, "_single_api_call", return_value="better phrasing"):
            text, model = svc.improve_text("some security finding text")
        assert text == "better phrasing"
        assert model == _DEFAULT_MODEL

    def test_strips_field_hint_tag_if_echoed(self):
        svc = _make_service()
        # If the model echoes back the [שדה: ...] tag, it should be stripped
        with patch.object(svc, "_single_api_call", return_value="[שדה: title]\nClean output"):
            text, _ = svc.improve_text("original", field_context="title")
        assert text == "Clean output"
        assert "[שדה:" not in text


# ---------------------------------------------------------------------------
# summarize_remediation validation
# ---------------------------------------------------------------------------


class TestSummarizeRemediation:
    def test_raises_value_error_when_both_title_and_remediation_empty(self):
        svc = _make_service()
        with pytest.raises(ValueError, match="title or remediation"):
            svc.summarize_remediation(title="", remediation="")

    def test_succeeds_with_title_only(self):
        svc = _make_service()
        with patch.object(svc, "_single_api_call", return_value="summary text"):
            text, model = svc.summarize_remediation(title="Exposed secret key", remediation="")
        assert text == "summary text"

    def test_succeeds_with_remediation_only(self):
        svc = _make_service()
        with patch.object(svc, "_single_api_call", return_value="remediation summary"):
            text, model = svc.summarize_remediation(
                title="", remediation="Rotate the key immediately."
            )
        assert text == "remediation summary"

    def test_long_remediation_is_truncated_internally(self):
        """A remediation >5000 chars should not raise — the service truncates it internally."""
        svc = _make_service()
        with patch.object(svc, "_single_api_call", return_value="ok") as mock_call:
            svc.summarize_remediation(
                title="Finding", remediation="r" * 6000
            )
        # Verify _single_api_call was invoked (truncation happened silently)
        mock_call.assert_called_once()


# ---------------------------------------------------------------------------
# generate_exec_summary validation
# ---------------------------------------------------------------------------


class TestGenerateExecSummary:
    def test_raises_value_error_on_empty_findings_list(self):
        svc = _make_service()
        with pytest.raises(ValueError, match="empty"):
            svc.generate_exec_summary(findings=[])

    def test_returns_text_and_model_for_valid_findings(self):
        svc = _make_service()
        findings = [
            {"title": "Finding 1", "severity": "critical", "category": "CSPM",
             "exception": {"active": False}},
            {"title": "Finding 2", "severity": "high", "category": "HSPM",
             "exception": {"active": False}},
        ]
        with patch.object(svc, "_single_api_call", return_value="exec summary text"):
            text, model = svc.generate_exec_summary(findings=findings)
        assert text == "exec summary text"
        assert model in _MODELS

    def test_excepted_findings_included_in_call_but_marked(self):
        """Excepted findings must still be passed to the model (they appear with a marker)."""
        svc = _make_service()
        findings = [
            {"title": "Accepted Risk", "severity": "high", "category": "CSPM",
             "exception": {"active": True}},
        ]
        with patch.object(svc, "_single_api_call", return_value="summary") as mock_call:
            svc.generate_exec_summary(findings=findings)
        # The call was made — excepted findings are included in the prompt
        mock_call.assert_called_once()
        call_args = mock_call.call_args
        payload = call_args[0][1]  # second positional arg is payload_dict
        prompt_text = payload["contents"][0]["parts"][0]["text"]
        assert "מוחרג" in prompt_text  # Hebrew marker for excepted

    def test_client_name_included_in_prompt(self):
        svc = _make_service()
        findings = [{"title": "F", "severity": "low", "category": "CSPM",
                     "exception": {"active": False}}]
        with patch.object(svc, "_single_api_call", return_value="summary") as mock_call:
            svc.generate_exec_summary(findings=findings, client="ACME Corp")
        payload = mock_call.call_args[0][1]
        prompt_text = payload["contents"][0]["parts"][0]["text"]
        assert "ACME Corp" in prompt_text

    def test_tone_hint_present_for_low_severity(self):
        """1 critical + 5 high: critical_count=1 < 4 and high_and_above=6 <= 10 → hint added."""
        svc = _make_service()
        findings = (
            [{"title": "C", "severity": "critical", "category": "CSPM",
              "exception": {"active": False}}] * 1
            + [{"title": "H", "severity": "high", "category": "CSPM",
                "exception": {"active": False}}] * 5
        )
        with patch.object(svc, "_single_api_call", return_value="summary") as mock_call:
            svc.generate_exec_summary(findings=findings)
        payload = mock_call.call_args[0][1]
        prompt_text = payload["contents"][0]["parts"][0]["text"]
        assert "[הנחיית טון]" in prompt_text

    def test_tone_hint_absent_for_high_severity(self):
        """5 critical + 10 high: critical_count=5 >= 4 → hint NOT added."""
        svc = _make_service()
        findings = (
            [{"title": "C", "severity": "critical", "category": "CSPM",
              "exception": {"active": False}}] * 5
            + [{"title": "H", "severity": "high", "category": "CSPM",
                "exception": {"active": False}}] * 10
        )
        with patch.object(svc, "_single_api_call", return_value="summary") as mock_call:
            svc.generate_exec_summary(findings=findings)
        payload = mock_call.call_args[0][1]
        prompt_text = payload["contents"][0]["parts"][0]["text"]
        assert "[הנחיית טון]" not in prompt_text


# ---------------------------------------------------------------------------
# _call_gemini 429 model fallback
# ---------------------------------------------------------------------------


class TestModelFallback:
    def test_429_triggers_model_fallback(self):
        """A 429 on model-a must cause immediate fallback to model-b."""
        svc = _make_service(models=["model-a", "model-b"], default_model="model-a")
        http_429 = urllib.error.HTTPError(
            url=None, code=429, msg="Too Many Requests", hdrs=None, fp=None
        )
        with patch.object(svc, "_single_api_call",
                          side_effect=[http_429, "fallback response"]):
            text, model = svc.summarize_remediation(
                title="test finding",
                remediation="fix it now by applying patch X to system Y",
            )
        assert model == "model-b"
        assert text == "fallback response"
