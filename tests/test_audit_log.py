"""BL-16 audit log: model, migration, instrumentation, list route, sanitising."""
from __future__ import annotations

import importlib.util
import io
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy import create_engine, inspect, text

from backend.database import db as _db
from backend.models import AuditEvent, ExcludeRule, Product, ReportSnapshot, User
from backend.routes.admin import admin_bp
from backend.routes.auth import auth_bp
from backend.routes.products import products_bp
from backend.routes.wiz import wiz_bp
from backend.services import audit_service

ROOT = Path(__file__).resolve().parent.parent
_MIGRATION = ROOT / "migrations" / "versions" / "d16a1c4e8b52_add_audit_events.py"
URL = "/api/admin/audit-log"


@pytest.fixture
def app(tmp_path):
    application = Flask(__name__)
    application.config["TESTING"] = True
    application.config["SECRET_KEY"] = "test"
    application.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    application.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    application.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024
    _db.init_app(application)
    with application.app_context():
        import backend.models  # noqa: F401
        _db.create_all()
        for bp in (products_bp, wiz_bp, auth_bp, admin_bp):
            application.register_blueprint(bp)
        yield application
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


def _events(**kw):
    return _db.session.execute(
        _db.select(AuditEvent).filter_by(**kw).order_by(AuditEvent.id)
    ).scalars().all()


def _mk_product(pid="p1", status=None, version="1.0"):
    _db.session.add(Product(id=pid, name=pid, owner="o", owner_email="o@x.com", env="e",
                            subscription_ids=[]))
    if status:
        _db.session.add(ReportSnapshot(
            product_id=pid, version=version, report_version="1.0", version_type="major",
            status=status, saved_at=datetime.now(timezone.utc), risk_score=7, snapshot_data={}))
    _db.session.commit()


def _login(client, email, role):
    with client.session_transaction() as s:
        s["user_email"] = email
        s["user_role"] = role


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------

def _load_migration():
    spec = importlib.util.spec_from_file_location("bl16_migration", _MIGRATION)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run(engine, fn):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            fn()


def test_migration_up_down_and_idempotent(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'mig.db'}")
    mig = _load_migration()
    assert mig.down_revision == "c24b7e9f1a30"
    _run(engine, mig.upgrade)
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("audit_events")}
    assert cols == {"id", "timestamp", "actor", "actor_role", "action", "entity_type",
                    "entity_id", "product_id", "details"}
    idx = {i["name"] for i in insp.get_indexes("audit_events")}
    assert {"ix_audit_events_timestamp", "ix_audit_events_actor",
            "ix_audit_events_action", "ix_audit_events_product_id"} <= idx
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO audit_events (timestamp, actor, actor_role, action, entity_type) "
                          "VALUES ('2026-01-01', 'a', 'admin', 'x', 'y')"))
    _run(engine, mig.upgrade)  # table already there (dev startup create_all) -> no-op, rows kept
    with engine.begin() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM audit_events")).scalar() == 1
    _run(engine, mig.downgrade)
    assert "audit_events" not in inspect(engine).get_table_names()
    _run(engine, mig.downgrade)  # idempotent
    engine.dispose()


def test_single_head_is_audit_revision():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    assert ScriptDirectory.from_config(cfg).get_heads() == ["e17b2d5f9a63"]


# ---------------------------------------------------------------------------
# One row per action
# ---------------------------------------------------------------------------

def test_publish_logs_one_row_and_does_not_change_version(client):
    _mk_product(status="draft")
    _login(client, "ed@x.com", "editor")
    r = client.post("/api/products/p1/versions/1.0/publish")
    assert r.status_code == 200
    ev = _events(action="version.publish")
    assert len(ev) == 1
    e = ev[0]
    assert (e.actor, e.actor_role, e.entity_type, e.entity_id, e.product_id) == (
        "ed@x.com", "editor", "version", "1.0", "p1")
    assert json.loads(e.details) == {"version": "1.0", "risk_score": 7}
    # failed publish (already published) writes nothing
    assert client.post("/api/products/p1/versions/1.0/publish").status_code == 409
    assert len(_events(action="version.publish")) == 1


def test_delete_version_and_product(client):
    _mk_product(status="draft")
    assert client.delete("/api/products/p1/versions/1.0").status_code == 200
    ev = _events(action="version.delete")
    assert len(ev) == 1 and ev[0].product_id == "p1" and ev[0].entity_id == "1.0"
    assert client.delete("/api/products/p1/versions/1.0").status_code == 404
    assert len(_events(action="version.delete")) == 1

    assert client.delete("/api/products/p1").status_code == 200
    ev = _events(action="product.delete")
    assert len(ev) == 1 and ev[0].entity_id == "p1"
    assert json.loads(ev[0].details) == {"name": "p1"}
    assert client.delete("/api/products/p1").status_code == 404
    assert len(_events(action="product.delete")) == 1


def test_delete_published_version_is_refused_and_not_logged(client):
    _mk_product(status="published")
    assert client.delete("/api/products/p1/versions/1.0").status_code == 409
    assert _events(action="version.delete") == []
    assert _db.session.query(ReportSnapshot).count() == 1  # published version untouched


@pytest.mark.parametrize("source,action", [
    ("deleted", "finding.delete"),
    ("excepted", "exception.add"),
    ("temp_excepted", "exception.temporary"),
    ("acknowledged", "exception.acknowledge"),
])
def test_memory_entry_actions(client, source, action):
    _mk_product()
    body = {"subscription": "Sub1", "title": "Open port", "reason": "r", "source": source}
    assert client.post("/api/products/p1/memory/entry", json=body).status_code == 200
    ev = _events(action=action)
    assert len(ev) == 1
    assert ev[0].entity_type == "finding" and ev[0].product_id == "p1"
    d = json.loads(ev[0].details)
    assert d["title"] == "Open port" and d["source"] == source
    # idempotent re-send is not a new action
    client.post("/api/products/p1/memory/entry", json=body)
    assert len(_events(action=action)) == 1
    assert _db.session.query(AuditEvent).count() == 1

    r = client.delete("/api/products/p1/memory/entry", json={"subscription": "Sub1", "title": "Open port"})
    assert r.status_code == 200
    removed = _events(action="exception.remove")
    if source == "deleted":
        assert removed == []  # un-deleting a finding is not a listed action
    else:
        assert len(removed) == 1 and json.loads(removed[0].details)["source"] == source
    # removing something that does not exist logs nothing
    client.delete("/api/products/p1/memory/entry", json={"subscription": "Sub1", "title": "Open port"})
    assert len(_events(action="exception.remove")) == len(removed)


def test_exclude_rule_actions(client):
    r = client.post("/api/wizi/exclude-rules", json={"field": "title", "operator": "contains", "pattern": "abc"})
    assert r.status_code == 201
    rid = r.get_json()["rule"]["id"]
    ev = _events(action="exclude_rule.create")
    assert len(ev) == 1 and ev[0].entity_id == str(rid)
    assert json.loads(ev[0].details)["after"]["pattern"] == "abc"

    r = client.put(f"/api/wizi/exclude-rules/{rid}", json={"pattern": "abcd"})
    assert r.status_code == 200
    ev = _events(action="exclude_rule.update")
    assert len(ev) == 1
    d = json.loads(ev[0].details)
    assert d["before"]["pattern"] == "abc" and d["after"]["pattern"] == "abcd"

    r = client.put(f"/api/wizi/exclude-rules/{rid}", json={"active": False})
    assert r.status_code == 200
    ev = _events(action="exclude_rule.toggle")
    assert len(ev) == 1
    d = json.loads(ev[0].details)
    assert d["before"]["active"] is True and d["after"]["active"] is False
    assert len(_events(action="exclude_rule.update")) == 1

    client.put(f"/api/wizi/exclude-rules/{rid}", json={"active": False})  # no change -> no row
    assert len(_events(action="exclude_rule.toggle")) == 1

    assert client.delete(f"/api/wizi/exclude-rules/{rid}").status_code == 200
    assert len(_events(action="exclude_rule.delete")) == 1
    assert client.delete(f"/api/wizi/exclude-rules/{rid}").status_code == 404
    assert len(_events(action="exclude_rule.delete")) == 1


def test_user_role_change(client):
    _db.session.add_all([User(email="a@x.com", role="admin"), User(email="b@x.com", role="viewer")])
    _db.session.commit()
    uid = _db.session.query(User).filter_by(email="b@x.com").one().id
    _login(client, "a@x.com", "admin")
    assert client.patch(f"/api/users/{uid}", json={"role": "editor"}).status_code == 200
    ev = _events(action="user.role_change")
    assert len(ev) == 1
    assert (ev[0].actor, ev[0].actor_role, ev[0].entity_id) == ("a@x.com", "admin", str(uid))
    assert json.loads(ev[0].details) == {"email": "b@x.com", "before": "viewer", "after": "editor"}
    assert client.patch(f"/api/users/{uid}", json={"role": "bogus"}).status_code == 400
    assert client.patch(f"/api/users/{uid}", json={"role": "editor"}).status_code == 200  # no change
    assert len(_events(action="user.role_change")) == 1


def test_backup_and_restore_logged_and_audit_rows_survive(client):
    _mk_product()
    audit_service.record_event("seed.event", "x", "1")
    assert client.get("/api/admin/backup").status_code == 200
    assert len(_events(action="system.backup")) == 1
    zip_bytes = client.get("/api/admin/backup").data
    assert len(_events(action="system.backup")) == 2

    r = client.post("/api/admin/restore", data={"backup": (io.BytesIO(zip_bytes), "b.zip")},
                    content_type="multipart/form-data")
    assert r.status_code == 200
    assert len(_events(action="system.restore")) == 1
    assert len(_events(action="seed.event")) == 1          # audit table not overwritten
    assert len(_events(action="system.backup")) == 2


def test_failed_restore_not_logged(client):
    r = client.post("/api/admin/restore", data={"backup": (io.BytesIO(b"nope"), "b.zip")},
                    content_type="multipart/form-data")
    assert r.status_code == 400
    assert _events(action="system.restore") == []


# ---------------------------------------------------------------------------
# record_event is best-effort
# ---------------------------------------------------------------------------

def test_record_event_failure_leaves_action_successful(client, caplog):
    _mk_product(status="draft")
    with patch.object(audit_service, "sanitize_details", side_effect=RuntimeError("boom")):
        with caplog.at_level(logging.ERROR, logger="backend.services.audit_service"):
            r = client.post("/api/products/p1/versions/1.0/publish")
    assert r.status_code == 200
    assert _db.session.get(ReportSnapshot, 1).status == "published"
    assert _events() == []
    assert any("Audit event could not be recorded" in rec.getMessage() for rec in caplog.records)


def test_record_event_commit_failure_never_raises_and_session_recovers(client):
    _mk_product(status="draft")
    real_commit = _db.session.commit
    calls = {"n": 0}

    def flaky_commit():
        calls["n"] += 1
        if calls["n"] == 2:  # 1st = the publish itself, 2nd = the audit insert
            raise RuntimeError("db down")
        return real_commit()

    with patch.object(_db.session, "commit", side_effect=flaky_commit):
        r = client.post("/api/products/p1/versions/1.0/publish")
    assert r.status_code == 200
    assert _db.session.get(ReportSnapshot, 1).status == "published"
    assert audit_service.record_event("after", "x") is True


def test_audit_rows_cannot_be_updated_or_deleted_via_orm(client):
    audit_service.record_event("a", "x")
    row = _events()[0]
    row.action = "tampered"
    with pytest.raises(RuntimeError):
        _db.session.commit()
    _db.session.rollback()
    _db.session.delete(_db.session.get(AuditEvent, row.id))
    with pytest.raises(RuntimeError):
        _db.session.commit()
    _db.session.rollback()
    assert _db.session.get(AuditEvent, row.id).action == "a"


def test_details_sanitised(client):
    secret_tb = 'Traceback (most recent call last):\n  File "x.py", line 1, in <module>\nValueError: x'
    audit_service.record_event("a", "x", details={
        "ok": "fine", "password": "p", "API_KEY": "k", "nested": {"client_secret": "s", "keep": 1},
        "Authorization": "Bearer abc", "err": secret_tb, "long": "z" * 5000, "lst": list(range(100)),
    })
    d = json.loads(_events()[0].details)
    assert d["ok"] == "fine" and d["nested"] == {"keep": 1}
    for k in ("password", "API_KEY", "Authorization"):
        assert k not in d
    assert d["err"] == "[redacted]"
    assert len(d["long"]) <= 301
    assert len(d["lst"]) == 20
    blob = _events()[0].details
    assert "Traceback" not in blob and "abc" not in blob and ", " not in blob  # compact separators


def test_details_total_size_capped(client):
    audit_service.record_event("a", "x", details={f"k{i}": "v" * 250 for i in range(60)})
    assert len(_events()[0].details) <= 4100
    assert json.loads(_events()[0].details)["truncated"] is True


# ---------------------------------------------------------------------------
# List route
# ---------------------------------------------------------------------------

def _seed(n=5):
    base = datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc)
    for i in range(n):
        _db.session.add(AuditEvent(
            timestamp=base + timedelta(days=i), actor=f"u{i % 2}@x.com", actor_role="admin",
            action="version.publish" if i % 2 else "product.delete", entity_type="version" if i % 2 else "product",
            entity_id=str(i), product_id="pa" if i < 3 else "pb", details=json.dumps({"i": i})))
    _db.session.commit()


def test_list_shape_order_and_iso_z(client):
    _seed(3)
    body = client.get(URL).get_json()
    assert set(body) == {"items", "page", "page_size", "total"}
    assert body["total"] == 3 and body["page"] == 1
    assert [i["entity_id"] for i in body["items"]] == ["2", "1", "0"]  # newest first
    first = body["items"][0]
    assert set(first) == {"id", "timestamp", "actor", "action", "entity_type", "entity_id",
                          "product_id", "details", "source_ip", "user_agent"}
    assert first["timestamp"] == "2026-03-03T12:00:00Z"
    assert first["details"] == {"i": 2}


def test_list_filters(client):
    _seed(5)
    ids = lambda q: [i["entity_id"] for i in client.get(URL + q).get_json()["items"]]  # noqa: E731
    assert ids("?actor=u1@x.com") == ["3", "1"]
    assert ids("?action=product.delete") == ["4", "2", "0"]
    assert ids("?entity_type=version") == ["3", "1"]
    assert ids("?entity_id=2") == ["2"]
    assert ids("?product_id=pb") == ["4", "3"]
    assert ids("?date_from=2026-03-02&date_to=2026-03-03") == ["2", "1"]
    # date_to is inclusive of the whole day (event at 12:00)
    assert ids("?date_to=2026-03-01") == ["0"]
    assert ids("?date_from=2026-03-05") == ["4"]
    assert ids("?actor=u0@x.com&action=product.delete&product_id=pb") == ["4"]
    assert ids("?actor=nobody") == []
    assert client.get(URL + "?date_from=garbage").status_code == 400
    assert client.get(URL + "?date_to=2026-13-40").status_code == 400


def test_list_pagination_cap_and_out_of_range(client):
    _seed(5)
    b = client.get(URL + "?page_size=2&page=2").get_json()
    assert [i["entity_id"] for i in b["items"]] == ["2", "1"] and b["total"] == 5 and b["page_size"] == 2
    assert client.get(URL + "?page_size=100000").get_json()["page_size"] == audit_service.MAX_PAGE_SIZE
    assert client.get(URL + "?page_size=0").get_json()["page_size"] == 1
    assert client.get(URL + "?page_size=abc&page=abc").get_json()["page"] == 1
    assert client.get(URL + "?page=-4").get_json()["page"] == 1
    far = client.get(URL + "?page=999").get_json()
    assert far["items"] == [] and far["total"] == 5


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_no_mutating_verbs(client, method):
    audit_service.record_event("a", "x")
    assert getattr(client, method)(URL).status_code == 405
    assert getattr(client, method)(URL + "/1").status_code == 404
    assert _db.session.query(AuditEvent).count() == 1


@patch("backend.services.auth_service._OAUTH_ENABLED", True)
def test_list_requires_admin(client):
    assert client.get(URL).status_code == 401
    _db.session.add_all([User(email="v@x.com", role="viewer"), User(email="e@x.com", role="editor"),
                         User(email="a@x.com", role="admin")])
    _db.session.commit()
    _login(client, "v@x.com", "viewer")
    assert client.get(URL).status_code == 403
    _login(client, "e@x.com", "editor")
    assert client.get(URL).status_code == 403
    _login(client, "a@x.com", "admin")
    assert client.get(URL).status_code == 200


@patch("backend.services.auth_service._OAUTH_ENABLED", True)
def test_actor_recorded_from_session_in_oauth_mode(client):
    _db.session.add(User(email="a@x.com", role="admin"))
    _db.session.commit()
    _login(client, "a@x.com", "admin")
    client.post("/api/wizi/exclude-rules", json={"field": "title", "operator": "contains", "pattern": "zzz"})
    e = _events(action="exclude_rule.create")[0]
    assert (e.actor, e.actor_role) == ("a@x.com", "admin")


# ---------------------------------------------------------------------------
# Cycle-1 fixes: consumed marker, pipeline path, original title, product filter
# ---------------------------------------------------------------------------

def _post_mem(client, source="temp_excepted", title="Open Port", sub="Sub1", pid="p1"):
    body = {"subscription": sub, "title": title, "reason": "r", "source": source}
    assert client.post(f"/api/products/{pid}/memory/entry", json=body).status_code == 200


@pytest.mark.parametrize("marker", ["consumed", "stale_dropped"])
def test_delete_with_marker_logs_temporary_consumed_once(client, marker):
    _mk_product()
    _post_mem(client)
    url = f"/api/products/p1/memory/entry?reason={marker}"
    body = {"subscription": "Sub1", "title": "Open Port"}
    assert client.delete(url, json=body).status_code == 200
    ev = _events(action="exception.temporary_consumed")
    assert len(ev) == 1
    assert ev[0].product_id == "p1" and ev[0].entity_id == "Open Port"
    d = json.loads(ev[0].details)
    assert d["reason"] == marker and d["source"] == "temp_excepted"
    assert _events(action="exception.remove") == []
    # second DELETE finds nothing -> no double logging
    assert client.delete(url, json=body).status_code == 200
    assert len(_events(action="exception.temporary_consumed")) == 1


@pytest.mark.parametrize("marker", ["consumed", "stale_dropped"])
def test_marker_on_permanent_entry_is_ignored_and_logs_remove(client, marker):
    """A marker cannot disguise a real removal of a non-temp entry (anti-spoofing)."""
    _mk_product()
    _post_mem(client, source="excepted")
    client.delete(f"/api/products/p1/memory/entry?reason={marker}",
                  json={"subscription": "Sub1", "title": "Open Port"})
    assert _events(action="exception.temporary_consumed") == []
    assert len(_events(action="exception.remove")) == 1


@pytest.mark.parametrize("marker", [None, "consumed", "stale_dropped"])
def test_deleted_source_entry_removal_logs_nothing(client, marker):
    _mk_product()
    _post_mem(client, source="deleted")
    url = "/api/products/p1/memory/entry" + (f"?reason={marker}" if marker else "")
    client.delete(url, json={"subscription": "Sub1", "title": "Open Port"})
    assert _events(action="exception.temporary_consumed") == []
    assert _events(action="exception.remove") == []


def test_create_product_duplicate_name_returns_409(client):
    body = {"name": "Dup Prod", "owner": "o", "ownerEmail": "o@x.com", "env": "e",
            "subscriptionIds": ["sub-001"]}
    assert client.post("/api/products", json=body).status_code == 201
    r = client.post("/api/products", json=body)
    assert r.status_code == 409
    assert "error" in r.get_json() and "Traceback" not in r.get_data(as_text=True)
    assert _db.session.query(Product).count() == 1


def test_unknown_marker_rejected_and_entry_kept(client):
    _mk_product()
    _post_mem(client)
    r = client.delete("/api/products/p1/memory/entry?reason=bogus",
                      json={"subscription": "Sub1", "title": "Open Port"})
    assert r.status_code == 400
    from backend.models import ProductMemoryEntry
    assert _db.session.query(ProductMemoryEntry).count() == 1
    assert _events(action="exception.temporary_consumed") == []
    assert _events(action="exception.remove") == []


def test_exception_remove_records_original_title_and_subscription(client):
    _mk_product()
    _post_mem(client, source="excepted", title="Open Port MIXED", sub="Sub1")
    r = client.delete("/api/products/p1/memory/entry",
                      json={"subscription": "Sub1", "title": "Open Port MIXED"})
    assert r.status_code == 200
    ev = _events(action="exception.remove")
    assert len(ev) == 1 and ev[0].entity_id == "Open Port MIXED"
    d = json.loads(ev[0].details)
    assert d["title"] == "Open Port MIXED" and d["subscription"] == "Sub1"


def test_exception_remove_falls_back_to_stored_values(client):
    _mk_product()
    _post_mem(client, source="excepted", title="Open Port", sub="Sub1")
    client.delete("/api/products/p1/memory/entry", json={"subscription": "sub1", "title": "open port"})
    ev = _events(action="exception.remove")
    assert len(ev) == 1 and ev[0].entity_id == "open port"


def test_pipeline_consumption_logs_once_with_system_actor(app):
    from backend.models import ProductMemoryEntry
    from backend.routes.pipeline import _audit_consumed_temp, _store_findings_with_memory
    _mk_product(status="draft")
    snap_id = _db.session.query(ReportSnapshot).one().id
    _db.session.add(ProductMemoryEntry(product_id="p1", subscription="sub1", title="open port",
                                       reason="r", source="temp_excepted"))
    _db.session.commit()
    raw = {
        "queryType": "configurationFindings", "id": "i-1", "severity": "HIGH",
        "rule": {"name": "Open Port", "id": "rule-1"},
        "resource": {"name": "res", "subscription": {"name": "Sub1"}},
        "_sourceSubscription": "Sub1", "_subscriptions": ["Sub1"],
    }
    consumed: list = []
    _store_findings_with_memory(snap_id, "p1", [raw], scope_subs=["Sub1"], consumed_out=consumed)
    _db.session.commit()
    assert len(consumed) == 1
    assert _db.session.query(ProductMemoryEntry).count() == 0
    _audit_consumed_temp("p1", consumed)
    ev = _events(action="exception.temporary_consumed")
    assert len(ev) == 1
    assert (ev[0].actor, ev[0].actor_role, ev[0].product_id) == ("system", "system", "p1")
    assert ev[0].entity_id == "Open Port"  # original title, not the lowercased stored one
    assert json.loads(ev[0].details)["reason"] == "consumed"
    # a second scan finds no temp entry -> nothing more to log
    again: list = []
    _store_findings_with_memory(snap_id, "p1", [raw], scope_subs=["Sub1"], consumed_out=again)
    assert again == []


def test_audit_log_api_product_id_filter(client):
    _mk_product("p1")
    _mk_product("p2")
    audit_service.record_event("version.publish", "version", "1.0", product_id="p1")
    audit_service.record_event("version.publish", "version", "2.0", product_id="p2")
    _login(client, "adm@x.com", "admin")
    r = client.get(URL + "?product_id=p2")
    assert r.status_code == 200
    items = r.get_json()["items"]
    assert [i["entity_id"] for i in items] == ["2.0"] and r.get_json()["total"] == 1
    assert client.get(URL).get_json()["total"] == 2


# ---------------------------------------------------------------------------
# BL-16 extension: source IP + User-Agent
# ---------------------------------------------------------------------------

_MIG2 = ROOT / "migrations" / "versions" / "e17b2d5f9a63_audit_events_source_ip_user_agent.py"


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _record(app, headers=None, addr="10.0.0.5"):
    with app.test_request_context("/", headers=headers or {}, environ_base={"REMOTE_ADDR": addr}):
        assert audit_service.record_event("system.test", "system")
    return _db.session.execute(_db.select(AuditEvent).order_by(AuditEvent.id.desc())).scalars().first()


def test_capture_ip_and_user_agent_untrusted_ignores_xff(app, monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXY", raising=False)
    e = _record(app, {"X-Forwarded-For": "6.6.6.6", "User-Agent": "UnitTest/1.0"})
    assert e.source_ip == "10.0.0.5"
    assert e.user_agent == "UnitTest/1.0"


def test_capture_ip_trusted_uses_first_xff(app, monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY", "1")
    e = _record(app, {"X-Forwarded-For": "1.2.3.4, 10.1.1.1"})
    assert e.source_ip == "1.2.3.4"
    e = _record(app)  # trusted but no XFF header -> remote_addr
    assert e.source_ip == "10.0.0.5"


def test_capture_truncates_and_strips_control_chars(app, monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY", "1")
    e = _record(app, {"X-Forwarded-For": "9" * 200, "User-Agent": "a" * 500})
    assert e.source_ip == "10.0.0.5"  # oversized/invalid XFF -> remote_addr
    assert len(e.user_agent) == 300
    e = _record(app, {"User-Agent": "Mozilla\x01/5.0\x7f<script>"})
    assert e.user_agent == "Mozilla/5.0<script>"  # stored as inert text, controls removed


def test_trusted_xff_garbage_falls_back_to_remote_addr_or_null(app, monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY", "1")
    e = _record(app, {"X-Forwarded-For": "<script>x</script>"})
    assert e.source_ip == "10.0.0.5"
    e = _record(app, {"X-Forwarded-For": "<script>x</script>"}, addr="not-an-ip")
    assert e.source_ip is None


def test_valid_ipv4_ipv6_pass_through(app, monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY", "1")
    assert _record(app, {"X-Forwarded-For": " 203.0.113.9 "}).source_ip == "203.0.113.9"
    assert _record(app, {"X-Forwarded-For": "2001:db8::1"}).source_ip == "2001:db8::1"
    assert _record(app, {"X-Forwarded-For": "[2001:db8::2]"}).source_ip == "2001:db8::2"
    assert _record(app, {"X-Forwarded-For": "fe80::1%eth0"}).source_ip == "fe80::1"


def test_user_agent_bidi_chars_stripped(app):
    ua = "Mozilla‮/5.0⁦x⁩‎‏؜‪‬"
    assert _record(app, {"User-Agent": ua}).user_agent == "Mozilla/5.0x"


def test_no_request_context_gives_null(app):
    assert audit_service.record_event("system.test", "system")
    e = _db.session.execute(_db.select(AuditEvent)).scalars().first()
    assert e.source_ip is None and e.user_agent is None


def test_capture_failure_does_not_break_record(app):
    with app.test_request_context("/"):
        with patch("backend.services.client_ip.get_client_ip", side_effect=RuntimeError("boom")):
            assert audit_service.record_event("system.test", "system") is True
    e = _db.session.execute(_db.select(AuditEvent)).scalars().first()
    assert e.source_ip is None


def test_api_returns_fields_and_filters_by_source_ip(app, client, monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXY", raising=False)
    _record(app, {"User-Agent": "A"}, addr="10.0.0.5")
    _record(app, {"User-Agent": "B"}, addr="10.0.0.6")
    _login(client, "ad@x.com", "admin")
    items = client.get(URL).get_json()["items"]
    assert all({"source_ip", "user_agent"} <= set(i) for i in items)
    r = client.get(URL + "?source_ip=10.0.0.6").get_json()
    assert r["total"] == 1 and r["items"][0]["user_agent"] == "B"
    assert client.get(URL + "?source_ip=10.0.0").get_json()["total"] == 0  # exact match only


def test_ip_migration_up_down_idempotent(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'mig2.db'}")
    base = _load_migration()
    mig = _load(_MIG2, "bl16_ext_migration")
    assert mig.down_revision == "d16a1c4e8b52"
    _run(engine, mig.upgrade)  # no table yet -> no-op
    _run(engine, base.upgrade)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO audit_events (timestamp, actor, actor_role, action, entity_type) "
                          "VALUES ('2026-01-01', 'a', 'admin', 'x', 'y')"))
    _run(engine, mig.upgrade)
    _run(engine, mig.upgrade)  # idempotent
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("audit_events")}
    assert {"source_ip", "user_agent"} <= cols
    _run(engine, mig.downgrade)
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("audit_events")}
    assert not ({"source_ip", "user_agent"} & cols)
    assert "ix_audit_events_actor" in {i["name"] for i in insp.get_indexes("audit_events")}
    with engine.begin() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM audit_events")).scalar() == 1
    _run(engine, mig.downgrade)  # idempotent
    engine.dispose()
