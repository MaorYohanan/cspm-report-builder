"""Authentication helpers and role-checking decorator.

When GOOGLE_CLIENT_ID is not set, OAuth is disabled and all require_role
decorators are no-ops — existing APP_TOKEN behaviour is unchanged.
"""
from __future__ import annotations

import hmac
import os
from datetime import UTC, datetime
from functools import wraps

from flask import jsonify, request, session

from backend.database import db
from backend.models import User

# Role hierarchy: higher index = more permissive
_ROLE_ORDER: dict[str, int] = {"viewer": 0, "editor": 1, "admin": 2}


def get_or_create_user(email: str) -> User | None:
    """Return the DB User for *email*, creating an Admin if bootstrap applies.

    Bootstrap rules (checked only when the user does NOT already exist):
    - If the Users table is empty → create Admin automatically.
    - If INITIAL_ADMIN_EMAIL matches the email → create Admin automatically.
    - Otherwise → return None (caller should reject the login).
    """
    user = db.session.execute(
        db.select(User).where(User.email == email)
    ).scalar_one_or_none()
    if user:
        return user

    count = db.session.execute(
        db.select(db.func.count()).select_from(User)
    ).scalar()
    initial_admin = os.environ.get("INITIAL_ADMIN_EMAIL", "").strip().lower()

    if count == 0 or (initial_admin and email.lower() == initial_admin):
        user = User(email=email, role="admin", created_at=datetime.now(UTC))
        db.session.add(user)
        db.session.commit()
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
            if not os.environ.get("GOOGLE_CLIENT_ID"):
                return f(*args, **kwargs)

            # APP_TOKEN bearer bypass (for scripts / CI)
            app_token = os.environ.get("APP_TOKEN", "")
            if app_token:
                auth_header = request.headers.get("Authorization", "")
                if auth_header.startswith("Bearer ") and hmac.compare_digest(
                    auth_header[7:], app_token
                ):
                    return f(*args, **kwargs)

            user_role = session.get("user_role", "")
            if not user_role:
                return jsonify({"error": "Unauthorized"}), 401
            if _ROLE_ORDER.get(user_role, -1) < _ROLE_ORDER.get(min_role, 0):
                return jsonify({"error": "Forbidden"}), 403
            return f(*args, **kwargs)

        return wrapped

    return decorator


def current_user_email() -> str | None:
    return session.get("user_email")


def current_user_role() -> str | None:
    return session.get("user_role")
