"""One-shot migration: import existing JSON product files into the SQLite database.

Usage (from project root):
    python -m backend.migration.migrate_json_to_db

The script is idempotent — products and snapshots that already exist in the DB
are skipped. Run it once after upgrading from the JSON-file backend to SQLAlchemy.
"""
from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

# Ensure the project root is on the path when run as a module
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app import app  # noqa: E402 — sets up Flask + SQLAlchemy
from backend.database import db  # noqa: E402
from backend.models import Finding, Product, ProductMemoryEntry, ReportSnapshot  # noqa: E402


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, TypeError):
        return None


def _migrate_product(product_dir: Path) -> None:
    meta_path = product_dir / "meta.json"
    if not meta_path.exists():
        print(f"  [SKIP] {product_dir.name}: no meta.json")
        return

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"  [ERROR] {product_dir.name}: could not read meta.json — {exc}")
        return

    slug = meta.get("id") or product_dir.name
    if db.session.get(Product, slug):
        print(f"  [SKIP] {slug}: already in DB")
        return

    product = Product(
        id=slug,
        name=meta.get("name", slug),
        owner=meta.get("owner", ""),
        owner_email=meta.get("ownerEmail", ""),
        env=meta.get("env", ""),
        subscription_ids=meta.get("subscriptionIds", []),
        created_at=_parse_dt(meta.get("createdAt")) or datetime.now(UTC),
    )
    db.session.add(product)
    db.session.flush()

    version_files = sorted(product_dir.glob("v*.*.json"))
    for vf in version_files:
        try:
            data = json.loads(vf.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"    [ERROR] {vf.name}: could not read — {exc}")
            continue

        version_str = data.get("version") or vf.stem.lstrip("v")
        snap = ReportSnapshot(
            product_id=slug,
            version=version_str,
            report_version=str(data.get("reportVersion", "1.0")),
            version_notes=data.get("versionNotes", ""),
            version_type=data.get("versionType", "minor"),
            status=data.get("status", "draft"),
            saved_at=_parse_dt(data.get("savedAt")) or datetime.utcnow(),
            published_at=_parse_dt(data.get("publishedAt")),
            risk_score=int(data.get("riskScore", 0)),
            snapshot_data={k: v for k, v in data.items() if k not in {
                "findings", "version", "reportVersion", "versionNotes",
                "versionType", "status", "savedAt", "publishedAt", "riskScore",
            }},
        )
        db.session.add(snap)
        db.session.flush()

        for fd in data.get("findings", []):
            if not isinstance(fd, dict):
                continue
            exc = fd.get("exception")
            db.session.add(Finding(
                snapshot_id=snap.id,
                severity=str(fd.get("severity", "")).lower() or None,
                exception_active=bool(isinstance(exc, dict) and exc.get("active")),
                finding_data=fd,
            ))

        print(f"    [OK] {vf.name}")

    # Sync denormalized fields
    from backend.routes.products import _latest_snapshot, _refresh_product_latest
    _refresh_product_latest(product)

    # Migrate memory.json
    mem_path = product_dir / "memory.json"
    if mem_path.exists():
        try:
            mem = json.loads(mem_path.read_text(encoding="utf-8"))
            for key, entry in mem.get("entries", {}).items():
                parts = key.split("::", 1)
                if len(parts) != 2:
                    continue
                sub, title = parts
                db.session.add(ProductMemoryEntry(
                    product_id=slug,
                    subscription=sub,
                    title=title,
                    reason=entry.get("reason", ""),
                    source=entry.get("source", "excepted"),
                ))
        except Exception as exc:
            print(f"    [WARN] {slug}/memory.json: {exc}")

    db.session.commit()
    print(f"  [MIGRATED] {slug}")


def main() -> None:
    uploads_dir = PROJECT_ROOT / "uploads" / "products"
    if not uploads_dir.is_dir():
        print(f"No products directory found at {uploads_dir}")
        return

    with app.app_context():
        product_dirs = [d for d in uploads_dir.iterdir() if d.is_dir()]
        print(f"Migrating {len(product_dirs)} product(s) from {uploads_dir}\n")
        for d in sorted(product_dirs):
            print(f"Product: {d.name}")
            _migrate_product(d)

    print("\nMigration complete.")


if __name__ == "__main__":
    main()
