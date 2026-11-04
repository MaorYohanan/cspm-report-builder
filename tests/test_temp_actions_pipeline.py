"""BL-12: temporary exception lifecycle through the real pipeline persistence path.

A temp_excepted memory entry applies to the report where it was set. In the NEXT
report the finding arrives ACTIVE (counts toward risk), flagged _wasTempActioned,
and the entry row is consumed once.
"""
from __future__ import annotations

from datetime import UTC, datetime

from backend.database import db
from backend.models import Finding, Product, ProductMemoryEntry, ReportSnapshot
from backend.routes.pipeline import _store_findings_with_memory

SUB = "prod-sub"


def _raw(title: str, sev: str = "HIGH", sub: str = SUB) -> dict:
    return {
        "queryType": "configurationFindings",
        "id": f"id-{title}",
        "severity": sev,
        "rule": {"name": title},
        "resource": {"name": "res", "subscription": {"name": sub}},
        "_sourceSubscription": sub,
        "_subscriptions": [sub],
    }


def _setup(pid: str = "p1") -> int:
    db.session.add(Product(
        id=pid, name="P", owner="o", owner_email="o@example.com", env="test",
        subscription_ids=[SUB], scan_frequency="quarterly", created_at=datetime.now(UTC),
    ))
    return _new_snap(pid, "d1")


def _new_snap(pid: str, version: str) -> int:
    snap = ReportSnapshot(
        product_id=pid, version=version, version_type="draft", status="draft",
        saved_at=datetime.now(UTC), snapshot_data={},
    )
    db.session.add(snap)
    db.session.commit()
    return snap.id


def _mem(pid, title, source, reason=""):
    db.session.add(ProductMemoryEntry(
        product_id=pid, subscription=SUB, title=title.lower(), reason=reason, source=source,
    ))
    db.session.commit()


def _run(sid, pid, raws):
    risk, count = _store_findings_with_memory(sid, pid, raws)
    db.session.commit()
    return risk, count


def _rows(sid):
    return {r.finding_data["title"]: r for r in Finding.query.filter_by(snapshot_id=sid).all()}


def test_temp_entry_finding_arrives_active_flagged_and_entry_consumed(app):
    sid = _setup()
    _mem("p1", "Open S3 bucket", "temp_excepted", "ignore this cycle")
    risk, count = _run(sid, "p1", [_raw("Open S3 bucket", "HIGH")])
    row = _rows(sid)["Open S3 bucket"]
    assert count == 1
    assert row.exception_active is False
    assert row.finding_data["_wasTempActioned"] is True
    assert row.finding_data["_tempActionReason"] == "excepted"
    assert not (row.finding_data.get("exception") or {}).get("active")
    assert risk == 3  # High counts toward risk
    assert ProductMemoryEntry.query.filter_by(product_id="p1").count() == 0


def test_second_run_does_not_reflag(app):
    sid = _setup()
    _mem("p1", "Open S3 bucket", "temp_excepted")
    _run(sid, "p1", [_raw("Open S3 bucket")])
    sid2 = _new_snap("p1", "d2")
    risk, _ = _run(sid2, "p1", [_raw("Open S3 bucket")])
    data = _rows(sid2)["Open S3 bucket"].finding_data
    assert "_wasTempActioned" not in data
    assert risk == 3


def test_permanent_excepted_still_excepts(app):
    sid = _setup()
    _mem("p1", "Weak TLS", "excepted", "accepted risk")
    risk, _ = _run(sid, "p1", [_raw("Weak TLS", "CRITICAL")])
    row = _rows(sid)["Weak TLS"]
    assert row.exception_active is True
    assert row.finding_data["exception"] == {"active": True, "reason": "accepted risk"}
    assert "_wasTempActioned" not in row.finding_data
    assert risk == 0


def test_permanent_deleted_still_skipped(app):
    sid = _setup()
    _mem("p1", "Old finding", "deleted")
    risk, count = _run(sid, "p1", [_raw("Old finding")])
    assert count == 0 and risk == 0
    assert _rows(sid) == {}


def test_unrelated_findings_and_entries_untouched(app):
    sid = _setup()
    _mem("p1", "Open S3 bucket", "temp_excepted")
    _mem("p1", "Other temp", "temp_excepted")  # not present in this scan
    risk, _ = _run(sid, "p1", [_raw("Open S3 bucket", "LOW"), _raw("Plain", "MEDIUM")])
    rows = _rows(sid)
    assert "_wasTempActioned" not in rows["Plain"].finding_data
    assert risk == 1 + 2
    left = ProductMemoryEntry.query.filter_by(product_id="p1").all()
    assert [e.title for e in left] == ["other temp"]


def test_temp_entry_already_removed_by_other_worker_is_safe(app, monkeypatch):
    import backend.routes.pipeline as pl

    sid = _setup()
    _mem("p1", "Open S3 bucket", "temp_excepted")
    real = pl._transform_finding

    def _transform_and_steal(raw, counters):
        # Another worker consumes the entry after we loaded it, before we delete it.
        db.session.execute(db.text("DELETE FROM product_memory_entries"))
        return real(raw, counters)

    monkeypatch.setattr(pl, "_transform_finding", _transform_and_steal)
    risk, count = _store_findings_with_memory(sid, "p1", [_raw("Open S3 bucket")])
    db.session.commit()  # must not raise
    assert count == 1 and risk == 3
    assert _rows(sid)["Open S3 bucket"].finding_data["_wasTempActioned"] is True
