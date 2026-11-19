"""BL-31: Product Memory for pipeline-scanned findings.

Pipeline-stored findings carry their source subscription(s) so the editor can save
exceptions / deletes / temporary exceptions to Product Memory (one entry per
contributing subscription) and the next scan matches on any of them.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from backend.database import db
from backend.models import ProductMemoryEntry
from backend.routes.pipeline import _aggregate_vulns, _transform_finding
from tests.test_bl24_carry_forward import (  # noqa: F401  (app fixture comes from conftest)
    OTHER, SUB, _cfg, _mem, _product, _store, _vuln,
)

JS = Path(__file__).resolve().parent.parent / "static" / "js" / "src"
needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def test_single_subscription_finding_is_stamped():
    f = _transform_finding(_cfg("T", "R-1"), {})
    assert f["_sourceSubscription"] == SUB
    assert "_sourceSubscriptions" not in f
    assert "_subscriptions" not in f


def test_merged_finding_lists_every_subscription_owner_unchanged():
    f = _transform_finding(_cfg("T", "R-1", subs=[SUB, OTHER]), {})
    assert f["_sourceSubscription"] == SUB
    assert f["_sourceSubscriptions"] == [SUB, OTHER]
    assert f["owner"] == f"{SUB}, {OTHER}"


def test_vuln_aggregate_lists_subscriptions_and_keeps_joined_key():
    agg = _aggregate_vulns([_vuln("CVE-1", "sub-a"), _vuln("CVE-2", "sub-b")])
    assert agg["_sourceSubscription"] == "sub-a, sub-b"
    assert agg["_sourceSubscriptions"] == ["sub-a", "sub-b"]
    assert "_sourceSubscriptions" not in _aggregate_vulns([_vuln("CVE-1", "sub-a")])


def test_stored_findings_persist_subscription_fields(app):
    _product()
    rows, _, _, _ = _store([_cfg("Single", "R-1"), _cfg("Merged", "R-2", subs=[SUB, OTHER])],
                           scope=[SUB, OTHER])
    by = {r["title"]: r for r in rows}
    assert by["Single"]["_sourceSubscription"] == SUB and "_sourceSubscriptions" not in by["Single"]
    assert by["Merged"]["_sourceSubscriptions"] == [SUB, OTHER]


@pytest.mark.parametrize("entry_sub", [SUB, OTHER])
def test_carry_forward_matches_merged_finding_on_any_subscription(app, entry_sub):
    _product()
    _mem("Shared", "excepted", sub=entry_sub, reason="why")
    rows, _, risk, _ = _store([_cfg("Shared", "R-1", subs=[SUB, OTHER])], scope=[SUB, OTHER])
    assert rows[0]["exception"] == {"active": True, "reason": "why"}
    assert risk == 0


def test_one_entry_per_subscription_round_trip(app):
    """Entries written the way the editor does (one per subscription) carry a merged finding forward."""
    _product()
    for s in (SUB, OTHER):
        _mem("Shared", "excepted", rule_key="configurationfindings|r-1", sub=s, reason="r")
    rows, unmatched, _, _ = _store([_cfg("Shared", "R-1", subs=[SUB, OTHER])], scope=[SUB, OTHER])
    assert rows[0]["exception"]["active"] is True
    assert unmatched == []
    assert ProductMemoryEntry.query.count() == 2


def _node(module: str, expr: str, data: dict):
    script = (
        f"import * as m from {json.dumps((JS / module).as_uri())};"
        f"const d = {json.dumps(data)};"
        f"console.log(JSON.stringify({expr}));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


@needs_node
@pytest.mark.parametrize("finding,save,remove", [
    ({"_sourceSubscription": "a"}, ["a"], ["a"]),
    ({"_sourceSubscription": "a", "_sourceSubscriptions": ["a", "b"]}, ["a", "b"], ["a", "b"]),
    ({"_sourceSubscription": "a, b", "_sourceSubscriptions": ["a", "b", "a"]}, ["a", "b"], ["a", "b", "a, b"]),
    ({"_sourceSubscriptions": ["a", "", 3]}, ["a"], ["a"]),
    ({"title": "no source"}, [], []),
])
def test_memory_subscription_fan_out(finding, save, remove):
    res = _node("memory-match.js",
                "{s: m.memorySubscriptionsForSave(d.f), r: m.memorySubscriptionsForRemove(d.f)}", {"f": finding})
    assert res == {"s": save, "r": remove}


@needs_node
def test_export_sanitize_strips_subscription_list_without_mutating():
    f = [{"title": "A", "_sourceSubscription": "a", "_sourceSubscriptions": ["a", "b"]}]
    res = _node("export-sanitize.js", "{out: m.stripInternalExportFields(d.f), orig: d.f}", {"f": f})
    assert "_sourceSubscription" not in res["out"][0] and "_sourceSubscriptions" not in res["out"][0]
    assert res["orig"] == f


# ---------------------------------------------------------------------------
# QA follow-up: shrinking merged findings, sibling cleanup, collapsed unmatched rows
# ---------------------------------------------------------------------------

RK = "configurationfindings|r-1"


def test_shrunk_merged_finding_leftover_entry_is_not_unmatched(app):
    """Scan 1 saved sub-a + sub-b; scan 2 returns the finding for sub-b only -> not stale."""
    _product()
    for s in (SUB, OTHER):
        _mem("Merged AB", "excepted", rule_key=RK, sub=s, reason="r")
    rows, unmatched, risk, _ = _store([_cfg("Merged AB", "R-1", sub=OTHER)], scope=[SUB, OTHER])
    assert rows[0]["exception"]["active"] is True and risk == 0
    assert unmatched == []


def test_title_only_sibling_of_matched_entry_is_not_unmatched(app):
    _product()
    for s in (SUB, OTHER):
        _mem("Legacy", "excepted", sub=s)
    _, unmatched, _, _ = _store([_cfg("Legacy", None, sub=OTHER)], scope=[SUB, OTHER])
    assert unmatched == []


def test_vanished_merged_finding_is_one_unmatched_row(app):
    _product()
    for s in (SUB, OTHER):
        _mem("Gone", "excepted", rule_key="configurationfindings|gone", sub=s)
    _, unmatched, _, _ = _store([], scope=[SUB, OTHER])
    assert len(unmatched) == 1
    assert unmatched[0]["subscriptions"] == [SUB, OTHER]
    assert unmatched[0]["title"] == "gone"


def test_unmatched_rows_of_different_findings_or_sources_stay_separate(app):
    _product()
    _mem("One", "excepted", rule_key="configurationfindings|one")
    _mem("Two", "excepted", rule_key="configurationfindings|two")
    _mem("One", "deleted", rule_key="configurationfindings|one", sub=OTHER)
    _, unmatched, _, _ = _store([], scope=[SUB, OTHER])
    assert len(unmatched) == 3
    assert all("subscriptions" not in u for u in unmatched)


def _delete(client, body):
    return client.delete("/api/products/p1/memory/entry", json=body)


def _seed(client, entries):
    with client.application.app_context():
        _product()
        for title, source, rk, sub in entries:
            _mem(title, source, rule_key=rk, sub=sub)


def _left(client):
    with client.application.app_context():
        return {(e.subscription, e.source, e.title) for e in ProductMemoryEntry.query.all()}


def test_delete_with_clear_siblings_removes_fan_out_entries(client):
    _seed(client, [
        ("Merged AB", "excepted", RK, SUB), ("Merged AB", "excepted", RK, OTHER),
        ("Other", "excepted", "configurationfindings|zzz", SUB),
        ("Merged AB", "deleted", RK, "third-sub"),
    ])
    r = _delete(client, {"subscription": OTHER, "title": "Merged AB", "rule_key": RK,
                         "clear_siblings": True})
    assert r.status_code == 200
    assert _left(client) == {(SUB, "excepted", "other"), ("third-sub", "deleted", "merged ab")}


def test_delete_without_flag_leaves_sibling_subscriptions(client):
    """Browser-import path: different subscriptions are different findings."""
    _seed(client, [("Merged AB", "excepted", RK, SUB), ("Merged AB", "excepted", RK, OTHER)])
    _delete(client, {"subscription": OTHER, "title": "Merged AB", "rule_key": RK})
    assert _left(client) == {(SUB, "excepted", "merged ab")}


def test_clear_siblings_requires_strict_boolean(client):
    _seed(client, [("Merged AB", "excepted", RK, SUB), ("Merged AB", "excepted", RK, OTHER)])
    _delete(client, {"subscription": OTHER, "title": "Merged AB", "rule_key": RK,
                     "clear_siblings": "true"})
    assert _left(client) == {(SUB, "excepted", "merged ab")}


def test_clear_siblings_title_fallback_without_rule_key(client):
    _seed(client, [("Vuln", "excepted", None, SUB), ("Vuln", "excepted", None, OTHER)])
    _delete(client, {"subscription": SUB, "title": "Vuln", "clear_siblings": True})
    assert _left(client) == set()


def test_clear_siblings_is_inert_when_exact_entry_missing(client):
    _seed(client, [("Keep", "excepted", RK, SUB)])
    _delete(client, {"subscription": OTHER, "title": "Keep", "rule_key": RK, "clear_siblings": True})
    assert _left(client) == {(SUB, "excepted", "keep")}


def test_pipeline_findings_carry_marker():
    assert _transform_finding(_cfg("T", "R-1"), {})["_pipelineScan"] is True
    assert _aggregate_vulns([_vuln("CVE-1", "sub-a")])["_pipelineScan"] is True


# ---------------------------------------------------------------------------
# QA cycle 2: rename-safe collapsed rows, accurate partial drop, non-destructive temp rollback
# ---------------------------------------------------------------------------

def test_collapsed_row_carries_per_subscription_titles(app):
    """One rule saved under two titles (renamed between saves): the row lists each exact pair."""
    _product()
    _mem("Old Title", "excepted", rule_key="configurationfindings|gone", sub=SUB)
    _mem("New Title", "excepted", rule_key="configurationfindings|gone", sub=OTHER)
    _, unmatched, _, _ = _store([], scope=[SUB, OTHER])
    assert len(unmatched) == 1
    assert unmatched[0]["title"] == "old title"  # existing fields kept
    assert unmatched[0]["subscriptions"] == [SUB, OTHER]
    assert unmatched[0]["entries"] == [{"subscription": SUB, "title": "old title"},
                                       {"subscription": OTHER, "title": "new title"}]


def _node_script(body: str) -> dict:
    script = f"""
    import * as m from {json.dumps((JS / 'memory-match.js').as_uri())};
    import {{ state }} from {json.dumps((JS / 'state.js').as_uri())};
    globalThis.CustomEvent = class {{ constructor(t, o) {{ this.type = t; this.detail = o.detail; }} }};
    globalThis.document = {{ dispatchEvent: () => {{}} }};
    const calls = [];
    {body}
    """
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


@needs_node
def test_js_drop_deletes_each_subscription_title_pair():
    res = _node_script("""
    globalThis.fetch = async (u, o) => { calls.push(JSON.parse(o.body)); return { ok: true }; };
    const row = { subscription: 'a, b', title: 'old', ruleKey: 'issues|r', subscriptions: ['a', 'b'],
                  entries: [{subscription: 'a', title: 'old'}, {subscription: 'b', title: 'new'}] };
    m.publishUnmatchedMemory([row], {});
    await m.dropMemoryEntry('p', row);
    console.log(JSON.stringify({ calls, left: state.unmatchedMemory.entries }));
    """)
    assert [(c["subscription"], c["title"]) for c in res["calls"]] == [("a", "old"), ("b", "new")]
    assert res["left"] == []


@needs_node
def test_js_drop_partial_failure_reports_and_shrinks_row():
    res = _node_script("""
    globalThis.fetch = async (u, o) => ({ ok: JSON.parse(o.body).subscription !== 'b', status: 500 });
    const row = { subscription: 'a, b', title: 'old', ruleKey: null, subscriptions: ['a', 'b'],
                  entries: [{subscription: 'a', title: 'old'}, {subscription: 'b', title: 'new'}] };
    m.publishUnmatchedMemory([row], {});
    let err = null;
    try { await m.dropMemoryEntry('p', row); } catch (x) { err = { msg: x.message, failed: x.failed, total: x.total }; }
    console.log(JSON.stringify({ err, left: state.unmatchedMemory.entries }));
    """)
    assert res["err"] == {"msg": "HTTP 500", "failed": 1, "total": 2}
    assert len(res["left"]) == 1
    assert res["left"][0]["entries"] == [{"subscription": "b", "title": "new"}]
    assert res["left"][0]["subscription"] == "b"


@needs_node
def test_js_temp_rollback_restores_preexisting_and_deletes_new():
    """sub-a had a permanent excepted entry, sub-b had none: rollback restores a, deletes b."""
    res = _node_script("""
    const mem = { entries: { 'sub-a::t': { subscription: 'sub-a', title: 't', source: 'excepted', reason: 'why', rule_key: 'issues|r' } } };
    globalThis.fetch = async (u, o) => {
      if (!o) return { ok: true, json: async () => mem };
      calls.push({ method: o.method, body: JSON.parse(o.body) });
      return { ok: true };
    };
    const snap = await m.snapshotMemoryEntries('p', ['sub-a', 'sub-b'], 'T');
    await m.rollbackMemoryWrites('p', 'T', ['sub-a', 'sub-b'], snap);
    console.log(JSON.stringify({ snap, calls }));
    """)
    assert res["snap"] == {"sub-a": {"source": "excepted", "reason": "why", "ruleKey": "issues|r"}}
    assert res["calls"][0] == {"method": "POST", "body": {
        "subscription": "sub-a", "title": "T", "reason": "why", "source": "excepted", "rule_key": "issues|r"}}
    assert res["calls"][1] == {"method": "DELETE", "body": {"subscription": "sub-b", "title": "T"}}
