"""Extended regression tests for the products blueprint.

Covers:
  - DEV-M-10: delete_version must reject published snapshots with HTTP 409.
  - Memory entry reason length capping (> _MAX_REASON_LEN chars silently truncated to "").
  - Memory entry title length rejection (> _MAX_TITLE_LEN chars returns 400).

Uses the shared app/client fixtures from tests/conftest.py (in-memory SQLite).

Run with:
    python -m pytest tests/test_products_extended.py -v
"""
from __future__ import annotations

from datetime import UTC, datetime

import pytest

from backend.database import db as _db
from backend.models import Product, ProductMemoryEntry, ReportSnapshot
from backend.routes.products import _MAX_REASON_LEN, _MAX_TITLE_LEN


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


# ---------------------------------------------------------------------------
# Memory entry length cap
# ---------------------------------------------------------------------------


class TestNotesLengthCapped:
    """Verify that overly-long reason strings are silently capped to empty string,
    and overly-long title strings are rejected with HTTP 400.
    """

    def _make_product(self, client, product_id: str) -> None:
        with client.application.app_context():
            product = Product(
                id=product_id,
                name=f"Test Memory Cap {product_id}",
                owner="owner",
                owner_email="owner@example.com",
                env="test",
                subscription_ids=["sub-1"],
                scan_frequency="quarterly",
                created_at=datetime.now(UTC),
            )
            _db.session.add(product)
            _db.session.commit()

    def test_notes_length_capped_reason_too_long(self, client):
        """A reason string longer than _MAX_REASON_LEN must be silently capped to
        empty string and the entry must still be stored (HTTP 200)."""
        self._make_product(client, "mem-cap-reason")

        over_limit_reason = "x" * (_MAX_REASON_LEN + 1)
        response = client.post(
            "/api/products/mem-cap-reason/memory/entry",
            json={
                "subscription": "test-sub",
                "title": "some finding title",
                "reason": over_limit_reason,
                "source": "excepted",
            },
        )
        assert response.status_code == 200, (
            f"Expected HTTP 200 when reason is too long (silently capped), "
            f"got {response.status_code}. Body: {response.get_data(as_text=True)}"
        )

        # Verify the stored reason was capped to empty string
        with client.application.app_context():
            entry = ProductMemoryEntry.query.filter_by(
                product_id="mem-cap-reason",
                subscription="test-sub",
                title="some finding title",
            ).first()
            assert entry is not None, "Entry should have been stored"
            assert entry.reason == "", (
                f"Expected reason to be capped to empty string, got: {entry.reason!r}"
            )

    def test_notes_length_capped_title_too_long(self, client):
        """A title string longer than _MAX_TITLE_LEN must be rejected with HTTP 400."""
        self._make_product(client, "mem-cap-title")

        over_limit_title = "t" * (_MAX_TITLE_LEN + 1)
        response = client.post(
            "/api/products/mem-cap-title/memory/entry",
            json={
                "subscription": "test-sub",
                "title": over_limit_title,
                "reason": "valid reason",
                "source": "excepted",
            },
        )
        assert response.status_code == 400, (
            f"Expected HTTP 400 when title is too long, got {response.status_code}. "
            f"Body: {response.get_data(as_text=True)}"
        )
        data = response.get_json()
        assert "error" in data
