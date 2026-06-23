"""Structured JSON logging for GCP Cloud Logging compatibility.

Call ``configure_logging()`` once at application startup (before the Flask
app processes any requests).  Every log line is emitted as a single JSON
object to stdout so Cloud Logging can ingest and index it automatically.

GCP-compatible fields:
  severity  — INFO / WARNING / ERROR / CRITICAL  (Cloud Logging reads this)
  message   — the log message
  path      — HTTP request path (injected by RequestContextFilter)
  method    — HTTP method
  user_email — authenticated user email (None until Milestone 1.4 adds OAuth)
"""
from __future__ import annotations

import logging
import sys
from datetime import UTC, datetime

from pythonjsonlogger import jsonlogger


class _GCPFormatter(jsonlogger.JsonFormatter):
    """Formats logs for GCP Cloud Logging structured ingestion.

    Key changes vs default JsonFormatter:
    - 'levelname' → 'severity'  (Cloud Logging reads this field)
    - 'asctime'   → 'timestamp' in RFC 3339 format with milliseconds
      (Cloud Logging uses this for log ordering instead of ingestion time)
    """

    def add_fields(self, log_record: dict, record: logging.LogRecord, message_dict: dict) -> None:
        super().add_fields(log_record, record, message_dict)
        # RFC 3339 with millisecond precision — e.g. 2026-06-23T20:58:59.530Z
        dt = datetime.fromtimestamp(record.created, UTC)
        log_record["timestamp"] = dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"
        log_record["severity"] = record.levelname
        log_record.pop("asctime", None)
        log_record.pop("levelname", None)
        log_record.pop("color_message", None)  # Gunicorn adds this; redundant


class _RequestContextFilter(logging.Filter):
    """Injects HTTP request fields into every log record emitted during a request."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            from flask import has_request_context, request, session
            if has_request_context():
                record.path = request.path
                record.method = request.method
                record.user_email = session.get("user_email")
            else:
                record.path = None
                record.method = None
                record.user_email = None
        except Exception:
            record.path = None
            record.method = None
            record.user_email = None
        return True


def configure_logging(debug: bool = False) -> None:
    """Wire up structured JSON logging on the root logger.

    Must be called before Flask or Gunicorn configure their own handlers so
    that all child loggers inherit our formatter.
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        _GCPFormatter("%(levelname)s %(name)s %(message)s")
    )
    handler.addFilter(_RequestContextFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(logging.DEBUG if debug else logging.INFO)
    root.addHandler(handler)

    # Werkzeug logs every request in its own text format; we replace that
    # with our own after_request hook in app.py, so silence Werkzeug here.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
