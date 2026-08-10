"""Regression tests for backend/routes/reports.py.

DEV-H-7: /api/render-pdf must require at least 'editor' role.
A session authenticated as 'viewer' must receive HTTP 403.

The auth guard is a no-op when GOOGLE_CLIENT_ID is not set, so we set that
env-var in the test to activate OAuth enforcement, then inject a viewer session
directly via the Flask test client.

Run:
    python -m pytest tests/test_reports.py -v
"""
from __future__ import annotations

import os

import pytest
from flask import Flask
from unittest.mock import patch

from backend.database import db as _db
from backend.models import User
from backend.routes.reports import reports_bp


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def app(tmp_path):
    """Flask application with an in-memory DB and the reports blueprint."""
    application = Flask(__name__)
    application.config["TESTING"] = True
    application.config["SECRET_KEY"] = "test-secret"
    application.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    application.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    _db.init_app(application)
    application.register_blueprint(reports_bp)

    with application.app_context():
        import backend.models  # noqa: F401
        _db.create_all()

        # Seed a viewer user so require_role can find them in the DB.
        viewer = User(email="viewer@example.com", role="viewer")
        _db.session.add(viewer)
        _db.session.commit()

        yield application

        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


# ---------------------------------------------------------------------------
# DEV-H-7: viewer role must be forbidden from /api/render-pdf
# ---------------------------------------------------------------------------


def test_render_pdf_viewer_forbidden(client):
    """A session with role 'viewer' must receive HTTP 403 on POST /api/render-pdf.

    The role check fires before any PDF rendering, so no Playwright/Chromium
    is invoked — this test passes without credentials or a browser installed.
    """
    # Activate OAuth enforcement by pretending GOOGLE_CLIENT_ID is set.
    with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "fake-client-id"}):
        # Reload the cached _OAUTH_ENABLED flag inside auth_service so the
        # patch takes effect for this request.
        import backend.services.auth_service as auth_mod
        original = auth_mod._OAUTH_ENABLED
        auth_mod._OAUTH_ENABLED = True
        try:
            with client.session_transaction() as sess:
                sess["user_email"] = "viewer@example.com"
                sess["user_role"] = "viewer"

            rv = client.post(
                "/api/render-pdf",
                json={"html": "<html></html>", "meta": {}},
            )
        finally:
            auth_mod._OAUTH_ENABLED = original

    assert rv.status_code == 403, (
        f"Expected 403 Forbidden for viewer role, got {rv.status_code}: {rv.get_data(as_text=True)}"
    )
