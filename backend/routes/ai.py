"""AI routes for CSPM Report Builder - text improvement and summarization."""

from __future__ import annotations

import logging
import os
import threading
from flask import Blueprint, jsonify, request

from backend.services import GeminiService
from backend.services.auth_service import require_role
from backend.utils import compute_risk_score

_log = logging.getLogger(__name__)
ai_bp = Blueprint('ai', __name__)

# Initialize Gemini service (lazy initialization when credentials are available)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODELS = [
    "gemini-2.5-flash",  # Stable production - fast and cost-effective
    "gemini-2.5-pro",    # Stable production - higher quality
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
    except Exception:
        _log.exception("Unexpected error in api_suggest")
        return jsonify({"error": "Internal error"}), 502


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
    except Exception:
        _log.exception("Unexpected error in api_summarize_remediation")
        return jsonify({"error": "Internal error"}), 502


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
    except Exception:
        _log.exception("Unexpected error in api_generate_exec_summary")
        return jsonify({"error": "Internal error"}), 502


@ai_bp.route("/api/generate-key-topics", methods=["POST"])
@require_role("editor")
def api_generate_key_topics():
    """Generate 3-5 concise Hebrew key topics from a findings list using Gemini."""
    if not GEMINI_API_KEY:
        return jsonify({"error": "AI assist not configured — set GEMINI_API_KEY"}), 501
    body = request.get_json(silent=True) or {}
    findings = body.get("findings", [])
    if not isinstance(findings, list) or not findings:
        return jsonify({"error": "findings must be a non-empty list"}), 400
    findings = findings[:500]
    # Sanitize to {title, severity} only
    safe_findings = [
        {"title": str(f.get("title", ""))[:200], "severity": str(f.get("severity", ""))}
        for f in findings
        if isinstance(f, dict)
    ]
    client = str(body.get("client", ""))[:100]
    model = (body.get("model") or "").strip()
    if not model or model not in GEMINI_MODELS:
        model = GEMINI_DEFAULT_MODEL
    try:
        topics, model = get_gemini_service().generate_key_topics(safe_findings, client=client, model=model)
        return jsonify({"topics": topics, "model": model})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except Exception:
        _log.exception("generate_key_topics failed")
        return jsonify({"error": "Internal error"}), 502


@ai_bp.route("/api/generate-regression-trend", methods=["POST"])
@require_role("editor")
def api_generate_regression_trend():
    """Generate a Hebrew regression trend paragraph comparing two consecutive snapshots."""
    if not GEMINI_API_KEY:
        return jsonify({"error": "AI assist not configured (GEMINI_API_KEY not set)"}), 501

    data = request.get_json(silent=True) or {}
    prev_snapshot_data = data.get("prev_snapshot_data")
    curr_findings = data.get("curr_findings")
    zombies = data.get("zombies")
    model = (data.get("model") or "").strip()

    if not isinstance(prev_snapshot_data, dict):
        return jsonify({"error": "prev_snapshot_data must be an object"}), 400
    if not isinstance(curr_findings, list):
        return jsonify({"error": "curr_findings must be a list"}), 400
    if not isinstance(zombies, list):
        return jsonify({"error": "zombies must be a list"}), 400

    prev_findings_raw = prev_snapshot_data.get("findings") or []
    if not isinstance(prev_findings_raw, list):
        return jsonify({"error": "prev_snapshot_data.findings must be a list"}), 400
    if len(curr_findings) > 500:
        return jsonify({"error": "Too many curr_findings (max 500)"}), 400
    if len(prev_findings_raw) > 500:
        return jsonify({"error": "Too many prev_snapshot_data.findings (max 500)"}), 400
    if len(zombies) > 500:
        return jsonify({"error": "Too many zombies (max 500)"}), 400

    if not model or model not in GEMINI_MODELS:
        model = GEMINI_DEFAULT_MODEL

    # Compute current risk score from curr_findings using the shared utility.
    # compute_risk_score expects a snapshot dict with a "findings" key.
    curr_risk_score = compute_risk_score({"findings": curr_findings})

    # Sanitize inputs — keep only safe scalar fields to avoid prompt injection
    safe_prev = {
        "riskScore": prev_snapshot_data.get("riskScore"),
        "findings": [
            {
                "title": (f.get("title") or "")[:200],
                "severity": (f.get("severity") or "")[:20],
                "exception": {"active": bool((f.get("exception") or {}).get("active", False))},
            }
            for f in prev_findings_raw
            if isinstance(f, dict)
        ],
    }

    safe_curr = [
        {
            "title": (f.get("title") or "")[:200],
            "severity": (f.get("severity") or "")[:20],
            "exception": {"active": bool((f.get("exception") or {}).get("active", False))},
        }
        for f in curr_findings
        if isinstance(f, dict)
    ]

    safe_zombies = [
        {
            "title": (z.get("title") or "")[:200],
            "severity": (z.get("severity") or "")[:20],
            "prevStatus": (z.get("prevStatus") or "")[:50],
        }
        for z in zombies
        if isinstance(z, dict)
    ]

    try:
        gemini = get_gemini_service()
        trend_text, used_model = gemini.generate_regression_trend(
            prev_snapshot_data=safe_prev,
            curr_findings=safe_curr,
            zombies=safe_zombies,
            curr_risk_score=curr_risk_score,
            model=model,
        )
        return jsonify({"trend_text": trend_text, "model": used_model})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except Exception:
        _log.exception("Unexpected error in api_generate_regression_trend")
        return jsonify({"error": "Internal error"}), 502


@ai_bp.route("/api/generate-diff-summary", methods=["POST"])
@require_role("viewer")
def api_generate_diff_summary():
    """Generate a Hebrew narrative summary for a version diff comparison."""
    if not GEMINI_API_KEY:
        return jsonify({"error": "AI assist not configured (GEMINI_API_KEY not set)"}), 501

    data = request.get_json(silent=True) or {}
    added_count = data.get("added_count")
    resolved_count = data.get("resolved_count")
    changed_count = data.get("changed_count")
    risk_delta = data.get("risk_delta")
    baseline_risk_score = data.get("baseline_risk_score")
    target_risk_score = data.get("target_risk_score")
    baseline_version = (data.get("baseline_version") or "").strip()
    target_version = (data.get("target_version") or "").strip()
    sample_titles = data.get("sample_titles")
    model = (data.get("model") or "").strip()

    # Validate inputs
    if not isinstance(added_count, int) or added_count < 0:
        return jsonify({"error": "added_count must be a non-negative integer"}), 400
    if not isinstance(resolved_count, int) or resolved_count < 0:
        return jsonify({"error": "resolved_count must be a non-negative integer"}), 400
    if not isinstance(changed_count, int) or changed_count < 0:
        return jsonify({"error": "changed_count must be a non-negative integer"}), 400
    if risk_delta is not None and not isinstance(risk_delta, (int, float)):
        return jsonify({"error": "risk_delta must be a number or null"}), 400
    if baseline_risk_score is not None and not isinstance(baseline_risk_score, (int, float)):
        return jsonify({"error": "baseline_risk_score must be a number or null"}), 400
    if target_risk_score is not None and not isinstance(target_risk_score, (int, float)):
        return jsonify({"error": "target_risk_score must be a number or null"}), 400
    if not baseline_version or not target_version:
        return jsonify({"error": "baseline_version and target_version are required"}), 400
    if len(baseline_version) > 50 or len(target_version) > 50:
        return jsonify({"error": "version strings too long (max 50 chars)"}), 400

    # Sanitize sample_titles
    safe_titles: list[str] = []
    if sample_titles:
        if not isinstance(sample_titles, list):
            return jsonify({"error": "sample_titles must be a list"}), 400
        # Cap at 5 and truncate each title to 150 chars
        for title in sample_titles[:5]:
            if isinstance(title, str):
                safe_titles.append(title[:150])

    # Validate model
    if not model or model not in GEMINI_MODELS:
        model = GEMINI_DEFAULT_MODEL

    try:
        gemini = get_gemini_service()
        summary_text, used_model = gemini.generate_diff_summary(
            added_count=added_count,
            resolved_count=resolved_count,
            changed_count=changed_count,
            risk_delta=int(risk_delta) if risk_delta is not None else None,
            baseline_risk_score=int(baseline_risk_score) if baseline_risk_score is not None else None,
            target_risk_score=int(target_risk_score) if target_risk_score is not None else None,
            baseline_version=baseline_version,
            target_version=target_version,
            sample_titles=safe_titles if safe_titles else None,
            model=model,
        )
        return jsonify({"summary": summary_text, "model": used_model})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except Exception:
        _log.exception("Unexpected error in api_generate_diff_summary")
        return jsonify({"error": "Internal error"}), 502
