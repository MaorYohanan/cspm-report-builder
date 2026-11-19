"""BL-16 audit log service.

``record_event`` appends one ``AuditEvent`` row. It is best-effort: it has its own
try/except, logs on failure and never raises, so a failing audit write can never
turn a successful user action into an error. Call it AFTER the primary action has
committed, and outside any ``_get_product_lock`` section.

The log is append-only: this module offers insert and read helpers only, and ORM
update/delete of an ``AuditEvent`` is blocked by mapper event listeners.
"""
from __future__ import annotations

import hmac
import ipaddress
import json
import logging
import os
import re
from datetime import datetime, time, timedelta, timezone
from typing import Any

from flask import has_request_context, request, session
from sqlalchemy import event

from backend.database import db
from backend.models import AuditEvent

_log = logging.getLogger(__name__)

MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 25

_MAX_STR = 300          # per string value inside details
_MAX_LIST = 20          # items kept per list inside details
_MAX_DEPTH = 4
_MAX_DETAILS = 4000     # serialized details cap (characters)
_SECRET_KEY_RE = re.compile(
    r"secret|token|passw|pwd|api[-_]?key|authorization|credential|cookie|private[-_]?key|bearer",
    re.IGNORECASE,
)
_TRACE_RE = re.compile(r"Traceback \(most recent call last\)|File \".+\", line \d+")


# ---------------------------------------------------------------------------
# Append-only guard
# ---------------------------------------------------------------------------

def _block_mutation(mapper, connection, target):  # noqa: ARG001
    raise RuntimeError("AuditEvent rows are append-only")


event.listen(AuditEvent, "before_update", _block_mutation)
event.listen(AuditEvent, "before_delete", _block_mutation)


# ---------------------------------------------------------------------------
# Sanitising
# ---------------------------------------------------------------------------

def _clean(value: Any, depth: int = 0) -> Any:
    if depth > _MAX_DEPTH:
        return "[truncated]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        if _TRACE_RE.search(value):
            return "[redacted]"
        return value if len(value) <= _MAX_STR else value[:_MAX_STR] + "…"
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            key = str(k)[:60]
            if _SECRET_KEY_RE.search(key):
                continue
            out[key] = _clean(v, depth + 1)
        return out
    if isinstance(value, (list, tuple, set)):
        return [_clean(v, depth + 1) for v in list(value)[:_MAX_LIST]]
    return _clean(str(value), depth)


def sanitize_details(details: Any) -> str | None:
    """Return compact JSON text for ``details`` (secret keys dropped, strings/size capped)."""
    if details is None:
        return None
    text = json.dumps(_clean(details), ensure_ascii=False, separators=(",", ":"), default=str)
    if len(text) > _MAX_DETAILS:
        text = json.dumps({"truncated": True, "preview": text[:_MAX_DETAILS - 100]},
                          ensure_ascii=False, separators=(",", ":"))
    return text


# ---------------------------------------------------------------------------
# Actor
# ---------------------------------------------------------------------------

def resolve_actor() -> tuple[str, str]:
    """Return (actor, actor_role) strings for the current request."""
    if not has_request_context():
        return "system", "system"
    email = session.get("user_email")
    if email:
        return str(email), str(session.get("user_role") or "unknown")
    app_token = os.environ.get("APP_TOKEN", "")
    header = request.headers.get("Authorization", "")
    if app_token and header.startswith("Bearer ") and hmac.compare_digest(header[7:], app_token):
        return "app-token", "admin"
    return "anonymous", "unknown"


_CTRL_RE = re.compile(r"[\x00-\x1f\x7f-\x9f  ]")
_MAX_IP = 64
_MAX_UA = 300


_BIDI_RE = re.compile("[‪-‮⁦-⁩‎‏؜]")


def _valid_ip(value: Any) -> str | None:
    """Return the canonical IP string if value is a valid IP, else None.

    Accepts surrounding whitespace, a bracketed IPv6 ([::1]) and an IPv6 zone id (fe80::1%eth0).
    """
    if not value:
        return None
    s = str(value).strip()
    if s.startswith("[") and s.endswith("]"):
        s = s[1:-1]
    s = s.split("%", 1)[0]
    try:
        return str(ipaddress.ip_address(s))[:_MAX_IP]
    except ValueError:
        return None


def resolve_client_meta() -> tuple[str | None, str | None]:
    """Return (source_ip, user_agent) for the current request; (None, None) without one.

    Own try/except: reading the request must never break the audited action.
    """
    if not has_request_context():
        return None, None
    ip: str | None = None
    ua: str | None = None
    try:
        from backend.services.client_ip import get_client_ip
        ip = _valid_ip(get_client_ip()) or _valid_ip(request.remote_addr)
    except Exception:
        _log.warning("Audit source IP could not be read", exc_info=True)
    try:
        ua = _CTRL_RE.sub("", _BIDI_RE.sub("", request.headers.get("User-Agent", ""))).strip()[:_MAX_UA] or None
    except Exception:
        _log.warning("Audit user agent could not be read", exc_info=True)
    return ip, ua


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------

def record_event(
    action: str,
    entity_type: str,
    entity_id: Any = None,
    product_id: str | None = None,
    details: Any = None,
) -> bool:
    """Append one audit row. Never raises; returns True when the row was written."""
    try:
        actor, role = resolve_actor()
        source_ip, user_agent = resolve_client_meta()
        row = AuditEvent(
            timestamp=datetime.now(timezone.utc),
            actor=actor[:254],
            actor_role=role[:20],
            action=str(action)[:60],
            entity_type=str(entity_type)[:40],
            entity_id=None if entity_id is None else str(entity_id)[:300],
            product_id=None if product_id is None else str(product_id)[:100],
            details=sanitize_details(details),
            source_ip=source_ip,
            user_agent=user_agent,
        )
        db.session.add(row)
        db.session.commit()
        return True
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass
        _log.error("Audit event could not be recorded (action=%s)", action, exc_info=True)
        return False


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

def _iso_z(ts: datetime | None) -> str | None:
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_details(text: str | None) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return text


def event_to_dict(e: AuditEvent) -> dict:
    return {
        "id": e.id,
        "timestamp": _iso_z(e.timestamp),
        "actor": e.actor,
        "action": e.action,
        "entity_type": e.entity_type,
        "entity_id": e.entity_id,
        "product_id": e.product_id,
        "details": _parse_details(e.details),
        "source_ip": e.source_ip,
        "user_agent": e.user_agent,
    }


def _parse_day(value: str) -> datetime:
    return datetime.combine(datetime.strptime(value, "%Y-%m-%d").date(), time.min)


def _clamp_int(value: Any, default: int, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def list_events(args) -> dict:
    """Filtered, paged (newest first) read of the audit log. Raises ValueError on a bad date."""
    q = db.select(AuditEvent)
    cnt = db.select(db.func.count()).select_from(AuditEvent)
    conds = []
    for key in ("actor", "action", "entity_type", "entity_id", "product_id", "source_ip"):
        val = (args.get(key) or "").strip()
        if val:
            conds.append(getattr(AuditEvent, key) == val)
    date_from = (args.get("date_from") or "").strip()
    date_to = (args.get("date_to") or "").strip()
    try:
        if date_from:
            conds.append(AuditEvent.timestamp >= _parse_day(date_from))
        if date_to:  # inclusive of the whole day
            conds.append(AuditEvent.timestamp < _parse_day(date_to) + timedelta(days=1))
    except ValueError:
        raise ValueError("date_from/date_to must be YYYY-MM-DD") from None

    for c in conds:
        q = q.where(c)
        cnt = cnt.where(c)

    page_size = _clamp_int(args.get("page_size"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
    page = _clamp_int(args.get("page"), 1, 1, 10**9)
    total = db.session.execute(cnt).scalar() or 0
    rows = db.session.execute(
        q.order_by(AuditEvent.timestamp.desc(), AuditEvent.id.desc())
        .limit(page_size).offset((page - 1) * page_size)
    ).scalars().all()
    return {
        "items": [event_to_dict(r) for r in rows],
        "page": page,
        "page_size": page_size,
        "total": total,
    }
