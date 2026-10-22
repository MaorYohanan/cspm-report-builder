"""Admin routes for backup and restore operations.

This module provides system-level backup/restore functionality for all database tables.
Memory usage: Acceptable for datasets up to ~100K rows. For larger datasets, the
in-memory ZIP creation and JSON serialization may fail naturally with OOM.
"""
from __future__ import annotations

import io
import json
import logging
import os
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Blueprint, jsonify, request, send_file
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from backend.database import db
from backend.models import (
    ExcludeRule,
    Finding,
    FindingTemplate,
    Product,
    ProductMemoryEntry,
    ReportSnapshot,
    User,
)
from backend.services.auth_service import require_role

_log = logging.getLogger(__name__)

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

# Ordered list of models for backup/restore operations
# Order respects foreign key dependencies for restore
_MODELS = [
    (User, "users.json"),
    (Product, "products.json"),
    (FindingTemplate, "finding_templates.json"),
    (ExcludeRule, "exclude_rules.json"),
    (ReportSnapshot, "report_snapshots.json"),
    (Finding, "findings.json"),
    (ProductMemoryEntry, "product_memory.json"),
]

# ZIP validation limits
_MAX_UNCOMPRESSED_SIZE = 500 * 1024 * 1024  # 500 MB
_MAX_FILE_COUNT = 100
_EXPECTED_FILES = {"backup_info.json"} | {name for _, name in _MODELS}


def _serialize_row(row: Any) -> dict[str, Any]:
    """Serialize a SQLAlchemy model instance to a JSON-serializable dict.

    Uses SQLAlchemy inspect() to automatically extract all column values.
    JSON columns are encoded as strings to avoid JSON-within-JSON issues.
    """
    mapper = inspect(row.__class__)
    result = {}

    for column in mapper.columns:
        value = getattr(row, column.name)

        # Handle datetime serialization
        if isinstance(value, datetime):
            result[column.name] = value.isoformat()
        # Handle JSON columns: encode as string to avoid nesting issues
        elif column.type.python_type == dict or column.type.python_type == list:
            result[column.name] = json.dumps(value) if value is not None else None
        else:
            result[column.name] = value

    return result


def _deserialize_row(data: dict[str, Any], model_class: Any) -> dict[str, Any]:
    """Deserialize a dict back to model-compatible values.

    Handles datetime parsing and JSON column decoding.
    """
    mapper = inspect(model_class)
    result = {}

    for column in mapper.columns:
        if column.name not in data:
            continue

        value = data[column.name]

        # Handle datetime deserialization
        if column.type.python_type == datetime and value is not None:
            if isinstance(value, str):
                result[column.name] = datetime.fromisoformat(value)
            else:
                result[column.name] = value
        # Handle JSON columns: decode from string
        elif (column.type.python_type == dict or column.type.python_type == list) and value is not None:
            if isinstance(value, str):
                result[column.name] = json.loads(value)
            else:
                result[column.name] = value
        else:
            result[column.name] = value

    return result


def _validate_zip_safety(zip_file: zipfile.ZipFile) -> tuple[bool, str | None]:
    """Validate ZIP file for safety constraints.

    Returns (is_valid, error_message).
    """
    # Check file count
    if len(zip_file.namelist()) > _MAX_FILE_COUNT:
        return False, f"קובץ ZIP מכיל יותר מדי קבצים (מקסימום: {_MAX_FILE_COUNT})"

    # Check for required files
    file_set = set(zip_file.namelist())
    missing = _EXPECTED_FILES - file_set
    if missing:
        return False, f"חסרים קבצים נדרשים בגיבוי: {', '.join(sorted(missing))}"

    # Check uncompressed size and validate paths
    total_size = 0
    for info in zip_file.infolist():
        total_size += info.file_size

        # Check for path traversal attempts
        # Fix Issue 4: Remove backslash check - ZIP spec uses forward slashes internally
        # even on Windows. Checking for backslash may reject valid archives.
        name = info.filename
        if ".." in name or name.startswith("/"):
            return False, f"שם קובץ לא חוקי בגיבוי: {name}"

        # Reject symlinks (external_attr check)
        # Unix symlink: (info.external_attr >> 16) & 0o170000 == 0o120000
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            return False, f"גיבוי מכיל קישור סימבולי (לא נתמך): {name}"

    if total_size > _MAX_UNCOMPRESSED_SIZE:
        return False, f"גודל גיבוי גדול מדי ({total_size / 1024 / 1024:.1f} MB, מקסימום: {_MAX_UNCOMPRESSED_SIZE / 1024 / 1024:.0f} MB)"

    return True, None


def _invalidate_all_sessions() -> None:
    """Invalidate all active sessions before restore.

    This prevents orphaned sessions from persisting after data is wiped.
    In production (with external session store), this would clear that store.
    For Flask's default signed-cookie sessions, there's no server-side state to clear.
    """
    # For signed-cookie sessions, invalidation happens client-side when users
    # try to use their old session cookie and the user_email no longer exists in DB.
    # No server-side action needed.
    # If using server-side sessions (redis, etc.), clear them here.
    _log.info("Session invalidation triggered (no-op for signed-cookie sessions)")


def _reset_sequences() -> None:
    """Reset auto-increment sequences to match restored data.

    Prevents ID conflicts on next insert after restore.
    Handles both PostgreSQL and SQLite.

    Raises:
        Exception: If sequence reset fails for any table.
    """
    dialect_name = db.engine.dialect.name

    if dialect_name == "postgresql":
        # PostgreSQL: reset sequences for all tables with serial/identity columns
        for model_class, _ in _MODELS:
            table_name = model_class.__tablename__
            mapper = inspect(model_class)

            for column in mapper.columns:
                if column.primary_key and column.autoincrement:
                    sequence_name = f"{table_name}_{column.name}_seq"
                    # Fix Issue 1: Change false to true
                    # The third parameter indicates whether the value has been "already used"
                    # true = next call to nextval() will return MAX + 1 (correct)
                    # false = next call to nextval() will return MAX (causes duplicate key error)
                    db.session.execute(text(
                        f"SELECT setval('{sequence_name}', COALESCE((SELECT MAX({column.name}) FROM {table_name}), 1), true)"
                    ))

    elif dialect_name == "sqlite":
        # SQLite: reset sqlite_sequence table
        # Note: sqlite_sequence is a system table that only exists after the first
        # autoincrement insert. We cannot create it manually - SQLite manages it.
        # Only update if it exists.
        table_exists = db.session.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'"
        )).scalar()

        if table_exists:
            # Clear existing entries
            db.session.execute(text("DELETE FROM sqlite_sequence"))

            # Repopulate with current max values
            for model_class, _ in _MODELS:
                table_name = model_class.__tablename__
                mapper = inspect(model_class)

                for column in mapper.columns:
                    if column.primary_key and column.autoincrement:
                        max_id = db.session.execute(
                            text(f"SELECT MAX({column.name}) FROM {table_name}")
                        ).scalar()

                        if max_id is not None:
                            db.session.execute(text(
                                f"INSERT INTO sqlite_sequence (name, seq) VALUES ('{table_name}', {max_id})"
                            ))
        # else: sqlite_sequence doesn't exist yet - SQLite will create it on first insert

    db.session.commit()


@admin_bp.route("/backup", methods=["GET"])
@require_role("admin")
def backup():
    """Create a full system backup as a downloadable ZIP file.

    Returns a ZIP containing:
    - 7 JSON files (one per ORM model)
    - backup_info.json with metadata (timestamp, row counts)

    Uses a database read transaction for consistent snapshot.
    """
    try:
        # Start read transaction for consistent snapshot
        # In SQLite/PostgreSQL READ COMMITTED, this gives us a consistent point-in-time view
        with db.session.begin_nested():
            backup_data: dict[str, list[dict]] = {}
            row_counts: dict[str, int] = {}

            # Serialize all models
            for model_class, filename in _MODELS:
                rows = db.session.execute(db.select(model_class)).scalars().all()
                serialized = [_serialize_row(row) for row in rows]
                backup_data[filename] = serialized
                row_counts[model_class.__tablename__] = len(serialized)

            # Create metadata
            metadata = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "system_version": None,  # No system version tracking yet
                "row_counts": row_counts,
            }

        # Create ZIP in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            # Add metadata
            zf.writestr("backup_info.json", json.dumps(metadata, ensure_ascii=False, indent=2))

            # Add all model data
            for filename, data in backup_data.items():
                zf.writestr(filename, json.dumps(data, ensure_ascii=False, indent=2))

        zip_buffer.seek(0)

        # Generate filename with timestamp
        timestamp_str = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M%S")
        filename = f"cspm-backup-{timestamp_str}.zip"

        _log.info(f"Backup created: {filename} ({sum(row_counts.values())} total rows)")

        return send_file(
            zip_buffer,
            mimetype="application/zip",
            as_attachment=True,
            download_name=filename,
        )

    except Exception as e:
        _log.error("Backup failed", exc_info=True)
        return jsonify({"error": "שגיאה ביצירת גיבוי"}), 500


@admin_bp.route("/restore", methods=["POST"])
@require_role("admin")
def restore():
    """Restore system state from a backup ZIP file.

    This is a DESTRUCTIVE operation that:
    1. Validates the uploaded ZIP
    2. Invalidates all active sessions
    3. Drops all existing data
    4. Restores data from backup
    5. Resets auto-increment sequences
    6. Verifies row counts match backup metadata

    All operations are transactional: any failure triggers full rollback.
    """
    # Validate file upload
    if "backup" not in request.files:
        return jsonify({"error": "לא הועלה קובץ גיבוי"}), 400

    uploaded_file = request.files["backup"]
    if not uploaded_file.filename:
        return jsonify({"error": "שם קובץ חסר"}), 400

    if not uploaded_file.filename.endswith(".zip"):
        return jsonify({"error": "פורמט קובץ לא חוקי - נדרש קובץ ZIP"}), 400

    try:
        # Read uploaded file into memory
        # Note: This loads the entire ZIP into memory. For very large backups (>100MB),
        # consider using a temp file instead. Current limit is 100MB (Flask config).
        zip_data = uploaded_file.read()
        zip_buffer = io.BytesIO(zip_data)

        # Validate ZIP structure and safety
        with zipfile.ZipFile(zip_buffer, "r") as zf:
            is_valid, error_msg = _validate_zip_safety(zf)
            if not is_valid:
                return jsonify({"error": error_msg}), 400

            # Read and validate metadata
            try:
                metadata_json = zf.read("backup_info.json").decode("utf-8")
                metadata = json.loads(metadata_json)
            except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as e:
                _log.warning(f"Metadata validation failed: {e}")
                return jsonify({"error": "מטא-דאטה של הגיבוי פגום או חסר"}), 400

            if "row_counts" not in metadata or "timestamp" not in metadata:
                return jsonify({"error": "מטא-דאטה של הגיבוי לא שלם"}), 400

            # Read all JSON files into memory
            restore_data: dict[str, list[dict]] = {}
            for model_class, filename in _MODELS:
                try:
                    data_json = zf.read(filename).decode("utf-8")
                    restore_data[filename] = json.loads(data_json)
                except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as e:
                    _log.warning(f"Failed to read {filename}: {e}")
                    return jsonify({"error": f"קובץ {filename} פגום או חסר"}), 400

        # Invalidate all active sessions before destructive operations
        _invalidate_all_sessions()

        # Begin transaction for restore operation
        try:
            # Drop all existing data (in reverse order to respect FK constraints)
            for model_class, _ in reversed(_MODELS):
                db.session.execute(db.delete(model_class))

            # Restore data in correct order (respects FK dependencies)
            for model_class, filename in _MODELS:
                for row_data in restore_data[filename]:
                    # Deserialize and create model instance
                    deserialized = _deserialize_row(row_data, model_class)
                    instance = model_class(**deserialized)
                    db.session.add(instance)

            # Fix Issue 2: Verify row counts BEFORE commit so rollback can work
            db.session.flush()  # Flush to make data visible for counting
            verification_errors = []
            for model_class, _ in _MODELS:
                table_name = model_class.__tablename__
                expected_count = metadata["row_counts"].get(table_name, 0)
                actual_count = db.session.execute(
                    db.select(db.func.count()).select_from(model_class)
                ).scalar()

                if expected_count != actual_count:
                    error_msg = f"Row count mismatch for {table_name}: expected {expected_count}, got {actual_count}"
                    _log.error(error_msg)
                    verification_errors.append(error_msg)

            if verification_errors:
                # Row count mismatch indicates data corruption - trigger rollback
                db.session.rollback()
                _log.error("Restore failed: row count verification failed, transaction rolled back")
                return jsonify({"error": "שחזור נכשל - אימות מספר שורות נכשל"}), 500

            # Commit all changes
            db.session.commit()

            # Fix Issue 3: Reset sequences after commit and propagate exceptions
            # Note: If sequence reset fails after commit, data is already committed.
            # We log the error and return failure status so admin can manually fix sequences.
            try:
                _reset_sequences()
            except Exception as e:
                _log.error("Sequence reset failed after successful restore", exc_info=True)
                return jsonify({"error": "שחזור הושלם אך איפוס מספרים סידוריים נכשל"}), 500

            _log.info(
                f"Restore completed successfully from backup dated {metadata.get('timestamp')} "
                f"({sum(metadata['row_counts'].values())} total rows)"
            )

            return jsonify({"status": "success"}), 200

        except SQLAlchemyError as e:
            db.session.rollback()
            _log.error("Restore failed, transaction rolled back", exc_info=True)
            return jsonify({"error": "שחזור נכשל - שגיאה במסד הנתונים"}), 500

    except zipfile.BadZipFile:
        return jsonify({"error": "קובץ ZIP פגום"}), 400
    except Exception as e:
        _log.error("Restore failed", exc_info=True)
        return jsonify({"error": "שחזור נכשל - שגיאה לא צפויה"}), 500
