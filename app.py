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

import hmac
import logging
import os
import time
from collections import defaultdict
from pathlib import Path
from typing import Dict

from flask import (
    Flask,
    Response,
    jsonify,
    request,
    send_file,
    send_from_directory,
)

from backend.database import db
from backend.logging_config import configure_logging

_debug = os.environ.get("FLASK_DEBUG", "0") == "1"
configure_logging(debug=_debug)
_log = logging.getLogger(__name__)

# Import blueprints
from backend.routes.wiz import wiz_bp
from backend.routes.ai import ai_bp, GEMINI_MODELS, GEMINI_DEFAULT_MODEL
from backend.routes.reports import reports_bp
from backend.routes.files import files_bp
from backend.routes.products import products_bp

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

# ---------------------------------------------------------------------------
# Database configuration
# ---------------------------------------------------------------------------

_database_url = os.environ.get("DATABASE_URL", "")
if not _database_url:
    _db_path = BASE_DIR / "instance" / "app.db"
    _db_path.parent.mkdir(parents=True, exist_ok=True)
    _database_url = f"sqlite:///{_db_path}"

app.config["SQLALCHEMY_DATABASE_URI"] = _database_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)

# Auto-create tables only in dev (SQLite). Production uses managed migrations.
if not os.environ.get("DATABASE_URL"):
    with app.app_context():
        import backend.models  # noqa: F401 — registers models with SQLAlchemy
        db.create_all()

# Initialize files blueprint with directory paths
from backend.routes import files
files.init_directories(BASE_DIR, STATES_DIR, OUTPUT_DIR)

# Register blueprints
app.register_blueprint(wiz_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(reports_bp)
app.register_blueprint(files_bp)
app.register_blueprint(products_bp)

MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50 MB
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

# ---------------------------------------------------------------------------
# Optional token-based auth (set APP_TOKEN env var to enable)
# ---------------------------------------------------------------------------

APP_TOKEN = os.environ.get("APP_TOKEN", "")

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
    # Fallback for browser-initiated GET downloads (<a href> can't set headers).
    # Only honoured on GET so token isn't logged with side-effecting requests.
    if request.method == "GET":
        token = request.args.get("token", "")
        if token:
            return hmac.compare_digest(token, APP_TOKEN)
    return False


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


@app.after_request
def log_request(response):
    """Emit one structured access-log line per request."""
    # Skip noisy health-check polls from container orchestration
    if request.path != "/api/health":
        _log.info(
            "%s %s %s",
            request.method,
            request.path,
            response.status_code,
            extra={"status_code": response.status_code},
        )
    return response


@app.errorhandler(Exception)
def handle_unhandled_exception(exc):
    """Log unhandled exceptions with full stack trace and return a clean 500."""
    _log.error("Unhandled exception", exc_info=True)
    return jsonify({"error": "Internal server error"}), 500




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




@app.route("/api/health")
def api_health():
    """Health check for container orchestration."""
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
    WIZI_CLIENT_ID = os.environ.get("WIZI_CLIENT_ID", "")
    WIZI_CLIENT_SECRET = os.environ.get("WIZI_CLIENT_SECRET", "")

    result = {"status": "ok", "ai_enabled": bool(GEMINI_API_KEY), "wizi_enabled": bool(WIZI_CLIENT_ID and WIZI_CLIENT_SECRET)}
    if GEMINI_API_KEY:
        result["ai_models"] = GEMINI_MODELS
        result["ai_default_model"] = GEMINI_DEFAULT_MODEL
    return jsonify(result)



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
        _log.info("Startup cleanup: removed %d old output file(s)", _cleaned)
except Exception:
    _log.warning("Startup cleanup failed", exc_info=True)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG", "0") == "1")
