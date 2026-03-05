"""
CSPM Report Builder – Flask backend for cloud deployment.

Endpoints:
  GET  /                     → serves the builder UI
  POST /api/render-pdf       → accepts JSON state, returns PDF
  POST /api/upload-state     → upload a JSON state file, returns its id
  GET  /api/download-state/<id> → download a previously uploaded state
  GET  /api/list-states      → list available state files
  POST /api/upload-html      → upload an HTML report file
  GET  /api/download-output/<filename> → download any file from output/
  GET  /api/list-outputs     → list files in output/
"""

from __future__ import annotations

import functools
import hashlib
import hmac
import json
import os
import secrets
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict

from flask import (
    Flask,
    Response,
    jsonify,
    render_template,
    request,
    send_file,
    send_from_directory,
)

app = Flask(
    __name__,
    static_folder="static",
    static_url_path="/static",
    template_folder="templates",
)

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "output"
STATES_DIR = UPLOAD_DIR / "states"

for d in (UPLOAD_DIR, OUTPUT_DIR, STATES_DIR):
    d.mkdir(parents=True, exist_ok=True)

MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50 MB
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

# ---------------------------------------------------------------------------
# Optional token-based auth (set APP_TOKEN env var to enable)
# ---------------------------------------------------------------------------

import urllib.request
import urllib.error

APP_TOKEN = os.environ.get("APP_TOKEN", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")


def check_auth() -> bool:
    """Return True if auth passes (no token set = open access)."""
    if not APP_TOKEN:
        return True
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return hmac.compare_digest(header[7:], APP_TOKEN)
    # Also check query param for browser-based downloads
    return hmac.compare_digest(request.args.get("token", ""), APP_TOKEN)


@app.before_request
def enforce_auth():
    """Block unauthenticated requests when APP_TOKEN is set."""
    if not APP_TOKEN:
        return None
    # Health check is always open
    if request.path == "/api/health":
        return None
    if not check_auth():
        return Response("Unauthorized", 401, {"WWW-Authenticate": "Bearer"})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_filename(name: str) -> str:
    """Strip path separators to prevent directory traversal."""
    return Path(name).name


# ---------------------------------------------------------------------------
# PDF rendering (reuses logic from render_pdf_playwright.py)
# ---------------------------------------------------------------------------

def build_header(meta: Dict[str, Any]) -> str:
    client = meta.get("client") or "__________"
    env = meta.get("env") or "__________"
    report_date = meta.get("reportDate") or "DD/MM/YYYY"
    consultant = meta.get("consultant") or ""
    team_name = meta.get("teamName") or "CSPM Report"
    return f"""
    <div style="width:100%;box-sizing:border-box;padding:0 15mm;font-family:Arial;font-size:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;color:#0b3c5d;">
        <div>
          <div style="font-weight:700;font-size:11px;">{team_name}</div>
          <div style="color:#64748b;">{client} · {env}</div>
        </div>
        <div style="text-align:left;">
          <div style="color:#64748b;">תאריך הדו״ח: {report_date}</div>
          <div style="font-weight:700;">{consultant}</div>
        </div>
      </div>
      <div style="border-bottom:1px solid #cbd5e1;margin-top:6px;"></div>
    </div>"""


def build_footer(meta: Dict[str, Any]) -> str:
    report_date = meta.get("reportDate") or "DD/MM/YYYY"
    footer_text = meta.get("footerText") or ""
    return f"""
    <div style="width:100%;box-sizing:border-box;padding:0 15mm;font-family:Arial;font-size:10px;">
      <div style="border-top:1px solid #cbd5e1;margin-bottom:6px;"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;color:#64748b;">
        <div>{footer_text}</div>
        <div>תאריך הדו״ח: {report_date}</div>
        <div>עמוד <span class="pageNumber"></span> מתוך <span class="totalPages"></span></div>
      </div>
    </div>"""


CLEAN_PRINT_CSS = r"""
@media print {
  .print-header, .print-footer { display: none !important; }
  html, body { height: auto !important; }
  body { margin: 0 !important; padding: 0 !important; overflow: visible !important; }
  .report-content, .page-section, .finding-card { overflow: visible !important; }
  .page-section { box-shadow: none !important; border-radius: 0 !important; }
  .page-section { break-after: page !important; page-break-after: always !important; }
  .page-section:last-child { break-after: auto !important; page-break-after: auto !important; }
  .finding-card { break-inside: avoid !important; page-break-inside: avoid !important; }
}
"""


def render_pdf_from_html(html_content: str, meta: Dict[str, Any]) -> bytes:
    """Render HTML string to PDF bytes using Playwright."""
    from playwright.sync_api import sync_playwright

    with tempfile.TemporaryDirectory() as tmpdir:
        html_path = Path(tmpdir) / "report.html"
        pdf_path = Path(tmpdir) / "report.pdf"
        html_path.write_text(html_content, encoding="utf-8")

        header = build_header(meta)
        footer = build_footer(meta)

        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(html_path.as_uri(), wait_until="load")
            page.add_style_tag(content=CLEAN_PRINT_CSS)
            page.pdf(
                path=str(pdf_path),
                format="A4",
                print_background=True,
                display_header_footer=True,
                header_template=header,
                footer_template=footer,
                margin={
                    "top": "50mm",
                    "bottom": "28mm",
                    "left": "15mm",
                    "right": "15mm",
                },
            )
            browser.close()

        return pdf_path.read_bytes()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Serve the builder UI."""
    return send_file(BASE_DIR / "index.html")


@app.route("/assets/<path:filename>")
def serve_assets(filename: str):
    """Serve report assets (CSS used by generated reports)."""
    return send_from_directory(BASE_DIR / "assets", filename)


@app.route("/api/render-pdf", methods=["POST"])
def api_render_pdf():
    """
    Accept JSON body with { html: "<full report html>", meta: {...} }
    Return the rendered PDF file.
    """
    data = request.get_json(force=True)
    html_content = data.get("html", "")
    meta = data.get("meta", {})

    if not html_content:
        return jsonify({"error": "Missing 'html' field"}), 400

    try:
        pdf_bytes = render_pdf_from_html(html_content, meta)
    except Exception as e:
        return jsonify({"error": f"PDF rendering failed: {e}"}), 500

    # Also save to output/
    out_name = f"cspm_report_{uuid.uuid4().hex[:8]}.pdf"
    out_path = OUTPUT_DIR / out_name
    out_path.write_bytes(pdf_bytes)

    return send_file(
        out_path,
        mimetype="application/pdf",
        as_attachment=True,
        download_name="cspm_report.pdf",
    )


@app.route("/api/upload-state", methods=["POST"])
def api_upload_state():
    """Upload a JSON state file. Accepts multipart file or raw JSON body."""
    if "file" in request.files:
        f = request.files["file"]
        content = f.read().decode("utf-8")
    else:
        content = request.get_data(as_text=True)

    # Validate JSON
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON"}), 400

    state_id = uuid.uuid4().hex[:12]
    filename = f"state_{state_id}.json"
    (STATES_DIR / filename).write_text(
        json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return jsonify({"id": state_id, "filename": filename}), 201


@app.route("/api/download-state/<state_id>")
def api_download_state(state_id: str):
    """Download a previously uploaded state file."""
    safe_id = _safe_filename(state_id)
    filename = f"state_{safe_id}.json"
    path = STATES_DIR / filename
    if not path.exists():
        return jsonify({"error": "State not found"}), 404
    return send_file(path, mimetype="application/json", as_attachment=True,
                     download_name="cspm_report_state.json")


@app.route("/api/list-states")
def api_list_states():
    """List all uploaded state files."""
    states = []
    for f in sorted(STATES_DIR.glob("state_*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            meta = data.get("meta", {})
        except Exception:
            meta = {}
        states.append({
            "id": f.stem.replace("state_", ""),
            "filename": f.name,
            "client": meta.get("client", ""),
            "reportDate": meta.get("reportDate", ""),
            "size": f.stat().st_size,
        })
    return jsonify(states)


@app.route("/api/upload-html", methods=["POST"])
def api_upload_html():
    """Upload an HTML report to the output folder."""
    if "file" in request.files:
        f = request.files["file"]
        content = f.read()
        original_name = _safe_filename(f.filename or "report.html")
    else:
        content = request.get_data()
        original_name = "report.html"

    stem = Path(original_name).stem
    suffix = Path(original_name).suffix or ".html"
    out_name = f"{stem}_{uuid.uuid4().hex[:8]}{suffix}"
    out_path = OUTPUT_DIR / out_name
    out_path.write_bytes(content)

    return jsonify({"filename": out_name}), 201


@app.route("/api/download-output/<filename>")
def api_download_output(filename: str):
    """Download a file from the output directory."""
    safe = _safe_filename(filename)
    path = OUTPUT_DIR / safe
    if not path.exists():
        return jsonify({"error": "File not found"}), 404
    return send_file(path, as_attachment=True, download_name=safe)


@app.route("/api/list-outputs")
def api_list_outputs():
    """List all files in the output directory."""
    files = []
    for f in sorted(OUTPUT_DIR.iterdir()):
        if f.is_file():
            files.append({
                "filename": f.name,
                "size": f.stat().st_size,
                "type": f.suffix.lstrip("."),
            })
    return jsonify(files)


@app.route("/api/delete-state/<state_id>", methods=["DELETE"])
def api_delete_state(state_id: str):
    """Delete a state file."""
    safe_id = _safe_filename(state_id)
    path = STATES_DIR / f"state_{safe_id}.json"
    if not path.exists():
        return jsonify({"error": "State not found"}), 404
    path.unlink()
    return jsonify({"deleted": True})


@app.route("/api/delete-output/<filename>", methods=["DELETE"])
def api_delete_output(filename: str):
    """Delete an output file."""
    safe = _safe_filename(filename)
    path = OUTPUT_DIR / safe
    if not path.exists():
        return jsonify({"error": "File not found"}), 404
    path.unlink()
    return jsonify({"deleted": True})


@app.route("/api/health")
def api_health():
    """Health check for container orchestration."""
    result = {"status": "ok", "ai_enabled": bool(GEMINI_API_KEY)}
    if GEMINI_API_KEY:
        result["ai_models"] = GEMINI_MODELS
        result["ai_default_model"] = GEMINI_DEFAULT_MODEL
    return jsonify(result)


# ---------------------------------------------------------------------------
# AI writing assistant (optional – set GEMINI_API_KEY env var)
# ---------------------------------------------------------------------------

GEMINI_MODELS = [
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
]
GEMINI_DEFAULT_MODEL = GEMINI_MODELS[0]

GEMINI_SYSTEM_PROMPT = (
    "You are a senior cloud security consultant writing a CSPM assessment report. "
    "Your task is to improve the phrasing of the given text. "
    "Rules:\n"
    "- Write in professional Hebrew. Use common English technical terms as-is "
    "(e.g. IAM, S3 Bucket, RBAC, VPC, MFA, encryption at rest) — do not translate them.\n"
    "- Be concise and precise. Avoid filler words.\n"
    "- Use formal but readable tone suitable for a security report delivered to management.\n"
    "- Preserve the original meaning and all technical details.\n"
    "- Return ONLY the improved text, nothing else. No explanations, no markdown."
)


@app.route("/api/suggest", methods=["POST"])
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

    if len(text) > 5000:
        return jsonify({"error": "Text too long (max 5000 chars)"}), 400

    # Validate model against whitelist
    if not model or model not in GEMINI_MODELS:
        model = GEMINI_DEFAULT_MODEL

    user_prompt = text
    if field_hint:
        user_prompt = f"[שדה: {field_hint}]\n{text}"

    payload = json.dumps({
        "contents": [{
            "parts": [{"text": user_prompt}]
        }],
        "systemInstruction": {
            "parts": [{"text": GEMINI_SYSTEM_PROMPT}]
        },
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 2048,
        }
    }).encode("utf-8")

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={GEMINI_API_KEY}"
    )

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        candidates = result.get("candidates", [])
        if not candidates:
            return jsonify({"error": "No response from model"}), 502
        parts = candidates[0].get("content", {}).get("parts", [])
        suggestion = parts[0].get("text", "").strip() if parts else ""
        if not suggestion:
            return jsonify({"error": "Empty response from model"}), 502
        return jsonify({"suggestion": suggestion})
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return jsonify({"error": f"Gemini API error: {e.code}", "details": body}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502


# ---------------------------------------------------------------------------
# Auto-cleanup: remove output files older than N days
# ---------------------------------------------------------------------------

CLEANUP_DAYS = int(os.environ.get("CLEANUP_DAYS", "30"))


def cleanup_old_files():
    """Delete output files older than CLEANUP_DAYS."""
    import time

    if CLEANUP_DAYS <= 0:
        return 0
    cutoff = time.time() - (CLEANUP_DAYS * 86400)
    removed = 0
    for f in OUTPUT_DIR.iterdir():
        if f.is_file() and f.stat().st_mtime < cutoff:
            f.unlink()
            removed += 1
    return removed


# Run cleanup on startup
try:
    _cleaned = cleanup_old_files()
    if _cleaned:
        print(f"Startup cleanup: removed {_cleaned} old output file(s)")
except Exception:
    pass


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG", "0") == "1")
