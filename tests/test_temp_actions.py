"""Unit tests for BL-12 Temporary Action feature.

Tests that:
1. temp_excepted is accepted (and temp_deleted rejected) by the API
2. ProductMemoryEntry model accepts temp_excepted
3. Database CHECK constraint enforces valid source values

Pipeline lifecycle tests live in tests/test_temp_actions_pipeline.py.

Run with:
    python -m pytest tests/test_temp_actions.py -v
"""
from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError

from backend.database import db as _db
from backend.models import Product, ProductMemoryEntry


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_product(app, product_id: str) -> str:
    """Create a minimal Product for testing and return its ID."""
    with app.app_context():
        product = Product(
            id=product_id,
            name=f"Test Product {product_id}",
            owner="owner",
            owner_email="owner@example.com",
            env="test",
            subscription_ids=["test-sub"],
            scan_frequency="quarterly",
            created_at=datetime.now(UTC),
        )
        _db.session.add(product)
        _db.session.commit()
        return product_id


# ---------------------------------------------------------------------------
# Model Tests
# ---------------------------------------------------------------------------


class TestProductMemoryEntryModel:
    """Test ProductMemoryEntry model with temp source values."""

    def test_temp_excepted_source_allowed(self, app):
        """BL-12: temp_excepted should be a valid source value."""
        product_id = _create_product(app, "model-temp-exc")
        with app.app_context():
            entry = ProductMemoryEntry(
                product_id=product_id,
                subscription="test-sub",
                title="test finding",
                reason="test",
                source="temp_excepted",
            )
            _db.session.add(entry)
            _db.session.commit()

            # Verify it was stored correctly
            retrieved = ProductMemoryEntry.query.filter_by(
                product_id=product_id,
                subscription="test-sub",
                title="test finding",
            ).first()
            assert retrieved is not None
            assert retrieved.source == "temp_excepted"

    def test_temp_deleted_source_rejected_by_check_constraint(self, app):
        """BL-12: temp delete was dropped — the CHECK constraint must refuse it."""
        product_id = _create_product(app, "model-temp-del")
        with app.app_context():
            _db.session.add(ProductMemoryEntry(
                product_id=product_id,
                subscription="test-sub-2",
                title="test finding 2",
                reason="test",
                source="temp_deleted",
            ))
            with pytest.raises(IntegrityError):
                _db.session.commit()
            _db.session.rollback()

    def test_permanent_sources_still_work(self, app):
        """Verify existing source values (excepted, deleted) still work."""
        product_id = _create_product(app, "model-perm")
        with app.app_context():
            entry1 = ProductMemoryEntry(
                product_id=product_id,
                subscription="sub-1",
                title="finding 1",
                reason="test",
                source="excepted",
            )
            entry2 = ProductMemoryEntry(
                product_id=product_id,
                subscription="sub-2",
                title="finding 2",
                reason="test",
                source="deleted",
            )
            _db.session.add(entry1)
            _db.session.add(entry2)
            _db.session.commit()

            assert ProductMemoryEntry.query.filter_by(source="excepted").count() == 1
            assert ProductMemoryEntry.query.filter_by(source="deleted").count() == 1

    def test_consumed_at_defaults_to_null(self, app):
        """BL-12 Fix: consumed_at should default to NULL for new entries."""
        product_id = _create_product(app, "model-consumed-null")
        with app.app_context():
            entry = ProductMemoryEntry(
                product_id=product_id,
                subscription="test-sub",
                title="test finding",
                reason="test",
                source="temp_excepted",
            )
            _db.session.add(entry)
            _db.session.commit()

            # Verify consumed_at is NULL (None in Python)
            retrieved = ProductMemoryEntry.query.filter_by(
                product_id=product_id,
                subscription="test-sub",
                title="test finding",
            ).first()
            assert retrieved is not None
            assert retrieved.consumed_at is None

    def test_consumed_at_can_be_set(self, app):
        """BL-12 Fix: consumed_at should accept datetime values (multi-worker safe)."""
        product_id = _create_product(app, "model-consumed-set")
        with app.app_context():
            entry = ProductMemoryEntry(
                product_id=product_id,
                subscription="test-sub-3",
                title="test finding 3",
                reason="test",
                source="temp_excepted",
            )
            _db.session.add(entry)
            _db.session.commit()

            # Simulate first scan: set consumed_at
            consumed_time = datetime.now(UTC)
            entry.consumed_at = consumed_time
            _db.session.commit()

            # Verify consumed_at was persisted
            retrieved = ProductMemoryEntry.query.filter_by(
                product_id=product_id,
                subscription="test-sub-3",
                title="test finding 3",
            ).first()
            assert retrieved is not None
            assert retrieved.consumed_at is not None
            # Verify the timestamp is recent (within last minute)
            # Note: SQLite may strip timezone info, so we compare against naive datetime
            now_naive = datetime.now(UTC).replace(tzinfo=None)
            consumed_naive = retrieved.consumed_at.replace(tzinfo=None) if retrieved.consumed_at.tzinfo else retrieved.consumed_at
            assert abs((consumed_naive - now_naive).total_seconds()) < 60


# ---------------------------------------------------------------------------
# API Endpoint Tests (already covered in test_product_memory.py)
# ---------------------------------------------------------------------------
# The API endpoint tests for temp_excepted (accepted) and temp_deleted (rejected) are in
# test_product_memory.py::TestUpsertMemoryEntry::test_temp_excepted_source_accepted
# test_product_memory.py::TestUpsertMemoryEntry::test_temp_deleted_source_rejected
