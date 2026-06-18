"""Shared pytest fixtures for the regression test suite."""
from __future__ import annotations

from pathlib import Path

import pytest
from flask import Flask

from backend.routes import products as products_module
from backend.routes.products import products_bp


@pytest.fixture
def tmp_products_dir(tmp_path: Path) -> Path:
    """Initialise a fresh products directory under pytest's tmp_path."""
    products_dir = tmp_path / "products"
    products_module._storage_error = False
    products_module.init_products_dir(products_dir)
    return products_dir


@pytest.fixture
def client(tmp_products_dir: Path):
    """Flask test client with only the products blueprint registered."""
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(products_bp)
    return app.test_client()
