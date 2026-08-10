"""Authentication helpers and role-checking decorator.

When GOOGLE_CLIENT_ID is not set, OAuth is disabled and all require_role
decorators are no-ops — existing APP_TOKEN behaviour is unchanged.
"""
from __future__ import annotations

import hmac
import logging
import os
from datetime import UTC, datetime
from functools import wraps

from flask import jsonify, redirect, request, session, url_for
from sqlalchemy.exc import IntegrityError

from backend.database import db
from backend.models import User

_log = logging.getLogger(__name__)

# Role hierarchy: higher index = more permissive
_ROLE_ORDER: dict[str, int] = {"viewer": 0, "editor": 1, "admin": 2}

# Cached at module load — these are static env config, not request-time values.
_OAUTH_ENABLED: bool = bool(os.environ.get("GOOGLE_CLIENT_ID"))
_APP_TOKEN: str = os.environ.get("APP_TOKEN", "")


def get_or_create_user(email: str) -> User | None:
    """Return the DB User for *email*, creating an Admin if bootstrap applies.

    Bootstrap rules (checked only when the user does NOT already exist):
    - If the Users table is empty → first login gets Admin automatically.
      If INITIAL_ADMIN_EMAIL is set it acts as a filter: only that specific
      email may claim the bootstrap slot; all others are rejected until the
      designated admin logs in first and then adds them via the UI.
    - If the table already has users → the email must already be in the DB
      (added by an admin). No auto-promotion. Return None to reject.
    """
    user = db.session.execute(
        db.select(User).where(User.email == email)
    ).scalar_one_or_none()
    if user:
        return user

    count = db.session.execute(
        db.select(db.func.count()).select_from(User)
    ).scalar()

    if count == 0:
        initial_admin = os.environ.get("INITIAL_ADMIN_EMAIL", "").strip().lower()
        if initial_admin and email.lower() != initial_admin:
            # Table is empty but this isn't the designated first admin.
            # Reject so the intended admin can claim the bootstrap slot.
            return None
        user = User(email=email, role="admin", created_at=datetime.now(UTC))
        db.session.add(user)
        try:
            db.session.commit()
        except IntegrityError:
            # Two concurrent first-logins: the other request won the race.
            db.session.rollback()
            return db.session.execute(
                db.select(User).where(User.email == email)
            ).scalar_one_or_none()
        except Exception:
            db.session.rollback()
            raise
        return user

    return None


def require_role(min_role: str):
    """Decorator that enforces a minimum role level on a route.

    No-op when GOOGLE_CLIENT_ID is not set (OAuth disabled).
    APP_TOKEN bearer grants implicit admin access even in OAuth mode.
    """
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            if not _OAUTH_ENABLED:
                return f(*args, **kwargs)

            # APP_TOKEN bearer bypass (for scripts / CI)
            if _APP_TOKEN:
                auth_header = request.headers.get("Authorization", "")
                if auth_header.startswith("Bearer ") and hmac.compare_digest(
                    auth_header[7:], _APP_TOKEN
                ):
                    _log.warning(
                        "APP_TOKEN bypass used on role-gated route",
                        extra={"route": request.path, "method": request.method},
                    )
                    return f(*args, **kwargs)

            user_email = session.get("user_email", "")
            is_api = request.path.startswith("/api/")
            if not user_email:
                if is_api:
                    return jsonify({"error": "Unauthorized"}), 401
                return redirect(url_for("auth.login"))
            # Re-read role from DB on every request so role demotions take effect immediately.
            db_user = db.session.execute(
                db.select(User).where(User.email == user_email)
            ).scalar_one_or_none()
            if not db_user:
                session.clear()
                if is_api:
                    return jsonify({"error": "Unauthorized"}), 401
                return redirect(url_for("auth.login"))
            user_role = db_user.role
            session["user_role"] = user_role  # keep session in sync
            if _ROLE_ORDER.get(user_role, -1) < _ROLE_ORDER.get(min_role, 0):
                if is_api:
                    return jsonify({"error": "Forbidden"}), 403
                return redirect(url_for("auth.error", reason="forbidden"))
            return f(*args, **kwargs)

        return wrapped

    return decorator


def current_user_email() -> str | None:
    return session.get("user_email")


def current_user_role() -> str | None:
    return session.get("user_role")
