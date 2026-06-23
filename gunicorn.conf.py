"""Gunicorn configuration — applied automatically when Gunicorn starts.

Ensures structured JSON logging is active in every worker process
after Gunicorn has finished setting up its own loggers.
"""
import os

# Bind / workers picked up from environment or sensible defaults
bind = f"0.0.0.0:{os.environ.get('PORT', '8080')}"
workers = int(os.environ.get("GUNICORN_WORKERS", "1"))
threads = int(os.environ.get("GUNICORN_THREADS", "4"))
timeout = 120  # PDF rendering can be slow


def post_fork(server, worker):  # noqa: ARG001
    """Re-apply JSON logging after Gunicorn overwrites the root logger."""
    from backend.logging_config import configure_logging
    configure_logging(debug=False)
