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
import secrets
import time
from collections import defaultdict
from datetime import timedelta
from pathlib import Path
from typing import Dict

from flask import (
    Flask,
    Response,
    jsonify,
    redirect,
    request,
    send_file,
    send_from_directory,
    session,
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
from backend.routes.auth import auth_bp
from backend.routes.pipeline import pipeline_bp

app = Flask(
    __name__,
    static_folder="static",
    static_url_path="/static",
    template_folder="templates",
)

# ---------------------------------------------------------------------------
# Secret key — required for signed sessions (OAuth mode)
# ---------------------------------------------------------------------------

_secret_key = os.environ.get("SECRET_KEY", "")
if not _secret_key:
    _secret_key = secrets.token_hex(32)
    _log.warning(
        "SECRET_KEY not set — sessions will be invalidated on restart. "
        "Set SECRET_KEY in production."
    )
app.config["SECRET_KEY"] = _secret_key
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
# Only enforce Secure flag in production (HTTPS). Dev/lab environments use plain HTTP.
app.config["SESSION_COOKIE_SECURE"] = bool(os.environ.get("DATABASE_URL"))
# Limit session lifetime so role changes take effect within a reasonable window.
# session.permanent = True is set in auth.py; this caps the lifetime to 8 hours.
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=8)

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

# SQLite: enable WAL mode and a 30-second busy timeout so background threads
# don't immediately deadlock concurrent Flask requests.
if not os.environ.get("DATABASE_URL"):
    import sqlite3 as _sqlite3
    from sqlalchemy import event as _sa_event
    from sqlalchemy.engine import Engine as _Engine

    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "connect_args": {"check_same_thread": False, "timeout": 30},
    }

    @_sa_event.listens_for(_Engine, "connect")
    def _set_sqlite_wal(dbapi_conn, _record):
        if isinstance(dbapi_conn, _sqlite3.Connection):
            dbapi_conn.execute("PRAGMA journal_mode=WAL")
            dbapi_conn.execute("PRAGMA synchronous=NORMAL")
            dbapi_conn.execute("PRAGMA busy_timeout=30000")

db.init_app(app)

# Auto-create tables only in dev (SQLite). Production uses managed migrations.
if not os.environ.get("DATABASE_URL"):
    with app.app_context():
        import backend.models  # noqa: F401 — registers models with SQLAlchemy
        db.create_all()
        # Backfill columns added after initial schema creation (existing SQLite DBs).
        from sqlalchemy import text as _text
        with db.engine.connect() as _c:
            for _stmt in [
                "ALTER TABLE products ADD COLUMN scan_frequency VARCHAR(20) NOT NULL DEFAULT 'quarterly'",
            ]:
                try:
                    _c.execute(_text(_stmt))
                    _c.commit()
                except Exception as _exc:
                    if "duplicate column" not in str(_exc).lower() and "already exists" not in str(_exc).lower():
                        _log.warning("DB migration step skipped unexpectedly: %s", _exc)

# ---------------------------------------------------------------------------
# Google OAuth (optional — enabled when GOOGLE_CLIENT_ID is set)
# ---------------------------------------------------------------------------

_google_client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
if _google_client_id:
    from backend.oauth import oauth
    oauth.init_app(app)
    oauth.register(
        name="google",
        client_id=_google_client_id,
        client_secret=os.environ.get("GOOGLE_CLIENT_SECRET", ""),
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )
    _log.info("Google OAuth enabled (domain=%s)", os.environ.get("ALLOWED_DOMAIN", "any"))
else:
    _log.info("Google OAuth disabled — APP_TOKEN auth only")

# Initialize files blueprint with directory paths
from backend.routes import files
files.init_directories(BASE_DIR, STATES_DIR, OUTPUT_DIR)

# Register blueprints
app.register_blueprint(wiz_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(reports_bp)
app.register_blueprint(files_bp)
app.register_blueprint(products_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(pipeline_bp)

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


_OPEN_PREFIXES = ("/auth/", "/static/", "/assets/")
_OPEN_PATHS = {"/api/health", "/api/me"}


@app.before_request
def enforce_auth():
    """Authentication gate and rate limiter."""
    path = request.path

    # Always open paths
    if path in _OPEN_PATHS or any(path.startswith(p) for p in _OPEN_PREFIXES):
        return None

    if _google_client_id:
        # OAuth mode: accept session or APP_TOKEN bearer (bearer only if token is configured)
        if session.get("user_email"):
            pass  # session OK
        elif APP_TOKEN and check_auth():
            pass  # APP_TOKEN bearer OK (CI/scripts only)
        else:
            # Not authenticated
            if path.startswith("/api/"):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect("/auth/login")
    else:
        # No OAuth: classic APP_TOKEN gate
        if APP_TOKEN and not check_auth():
            return Response("Unauthorized", 401, {"WWW-Authenticate": "Bearer"})

    # Rate limiting on mutating endpoints only
    if request.method in ("POST", "DELETE", "PATCH"):
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
    from werkzeug.exceptions import HTTPException
    if isinstance(exc, HTTPException):
        return exc  # 4xx/5xx HTTP exceptions are expected; let Flask respond normally
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
            f.unlink(missing_ok=True)
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
