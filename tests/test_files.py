"""Regression tests for backend/routes/files.py.

Tests confirm that the atomic write pattern (temp file + os.replace) is used
when uploading state files — no .tmp_* artefact should remain after a request,
and the written file must contain valid JSON.

Run:
    python -m pytest tests/test_files.py -v
"""
from __future__ import annotations

import json

import pytest
from flask import Flask

from backend.database import db as _db
from backend.routes.files import files_bp, init_directories


@pytest.fixture
def tmp_states_dir(tmp_path):
    """Isolated directory for state files, cleaned up after each test."""
    states = tmp_path / "states"
    states.mkdir()
    outputs = tmp_path / "output"
    outputs.mkdir()
    return tmp_path, states, outputs


@pytest.fixture
def app(tmp_states_dir):
    """Flask test application with the files blueprint registered."""
    base_dir, states_dir, output_dir = tmp_states_dir

    application = Flask(__name__)
    application.config["TESTING"] = True
    application.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    application.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    _db.init_app(application)

    # Wire up the directory paths before the blueprint handles requests.
    init_directories(base_dir, states_dir, output_dir)
    application.register_blueprint(files_bp)

    with application.app_context():
        import backend.models  # noqa: F401 — registers all ORM models
        _db.create_all()
        yield application
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_STATE = json.dumps({
    "meta": {"client": "Acme Corp", "reportDate": "01/01/2026"},
    "findings": [],
})


def _post_state(client, body: str = _VALID_STATE):
    return client.post(
        "/api/upload-state",
        data=body,
        content_type="application/json",
    )


# ---------------------------------------------------------------------------
# DEV-H-3: atomic write — no .tmp_* files survive a successful upload
# ---------------------------------------------------------------------------


def test_upload_state_no_tmp_files_remain(client, tmp_states_dir):
    """After a successful upload no .tmp_* artefact must linger in STATES_DIR."""
    _, states_dir, _ = tmp_states_dir

    rv = _post_state(client)
    assert rv.status_code == 201

    tmp_files = list(states_dir.glob(".tmp_*.json"))
    assert tmp_files == [], (
        f"Temporary file(s) were not cleaned up: {tmp_files}"
    )


def test_upload_state_file_readable(client, tmp_states_dir):
    """The written state file must be parseable JSON matching the uploaded payload."""
    _, states_dir, _ = tmp_states_dir

    rv = _post_state(client)
    assert rv.status_code == 201

    body = rv.get_json()
    filename = body["filename"]
    written_path = states_dir / filename

    assert written_path.exists(), f"Expected state file not found: {written_path}"

    with open(written_path, encoding="utf-8") as fh:
        data = json.load(fh)

    assert data["meta"]["client"] == "Acme Corp"
    assert data["findings"] == []
