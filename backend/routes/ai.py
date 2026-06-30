"""AI routes for CSPM Report Builder - text improvement and summarization."""

from __future__ import annotations

import os
import threading
from flask import Blueprint, jsonify, request

from backend.services import GeminiService
from backend.services.auth_service import require_role

ai_bp = Blueprint('ai', __name__)

# Initialize Gemini service (lazy initialization when credentials are available)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash-exp",
    "gemini-2.5-pro",
]
GEMINI_DEFAULT_MODEL = GEMINI_MODELS[0]  # gemini-2.5-flash

_gemini_service: GeminiService | None = None
_gemini_lock = threading.Lock()


def get_gemini_service() -> GeminiService:
    """Get or create the Gemini service instance (thread-safe)."""
    global _gemini_service
    if _gemini_service is None:
        with _gemini_lock:
            if _gemini_service is None:
                if not GEMINI_API_KEY:
                    raise RuntimeError("Gemini API key not configured")
                _gemini_service = GeminiService(
                    api_key=GEMINI_API_KEY,
                    models=GEMINI_MODELS,
                    default_model=GEMINI_DEFAULT_MODEL,
                )
    return _gemini_service


@ai_bp.route("/api/suggest", methods=["POST"])
@require_role("editor")
def api_suggest():
    """Send text to Gemini for phrasing improvement."""
    if not GEMINI_API_KEY:
        return jsonify({"error": "AI assist not configured (GEMINI_API_KEY not set)"}), 501

    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    field_hint = (data.get("field") or "").strip()
    model = (data.get("model") or "").strip()

    if not text:
        return jsonify({"error": "No text provided"}), 400

    # Validate model against whitelist
    if not model or model not in GEMINI_MODELS:
        model = GEMINI_DEFAULT_MODEL

    try:
        gemini = get_gemini_service()
        suggestion, used_model = gemini.improve_text(
            text=text,
            field_context=field_hint,
            model=model
        )
        return jsonify({"suggestion": suggestion, "model": used_model})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@ai_bp.route("/api/summarize-remediation", methods=["POST"])
@require_role("editor")
def api_summarize_remediation():
    """Summarize remediation instructions using AI."""
    if not GEMINI_API_KEY:
        return jsonify({"error": "AI not configured"}), 501

    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip()
    model = (data.get("model") or "").strip()

    if not text and not title:
        return jsonify({"error": "No text provided"}), 400

    # Validate model
    if not model or model not in GEMINI_MODELS:
        model = GEMINI_DEFAULT_MODEL

    try:
        gemini = get_gemini_service()
        summary, used_model = gemini.summarize_remediation(
            title=title,
            description=description,
            remediation=text,
            model=model
        )
        return jsonify({"summary": summary, "model": used_model})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@ai_bp.route("/api/generate-exec-summary", methods=["POST"])
@require_role("editor")
def api_generate_exec_summary():
    """Generate an executive summary from the full findings list using Gemini."""
    if not GEMINI_API_KEY:
        return jsonify({"error": "AI assist not configured (GEMINI_API_KEY not set)"}), 501

    data = request.get_json(silent=True) or {}
    findings = data.get("findings") or []
    client = (data.get("client") or "").strip()
    model = (data.get("model") or "").strip()

    if not isinstance(findings, list) or not findings:
        return jsonify({"error": "findings must be a non-empty list"}), 400
    if len(findings) > 500:
        return jsonify({"error": "Too many findings (max 500)"}), 400

    if not model or model not in GEMINI_MODELS:
        model = GEMINI_DEFAULT_MODEL

    safe_findings = [
        {
            "title": (f.get("title") or "")[:200],
            "severity": f.get("severity", ""),
            "category": f.get("category", ""),
            "exception": {"active": bool((f.get("exception") or {}).get("active", False))},
        }
        for f in findings
        if isinstance(f, dict)
    ]

    if not safe_findings:
        return jsonify({"error": "findings must contain at least one valid finding object"}), 400

    try:
        gemini = get_gemini_service()
        summary, used_model = gemini.generate_exec_summary(
            findings=safe_findings,
            client=client,
            model=model
        )
        return jsonify({"summary": summary, "model": used_model})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502
