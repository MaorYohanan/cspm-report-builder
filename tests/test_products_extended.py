"""Extended regression tests for the products blueprint.

Covers:
  - DEV-M-10: delete_version must reject published snapshots with HTTP 409.

Uses the shared app/client fixtures from tests/conftest.py (in-memory SQLite).

Run with:
    python -m pytest tests/test_products_extended.py -v
"""
from __future__ import annotations

from datetime import UTC, datetime

import pytest

from backend.database import db as _db
from backend.models import Product, ReportSnapshot


# ---------------------------------------------------------------------------
# DEV-M-10 — delete_version rejects published snapshots
# ---------------------------------------------------------------------------


class TestDeletePublishedVersionRejected:
    """A published snapshot must not be deletable — HTTP 409 expected."""

    def test_delete_published_version_returns_409(self, client):
        """
        Given a product with one published snapshot at version '1.0',
        when DELETE /api/products/<id>/versions/1.0 is called,
        the response must be HTTP 409.
        """
        with client.application.app_context():
            product = Product(
                id="test-product-del",
                name="Test Product Delete",
                owner="owner",
                owner_email="owner@example.com",
                env="test",
                subscription_ids=["sub-1"],
                scan_frequency="quarterly",
                created_at=datetime.now(UTC),
            )
            _db.session.add(product)
            _db.session.flush()

            snap = ReportSnapshot(
                product_id="test-product-del",
                version="1.0",
                version_type="major",
                version_notes="",
                status="published",
                saved_at=datetime.now(UTC),
                published_at=datetime.now(UTC),
                risk_score=0,
                snapshot_data={},
            )
            _db.session.add(snap)
            _db.session.commit()

        response = client.delete("/api/products/test-product-del/versions/1.0")
        assert response.status_code == 409, (
            f"Expected HTTP 409 for deleting a published version, got {response.status_code}. "
            f"Body: {response.get_data(as_text=True)}"
        )
        data = response.get_json()
        assert "error" in data
        assert "published" in data["error"].lower()

    def test_delete_draft_version_succeeds(self, client):
        """A draft snapshot should still be deletable (HTTP 200)."""
        with client.application.app_context():
            product = Product(
                id="test-product-draft",
                name="Test Product Draft",
                owner="owner",
                owner_email="owner@example.com",
                env="test",
                subscription_ids=["sub-1"],
                scan_frequency="quarterly",
                created_at=datetime.now(UTC),
            )
            _db.session.add(product)
            _db.session.flush()

            snap = ReportSnapshot(
                product_id="test-product-draft",
                version="1.0",
                version_type="major",
                version_notes="",
                status="draft",
                saved_at=datetime.now(UTC),
                published_at=None,
                risk_score=0,
                snapshot_data={},
            )
            _db.session.add(snap)
            _db.session.commit()

        response = client.delete("/api/products/test-product-draft/versions/1.0")
        assert response.status_code == 200, (
            f"Expected HTTP 200 for deleting a draft version, got {response.status_code}. "
            f"Body: {response.get_data(as_text=True)}"
        )
