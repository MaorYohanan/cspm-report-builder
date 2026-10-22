"""Unit tests for backend/routes/admin.py backup/restore functionality.

Run with:
    python -m pytest tests/test_backup_restore.py -v
"""
from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from flask import Flask

from backend.database import db as _db
from backend.models import (
    ExcludeRule,
    Finding,
    FindingTemplate,
    Product,
    ProductMemoryEntry,
    ReportSnapshot,
    User,
)
from backend.routes.admin import admin_bp


@pytest.fixture
def app():
    """Flask application with an isolated in-memory SQLite database."""
    application = Flask(__name__)
    application.config["TESTING"] = True
    application.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    application.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    application.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100 MB
    _db.init_app(application)

    with application.app_context():
        import backend.models  # noqa: F401 — registers all models
        _db.create_all()
        yield application
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    """Flask test client with the admin blueprint registered."""
    app.register_blueprint(admin_bp)
    return app.test_client()


@pytest.fixture
def sample_data(app):
    """Create sample data in all tables for testing."""
    with app.app_context():
        # Create user
        user = User(email="admin@example.com", role="admin")
        _db.session.add(user)

        # Create product
        product = Product(
            id="test-product",
            name="Test Product",
            owner="Test Owner",
            owner_email="owner@example.com",
            env="production",
            subscription_ids=["sub-1", "sub-2"],
            scan_frequency="quarterly",
        )
        _db.session.add(product)

        # Create finding template
        template = FindingTemplate(
            name="Test Template",
            category="CSPM",
            severity="high",
            title="Test Finding Title",
            description="Test description",
            active=True,
        )
        _db.session.add(template)

        # Create exclude rule
        rule = ExcludeRule(
            field="title",
            operator="contains",
            pattern="test",
            active=True,
        )
        _db.session.add(rule)

        # Create report snapshot
        snapshot = ReportSnapshot(
            product_id="test-product",
            version="1.0",
            report_version="1.0",
            version_type="major",
            status="published",
            saved_at=datetime.now(timezone.utc),
            risk_score=10,
            snapshot_data={"test": "data"},
        )
        _db.session.add(snapshot)

        _db.session.commit()

        # Create finding (needs snapshot.id)
        finding = Finding(
            snapshot_id=snapshot.id,
            severity="high",
            exception_active=False,
            finding_data={"title": "Test Finding", "policies": ["pol-1"]},
        )
        _db.session.add(finding)

        # Create product memory entry
        memory = ProductMemoryEntry(
            product_id="test-product",
            subscription="sub-1",
            title="Deleted Finding",
            reason="Test reason",
            source="deleted",
        )
        _db.session.add(memory)

        _db.session.commit()

        return {
            "user": user,
            "product": product,
            "template": template,
            "rule": rule,
            "snapshot": snapshot,
            "finding": finding,
            "memory": memory,
        }


class TestBackup:
    """Tests for GET /api/admin/backup endpoint."""

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_backup_success(self, client, sample_data):
        """Test successful backup creation."""
        response = client.get("/api/admin/backup")

        assert response.status_code == 200
        assert response.content_type == "application/zip"
        assert "cspm-backup-" in response.headers.get("Content-Disposition", "")

        # Verify ZIP contents
        zip_buffer = io.BytesIO(response.data)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            filenames = set(zf.namelist())
            expected = {
                "backup_info.json",
                "users.json",
                "products.json",
                "finding_templates.json",
                "exclude_rules.json",
                "report_snapshots.json",
                "findings.json",
                "product_memory.json",
            }
            assert filenames == expected

            # Verify metadata
            metadata = json.loads(zf.read("backup_info.json"))
            assert "timestamp" in metadata
            assert "row_counts" in metadata
            assert metadata["row_counts"]["users"] == 1
            assert metadata["row_counts"]["products"] == 1
            assert metadata["row_counts"]["findings"] == 1

            # Verify user data
            users = json.loads(zf.read("users.json"))
            assert len(users) == 1
            assert users[0]["email"] == "admin@example.com"
            assert users[0]["role"] == "admin"

            # Verify product data
            products = json.loads(zf.read("products.json"))
            assert len(products) == 1
            assert products[0]["id"] == "test-product"
            # JSON column should be encoded as string
            assert isinstance(products[0]["subscription_ids"], str)

    @patch("backend.services.auth_service._OAUTH_ENABLED", True)
    def test_backup_requires_auth(self, client):
        """Test that backup requires admin authentication."""
        response = client.get("/api/admin/backup")
        assert response.status_code == 401

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_backup_empty_database(self, client):
        """Test backup with no data."""
        response = client.get("/api/admin/backup")

        assert response.status_code == 200
        zip_buffer = io.BytesIO(response.data)
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            metadata = json.loads(zf.read("backup_info.json"))
            assert all(count == 0 for count in metadata["row_counts"].values())


class TestRestore:
    """Tests for POST /api/admin/restore endpoint."""

    def _create_backup_zip(self, data: dict[str, list[dict]], metadata: dict | None = None) -> io.BytesIO:
        """Helper to create a backup ZIP file."""
        if metadata is None:
            metadata = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "system_version": None,
                "row_counts": {
                    "users": len(data.get("users.json", [])),
                    "products": len(data.get("products.json", [])),
                    "finding_templates": len(data.get("finding_templates.json", [])),
                    "exclude_rules": len(data.get("exclude_rules.json", [])),
                    "report_snapshots": len(data.get("report_snapshots.json", [])),
                    "findings": len(data.get("findings.json", [])),
                    "product_memory_entries": len(data.get("product_memory.json", [])),
                },
            }

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("backup_info.json", json.dumps(metadata))
            for filename, rows in data.items():
                zf.writestr(filename, json.dumps(rows))
        zip_buffer.seek(0)
        return zip_buffer

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_success(self, client, app):
        """Test successful restore operation."""
        # Create backup data
        backup_data = {
            "users.json": [
                {
                    "id": 1,
                    "email": "restored@example.com",
                    "role": "admin",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            ],
            "products.json": [
                {
                    "id": "restored-product",
                    "name": "Restored Product",
                    "owner": "Restored Owner",
                    "owner_email": "owner@example.com",
                    "env": "test",
                    "subscription_ids": json.dumps(["sub-1"]),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "scan_frequency": "monthly",
                    "latest_version": None,
                    "latest_risk_score": None,
                }
            ],
            "finding_templates.json": [],
            "exclude_rules.json": [],
            "report_snapshots.json": [],
            "findings.json": [],
            "product_memory.json": [],
        }

        zip_buffer = self._create_backup_zip(backup_data)

        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "test-backup.zip")},
            content_type="multipart/form-data",
        )

        assert response.status_code == 200
        assert response.json == {"status": "success"}

        # Verify data was restored
        with app.app_context():
            user = _db.session.execute(_db.select(User)).scalar_one_or_none()
            assert user is not None
            assert user.email == "restored@example.com"

            product = _db.session.execute(_db.select(Product)).scalar_one_or_none()
            assert product is not None
            assert product.id == "restored-product"
            assert product.subscription_ids == ["sub-1"]  # JSON decoded

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_replaces_existing_data(self, client, app, sample_data):
        """Test that restore wipes existing data and replaces it."""
        # Verify existing data
        with app.app_context():
            assert _db.session.execute(_db.select(_db.func.count()).select_from(User)).scalar() == 1
            assert _db.session.execute(_db.select(_db.func.count()).select_from(Product)).scalar() == 1

        # Create different backup data
        backup_data = {
            "users.json": [
                {
                    "id": 99,
                    "email": "different@example.com",
                    "role": "viewer",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            ],
            "products.json": [],
            "finding_templates.json": [],
            "exclude_rules.json": [],
            "report_snapshots.json": [],
            "findings.json": [],
            "product_memory.json": [],
        }

        zip_buffer = self._create_backup_zip(backup_data)

        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "restore.zip")},
            content_type="multipart/form-data",
        )

        assert response.status_code == 200

        # Verify old data is gone, new data is present
        with app.app_context():
            users = _db.session.execute(_db.select(User)).scalars().all()
            assert len(users) == 1
            assert users[0].email == "different@example.com"

            products = _db.session.execute(_db.select(Product)).scalars().all()
            assert len(products) == 0

    @patch("backend.services.auth_service._OAUTH_ENABLED", True)
    def test_restore_requires_auth(self, client):
        """Test that restore requires admin authentication."""
        zip_buffer = io.BytesIO(b"fake zip")
        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "test.zip")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 401

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_no_file_uploaded(self, client):
        """Test restore without uploading a file."""
        response = client.post("/api/admin/restore")
        assert response.status_code == 400
        assert "לא הועלה קובץ גיבוי" in response.json["error"]

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_invalid_extension(self, client):
        """Test restore with non-ZIP file."""
        file_data = io.BytesIO(b"not a zip")
        response = client.post(
            "/api/admin/restore",
            data={"backup": (file_data, "backup.txt")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 400
        assert "ZIP" in response.json["error"]

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_corrupted_zip(self, client):
        """Test restore with corrupted ZIP file."""
        file_data = io.BytesIO(b"PK\x03\x04corrupted")
        response = client.post(
            "/api/admin/restore",
            data={"backup": (file_data, "backup.zip")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 400
        assert "פגום" in response.json["error"]

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_missing_metadata(self, client):
        """Test restore with missing backup_info.json."""
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zf:
            zf.writestr("users.json", "[]")
        zip_buffer.seek(0)

        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "backup.zip")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 400
        assert "חסרים קבצים נדרשים" in response.json["error"]

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_malformed_metadata(self, client):
        """Test restore with invalid JSON in metadata."""
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zf:
            zf.writestr("backup_info.json", "{invalid json")
            zf.writestr("users.json", "[]")
            zf.writestr("products.json", "[]")
            zf.writestr("finding_templates.json", "[]")
            zf.writestr("exclude_rules.json", "[]")
            zf.writestr("report_snapshots.json", "[]")
            zf.writestr("findings.json", "[]")
            zf.writestr("product_memory.json", "[]")
        zip_buffer.seek(0)

        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "backup.zip")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 400
        assert "פגום" in response.json["error"]

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_incomplete_metadata(self, client):
        """Test restore with metadata missing required fields."""
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zf:
            # Missing row_counts
            zf.writestr("backup_info.json", json.dumps({"timestamp": "2024-01-01T00:00:00Z"}))
            zf.writestr("users.json", "[]")
            zf.writestr("products.json", "[]")
            zf.writestr("finding_templates.json", "[]")
            zf.writestr("exclude_rules.json", "[]")
            zf.writestr("report_snapshots.json", "[]")
            zf.writestr("findings.json", "[]")
            zf.writestr("product_memory.json", "[]")
        zip_buffer.seek(0)

        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "backup.zip")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 400
        assert "לא שלם" in response.json["error"]

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_missing_data_file(self, client):
        """Test restore with missing data JSON file."""
        backup_data = {
            "users.json": [],
            # Missing products.json
            "finding_templates.json": [],
            "exclude_rules.json": [],
            "report_snapshots.json": [],
            "findings.json": [],
            "product_memory.json": [],
        }
        zip_buffer = self._create_backup_zip(backup_data)

        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "backup.zip")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 400
        assert "חסרים קבצים נדרשים" in response.json["error"]

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_malformed_json_data(self, client):
        """Test restore with invalid JSON in data file."""
        zip_buffer = io.BytesIO()
        metadata = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "system_version": None,
            "row_counts": {
                "users": 0,
                "products": 0,
                "finding_templates": 0,
                "exclude_rules": 0,
                "report_snapshots": 0,
                "findings": 0,
                "product_memory_entries": 0,
            },
        }
        with zipfile.ZipFile(zip_buffer, "w") as zf:
            zf.writestr("backup_info.json", json.dumps(metadata))
            zf.writestr("users.json", "{invalid json")
            zf.writestr("products.json", "[]")
            zf.writestr("finding_templates.json", "[]")
            zf.writestr("exclude_rules.json", "[]")
            zf.writestr("report_snapshots.json", "[]")
            zf.writestr("findings.json", "[]")
            zf.writestr("product_memory.json", "[]")
        zip_buffer.seek(0)

        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "backup.zip")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 400
        assert "פגום" in response.json["error"]

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_path_traversal_attempt(self, client):
        """Test that path traversal attempts are rejected."""
        zip_buffer = io.BytesIO()
        metadata = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "system_version": None,
            "row_counts": {k: 0 for k in ["users", "products", "finding_templates", "exclude_rules", "report_snapshots", "findings", "product_memory_entries"]},
        }
        with zipfile.ZipFile(zip_buffer, "w") as zf:
            zf.writestr("backup_info.json", json.dumps(metadata))
            zf.writestr("../../../etc/passwd", "malicious")
            zf.writestr("users.json", "[]")
            zf.writestr("products.json", "[]")
            zf.writestr("finding_templates.json", "[]")
            zf.writestr("exclude_rules.json", "[]")
            zf.writestr("report_snapshots.json", "[]")
            zf.writestr("findings.json", "[]")
            zf.writestr("product_memory.json", "[]")
        zip_buffer.seek(0)

        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "backup.zip")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 400
        assert "לא חוקי" in response.json["error"]

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_too_many_files(self, client):
        """Test that ZIP with too many files is rejected."""
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zf:
            # Add 101 files (exceeds MAX_FILE_COUNT of 100)
            for i in range(101):
                zf.writestr(f"file_{i}.txt", "data")
        zip_buffer.seek(0)

        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "backup.zip")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 400
        assert "יותר מדי קבצים" in response.json["error"]

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_sequence_reset(self, client, app):
        """Test that sequence reset works after restore (Issue 1 fix).

        After restore, new inserts should get sequential IDs without conflicts.
        """
        # Create backup with user ID 5
        backup_data = {
            "users.json": [
                {
                    "id": 5,
                    "email": "user5@example.com",
                    "role": "viewer",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            ],
            "products.json": [],
            "finding_templates.json": [],
            "exclude_rules.json": [],
            "report_snapshots.json": [],
            "findings.json": [],
            "product_memory.json": [],
        }

        zip_buffer = self._create_backup_zip(backup_data)

        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "restore.zip")},
            content_type="multipart/form-data",
        )

        assert response.status_code == 200

        # Insert new user - should get ID 6 (not 5, which would cause conflict)
        with app.app_context():
            new_user = User(email="user6@example.com", role="admin")
            _db.session.add(new_user)
            _db.session.commit()

            # Verify new user got ID 6
            assert new_user.id == 6

            # Verify both users exist
            all_users = _db.session.execute(_db.select(User)).scalars().all()
            assert len(all_users) == 2
            assert {u.id for u in all_users} == {5, 6}

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_oversized_zip_rejected(self, client):
        """Test that ZIP with uncompressed size > 500MB is rejected (Issue validation)."""
        zip_buffer = io.BytesIO()
        metadata = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "system_version": None,
            "row_counts": {k: 0 for k in ["users", "products", "finding_templates", "exclude_rules", "report_snapshots", "findings", "product_memory_entries"]},
        }

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("backup_info.json", json.dumps(metadata))

            # Create a 501MB uncompressed file (will compress much smaller)
            # Use a pattern that compresses well to keep test fast
            large_data = "x" * (501 * 1024 * 1024)
            zf.writestr("users.json", large_data)

            zf.writestr("products.json", "[]")
            zf.writestr("finding_templates.json", "[]")
            zf.writestr("exclude_rules.json", "[]")
            zf.writestr("report_snapshots.json", "[]")
            zf.writestr("findings.json", "[]")
            zf.writestr("product_memory.json", "[]")

        zip_buffer.seek(0)

        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "huge.zip")},
            content_type="multipart/form-data",
        )

        assert response.status_code == 400
        assert "גדול מדי" in response.json["error"]

    @patch("backend.services.auth_service._OAUTH_ENABLED", False)
    def test_restore_row_count_verification_failure(self, client, app, sample_data):
        """Test that row count mismatch triggers rollback (Issue 2 fix).

        If row counts don't match after restore, transaction should roll back
        and original data should remain intact.
        """
        # Verify initial state has sample data
        with app.app_context():
            initial_user_count = _db.session.execute(_db.select(_db.func.count()).select_from(User)).scalar()
            assert initial_user_count == 1  # From sample_data fixture
            initial_user = _db.session.execute(_db.select(User)).scalar_one()
            initial_email = initial_user.email

        # Create backup with intentionally wrong row count metadata
        backup_data = {
            "users.json": [
                {
                    "id": 99,
                    "email": "restored@example.com",
                    "role": "viewer",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            ],
            "products.json": [],
            "finding_templates.json": [],
            "exclude_rules.json": [],
            "report_snapshots.json": [],
            "findings.json": [],
            "product_memory.json": [],
        }

        # Create metadata with wrong row count (claims 2 users but only 1 in data)
        metadata = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "system_version": None,
            "row_counts": {
                "users": 2,  # Wrong! Only 1 user in backup
                "products": 0,
                "finding_templates": 0,
                "exclude_rules": 0,
                "report_snapshots": 0,
                "findings": 0,
                "product_memory_entries": 0,
            },
        }

        zip_buffer = self._create_backup_zip(backup_data, metadata)

        response = client.post(
            "/api/admin/restore",
            data={"backup": (zip_buffer, "bad.zip")},
            content_type="multipart/form-data",
        )

        # Should fail with 500 error
        assert response.status_code == 500
        assert "אימות" in response.json["error"]  # Hebrew for "verification"

        # Verify database was rolled back - original data should still be there
        with app.app_context():
            user_count = _db.session.execute(_db.select(_db.func.count()).select_from(User)).scalar()
            assert user_count == initial_user_count  # Should have original data

            # Verify original user still exists (not the "restored" one)
            user = _db.session.execute(_db.select(User)).scalar_one()
            assert user.email == initial_email  # Should be the original user
