"""BL-23: Acknowledge vs Exclude dismissal states (backend).

Covers the migration (up/down on SQLite), the 'excluded' memory source, pipeline
restore of kind 'exclude', version save/load round-trip, the risk score and the
exceptions overview.
"""
from __future__ import annotations

import importlib.util
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from backend.database import db
from backend.models import Finding, Product, ProductMemoryEntry, ReportSnapshot
from backend.routes.pipeline import _store_findings_with_memory
from backend.utils import compute_risk_score

SUB = "prod-sub"
_MIGRATION = (
    Path(__file__).resolve().parent.parent
    / "migrations" / "versions" / "b23a0c5d7e11_add_exception_kind_and_excluded_source.py"
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _product(pid: str = "p1") -> None:
    db.session.add(Product(
        id=pid, name="P", owner="o", owner_email="o@example.com", env="test",
        subscription_ids=[SUB], scan_frequency="quarterly", created_at=datetime.now(UTC),
    ))
    db.session.commit()


def _snap(pid: str = "p1", version: str = "d1") -> int:
    snap = ReportSnapshot(
        product_id=pid, version=version, version_type="draft", status="draft",
        saved_at=datetime.now(UTC), snapshot_data={},
    )
    db.session.add(snap)
    db.session.commit()
    return snap.id


def _mem(pid: str, title: str, source: str, reason: str = "") -> None:
    db.session.add(ProductMemoryEntry(
        product_id=pid, subscription=SUB, title=title.lower(), reason=reason, source=source,
    ))
    db.session.commit()


def _raw(title: str, sev: str = "HIGH") -> dict:
    return {
        "queryType": "configurationFindings",
        "id": f"id-{title}",
        "severity": sev,
        "rule": {"name": title},
        "resource": {"name": "res", "subscription": {"name": SUB}},
        "_sourceSubscription": SUB,
        "_subscriptions": [SUB],
    }


# ---------------------------------------------------------------------------
# model + risk score
# ---------------------------------------------------------------------------

def test_memory_source_excluded_is_allowed(app):
    _product()
    _mem("p1", "Noisy", "excluded", "not relevant")
    assert ProductMemoryEntry.query.filter_by(source="excluded").count() == 1


def test_memory_source_invalid_still_rejected(app):
    _product()
    with pytest.raises(IntegrityError):
        _mem("p1", "Bad", "temp_deleted")
    db.session.rollback()


def test_risk_score_ignores_both_kinds():
    snap = {"findings": [
        {"severity": "critical", "exception": {"active": True, "reason": ""}},
        {"severity": "critical", "exception": {"active": True, "kind": "exclude", "reason": ""}},
        {"severity": "high", "exception": {"active": False, "kind": "exclude"}},
        {"severity": "low"},
    ]}
    assert compute_risk_score(snap) == 3 + 1


# ---------------------------------------------------------------------------
# pipeline restore
# ---------------------------------------------------------------------------

def test_pipeline_restores_excluded_kind(app):
    _product()
    sid = _snap()
    _mem("p1", "Noisy rule", "excluded", "n/a here")
    _mem("p1", "Accepted rule", "excepted", "accepted")
    risk, count = _store_findings_with_memory(
        sid, "p1", [_raw("Noisy rule", "CRITICAL"), _raw("Accepted rule", "HIGH"), _raw("Plain", "LOW")]
    )
    db.session.commit()
    rows = {r.finding_data["title"]: r for r in Finding.query.filter_by(snapshot_id=sid).all()}
    assert count == 3
    assert risk == 1  # only Plain scores
    noisy = rows["Noisy rule"]
    assert noisy.exception_active is True and noisy.exception_kind == "exclude"
    assert noisy.finding_data["exception"] == {"active": True, "reason": "n/a here", "kind": "exclude"}
    acc = rows["Accepted rule"]
    assert acc.exception_active is True and acc.exception_kind is None
    assert acc.finding_data["exception"] == {"active": True, "reason": "accepted"}
    assert rows["Plain"].exception_kind is None


# ---------------------------------------------------------------------------
# API: memory source, version round-trip, exceptions overview, publish immutability
# ---------------------------------------------------------------------------

def test_memory_endpoint_accepts_excluded(client, app):
    _product()
    r = client.post("/api/products/p1/memory/entry", json={
        "subscription": SUB, "title": "Noisy", "reason": "x", "source": "excluded"})
    assert r.status_code == 200
    mem = client.get("/api/products/p1/memory").get_json()
    assert mem["entries"][f"{SUB}::noisy"]["source"] == "excluded"
    # toggling kind re-uses the same key and overrides the source
    r = client.post("/api/products/p1/memory/entry", json={
        "subscription": SUB, "title": "Noisy", "reason": "x", "source": "excepted"})
    assert r.status_code == 200
    mem = client.get("/api/products/p1/memory").get_json()
    assert mem["entries"][f"{SUB}::noisy"]["source"] == "excepted"


def test_memory_endpoint_rejects_unknown_source(client, app):
    _product()
    r = client.post("/api/products/p1/memory/entry", json={
        "subscription": SUB, "title": "Noisy", "source": "nope"})
    assert r.status_code == 400


def _snapshot_payload() -> dict:
    return {"meta": {}, "findings": [
        {"id": "A", "title": "ack", "severity": "high", "exception": {"active": True, "reason": "ok"}},
        {"id": "B", "title": "excl", "severity": "critical",
         "exception": {"active": True, "kind": "exclude", "reason": "n/a"}},
        {"id": "C", "title": "live", "severity": "low", "exception": {"active": False, "reason": ""}},
    ]}


def test_version_round_trip_preserves_kind_and_score(client, app):
    _product()
    r = client.post("/api/products/p1/versions", json={
        "type": "minor", "notes": "n", "snapshot": _snapshot_payload()})
    assert r.status_code in (200, 201), r.get_json()
    ver = r.get_json().get("version") or "1.1"
    rows = {f.finding_data["id"]: f for f in Finding.query.all()}
    assert rows["A"].exception_kind is None and rows["A"].exception_active is True
    assert rows["B"].exception_kind == "exclude" and rows["B"].exception_active is True
    assert rows["C"].exception_kind is None and rows["C"].exception_active is False
    loaded = client.get(f"/api/products/p1/versions/{ver}").get_json()
    byid = {f["id"]: f for f in loaded["findings"]}
    assert byid["B"]["exception"]["kind"] == "exclude"
    assert "kind" not in byid["A"]["exception"]
    assert loaded["riskScore"] == 1  # only the live low finding scores


def test_draft_overwrite_updates_kind(client, app):
    _product()
    client.post("/api/products/p1/versions", json={
        "type": "minor", "notes": "n", "snapshot": _snapshot_payload()})
    payload = _snapshot_payload()
    payload["findings"][1]["exception"].pop("kind")  # excluded -> acknowledged
    r = client.post("/api/products/p1/versions", json={"type": "draft", "notes": "n", "snapshot": payload})
    assert r.status_code in (200, 201), r.get_json()
    kinds = {f.finding_data["id"]: f.exception_kind for f in Finding.query.all()}
    assert kinds == {"A": None, "B": None, "C": None}


def test_publish_keeps_kind_and_exceptions_overview_returns_it(client, app):
    _product()
    r = client.post("/api/products/p1/versions", json={
        "type": "minor", "notes": "n", "snapshot": _snapshot_payload()})
    ver = r.get_json().get("version") or "1.1"
    assert client.post(f"/api/products/p1/versions/{ver}/publish").status_code == 200
    overview = client.get("/api/exceptions").get_json()
    kinds = {row["findingId"]: row["kind"] for row in overview}
    assert kinds == {"A": "acknowledge", "B": "exclude"}
    loaded = client.get(f"/api/products/p1/versions/{ver}").get_json()
    assert {f["id"]: f["exception"].get("kind") for f in loaded["findings"]} == {
        "A": None, "B": "exclude", "C": None}


# ---------------------------------------------------------------------------
# migration up / down on a legacy SQLite schema
# ---------------------------------------------------------------------------

_LEGACY_DDL = [
    "CREATE TABLE findings (id INTEGER PRIMARY KEY, snapshot_id INTEGER NOT NULL, "
    "severity VARCHAR(20) NOT NULL DEFAULT 'medium', exception_active BOOLEAN NOT NULL DEFAULT 0, "
    "finding_data JSON NOT NULL)",
    "CREATE TABLE product_memory_entries (id INTEGER NOT NULL, product_id VARCHAR(100) NOT NULL, "
    "subscription VARCHAR(200) NOT NULL, title VARCHAR(500) NOT NULL, reason VARCHAR(1000), "
    "source VARCHAR(20) NOT NULL, consumed_at DATETIME, PRIMARY KEY (id), "
    "UNIQUE (product_id, subscription, title), "
    "CONSTRAINT ck_memory_source CHECK (source IN ('excepted','deleted','temp_excepted')))",
    "CREATE INDEX ix_product_memory_entries_product_id ON product_memory_entries (product_id)",
]


def _load_migration():
    spec = importlib.util.spec_from_file_location("bl23_migration", _MIGRATION)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run(engine, fn):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            fn()


def _insert_memory(engine, title: str, source: str) -> None:
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO product_memory_entries (product_id, subscription, title, source) "
            "VALUES ('p', 's', :t, :s)"), {"t": title, "s": source})


@pytest.fixture
def legacy_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        for ddl in _LEGACY_DDL:
            conn.execute(text(ddl))
        conn.execute(text(
            "INSERT INTO product_memory_entries (product_id, subscription, title, source, reason) "
            "VALUES ('p', 's', 'old', 'temp_excepted', 'keep me')"))
        conn.execute(text(
            "INSERT INTO findings (snapshot_id, severity, exception_active, finding_data) "
            "VALUES (1, 'high', 1, '{}')"))
    yield engine
    engine.dispose()


def test_migration_upgrade_on_legacy_sqlite(legacy_engine):
    mod = _load_migration()
    with pytest.raises(IntegrityError):
        _insert_memory(legacy_engine, "x", "excluded")  # old CHECK rejects it

    _run(legacy_engine, mod.upgrade)

    insp = inspect(legacy_engine)
    assert "exception_kind" in {c["name"] for c in insp.get_columns("findings")}
    _insert_memory(legacy_engine, "new", "excluded")  # widened CHECK accepts it
    with pytest.raises(IntegrityError):
        _insert_memory(legacy_engine, "bad", "nonsense")
    with legacy_engine.connect() as conn:
        old = conn.execute(text("SELECT source, reason FROM product_memory_entries WHERE title='old'")).one()
        assert tuple(old) == ("temp_excepted", "keep me")
        assert conn.execute(text("SELECT exception_kind FROM findings")).scalar() is None
    assert "ix_product_memory_entries_product_id" in {
        i["name"] for i in inspect(legacy_engine).get_indexes("product_memory_entries")}
    with pytest.raises(IntegrityError):  # UNIQUE survived the rebuild
        _insert_memory(legacy_engine, "new", "excepted")


def test_migration_is_idempotent_and_downgrade_works(legacy_engine):
    mod = _load_migration()
    _run(legacy_engine, mod.upgrade)
    _run(legacy_engine, mod.upgrade)  # second run is a no-op, not an error
    _insert_memory(legacy_engine, "gone", "excluded")

    _run(legacy_engine, mod.downgrade)

    insp = inspect(legacy_engine)
    assert "exception_kind" not in {c["name"] for c in insp.get_columns("findings")}
    with legacy_engine.connect() as conn:
        src = conn.execute(text("SELECT source FROM product_memory_entries WHERE title='gone'")).scalar()
        assert src == "excepted"  # degraded, not lost
        assert conn.execute(text("SELECT COUNT(*) FROM findings")).scalar() == 1
    with pytest.raises(IntegrityError):
        _insert_memory(legacy_engine, "again", "excluded")


def test_startup_backfill_helper_is_noop_on_current_schema(app):
    from backend.services.sqlite_schema import set_memory_source_check

    with db.engine.connect() as conn:
        assert set_memory_source_check(conn, allow_excluded=True) is False


# ---------------------------------------------------------------------------
# admin backup includes the new column (inspect-based)
# ---------------------------------------------------------------------------

def test_backup_serializer_includes_exception_kind(app):
    from backend.routes.admin import _serialize_row

    _product()
    sid = _snap()
    db.session.add(Finding(snapshot_id=sid, severity="high", exception_active=True,
                           exception_kind="exclude", finding_data={"id": "X"}))
    db.session.commit()
    row = Finding.query.first()
    assert _serialize_row(row)["exception_kind"] == "exclude"
