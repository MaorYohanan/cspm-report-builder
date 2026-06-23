"""Shared pytest fixtures for the regression test suite."""
from __future__ import annotations

import pytest
from flask import Flask

from backend.database import db as _db
from backend.routes.products import products_bp


@pytest.fixture
def app():
    """Flask application with an isolated in-memory SQLite database."""
    application = Flask(__name__)
    application.config["TESTING"] = True
    application.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    application.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    _db.init_app(application)

    with application.app_context():
        import backend.models  # noqa: F401 — registers all models
        _db.create_all()
        yield application
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    """Flask test client with the products blueprint registered."""
    app.register_blueprint(products_bp)
    return app.test_client()
