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
