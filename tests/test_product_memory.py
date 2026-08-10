"""Tests for ProductMemoryEntry CRUD via the products blueprint.

Exercises the memory endpoints:
  GET    /api/products/<id>/memory
  POST   /api/products/<id>/memory/entry
  DELETE /api/products/<id>/memory/entry

Uses the shared fixtures from tests/conftest.py (in-memory SQLite, products_bp registered).

Run with:
    python -m pytest tests/test_product_memory.py -v
"""
from __future__ import annotations

from datetime import UTC, datetime

import pytest

from backend.database import db as _db
from backend.models import Product, ProductMemoryEntry


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_product(client, product_id: str, name: str = "Test Product") -> None:
    """Insert a minimal Product row inside the app context."""
    with client.application.app_context():
        product = Product(
            id=product_id,
            name=name,
            owner="owner",
            owner_email="owner@example.com",
            env="test",
            subscription_ids=["sub-1"],
            scan_frequency="quarterly",
            created_at=datetime.now(UTC),
        )
        _db.session.add(product)
        _db.session.commit()


# ---------------------------------------------------------------------------
# GET /api/products/<id>/memory
# ---------------------------------------------------------------------------


class TestGetMemory:
    def test_returns_404_for_unknown_product(self, client):
        response = client.get("/api/products/nonexistent-product/memory")
        assert response.status_code == 404

    def test_returns_empty_entries_for_new_product(self, client):
        _create_product(client, "mem-get-empty")
        response = client.get("/api/products/mem-get-empty/memory")
        assert response.status_code == 200
        data = response.get_json()
        assert data["version"] == 1
        assert data["entries"] == {}

    def test_returns_stored_entries(self, client):
        _create_product(client, "mem-get-entries")
        # Insert an entry directly into DB
        with client.application.app_context():
            _db.session.add(ProductMemoryEntry(
                product_id="mem-get-entries",
                subscription="test-sub",
                title="some finding",
                reason="risk accepted",
                source="excepted",
            ))
            _db.session.commit()

        response = client.get("/api/products/mem-get-entries/memory")
        assert response.status_code == 200
        data = response.get_json()
        assert data["version"] == 1
        # The key format is "<subscription>::<title>" (lowercased)
        assert "test-sub::some finding" in data["entries"]
        entry = data["entries"]["test-sub::some finding"]
        assert entry["exception"] is True
        assert entry["reason"] == "risk accepted"
        assert entry["source"] == "excepted"


# ---------------------------------------------------------------------------
# POST /api/products/<id>/memory/entry
# ---------------------------------------------------------------------------


class TestUpsertMemoryEntry:
    def test_creates_entry_returns_200(self, client):
        _create_product(client, "mem-post-create")
        response = client.post(
            "/api/products/mem-post-create/memory/entry",
            json={
                "subscription": "my-sub",
                "title": "My Finding",
                "reason": "acceptable risk",
                "source": "excepted",
            },
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["ok"] is True
        assert "key" in data

    def test_entry_is_persisted_to_db(self, client):
        _create_product(client, "mem-post-persist")
        client.post(
            "/api/products/mem-post-persist/memory/entry",
            json={
                "subscription": "sub-a",
                "title": "Finding A",
                "reason": "low risk",
                "source": "excepted",
            },
        )
        with client.application.app_context():
            entry = ProductMemoryEntry.query.filter_by(
                product_id="mem-post-persist",
                subscription="sub-a",
                title="finding a",  # stored lowercased
            ).first()
            assert entry is not None
            assert entry.reason == "low risk"
            assert entry.source == "excepted"

    def test_upserts_existing_entry_updates_reason(self, client):
        _create_product(client, "mem-post-upsert")
        payload = {
            "subscription": "sub-b",
            "title": "Finding B",
            "reason": "original reason",
            "source": "excepted",
        }
        client.post("/api/products/mem-post-upsert/memory/entry", json=payload)
        # Update with new reason
        payload["reason"] = "updated reason"
        response = client.post(
            "/api/products/mem-post-upsert/memory/entry", json=payload
        )
        assert response.status_code == 200

        with client.application.app_context():
            entry = ProductMemoryEntry.query.filter_by(
                product_id="mem-post-upsert",
                subscription="sub-b",
                title="finding b",
            ).first()
            assert entry.reason == "updated reason"

    def test_missing_subscription_returns_400(self, client):
        _create_product(client, "mem-post-miss-sub")
        response = client.post(
            "/api/products/mem-post-miss-sub/memory/entry",
            json={"title": "Finding", "reason": ""},
        )
        assert response.status_code == 400

    def test_missing_title_returns_400(self, client):
        _create_product(client, "mem-post-miss-title")
        response = client.post(
            "/api/products/mem-post-miss-title/memory/entry",
            json={"subscription": "sub-c", "reason": ""},
        )
        assert response.status_code == 400

    def test_unknown_product_returns_404(self, client):
        response = client.post(
            "/api/products/does-not-exist/memory/entry",
            json={"subscription": "sub", "title": "t", "reason": ""},
        )
        assert response.status_code == 404

    def test_invalid_source_defaults_to_excepted(self, client):
        _create_product(client, "mem-post-bad-source")
        client.post(
            "/api/products/mem-post-bad-source/memory/entry",
            json={
                "subscription": "sub-d",
                "title": "Finding D",
                "reason": "",
                "source": "unknown_value",
            },
        )
        with client.application.app_context():
            entry = ProductMemoryEntry.query.filter_by(
                product_id="mem-post-bad-source",
                subscription="sub-d",
                title="finding d",
            ).first()
            assert entry is not None
            assert entry.source == "excepted"

    def test_deleted_source_accepted(self, client):
        _create_product(client, "mem-post-deleted")
        response = client.post(
            "/api/products/mem-post-deleted/memory/entry",
            json={
                "subscription": "sub-e",
                "title": "Finding E",
                "reason": "",
                "source": "deleted",
            },
        )
        assert response.status_code == 200
        with client.application.app_context():
            entry = ProductMemoryEntry.query.filter_by(
                product_id="mem-post-deleted",
                subscription="sub-e",
                title="finding e",
            ).first()
            assert entry is not None
            assert entry.source == "deleted"


# ---------------------------------------------------------------------------
# DELETE /api/products/<id>/memory/entry
# ---------------------------------------------------------------------------


class TestDeleteMemoryEntry:
    def test_deletes_existing_entry_returns_200(self, client):
        _create_product(client, "mem-del-exists")
        # Create entry first
        client.post(
            "/api/products/mem-del-exists/memory/entry",
            json={"subscription": "sub-f", "title": "Finding F", "reason": ""},
        )
        response = client.delete(
            "/api/products/mem-del-exists/memory/entry",
            json={"subscription": "sub-f", "title": "Finding F"},
        )
        assert response.status_code == 200

        with client.application.app_context():
            entry = ProductMemoryEntry.query.filter_by(
                product_id="mem-del-exists",
                subscription="sub-f",
                title="finding f",
            ).first()
            assert entry is None

    def test_delete_nonexistent_entry_returns_200(self, client):
        """Deleting an entry that doesn't exist should not error."""
        _create_product(client, "mem-del-missing")
        response = client.delete(
            "/api/products/mem-del-missing/memory/entry",
            json={"subscription": "sub-g", "title": "Finding G"},
        )
        assert response.status_code == 200

    def test_delete_unknown_product_returns_404(self, client):
        response = client.delete(
            "/api/products/does-not-exist/memory/entry",
            json={"subscription": "sub", "title": "t"},
        )
        assert response.status_code == 404
