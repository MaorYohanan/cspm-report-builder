"""Google OAuth authentication and user management endpoints."""
from __future__ import annotations

import os
from datetime import UTC, datetime

from flask import (
    Blueprint,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

from backend.database import db
from backend.models import User
from backend.oauth import oauth
from backend.services.auth_service import get_or_create_user, require_role

auth_bp = Blueprint("auth", __name__)

_VALID_ROLES = {"viewer", "editor", "admin"}


# ---------------------------------------------------------------------------
# OAuth flow
# ---------------------------------------------------------------------------


@auth_bp.route("/auth/login")
def login():
    if not os.environ.get("GOOGLE_CLIENT_ID"):
        return redirect("/")
    redirect_uri = url_for("auth.callback", _external=True)
    return oauth.google.authorize_redirect(redirect_uri)


@auth_bp.route("/auth/callback")
def callback():
    try:
        token = oauth.google.authorize_access_token()
    except Exception:
        return redirect(url_for("auth.error", reason="invalid"))
    userinfo = token.get("userinfo", {})
    email = (userinfo.get("email") or "").lower().strip()

    if not email or not userinfo.get("email_verified"):
        return redirect(url_for("auth.error", reason="invalid"))

    # Gate 1: domain whitelist
    allowed_domain = os.environ.get("ALLOWED_DOMAIN", "").strip().lower()
    if allowed_domain and not email.endswith(f"@{allowed_domain}"):
        return redirect(url_for("auth.error", reason="domain"))

    # Gate 2: DB whitelist + bootstrap
    user = get_or_create_user(email)
    if user is None:
        return redirect(url_for("auth.error", reason="unauthorized"))

    session.permanent = True
    session["user_email"] = user.email
    session["user_role"] = user.role
    session["user_id"] = user.id
    return redirect("/")


@auth_bp.route("/auth/logout")
def logout():
    session.clear()
    return redirect(url_for("auth.login"))


@auth_bp.route("/auth/error")
def error():
    reason = request.args.get("reason", "unknown")
    messages = {
        "domain": "הדומיין שלך אינו מורשה לגשת למערכת. פנה למנהל המערכת.",
        "unauthorized": "חשבונך אינו ברשימת המורשים. פנה למנהל המערכת לקבלת הרשאה.",
        "forbidden": "אין לך הרשאה לגשת לדף זה.",
        "invalid": "שגיאת אימות. אנא נסה שוב.",
        "unknown": "שגיאה לא ידועה. אנא נסה שוב.",
    }
    msg = messages.get(reason, messages["unknown"])
    return render_template("auth_error.html", message=msg), 403


# ---------------------------------------------------------------------------
# Current user info
# ---------------------------------------------------------------------------


@auth_bp.route("/api/me")
def me():
    email = session.get("user_email")
    role = session.get("user_role")
    oauth_enabled = bool(os.environ.get("GOOGLE_CLIENT_ID"))
    if not oauth_enabled:
        return jsonify({"oauth_enabled": False, "authenticated": True})
    if not email:
        return jsonify({"oauth_enabled": True, "authenticated": False}), 401
    return jsonify({"oauth_enabled": True, "authenticated": True, "email": email, "role": role})


# ---------------------------------------------------------------------------
# Admin page
# ---------------------------------------------------------------------------


@auth_bp.route("/admin")
@require_role("admin")
def admin_page():
    return render_template("admin.html")


# ---------------------------------------------------------------------------
# User management API (admin only)
# ---------------------------------------------------------------------------


@auth_bp.route("/api/users", methods=["GET"])
@require_role("admin")
def list_users():
    users = db.session.execute(db.select(User).order_by(User.created_at)).scalars().all()
    return jsonify([
        {"id": u.id, "email": u.email, "role": u.role,
         "created_at": u.created_at.isoformat() if u.created_at else None}
        for u in users
    ])


@auth_bp.route("/api/users", methods=["POST"])
@require_role("admin")
def create_user():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").lower().strip()
    role = (data.get("role") or "").lower().strip()

    if not email or "@" not in email:
        return jsonify({"error": "Invalid email"}), 400
    if role not in _VALID_ROLES:
        return jsonify({"error": f"Role must be one of: {', '.join(sorted(_VALID_ROLES))}"}), 400

    existing = db.session.execute(
        db.select(User).where(User.email == email)
    ).scalar_one_or_none()
    if existing:
        return jsonify({"error": "User already exists"}), 409

    user = User(email=email, role=role, created_at=datetime.now(UTC))
    db.session.add(user)
    db.session.commit()
    return jsonify({"id": user.id, "email": user.email, "role": user.role}), 201


@auth_bp.route("/api/users/<int:user_id>", methods=["PATCH"])
@require_role("admin")
def update_user(user_id: int):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "Not found"}), 404

    data = request.get_json(silent=True) or {}
    new_role = (data.get("role") or "").lower().strip()
    if new_role not in _VALID_ROLES:
        return jsonify({"error": f"Role must be one of: {', '.join(sorted(_VALID_ROLES))}"}), 400

    # Prevent self-demotion
    if user.email == session.get("user_email") and new_role != "admin":
        return jsonify({"error": "Cannot change your own role"}), 400

    user.role = new_role
    db.session.commit()
    return jsonify({"id": user.id, "email": user.email, "role": user.role})


@auth_bp.route("/api/users/<int:user_id>", methods=["DELETE"])
@require_role("admin")
def delete_user(user_id: int):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "Not found"}), 404

    if user.email == session.get("user_email"):
        return jsonify({"error": "Cannot delete your own account"}), 400

    db.session.delete(user)
    db.session.commit()
    return jsonify({"ok": True})
