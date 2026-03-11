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
import time
import uuid
from collections import defaultdict
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
import urllib.parse

APP_TOKEN = os.environ.get("APP_TOKEN", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# ---------------------------------------------------------------------------
# Wizi (Wiz) integration
# ---------------------------------------------------------------------------

WIZI_CLIENT_ID = os.environ.get("WIZI_CLIENT_ID", "")
WIZI_CLIENT_SECRET = os.environ.get("WIZI_CLIENT_SECRET", "")
WIZI_AUTH_URL = os.environ.get("WIZI_AUTH_URL", "https://auth.app.wiz.io/oauth/token")
WIZI_API_URL = os.environ.get("WIZI_API_URL", "https://api.il1.app.wiz.io/graphql")

_wizi_token: Dict[str, Any] = {"access_token": "", "expires_at": 0}

# ---------------------------------------------------------------------------
# Simple in-memory rate limiter
# ---------------------------------------------------------------------------

RATE_LIMIT_WINDOW = int(os.environ.get("RATE_LIMIT_WINDOW", "60"))  # seconds
RATE_LIMIT_MAX = int(os.environ.get("RATE_LIMIT_MAX", "30"))  # requests per window

_rate_store: Dict[str, list] = defaultdict(list)


def _get_client_key() -> str:
    return request.remote_addr or "unknown"


def check_rate_limit() -> bool:
    """Return True if request is within rate limit."""
    if RATE_LIMIT_MAX <= 0:
        return True
    key = _get_client_key()
    now = time.time()
    # Prune old entries
    _rate_store[key] = [t for t in _rate_store[key] if t > now - RATE_LIMIT_WINDOW]
    if len(_rate_store[key]) >= RATE_LIMIT_MAX:
        return False
    _rate_store[key].append(now)
    # Periodic cleanup: remove stale keys to prevent memory growth
    if len(_rate_store) > 1000:
        stale = [k for k, v in _rate_store.items() if not v or v[-1] < now - RATE_LIMIT_WINDOW * 2]
        for k in stale:
            del _rate_store[k]
    return True


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
    """Block unauthenticated requests when APP_TOKEN is set, and enforce rate limits."""
    # Health check is always open and exempt from rate limiting
    if request.path == "/api/health":
        return None
    if not APP_TOKEN:
        pass
    elif not check_auth():
        return Response("Unauthorized", 401, {"WWW-Authenticate": "Bearer"})
    # Rate limiting on mutating endpoints only
    if request.method in ("POST", "DELETE"):
        if not check_rate_limit():
            return jsonify({"error": "Rate limit exceeded"}), 429


@app.after_request
def set_security_headers(response):
    """Add security headers to all responses."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # Cache control for API responses
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


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
    from playwright.sync_api import sync_playwright, Error as PlaywrightError

    browser = None
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            html_path = Path(tmpdir) / "report.html"
            pdf_path = Path(tmpdir) / "report.pdf"
            
            try:
                html_path.write_text(html_content, encoding="utf-8")
            except Exception as e:
                raise RuntimeError(f"Failed to write HTML file: {e}")

            header = build_header(meta)
            footer = build_footer(meta)

            try:
                with sync_playwright() as p:
                    try:
                        browser = p.chromium.launch()
                    except PlaywrightError as e:
                        raise RuntimeError(f"Failed to launch Chromium browser. Ensure Playwright is installed: {e}")
                    except Exception as e:
                        raise RuntimeError(f"Browser launch failed: {e}")
                    
                    try:
                        page = browser.new_page()
                        page.goto(html_path.as_uri(), wait_until="load", timeout=30000)
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
                    except PlaywrightError as e:
                        raise RuntimeError(f"PDF generation failed: {e}")
                    except Exception as e:
                        raise RuntimeError(f"Page rendering failed: {e}")
                    finally:
                        if browser:
                            try:
                                browser.close()
                            except Exception:
                                pass  # Best effort cleanup
            except RuntimeError:
                raise  # Re-raise our custom errors
            except Exception as e:
                raise RuntimeError(f"Playwright operation failed: {e}")

            try:
                return pdf_path.read_bytes()
            except Exception as e:
                raise RuntimeError(f"Failed to read generated PDF: {e}")
    except RuntimeError:
        raise  # Re-raise with context
    except Exception as e:
        raise RuntimeError(f"PDF rendering failed: {e}")


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

    # Only allow .html suffix for safety
    stem = Path(original_name).stem
    out_name = f"{stem}_{uuid.uuid4().hex[:8]}.html"
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
    result = {"status": "ok", "ai_enabled": bool(GEMINI_API_KEY), "wizi_enabled": bool(WIZI_CLIENT_ID and WIZI_CLIENT_SECRET)}
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
    "- Return ONLY the improved text, nothing else. No explanations, no markdown.\n"
    "- The input may start with a [שדה: ...] tag indicating the field context. "
    "Use it to understand the context but NEVER include it in your output."
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
        # Strip field hint tag if the model echoed it back
        if suggestion.startswith("[שדה:"):
            idx = suggestion.find("]")
            if idx != -1:
                suggestion = suggestion[idx + 1:].strip()
        if not suggestion:
            return jsonify({"error": "Empty response from model"}), 502
        return jsonify({"suggestion": suggestion})
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return jsonify({"error": f"Gemini API error: {e.code}", "details": body}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502


# ---------------------------------------------------------------------------
# Wizi (Wiz) API integration
# ---------------------------------------------------------------------------

def _wizi_get_token() -> str:
    """Get a valid Wizi OAuth token, refreshing if expired."""
    now = time.time()
    if _wizi_token["access_token"] and _wizi_token["expires_at"] > now + 60:
        return _wizi_token["access_token"]

    payload = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": WIZI_CLIENT_ID,
        "client_secret": WIZI_CLIENT_SECRET,
        "audience": "wiz-api",
    }).encode("utf-8")

    req = urllib.request.Request(
        WIZI_AUTH_URL,
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read().decode("utf-8"))

    _wizi_token["access_token"] = result["access_token"]
    _wizi_token["expires_at"] = now + result.get("expires_in", 3600)
    return _wizi_token["access_token"]


def _wizi_graphql(query: str, variables: dict | None = None) -> dict:
    """Execute a GraphQL query against the Wizi API."""
    token = _wizi_get_token()
    payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(
        WIZI_API_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


WIZI_ISSUES_QUERY = """
query IssuesTable($first: Int, $after: String, $filterBy: IssueFilters) {
  issues(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      control { id name }
      sourceRules { id name description }
      severity
      status
      description
      projects { id name }
      cloudAccounts { id name cloudProvider externalId }
      entitySnapshot {
        name type cloudPlatform region
        subscriptionName subscriptionExternalId nativeType tags
      }
      notes { text }
      createdAt updatedAt
    }
  }
}
"""

WIZI_CONFIG_FINDINGS_QUERY = """
query ConfigFindings($first: Int, $after: String, $filterBy: ConfigurationFindingFilters) {
  configurationFindings(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id name severity result status
      rule { id name shortId description remediationInstructions }
      resource {
        name type region nativeType
        subscription { name cloudProvider externalId }
      }
      securitySubCategories { title category { name } }
      analyzedAt
    }
  }
}
"""

WIZI_VULN_FINDINGS_QUERY = """
query VulnFindings($first: Int, $after: String, $filterBy: VulnerabilityFindingFilters) {
  vulnerabilityFindings(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id name severity score
      CVEDescription
      hasExploit hasFix fixedVersion version
      remediation description detailedName
      status
      projects { name }
      firstDetectedAt lastDetectedAt
    }
  }
}
"""

WIZI_HOST_CONFIG_QUERY = """
query HostConfigFindings($first: Int, $after: String, $filterBy: HostConfigurationRuleAssessmentFilters) {
  hostConfigurationRuleAssessments(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id severity result status
      rule { id name description remediationInstructions }
      resource {
        name nativeType region cloudPlatform
        subscription { name cloudProvider }
      }
    }
  }
}
"""

WIZI_DATA_FINDINGS_QUERY = """
query DataFindings($first: Int, $after: String, $filterBy: DataFindingFiltersV2) {
  dataFindingsV2(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id name severity status
      dataClassifier { name category }
      graphEntity { name type }
      cloudAccount { name cloudProvider }
    }
  }
}
"""

WIZI_SECRET_INSTANCES_QUERY = """
query SecretInstances($first: Int, $after: String, $filterBy: SecretInstanceFilters) {
  secretInstances(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id name severity status type path
      rule { name }
      resource { name nativeType region cloudPlatform cloudAccount { name } }
    }
  }
}
"""

WIZI_EXCESSIVE_ACCESS_QUERY = """
query ExcessiveAccessFindings($first: Int, $after: String, $filterBy: ExcessiveAccessFindingFilters) {
  excessiveAccessFindings(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id name severity status cloudPlatform description
      remediationType remediationInstructions
      principal { graphEntity { name type } cloudAccount { name } }
    }
  }
}
"""

WIZI_NETWORK_EXPOSURE_QUERY = """
query NetworkExposures($first: Int, $after: String, $filterBy: NetworkExposureFilters) {
  networkExposures(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id sourceIpRange portRange type
      exposedEntity { name type }
    }
  }
}
"""

WIZI_INVENTORY_FINDINGS_QUERY = """
query InventoryFindings($first: Int, $after: String, $filterBy: InventoryFindingFilters) {
  inventoryFindings(first: $first, after: $after, filterBy: $filterBy) {
    totalCount
    pageInfo { hasNextPage endCursor }
    nodes {
      id severity status
      rule { id name description }
      resource {
        name nativeType region cloudPlatform
        cloudAccount { name }
      }
    }
  }
}
"""

WIZI_PROJECTS_QUERY = """
query ProjectsTable($first: Int, $after: String) {
  projects(first: $first, after: $after) {
    nodes {
      id
      name
      slug
      riskProfile {
        businessImpact
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

WIZI_SUBSCRIPTIONS_QUERY = """
query SubscriptionsTable($first: Int, $after: String) {
  subscriptions(first: $first, after: $after) {
    nodes {
      id
      name
      externalId
      cloudProvider
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""


@app.route("/api/wizi/projects")
def api_wizi_projects():
    """Fetch available projects from Wizi."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501
    try:
        result = _wizi_graphql(WIZI_PROJECTS_QUERY, {"first": 500})
        if "errors" in result:
            return jsonify({"error": result["errors"][0].get("message", "GraphQL error")}), 502
        nodes = result.get("data", {}).get("projects", {}).get("nodes", [])
        return jsonify({"projects": nodes})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/wizi/subscriptions")
def api_wizi_subscriptions():
    """Fetch available subscriptions (cloud accounts) from Wizi."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501
    try:
        # Use cloudAccounts query since subscriptions root query doesn't exist
        result = _wizi_graphql("""
            query {
              cloudAccounts(first: 500) {
                nodes {
                  id
                  name
                  externalId
                  cloudProvider
                }
              }
            }
        """)
        if "errors" in result:
            return jsonify({"error": result["errors"][0].get("message", "GraphQL error")}), 502
        nodes = result.get("data", {}).get("cloudAccounts", {}).get("nodes", [])
        return jsonify({"subscriptions": nodes})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/wizi/graphql", methods=["POST"])
def api_wizi_graphql_proxy():
    """Raw GraphQL proxy for debugging — pass {query, variables}."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501
    enforce_auth()
    data = request.get_json(silent=True) or {}
    query = data.get("query", "")
    variables = data.get("variables", {})
    if not query:
        return jsonify({"error": "No query provided"}), 400
    # Block mutations — this is a read-only proxy
    query_stripped = query.strip().lower()
    if query_stripped.startswith("mutation"):
        return jsonify({"error": "Mutations are not allowed"}), 403
    # Limit query size to prevent abuse
    if len(query) > 10000:
        return jsonify({"error": "Query too large (max 10000 chars)"}), 400
    try:
        result = _wizi_graphql(query, variables)
        return jsonify(result)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return jsonify({"error": f"Wizi API error: {e.code}", "details": body}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/wizi/discover")
def api_wizi_discover():
    """Discover available root query fields via introspection."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501
    try:
        result = _wizi_graphql("""
            query {
              __schema {
                queryType {
                  fields {
                    name
                    description
                    args { name type { name kind ofType { name kind } } }
                  }
                }
              }
            }
        """)
        if "errors" in result:
            return jsonify({"error": result["errors"][0].get("message", ""), "details": result["errors"]}), 502
        fields = result.get("data", {}).get("__schema", {}).get("queryType", {}).get("fields", [])
        # Return just names and descriptions for quick overview
        summary = [{"name": f["name"], "description": f.get("description", ""),
                     "args": [a["name"] for a in f.get("args", [])]} for f in fields]
        return jsonify({"fields": summary})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/wizi/issues", methods=["POST"])
def api_wizi_issues():
    """Fetch findings from Wizi with optional filters and pagination."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501

    data = request.get_json(silent=True) or {}
    query_type = data.get("queryType", "issues")
    first = min(int(data.get("first", 100)), 500)
    after = data.get("after") or None
    severity = data.get("severity") or None
    status = data.get("status") or None
    project_id = data.get("project") or None
    subscription_id = data.get("subscription") or None

    variables: Dict[str, Any] = {"first": first}
    if after:
        variables["after"] = after

    # Helper: ensure list
    def as_list(v):
        return v if isinstance(v, list) else [v]

    # Helper: wrap in {equals: [...]} for nested filter objects
    def eq_wrap(v):
        return {"equals": as_list(v)}

    # Resolve subscription search text → cloud account IDs
    resolved_sub_ids: list = []
    resolved_sub_ext_ids: list = []
    subscription_resolution_failed = False
    if subscription_id:
        try:
            # Try exact search first
            sub_result = _wizi_graphql(
                'query($filterBy: CloudAccountFilters) { cloudAccounts(first: 100, filterBy: $filterBy) { nodes { id name externalId } } }',
                {"filterBy": {"search": subscription_id}}
            )
            nodes = sub_result.get("data", {}).get("cloudAccounts", {}).get("nodes", [])
            
            # If no exact match, try partial search with significant parts
            if not nodes:
                # Extract meaningful parts (skip common prefixes/suffixes)
                parts = subscription_id.replace("_", "-").split("-")
                significant_parts = [p for p in parts if len(p) >= 4 and p.lower() not in ("aws", "azure", "gcp", "dev", "prod", "test", "stg")]
                
                if significant_parts:
                    # Try searching with the most significant part
                    for part in significant_parts:
                        sub_result = _wizi_graphql(
                            'query($filterBy: CloudAccountFilters) { cloudAccounts(first: 100, filterBy: $filterBy) { nodes { id name externalId } } }',
                            {"filterBy": {"search": part}}
                        )
                        nodes = sub_result.get("data", {}).get("cloudAccounts", {}).get("nodes", [])
                        if nodes:
                            # Filter nodes to only those that contain the original search term
                            nodes = [n for n in nodes if subscription_id.lower() in n.get("name", "").lower()]
                            if nodes:
                                break
            
            resolved_sub_ids = [n["id"] for n in nodes if n.get("id")]
            resolved_sub_ext_ids = [n["externalId"] for n in nodes if n.get("externalId")]
            
            # If still no results, mark as failed for user feedback
            if not resolved_sub_ids and not resolved_sub_ext_ids:
                subscription_resolution_failed = True
        except Exception as e:
            subscription_resolution_failed = True
            # Log error but continue - client-side filter will still apply

    filter_by: Dict[str, Any] = {}

    if query_type == "configurationFindings":
        if severity:
            filter_by["severity"] = as_list(severity)
        if status:
            filter_by["result"] = as_list(status)
        if resolved_sub_ids:
            filter_by["resource"] = {"subscriptionId": resolved_sub_ids}
        # configurationFindings: no direct project ID filter (only projectTag)
        gql = WIZI_CONFIG_FINDINGS_QUERY
        root_key = "configurationFindings"

    elif query_type == "vulnerabilityFindings":
        if severity:
            filter_by["severity"] = as_list(severity)
        if status:
            filter_by["status"] = as_list(status)
        if resolved_sub_ext_ids:
            filter_by["subscriptionExternalId"] = resolved_sub_ext_ids
        if project_id:
            filter_by["projectIdV2"] = {"equals": as_list(project_id)}
        gql = WIZI_VULN_FINDINGS_QUERY
        root_key = "vulnerabilityFindings"

    elif query_type == "hostConfigurationRuleAssessments":
        if severity:
            filter_by["severity"] = as_list(severity)
        if status:
            filter_by["status"] = as_list(status)
        if resolved_sub_ids:
            filter_by["resource"] = {"subscriptionId": resolved_sub_ids}
        # hostConfigurationRuleAssessments: no project filter available
        gql = WIZI_HOST_CONFIG_QUERY
        root_key = "hostConfigurationRuleAssessments"

    elif query_type == "dataFindingsV2":
        if severity:
            filter_by["severity"] = eq_wrap(severity)
        if status:
            filter_by["status"] = eq_wrap(status)
        if resolved_sub_ext_ids:
            filter_by["graphEntityCloudAccount"] = {"equals": resolved_sub_ext_ids}
        if project_id:
            filter_by["projectId"] = as_list(project_id)
        gql = WIZI_DATA_FINDINGS_QUERY
        root_key = "dataFindingsV2"

    elif query_type == "secretInstances":
        if severity:
            filter_by["severity"] = eq_wrap(severity)
        if status:
            filter_by["status"] = eq_wrap(status)
        if resolved_sub_ext_ids:
            filter_by["cloudAccount"] = {"equals": resolved_sub_ext_ids}
        if project_id:
            filter_by["projectId"] = as_list(project_id)
        gql = WIZI_SECRET_INSTANCES_QUERY
        root_key = "secretInstances"

    elif query_type == "excessiveAccessFindings":
        if severity:
            filter_by["severity"] = eq_wrap(severity)
        if status:
            filter_by["status"] = eq_wrap(status)
        if project_id:
            filter_by["project"] = as_list(project_id)
        # No subscription filter available for excessive access
        gql = WIZI_EXCESSIVE_ACCESS_QUERY
        root_key = "excessiveAccessFindings"

    elif query_type == "networkExposures":
        if resolved_sub_ext_ids:
            filter_by["cloudAccount"] = resolved_sub_ext_ids
        if project_id:
            # networkExposures.projectId is a scalar String, not a list
            pid = project_id if isinstance(project_id, str) else project_id[0]
            filter_by["projectId"] = pid
        gql = WIZI_NETWORK_EXPOSURE_QUERY
        root_key = "networkExposures"

    elif query_type == "inventoryFindings":
        if severity:
            filter_by["severity"] = eq_wrap(severity)
        if status:
            filter_by["status"] = eq_wrap(status)
        if resolved_sub_ids:
            filter_by["resource"] = {"subscriptionId": {"equals": resolved_sub_ids}}
        if project_id:
            filter_by["projects"] = {"equals": as_list(project_id)}
        gql = WIZI_INVENTORY_FINDINGS_QUERY
        root_key = "inventoryFindings"

    else:
        # Default: issues
        if severity:
            filter_by["severity"] = as_list(severity)
        if status:
            filter_by["status"] = as_list(status)
        else:
            filter_by["status"] = ["OPEN", "IN_PROGRESS"]
        if project_id:
            filter_by["project"] = project_id if isinstance(project_id, list) else [project_id]
        if subscription_id:
            if resolved_sub_ids:
                filter_by["cloudAccountOrCloudOrganizationId"] = resolved_sub_ids
            else:
                filter_by.setdefault("relatedEntity", {})["subscriptionSearch"] = subscription_id
        gql = WIZI_ISSUES_QUERY
        root_key = "issues"

    if filter_by:
        variables["filterBy"] = filter_by

    try:
        result = _wizi_graphql(gql, variables)
        if "errors" in result:
            return jsonify({"error": result["errors"][0].get("message", "GraphQL error"), "details": result["errors"]}), 502
        
        response_data = {"queryType": query_type, root_key: result.get("data", {}).get(root_key, {})}
        
        # Add warning if subscription resolution failed
        if subscription_resolution_failed:
            response_data["warning"] = f"Subscription '{subscription_id}' not found in cloud accounts. Results may be unfiltered."
        
        return jsonify(response_data)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return jsonify({"error": f"Wizi API error: {e.code}", "details": body}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/wizi/find-by-id", methods=["POST"])
def api_wizi_find_by_id():
    """Fetch findings from Wizi by ID or rule ID. Returns paginated results for user selection."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"error": "Wizi integration not configured"}), 501

    data = request.get_json(silent=True) or {}
    finding_id = (data.get("id") or "").strip()
    subscription_filter = (data.get("subscription") or "").strip()
    page_size = int(data.get("pageSize") or 5)
    page = int(data.get("page") or 0)
    if not finding_id:
        return jsonify({"error": "No finding ID provided"}), 400

    # Store resolved subscription names for client-side filtering
    resolved_sub_names: list = []

    # Resolve subscription text → cloud account IDs (if provided)
    resolved_sub_ids: list = []
    resolved_sub_ext_ids: list = []
    if subscription_filter:
        search_terms = [subscription_filter]
        parts = [p for p in subscription_filter.replace("_", "-").split("-") if len(p) >= 3]
        parts.sort(key=len, reverse=True)
        for part in parts[:3]:
            if part.lower() not in ("aws", "dev", "prod", "stg", "test"):
                search_terms.append(part)

        for term in search_terms:
            try:
                sub_result = _wizi_graphql(
                    'query($filterBy: CloudAccountFilters) { cloudAccounts(first: 100, filterBy: $filterBy) { nodes { id name externalId } } }',
                    {"filterBy": {"search": term}}
                )
                nodes = sub_result.get("data", {}).get("cloudAccounts", {}).get("nodes", [])
                if nodes:
                    resolved_sub_ids = [n["id"] for n in nodes if n.get("id")]
                    resolved_sub_ext_ids = [n["externalId"] for n in nodes if n.get("externalId")]
                    resolved_sub_names = [n["name"] for n in nodes if n.get("name")]
                    break
            except Exception:
                continue

    queries = [
        ("issues", "issues", WIZI_ISSUES_QUERY),
        ("configurationFindings", "configurationFindings", WIZI_CONFIG_FINDINGS_QUERY),
        ("vulnerabilityFindings", "vulnerabilityFindings", WIZI_VULN_FINDINGS_QUERY),
        ("hostConfigurationRuleAssessments", "hostConfigurationRuleAssessments", WIZI_HOST_CONFIG_QUERY),
        ("dataFindingsV2", "dataFindingsV2", WIZI_DATA_FINDINGS_QUERY),
        ("secretInstances", "secretInstances", WIZI_SECRET_INSTANCES_QUERY),
        ("excessiveAccessFindings", "excessiveAccessFindings", WIZI_EXCESSIVE_ACCESS_QUERY),
        ("networkExposures", "networkExposures", WIZI_NETWORK_EXPOSURE_QUERY),
        ("inventoryFindings", "inventoryFindings", WIZI_INVENTORY_FINDINGS_QUERY),
    ]

    def _add_sub_filter(filter_by: dict, qt: str) -> dict:
        if not subscription_filter:
            return filter_by
        if qt == "issues":
            # Prefer resolved cloud account IDs (exact match) over free-text search
            if resolved_sub_ids:
                filter_by["cloudAccountOrCloudOrganizationId"] = resolved_sub_ids
            else:
                filter_by.setdefault("relatedEntity", {})["subscriptionSearch"] = subscription_filter
        elif qt == "configurationFindings" and resolved_sub_ids:
            filter_by["resource"] = {"subscriptionId": resolved_sub_ids}
        elif qt == "vulnerabilityFindings" and resolved_sub_ext_ids:
            filter_by["subscriptionExternalId"] = resolved_sub_ext_ids
        elif qt == "hostConfigurationRuleAssessments" and resolved_sub_ids:
            filter_by["resource"] = {"subscriptionId": resolved_sub_ids}
        elif qt == "dataFindingsV2" and resolved_sub_ext_ids:
            filter_by["graphEntityCloudAccount"] = {"equals": resolved_sub_ext_ids}
        elif qt == "secretInstances" and resolved_sub_ext_ids:
            filter_by["cloudAccount"] = {"equals": resolved_sub_ext_ids}
        elif qt == "networkExposures" and resolved_sub_ext_ids:
            filter_by["cloudAccount"] = resolved_sub_ext_ids
        elif qt == "inventoryFindings" and resolved_sub_ids:
            filter_by["resource"] = {"subscriptionId": {"equals": resolved_sub_ids}}
        return filter_by

    def _client_side_sub_filter(nodes: list) -> list:
        if not subscription_filter or not nodes:
            return nodes

        # If we resolved actual subscription names, use those for exact matching
        if resolved_sub_names:
            resolved_lower = [n.lower() for n in resolved_sub_names]

            def matches(node: dict) -> bool:
                names = []
                names.append((node.get("entitySnapshot") or {}).get("subscriptionName", ""))
                res = node.get("resource") or {}
                res_sub = res.get("subscription") or {}
                names.append(res_sub.get("name", ""))
                ca = node.get("cloudAccount") or res.get("cloudAccount") or {}
                names.append(ca.get("name", ""))
                principal_ca = (node.get("principal") or {}).get("cloudAccount") or {}
                names.append(principal_ca.get("name", ""))
                return any(n.lower() in resolved_lower for n in names if n)

            return [n for n in nodes if matches(n)]

        # Fallback: token-based fuzzy matching from user input
        needle = subscription_filter.lower()
        tokens = [needle]
        parts = [p.lower() for p in subscription_filter.replace("_", "-").split("-") if len(p) >= 4]
        skip = {"aws", "dev", "prod", "stg", "test", "gcp", "azure"}
        tokens.extend([p for p in parts if p not in skip])

        def matches_fuzzy(node: dict) -> bool:
            names = []
            names.append((node.get("entitySnapshot") or {}).get("subscriptionName", ""))
            res = node.get("resource") or {}
            res_sub = res.get("subscription") or {}
            names.append(res_sub.get("name", ""))
            ca = node.get("cloudAccount") or res.get("cloudAccount") or {}
            names.append(ca.get("name", ""))
            principal_ca = (node.get("principal") or {}).get("cloudAccount") or {}
            names.append(principal_ca.get("name", ""))
            combined = " ".join(n.lower() for n in names if n)
            if not combined:
                return False
            return any(t in combined for t in tokens)

        return [n for n in nodes if matches_fuzzy(n)]

    def _paginate(all_nodes: list, qt: str, total: int) -> dict:
        """Return a page of results with metadata."""
        start = page * page_size
        page_nodes = all_nodes[start:start + page_size]
        return {
            "queryType": qt,
            "nodes": page_nodes,
            "total": total,
            "page": page,
            "pageSize": page_size,
            "hasMore": (start + page_size) < total,
        }

    # Strategy 1: Direct ID filter (works for finding UUIDs)
    for qt, root_key, gql in queries:
        try:
            filter_by: Dict[str, Any] = {"id": finding_id}
            filter_by = _add_sub_filter(filter_by, qt)
            variables: Dict[str, Any] = {"first": 1, "filterBy": filter_by}
            result = _wizi_graphql(gql, variables)
            if "errors" in result:
                continue
            nodes = result.get("data", {}).get(root_key, {}).get("nodes", [])
            if nodes:
                return jsonify({"queryType": qt, "nodes": nodes, "total": 1, "page": 0, "pageSize": page_size, "hasMore": False})
        except Exception:
            continue

    # For rule-based strategies, fetch more results and filter
    fetch_limit = max(50, (page + 1) * page_size + page_size)

    # Strategy 2: Search by rule ID — issues use sourceRule filter
    try:
        filter_by = {"sourceRule": {"id": [finding_id]}}
        filter_by = _add_sub_filter(filter_by, "issues")
        variables = {"first": fetch_limit, "filterBy": filter_by}
        result = _wizi_graphql(WIZI_ISSUES_QUERY, variables)
        nodes = result.get("data", {}).get("issues", {}).get("nodes", [])
        if nodes:
            filtered = _client_side_sub_filter(nodes) if subscription_filter else nodes
            if filtered:
                return jsonify(_paginate(filtered, "issues", len(filtered)))
    except Exception:
        pass

    # Strategy 3: Search config findings by rule ID
    try:
        filter_by = {"rule": {"id": [finding_id]}}
        filter_by = _add_sub_filter(filter_by, "configurationFindings")
        variables = {"first": fetch_limit, "filterBy": filter_by}
        result = _wizi_graphql(WIZI_CONFIG_FINDINGS_QUERY, variables)
        nodes = result.get("data", {}).get("configurationFindings", {}).get("nodes", [])
        if nodes:
            filtered = _client_side_sub_filter(nodes) if subscription_filter else nodes
            if filtered:
                return jsonify(_paginate(filtered, "configurationFindings", len(filtered)))
    except Exception:
        pass

    # Strategy 4: Search host config by rule ID
    try:
        filter_by = {"ruleV2": {"id": {"equals": [finding_id]}}}
        filter_by = _add_sub_filter(filter_by, "hostConfigurationRuleAssessments")
        variables = {"first": fetch_limit, "filterBy": filter_by}
        result = _wizi_graphql(WIZI_HOST_CONFIG_QUERY, variables)
        nodes = result.get("data", {}).get("hostConfigurationRuleAssessments", {}).get("nodes", [])
        if nodes:
            filtered = _client_side_sub_filter(nodes) if subscription_filter else nodes
            if filtered:
                return jsonify(_paginate(filtered, "hostConfigurationRuleAssessments", len(filtered)))
    except Exception:
        pass

    # Strategy 5: Search by rule shortId (e.g. EC2-005, Custom-Rule-140)
    # Two-step: resolve shortId → rule UUID, then search config findings by rule UUID
    try:
        rule_lookup = _wizi_graphql(
            'query($filterBy: CloudConfigurationRuleFilters) { cloudConfigurationRules(first: 5, filterBy: $filterBy) { nodes { id name shortId } } }',
            {"filterBy": {"shortId": {"equals": [finding_id]}}}
        )
        rule_nodes = rule_lookup.get("data", {}).get("cloudConfigurationRules", {}).get("nodes", [])
        if rule_nodes:
            rule_uuids = [r["id"] for r in rule_nodes]
            filter_by = {"rule": {"id": rule_uuids}}
            filter_by = _add_sub_filter(filter_by, "configurationFindings")
            variables = {"first": fetch_limit, "filterBy": filter_by}
            result = _wizi_graphql(WIZI_CONFIG_FINDINGS_QUERY, variables)
            nodes = result.get("data", {}).get("configurationFindings", {}).get("nodes", [])
            if nodes:
                filtered = _client_side_sub_filter(nodes) if subscription_filter else nodes
                if filtered:
                    return jsonify(_paginate(filtered, "configurationFindings", len(filtered)))
    except Exception:
        pass

    # Strategy 5: Free-text search via issues (catches partial matches)
    try:
        filter_by = {"search": finding_id}
        filter_by = _add_sub_filter(filter_by, "issues")
        variables = {"first": fetch_limit, "filterBy": filter_by}
        result = _wizi_graphql(WIZI_ISSUES_QUERY, variables)
        nodes = result.get("data", {}).get("issues", {}).get("nodes", [])
        if nodes:
            filtered = _client_side_sub_filter(nodes) if subscription_filter else nodes
            if filtered:
                return jsonify(_paginate(filtered, "issues", len(filtered)))
    except Exception:
        pass

    return jsonify({"error": "Finding not found", "id": finding_id}), 404


@app.route("/api/wizi/status")
def api_wizi_status():
    """Check if Wizi integration is configured and reachable."""
    if not WIZI_CLIENT_ID or not WIZI_CLIENT_SECRET:
        return jsonify({"enabled": False})
    try:
        result = _wizi_graphql("query { issues(first: 1) { totalCount } }")
        total = result.get("data", {}).get("issues", {}).get("totalCount", 0)
        return jsonify({"enabled": True, "totalIssues": total})
    except Exception as e:
        return jsonify({"enabled": False, "error": str(e)})


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
