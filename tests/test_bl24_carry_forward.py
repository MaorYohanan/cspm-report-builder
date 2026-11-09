"""BL-24: exception carry-forward hardening (backend + business-logic JS).

Covers the stable rule key, matching (rule key first, (subscription, title) fallback,
loose marker), the unmatched-memory list, VULN-001 carry-forward on the pipeline path,
the memory endpoints (rule_key persistence, role-gated drop) and the Alembic migration.
The browser-side logic (memory-match.js) is exercised through Node.
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine, inspect, text

from backend.database import db
from backend.models import Finding, Product, ProductMemoryEntry, ReportSnapshot, User
from backend.routes.pipeline import _aggregate_vulns, _store_findings_with_memory
from backend.services.memory_matching import compute_unmatched, rule_key_for, MemoryIndex

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "static" / "js" / "src"
SUB = "prod-sub"
OTHER = "other-sub"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _product(pid: str = "p1") -> None:
    db.session.add(Product(
        id=pid, name="P", owner="o", owner_email="o@example.com", env="test",
        subscription_ids=[SUB], scan_frequency="quarterly", created_at=datetime.now(UTC),
    ))
    db.session.commit()


def _snap(pid: str = "p1") -> int:
    snap = ReportSnapshot(
        product_id=pid, version="d1", version_type="draft", status="draft",
        saved_at=datetime.now(UTC), snapshot_data={},
    )
    db.session.add(snap)
    db.session.commit()
    return snap.id


def _mem(title: str, source: str = "excepted", rule_key: str | None = None,
         sub: str = SUB, reason: str = "", pid: str = "p1") -> ProductMemoryEntry:
    e = ProductMemoryEntry(
        product_id=pid, subscription=sub.lower(), title=title.lower().strip(),
        reason=reason, source=source, rule_key=rule_key,
    )
    db.session.add(e)
    db.session.commit()
    return e


def _cfg(title: str, rule_id: str | None = "rule-1", sub: str = SUB, sev: str = "HIGH",
         subs: list | None = None) -> dict:
    """A raw configurationFindings node (title comes from rule.name)."""
    rule = {"name": title}
    if rule_id:
        rule["id"] = rule_id
    return {
        "queryType": "configurationFindings",
        "id": f"instance-{title}",
        "severity": sev,
        "rule": rule,
        "resource": {"name": "res", "subscription": {"name": sub}},
        "_sourceSubscription": sub,
        "_subscriptions": subs if subs is not None else [sub],
    }


def _store(raws, scope=None, sid=None):
    sid = sid or _snap()
    unmatched: list = []
    risk, count = _store_findings_with_memory(
        sid, "p1", raws, scope_subs=scope if scope is not None else [SUB], unmatched_out=unmatched,
    )
    db.session.commit()
    rows = [r.finding_data for r in Finding.query.filter_by(snapshot_id=sid).all()]
    return rows, unmatched, risk, count


def _by_title(rows):
    return {r["title"]: r for r in rows}


# ---------------------------------------------------------------------------
# rule key
# ---------------------------------------------------------------------------

RULE_KEY_FIXTURES = [
    ({"queryType": "issues", "sourceRules": [{"id": "SR-1", "name": "n"}]}, "issues|sr-1"),
    ({"queryType": "issues", "sourceRules": [{"name": "n"}], "control": {"id": "CTRL-9"}}, "issues|ctrl-9"),
    ({"queryType": "issues", "sourceRules": [], "control": {"id": "CTRL-9"}}, "issues|ctrl-9"),
    ({"queryType": "issues", "id": "instance-only", "sourceRules": [{"name": "n"}]}, None),
    ({"queryType": "configurationFindings", "rule": {"id": "AbC-1"}}, "configurationfindings|abc-1"),
    ({"queryType": "hostConfigurationRuleAssessments", "rule": {"id": "H1"}}, "hostconfigurationruleassessments|h1"),
    ({"queryType": "inventoryFindings", "rule": {"id": "I1"}}, "inventoryfindings|i1"),
    ({"queryType": "configurationFindings", "id": "inst", "rule": {"shortId": "x", "name": "y"}}, None),
    ({"queryType": "secretInstances", "name": "AWS key", "rule": {"id": "r"}}, None),
    ({"queryType": "excessiveAccessFindings", "name": "n"}, None),
    ({"queryType": "endOfLifeFindings", "detailedName": "x"}, None),
    ({"queryType": "networkExposures", "type": "t"}, None),
    ({"queryType": "dataFindingsV2", "dataClassifier": {"id": "c"}}, None),
    ({"queryType": "vulnerabilityFindings", "name": "CVE-1"}, None),
    ({"queryType": "configurationFindings", "rule": {"id": "  "}}, None),
    ({"rule": {"id": "x"}}, None),
]


@pytest.mark.parametrize("node,expected", RULE_KEY_FIXTURES)
def test_rule_key_for(node, expected):
    assert rule_key_for(node) == expected


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_js_build_rule_key_matches_python():
    """buildRuleKey (browser) and rule_key_for (pipeline) agree on every fixture."""
    cases = [{"item": n, "qt": n.get("queryType", "")} for n, _ in RULE_KEY_FIXTURES]
    out = _node("d.c.map(x => m.buildRuleKey(x.item, x.qt))", {"c": cases})
    assert out == [exp for _, exp in RULE_KEY_FIXTURES]


# ---------------------------------------------------------------------------
# server matching
# ---------------------------------------------------------------------------

def test_finding_gets_rule_key_stamped(app):
    _product()
    rows, _, _, _ = _store([_cfg("Some rule", "R-1"), _cfg("No id", None)])
    r = _by_title(rows)
    assert r["Some rule"]["_ruleKey"] == "configurationfindings|r-1"
    assert "_ruleKey" not in r["No id"]


def test_stable_id_match_restores_exception_after_title_change(app):
    _product()
    _mem("Old title of the rule", "excepted", rule_key="configurationfindings|r-1", reason="accepted")
    rows, unmatched, risk, _ = _store([_cfg("Renamed title", "R-1")])
    f = rows[0]
    assert f["exception"] == {"active": True, "reason": "accepted"}
    assert f["_matchedLoosely"] is True
    assert risk == 0
    assert unmatched == []  # the entry matched via its rule key


def test_exact_title_match_is_not_loose_even_with_rule_key(app):
    _product()
    _mem("Same title", "excepted", rule_key="configurationfindings|r-1")
    rows, _, _, _ = _store([_cfg("Same title", "R-1")])
    assert rows[0]["exception"]["active"] is True
    assert "_matchedLoosely" not in rows[0]


def test_legacy_entry_without_rule_key_still_matches_by_title(app):
    _product()
    _mem("Legacy finding", "excepted", rule_key=None)
    rows, _, _, _ = _store([_cfg("Legacy finding", "R-7")])
    assert rows[0]["exception"]["active"] is True
    assert "_matchedLoosely" not in rows[0]


def test_title_only_type_uses_fallback(app):
    _product()
    _mem("AWS access key", "excepted")
    raw = {"queryType": "secretInstances", "id": "s1", "name": "AWS access key", "severity": "HIGH",
           "resource": {"name": "r", "cloudAccount": {"name": SUB}}, "_sourceSubscription": SUB,
           "_subscriptions": [SUB]}
    rows, _, _, _ = _store([raw])
    assert rows[0]["exception"]["active"] is True
    assert "_ruleKey" not in rows[0]
    assert "_matchedLoosely" not in rows[0]


def test_rule_match_requires_agreeing_subscription(app):
    """A rule excepted in another subscription never silently excepts it here."""
    _product()
    _mem("Old title", "excepted", rule_key="configurationfindings|r-1", sub=OTHER)
    rows, unmatched, risk, _ = _store([_cfg("New title", "R-1")], scope=[SUB, OTHER])
    assert rows[0]["exception"]["active"] is False
    assert risk == 3
    assert [u["title"] for u in unmatched] == ["old title"]  # nothing matched the OTHER entry


def test_rule_match_on_aggregated_multi_subscription_finding(app):
    """Aggregation keeps the first _sourceSubscription; an entry for any contributing sub matches."""
    _product()
    _mem("Old title", "excepted", rule_key="configurationfindings|r-1", sub=OTHER, reason="b")
    rows, unmatched, _, _ = _store([_cfg("New title", "R-1", sub=SUB, subs=[SUB, OTHER])], scope=[SUB, OTHER])
    assert rows[0]["exception"] == {"active": True, "reason": "b"}
    assert rows[0]["_matchedLoosely"] is True
    assert unmatched == []


def test_exact_title_match_on_second_contributing_subscription(app):
    _product()
    _mem("Shared title", "excepted", sub=OTHER)
    rows, _, _, _ = _store([_cfg("Shared title", "R-1", sub=SUB, subs=[SUB, OTHER])], scope=[SUB, OTHER])
    assert rows[0]["exception"]["active"] is True


@pytest.mark.parametrize("source", ["excepted", "acknowledged"])
def test_rule_match_exception_kinds(app, source):
    _product()
    _mem("Gone title", source, rule_key="configurationfindings|r-1", reason="why")
    rows, _, risk, _ = _store([_cfg("Fresh title", "R-1")])
    f = rows[0]
    assert f["exception"]["active"] is True and f["_matchedLoosely"] is True
    if source == "acknowledged":
        assert f["exception"]["kind"] == "acknowledge"
    else:
        assert "kind" not in f["exception"]
    assert risk == 0


def test_rule_match_deleted_drops_finding(app):
    _product()
    _mem("Gone title", "deleted", rule_key="configurationfindings|r-1")
    rows, unmatched, _, count = _store([_cfg("Fresh title", "R-1"), _cfg("Other", "R-2")])
    assert count == 1 and [r["title"] for r in rows] == ["Other"]
    assert unmatched == []


def test_rule_match_temp_entry_flags_reminder_and_is_consumed(app):
    _product()
    _mem("Gone title", "temp_excepted", rule_key="configurationfindings|r-1")
    rows, unmatched, risk, _ = _store([_cfg("Fresh title", "R-1", sev="CRITICAL")])
    f = rows[0]
    assert f["_wasTempActioned"] is True and f["_matchedLoosely"] is True
    assert f["exception"]["active"] is False  # stays ACTIVE and counts toward risk
    assert risk == 4
    assert ProductMemoryEntry.query.filter_by(source="temp_excepted").count() == 0
    assert unmatched == []


def test_excepted_wins_over_acknowledged_on_rule_tie(app):
    _product()
    _mem("old a", "acknowledged", rule_key="configurationfindings|r-1")
    _mem("old b", "excepted", rule_key="configurationfindings|r-1")
    rows, _, _, _ = _store([_cfg("Now", "R-1")])
    assert "kind" not in rows[0]["exception"]


# ---------------------------------------------------------------------------
# unmatched memory
# ---------------------------------------------------------------------------

def test_unmatched_lists_all_four_sources_in_scope_only(app):
    _product()
    _mem("stale excepted", "excepted", rule_key="configurationfindings|gone-1", reason="r1")
    _mem("stale deleted", "deleted")
    _mem("stale temp", "temp_excepted")
    _mem("stale ack", "acknowledged")
    _mem("elsewhere", "excepted", sub=OTHER)
    _mem("present", "excepted")
    rows, unmatched, _, _ = _store([_cfg("Present", "R-1")], scope=[SUB])
    assert rows[0]["exception"]["active"] is True
    got = {u["title"]: u for u in unmatched}
    assert set(got) == {"stale excepted", "stale deleted", "stale temp", "stale ack"}
    assert {u["source"] for u in unmatched} == {"excepted", "deleted", "temp_excepted", "acknowledged"}
    assert got["stale excepted"]["ruleKey"] == "configurationfindings|gone-1"
    assert got["stale excepted"]["reason"] == "r1"
    assert got["stale excepted"]["subscription"] == SUB


def test_unmatched_scope_covers_all_scanned_subscriptions(app):
    _product()
    _mem("elsewhere", "excepted", sub=OTHER)
    _, unmatched, _, _ = _store([_cfg("x", "R-1")], scope=[SUB, OTHER])
    assert [u["title"] for u in unmatched] == ["elsewhere"]
    _, unmatched2, _, _ = _store([_cfg("x", "R-1")], scope=[SUB], sid=_snap_again())
    assert unmatched2 == []


def _snap_again() -> int:
    snap = ReportSnapshot(product_id="p1", version="d2", version_type="draft", status="draft",
                          saved_at=datetime.now(UTC), snapshot_data={})
    db.session.add(snap)
    db.session.commit()
    return snap.id


def test_unmatched_omitted_when_not_requested(app):
    _product()
    _mem("stale", "excepted")
    sid = _snap()
    risk, count = _store_findings_with_memory(sid, "p1", [_cfg("x", "R-1")])
    assert count == 1  # legacy two-value return still works


def test_compute_unmatched_joined_subscription_scope():
    class E:  # minimal entry stand-in
        def __init__(self, i, sub):
            self.id, self.subscription, self.title = i, sub, "t"
            self.source, self.reason, self.rule_key = "excepted", "", None

    out = compute_unmatched([E(1, "sub-a, sub-b"), E(2, "sub-a, sub-z")], set(), ["sub-a", "sub-b"])
    assert [e["subscription"] for e in out] == ["sub-a, sub-b"]


def test_index_resolve_ignores_blank_subscriptions():
    class E:
        id, subscription, title, source, reason, rule_key = 1, "s", "t", "excepted", "", "k|1"

    res = MemoryIndex([E()]).resolve("t", "k|1", ["", "  "])
    assert res.matched == []


# ---------------------------------------------------------------------------
# VULN-001 on the pipeline path
# ---------------------------------------------------------------------------

def _vuln(name: str, sub: str, sev: str = "HIGH") -> dict:
    return {"queryType": "vulnerabilityFindings", "id": f"v-{name}-{sub}", "name": name, "severity": sev,
            "vulnerableAsset": {"name": f"vm-{name}"}, "_sourceSubscription": sub, "_subscriptions": [sub]}


VULN_TITLE = "multiple vulnerabilities with high and above severity"


def test_aggregate_vulns_carries_subscription_key():
    agg = _aggregate_vulns([_vuln("CVE-1", "sub-a"), _vuln("CVE-2", "sub-b")])
    assert agg["_sourceSubscription"] == "sub-a, sub-b"
    assert agg["_subscriptions"] == ["sub-a", "sub-b"]


def test_vuln001_carries_forward_on_joined_subscription(app):
    _product()
    _mem(VULN_TITLE, "excepted", sub="sub-a, sub-b", reason="vuln accepted")
    agg = _aggregate_vulns([_vuln("CVE-1", "sub-a"), _vuln("CVE-2", "sub-b")])
    rows, unmatched, risk, _ = _store([agg], scope=["sub-a", "sub-b"])
    f = rows[0]
    assert f["id"] == "VULN-001"
    assert f["exception"] == {"active": True, "reason": "vuln accepted"}
    assert "_matchedLoosely" not in f and "_ruleKey" not in f
    assert "_subscriptions" not in f  # internal helper never persisted
    assert risk == 0 and unmatched == []


def test_vuln001_carries_forward_when_stored_under_one_subscription(app):
    """The browser stores the aggregate under the subscription it imported (one name)."""
    _product()
    _mem(VULN_TITLE, "acknowledged", sub="sub-a")
    agg = _aggregate_vulns([_vuln("CVE-1", "sub-a"), _vuln("CVE-2", "sub-b")])
    rows, _, _, _ = _store([agg], scope=["sub-a", "sub-b"])
    assert rows[0]["exception"]["kind"] == "acknowledge"


def test_vuln001_deleted_is_dropped_and_not_reported(app):
    _product()
    _mem(VULN_TITLE, "deleted", sub="sub-a, sub-b")
    agg = _aggregate_vulns([_vuln("CVE-1", "sub-a"), _vuln("CVE-2", "sub-b")])
    rows, unmatched, _, count = _store([agg], scope=["sub-a", "sub-b"])
    assert count == 0 and unmatched == []


def test_vuln001_not_excepted_without_entry(app):
    _product()
    agg = _aggregate_vulns([_vuln("CVE-1", "sub-a", "CRITICAL")])
    rows, _, risk, _ = _store([agg], scope=["sub-a"])
    assert rows[0]["exception"]["active"] is False and risk == 4


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------

def _api_product(client, pid="api-p"):
    with client.application.app_context():
        _product(pid)


def test_upsert_persists_rule_key_and_get_returns_it(client):
    _api_product(client)
    r = client.post("/api/products/api-p/memory/entry", json={
        "subscription": "Sub-1", "title": "  Some Title ", "source": "excepted",
        "reason": "x", "rule_key": " ConfigurationFindings|Rule-1 ",
    })
    assert r.status_code == 200
    with client.application.app_context():
        e = ProductMemoryEntry.query.filter_by(product_id="api-p").one()
        assert e.rule_key == "configurationfindings|rule-1"
    data = client.get("/api/products/api-p/memory").get_json()
    entry = data["entries"]["sub-1::some title"]
    assert entry["rule_key"] == "configurationfindings|rule-1"
    assert entry["subscription"] == "sub-1" and entry["title"] == "some title"


def test_upsert_without_rule_key_keeps_existing_key(client):
    _api_product(client)
    body = {"subscription": "s", "title": "t", "source": "excepted", "rule_key": "issues|r1"}
    assert client.post("/api/products/api-p/memory/entry", json=body).status_code == 200
    body2 = {"subscription": "s", "title": "t", "source": "acknowledged"}
    assert client.post("/api/products/api-p/memory/entry", json=body2).status_code == 200
    with client.application.app_context():
        e = ProductMemoryEntry.query.filter_by(product_id="api-p").one()
        assert e.source == "acknowledged" and e.rule_key == "issues|r1"


def test_upsert_blank_rule_key_is_stored_as_null_and_legacy_entries_have_none(client):
    _api_product(client)
    assert client.post("/api/products/api-p/memory/entry", json={
        "subscription": "s", "title": "t", "rule_key": "   "}).status_code == 200
    data = client.get("/api/products/api-p/memory").get_json()
    assert data["entries"]["s::t"]["rule_key"] is None


@pytest.mark.parametrize("bad", [123, ["a"], {"a": 1}, "x" * 301, "a/../x", "a\x00b"])
def test_upsert_rejects_invalid_rule_key(client, bad):
    _api_product(client)
    r = client.post("/api/products/api-p/memory/entry", json={
        "subscription": "s", "title": "t", "rule_key": bad})
    assert r.status_code == 400


def test_delete_with_rule_key_clears_stale_same_rule_entries(client):
    _api_product(client)
    with client.application.app_context():
        _mem("old title", "excepted", rule_key="issues|r1", sub="s", pid="api-p")
        _mem("older title", "excepted", rule_key="issues|r1", sub="s", pid="api-p")
        _mem("other sub", "excepted", rule_key="issues|r1", sub="z", pid="api-p")
        _mem("other rule", "excepted", rule_key="issues|r2", sub="s", pid="api-p")
    r = client.delete("/api/products/api-p/memory/entry", json={
        "subscription": "S", "title": "Old Title", "rule_key": "Issues|R1"})
    assert r.status_code == 200
    with client.application.app_context():
        left = {e.title for e in ProductMemoryEntry.query.filter_by(product_id="api-p").all()}
        assert left == {"other sub", "other rule"}


def test_delete_without_rule_key_only_removes_that_entry(client):
    _api_product(client)
    with client.application.app_context():
        _mem("a", "excepted", rule_key="issues|r1", sub="s", pid="api-p")
        _mem("b", "excepted", rule_key="issues|r1", sub="s", pid="api-p")
    assert client.delete("/api/products/api-p/memory/entry",
                         json={"subscription": "s", "title": "a"}).status_code == 200
    with client.application.app_context():
        assert [e.title for e in ProductMemoryEntry.query.filter_by(product_id="api-p").all()] == ["b"]


def _login(client, email, role):
    client.application.secret_key = "bl24-test-secret"
    with client.application.app_context():
        db.session.add(User(email=email, role=role, created_at=datetime.now(UTC)))
        db.session.commit()
    with client.session_transaction() as s:
        s["user_email"] = email


@patch("backend.services.auth_service._OAUTH_ENABLED", True)
def test_drop_rejected_for_viewer_and_allowed_for_editor(client):
    _api_product(client)
    with client.application.app_context():
        _mem("stale", "excepted", sub="s", pid="api-p")
    _login(client, "v@example.com", "viewer")
    r = client.delete("/api/products/api-p/memory/entry", json={"subscription": "s", "title": "stale"})
    assert r.status_code == 403
    with client.application.app_context():
        assert ProductMemoryEntry.query.filter_by(product_id="api-p").count() == 1
    # upsert is editor-gated too
    assert client.post("/api/products/api-p/memory/entry",
                       json={"subscription": "s", "title": "n"}).status_code == 403
    # GET stays viewer-readable
    assert client.get("/api/products/api-p/memory").status_code == 200

    with client.session_transaction() as sess:
        sess.clear()
    _login(client, "e@example.com", "editor")
    r = client.delete("/api/products/api-p/memory/entry", json={"subscription": "s", "title": "stale"})
    assert r.status_code == 200
    with client.application.app_context():
        assert ProductMemoryEntry.query.filter_by(product_id="api-p").count() == 0


@patch("backend.services.auth_service._OAUTH_ENABLED", True)
def test_drop_requires_login(client):
    _api_product(client)
    r = client.delete("/api/products/api-p/memory/entry", json={"subscription": "s", "title": "t"})
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# scan-status payload
# ---------------------------------------------------------------------------

def test_scan_status_db_fallback_includes_unmatched_memory(app):
    from flask import Flask  # noqa: F401
    from backend.routes.pipeline import pipeline_bp

    app.register_blueprint(pipeline_bp)
    _product()
    snap = ReportSnapshot(
        product_id="p1", version="d1", version_type="draft", status="draft", saved_at=datetime.now(UTC),
        snapshot_data={"_scan_status": "done", "_scan_total": 2, "findings_count": 3,
                       "_unmatched_memory": [{"subscription": "s", "title": "t", "source": "excepted",
                                              "reason": "", "ruleKey": None}]},
    )
    db.session.add(snap)
    db.session.commit()
    data = app.test_client().get(f"/api/pipeline/p1/scan-status/{snap.id}").get_json()
    assert data["status"] == "done"
    assert data["unmatched_memory"][0]["title"] == "t"


# ---------------------------------------------------------------------------
# migration (temp DBs only)
# ---------------------------------------------------------------------------

_MIGRATION = ROOT / "migrations" / "versions" / "c24b7e9f1a30_add_rule_key_to_product_memory.py"

_PRE_DDL = [
    "CREATE TABLE product_memory_entries ("
    "id INTEGER NOT NULL PRIMARY KEY, product_id VARCHAR(100) NOT NULL, subscription VARCHAR(200) NOT NULL, "
    "title VARCHAR(500) NOT NULL, reason VARCHAR(1000), source VARCHAR(20) NOT NULL, consumed_at DATETIME, "
    "UNIQUE (product_id, subscription, title), "
    "CONSTRAINT ck_memory_source CHECK (source IN ('excepted','deleted','temp_excepted','acknowledged')))",
    "CREATE INDEX ix_product_memory_entries_product_id ON product_memory_entries (product_id)",
]


def _load_migration():
    spec = importlib.util.spec_from_file_location("bl24_migration", _MIGRATION)
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


@pytest.fixture
def pre_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'pre.db'}")
    with engine.begin() as conn:
        for ddl in _PRE_DDL:
            conn.execute(text(ddl))
        conn.execute(text(
            "INSERT INTO product_memory_entries (product_id, subscription, title, source, reason) "
            "VALUES ('p', 's', 'keep', 'acknowledged', 'kept reason')"))
    yield engine
    engine.dispose()


def _cols(engine):
    return {c["name"] for c in inspect(engine).get_columns("product_memory_entries")}


def _indexes(engine):
    return {i["name"] for i in inspect(engine).get_indexes("product_memory_entries")}


def test_migration_chain_has_single_head_after_b23():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["c24b7e9f1a30"]
    assert script.get_revision("c24b7e9f1a30").down_revision == "b23a0c5d7e11"


def test_migration_up_down_preserves_rows(pre_engine):
    mig = _load_migration()
    assert "rule_key" not in _cols(pre_engine)

    _run(pre_engine, mig.upgrade)
    assert "rule_key" in _cols(pre_engine)
    assert "ix_memory_product_rule_key" in _indexes(pre_engine)
    with pre_engine.begin() as conn:
        row = conn.execute(text("SELECT title, source, reason, rule_key FROM product_memory_entries")).one()
        assert tuple(row) == ("keep", "acknowledged", "kept reason", None)
        conn.execute(text("UPDATE product_memory_entries SET rule_key='issues|r1'"))

    _run(pre_engine, mig.upgrade)  # idempotent (dev startup backfill may have added it already)

    _run(pre_engine, mig.downgrade)
    assert "rule_key" not in _cols(pre_engine)
    assert "ix_memory_product_rule_key" not in _indexes(pre_engine)
    with pre_engine.begin() as conn:
        row = conn.execute(text("SELECT title, source, reason FROM product_memory_entries")).one()
        assert tuple(row) == ("keep", "acknowledged", "kept reason")
        # the unique constraint and the source CHECK survive the batch rebuild
        with pytest.raises(Exception):
            conn.execute(text(
                "INSERT INTO product_memory_entries (product_id, subscription, title, source) "
                "VALUES ('p', 's', 'bad', 'nope')"))


# ---------------------------------------------------------------------------
# browser-side logic (memory-match.js) through Node
# ---------------------------------------------------------------------------

def _node(expr: str, data: dict):
    script = (
        f"import * as m from {json.dumps((JS / 'memory-match.js').as_uri())};"
        f"const d = {json.dumps(data)};"
        f"console.log(JSON.stringify({expr}));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


def _entries(*rows):
    """rows: (sub, title, source, rule_key, reason) -> GET /memory 'entries' object."""
    out = {}
    for sub, title, source, rk, reason in rows:
        out[f"{sub.lower()}::{title.lower()}"] = {
            "exception": True, "reason": reason, "source": source,
            "subscription": sub.lower(), "title": title.lower(), "rule_key": rk,
        }
    return out


def _apply(findings, entries, sub=SUB, scope=None, seen=None):
    expr = (
        "(() => { const list = m.memoryEntriesToList(d.e);"
        " const res = m.applyMemoryToFindings(d.f, list, d.s);"
        " const un = m.computeUnmatchedEntries(list, res.matchedKeys, d.scope, d.seen);"
        " return {f: d.f, res: {matched: res.matched, matchedAck: res.matchedAck, tempFlagged: res.tempFlagged,"
        " loose: res.loose, tempToConsume: res.tempToConsume, keys: [...res.matchedKeys]}, un}; })()"
    )
    return _node(expr, {"f": findings, "e": entries, "s": sub,
                        "scope": scope or {"subscription": sub}, "seen": seen or []})


needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


@needs_node
def test_js_rule_key_match_restores_and_marks_loose():
    f = [{"title": "Renamed", "_ruleKey": "configurationfindings|r-1"}]
    out = _apply(f, _entries((SUB, "Old name", "excepted", "configurationfindings|r-1", "why")))
    assert out["f"][0]["exception"] == {"active": True, "reason": "why"}
    assert out["f"][0]["_matchedLoosely"] is True
    assert out["res"]["matched"] == 1 and out["res"]["loose"] == 1
    assert out["un"] == []


@needs_node
def test_js_exact_title_match_not_loose_and_legacy_entry():
    f = [{"title": "Same", "_ruleKey": "configurationfindings|r-1"}, {"title": "Legacy", "_ruleKey": "x|y"}]
    out = _apply(f, _entries((SUB, "same", "excepted", "configurationfindings|r-1", ""),
                             (SUB, "LEGACY", "excepted", None, "")))
    assert all(x["exception"]["active"] for x in out["f"])
    assert all("_matchedLoosely" not in x for x in out["f"])


@needs_node
def test_js_title_only_fallback_without_rule_key_on_finding():
    f = [{"title": "  Secret NAME "}]
    out = _apply(f, _entries((SUB, "secret name", "acknowledged", None, "r")))
    assert out["f"][0]["exception"] == {"active": True, "reason": "r", "kind": "acknowledge"}
    assert out["res"]["matchedAck"] == 1
    assert "_matchedLoosely" not in out["f"][0]


@needs_node
def test_js_rule_match_requires_same_subscription():
    f = [{"title": "New", "_ruleKey": "issues|r"}]
    out = _apply(f, _entries(("other-sub", "Old", "excepted", "issues|r", "")))
    assert "exception" not in out["f"][0]
    assert out["un"] == []  # entry belongs to another subscription: out of scope, not stale


@needs_node
def test_js_temp_entry_flagged_once_and_consumed():
    f = [{"title": "Gone", "_ruleKey": "issues|r"}]
    out = _apply(f, _entries((SUB, "Old", "temp_excepted", "issues|r", "")))
    x = out["f"][0]
    assert x["_wasTempActioned"] is True and x["_tempActionReason"] == "excepted"
    assert x["_matchedLoosely"] is True and "exception" not in x
    assert out["res"]["tempToConsume"] == [{"subscription": SUB, "title": "old"}]
    # an already-flagged finding never fires a second DELETE
    f2 = [{"title": "Gone", "_ruleKey": "issues|r", "_wasTempActioned": True}]
    assert _apply(f2, _entries((SUB, "Old", "temp_excepted", "issues|r", "")))["res"]["tempToConsume"] == []


@needs_node
def test_js_deleted_entry_restores_as_exclusion_like_before():
    out = _apply([{"title": "X"}], _entries((SUB, "x", "deleted", None, "")))
    assert out["f"][0]["exception"]["active"] is True


@needs_node
def test_js_existing_exception_is_not_overwritten_or_marked_loose():
    f = [{"title": "N", "_ruleKey": "issues|r", "exception": {"active": True, "reason": "mine"}}]
    out = _apply(f, _entries((SUB, "old", "excepted", "issues|r", "other")))
    assert out["f"][0]["exception"]["reason"] == "mine"
    assert "_matchedLoosely" not in out["f"][0]


@needs_node
def test_js_vuln001_aggregate_title_matches_for_the_stamped_subscription():
    title = "Multiple vulnerabilities with high and above severity"
    f = [{"title": title, "category": "VULN"}]
    out = _apply(f, _entries((SUB, title, "excepted", None, "agg")))
    assert out["f"][0]["exception"] == {"active": True, "reason": "agg"}


@needs_node
def test_js_unmatched_all_sources_scope_and_seen():
    entries = _entries(
        (SUB, "stale a", "excepted", "issues|gone", "ra"),
        (SUB, "stale b", "deleted", None, ""),
        (SUB, "stale c", "temp_excepted", None, ""),
        (SUB, "stale d", "acknowledged", None, ""),
        (SUB, "present but not imported", "excepted", None, ""),
        (SUB, "renamed elsewhere", "excepted", "issues|live", ""),
        ("other-sub", "elsewhere", "excepted", None, ""),
    )
    seen = [{"title": "Present But Not Imported", "subscription": ""},
            {"title": "whatever", "ruleKey": "issues|live", "subscription": SUB}]
    out = _apply([], entries, scope={"subscription": SUB}, seen=seen)
    got = {u["title"]: u for u in out["un"]}
    assert set(got) == {"stale a", "stale b", "stale c", "stale d"}
    assert got["stale a"] == {"subscription": SUB, "title": "stale a", "source": "excepted",
                              "reason": "ra", "ruleKey": "issues|gone"}


@needs_node
def test_js_unmatched_single_query_scope_limited_to_query_type_rule_keys():
    entries = _entries(
        (SUB, "cfg stale", "excepted", "configurationfindings|gone", ""),
        (SUB, "issue stale", "excepted", "issues|gone", ""),
        (SUB, "title only", "excepted", None, ""),
    )
    out = _apply([], entries, scope={"subscription": SUB, "queryType": "configurationFindings"})
    assert [u["title"] for u in out["un"]] == ["cfg stale"]


@needs_node
def test_js_unmatched_empty_without_scope_subscription():
    out = _apply([], _entries((SUB, "x", "excepted", None, "")), scope={"subscription": ""})
    assert out["un"] == []


@needs_node
def test_js_publish_and_drop_helpers():
    """publishUnmatchedMemory dispatches the event; dropMemoryEntry DELETEs and re-publishes."""
    script = f"""
    import {{ state }} from {json.dumps((JS / 'state.js').as_uri())};
    import * as m from {json.dumps((JS / 'memory-match.js').as_uri())};
    const events = [];
    globalThis.CustomEvent = class {{ constructor(t, o) {{ this.type = t; this.detail = o.detail; }} }};
    globalThis.document = {{ dispatchEvent: e => events.push(e) }};
    const calls = [];
    globalThis.fetch = async (url, opts) => {{ calls.push({{url, opts}}); return {{ ok: true }}; }};
    const e1 = {{subscription:'s', title:'a', source:'excepted', reason:'', ruleKey:null}};
    const e2 = {{subscription:'s', title:'b', source:'deleted', reason:'', ruleKey:'issues|r'}};
    m.publishUnmatchedMemory([e1, e2], {{type:'bulk'}});
    const r = await m.dropMemoryEntry('prod 1', e1);
    globalThis.fetch = async () => ({{ ok: false, status: 403 }});
    let err = null;
    try {{ await m.dropMemoryEntry('prod 1', e2); }} catch (x) {{ err = x.message; }}
    console.log(JSON.stringify({{ types: events.map(e => e.type),
      first: events[0].detail.entries.length, last: events[events.length-1].detail,
      r, url: calls[0].url, method: calls[0].opts.method, body: JSON.parse(calls[0].opts.body),
      state: state.unmatchedMemory, err }}));
    """
    res = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    out = json.loads(res.stdout)
    assert out["types"] == ["memory:unmatched", "memory:unmatched"]
    assert out["first"] == 2
    assert [e["title"] for e in out["last"]["entries"]] == ["b"]
    assert out["last"]["scope"] == {"type": "bulk"}
    assert out["r"] == {"ok": True}
    assert out["url"] == "/api/products/prod%201/memory/entry" and out["method"] == "DELETE"
    assert out["body"] == {"subscription": "s", "title": "a"}
    assert out["err"] == "HTTP 403"
    assert [e["title"] for e in out["state"]["entries"]] == ["b"]  # failed drop leaves state untouched


@needs_node
def test_js_export_sanitize_strips_loose_marker_and_rule_key():
    script = (
        f"import {{stripInternalExportFields as s}} from {json.dumps((JS / 'export-sanitize.js').as_uri())};"
        "const f=[{title:'A',_matchedLoosely:true,_ruleKey:'issues|r',_sourceSubscription:'s'}];"
        "const o=s(f); console.log(JSON.stringify({o, f}));"
    )
    out = json.loads(subprocess.run(["node", "--input-type=module", "-e", script],
                                    capture_output=True, text=True, check=True, timeout=30).stdout)
    assert out["o"] == [{"title": "A"}]
    assert out["f"][0]["_matchedLoosely"] is True  # input never mutated
