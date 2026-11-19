"""BL-37: ExcludeRules applied server-side in pipeline scans.

Covers the shared matcher (backend/services/exclude_matching.py), parity with the browser's
isExcludedByRules (run through Node on the same vectors), safe degradation for invalid rules,
and an end-to-end scan with a mocked Wiz service.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.database import db
from backend.models import ExcludeRule, Finding, ReportSnapshot
from backend.routes import pipeline as pl
from backend.services.exclude_matching import (
    ExcludeMatcher, item_category, item_paths, item_resource, item_title, load_active_matcher,
)
from tests.test_bl24_carry_forward import SUB, _cfg, _product, _snap

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "static" / "js" / "src"
needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def R(field, operator, pattern, active=True, rid=1):
    return {"id": rid, "field": field, "operator": operator, "pattern": pattern, "active": active}


def pair(first, second, key):
    return json.dumps({"title": first, key: second})


# (rule, title, category, paths, resource, expected) -- shared by the Python and Node runs
VECTORS = [
    (R("title", "startsWith", "[GovIL]"), "[govil] Bucket public", "CSPM", [], None, True),
    (R("title", "startsWith", "[GovIL]"), "x [govil]", "CSPM", [], None, False),
    (R("title", "contains", "[govil]"), "Prefix [GOVIL] suffix", "CSPM", [], None, True),
    (R("title", "contains", "dynatrace"), "Dynatrace agent", "CSPM", [], None, True),
    (R("title", "contains", "dynatrace"), "other", "CSPM", [], None, False),
    (R("title", "regex", r"^s3 .*public$"), "S3 Bucket Public", "CSPM", [], None, True),
    (R("title", "regex", r"^s3 .*public$"), "S3 Bucket Public x", "CSPM", [], None, False),
    (R("title", "regex", r"\bkey\d+\b"), "Rotate KEY12 now", "CSPM", [], None, True),
    (R("category", "startsWith", "vu"), "t", "VULN", [], None, True),
    (R("category", "contains", "SPM"), "t", "HSPM", [], None, True),
    (R("category", "regex", "^(cspm|kspm)$"), "t", "KSPM", [], None, True),
    (R("category", "regex", "^(cspm|kspm)$"), "t", "VULN", [], None, False),
    (R("path", "contains", "/tmp/"), "t", "SECR", ["/opt/a", "/TMP/x"], None, True),
    (R("path", "startsWith", "/tmp"), "t", "SECR", ["/opt/tmp"], None, False),
    (R("path", "contains", "/tmp/"), "t", "SECR", [], None, False),
    (R("title_resource", "contains", pair("bucket", "prod", "resource")), "Public Bucket", "CSPM", [], "my-PROD-1", True),
    (R("title_resource", "contains", pair("bucket", "prod", "resource")), "Public Bucket", "CSPM", [], "dev", False),
    (R("title_resource", "contains", pair("bucket", "prod", "resource")), "Public Bucket", "CSPM", [], None, False),
    (R("title_resource", "contains", pair("bucket", "prod", "resource")), "Other", "CSPM", [], "prod", False),
    (R("title_resource", "regex", pair("^pub", "-\\d+$", "resource")), "Public x", "CSPM", [], "vm-12", True),
    (R("title_path", "contains", pair("private key", ".pem", "path")), "Private Key found", "SECR", ["/a/b.PEM"], None, True),
    (R("title_path", "contains", pair("private key", ".pem", "path")), "Private Key found", "SECR", ["/a/b.txt"], None, False),
    (R("title_path", "contains", pair("private key", ".pem", "path")), "Private Key found", "SECR", [], None, False),
    (R("title_path", "contains", pair("private key", ".pem", "path")), "Other", "SECR", ["/a/b.pem"], None, False),
    (R("title", "contains", "x", active=False), "x", "CSPM", [], None, False),
    (R("title", "contains", "x"), "", "CSPM", [], None, False),
]


@pytest.mark.parametrize("rule,title,cat,paths,resource,expected", VECTORS)
def test_matcher_vectors(rule, title, cat, paths, resource, expected):
    assert ExcludeMatcher([rule]).matches_values(title, cat, paths, resource) is expected


@needs_node
def test_parity_with_browser_is_excluded_by_rules(tmp_path):
    """The JS isExcludedByRules and the Python matcher agree on every vector."""
    src = (JS / "exclude_rules.js").read_text(encoding="utf-8")
    body = "\n".join(l for l in src.splitlines() if not l.startswith("import "))
    mod = tmp_path / "exclude_rules_pure.mjs"
    mod.write_text(body + "\nexport function __setRules(r) { _rules = r; }\n", encoding="utf-8")
    payload = [
        {"rule": r, "title": t, "cat": c, "paths": p, "res": res} for r, t, c, p, res, _ in VECTORS
    ]
    script = (
        f"import * as m from {json.dumps(mod.as_uri())};"
        f"const d = {json.dumps(payload)};"
        "console.log(JSON.stringify(d.map(v => { m.__setRules([v.rule]);"
        " return m.isExcludedByRules(v.title, v.cat, v.paths, v.res); })));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    js_results = json.loads(out.stdout)
    py_results = [ExcludeMatcher([r]).matches_values(t, c, p, res) for r, t, c, p, res, _ in VECTORS]
    assert js_results == py_results == [v[-1] for v in VECTORS]


def test_no_rules_excludes_nothing():
    m = ExcludeMatcher([])
    assert len(m) == 0 and m.is_excluded(_cfg("anything")) is False


def test_any_rule_matches_and_inactive_ignored():
    m = ExcludeMatcher([R("title", "contains", "zzz", rid=1), R("title", "contains", "bad", rid=2),
                        R("title", "contains", "good", active=False, rid=3)])
    assert m.is_excluded(_cfg("a bad one"))
    assert not m.is_excluded(_cfg("a good one"))
    assert len(m) == 2


@pytest.mark.parametrize("bad", [
    R("title", "regex", "([unclosed"),
    R("title", "bogus", "x"),
    R("bogusfield", "contains", "x"),
    R("title", "contains", ""),
    R("title", "contains", "x" * 501),
    R("title_path", "contains", "not json"),
    R("title_path", "contains", json.dumps({"title": "a"})),
    R("title_resource", "contains", json.dumps({"title": "a", "resource": ""})),
    R("title", "contains", None),
    R("title", "regex", "(?<name>x)"),   # valid JS, invalid Python: skipped, not fatal
])
def test_invalid_rules_are_skipped_and_others_still_apply(bad, caplog):
    bad = dict(bad, id=77, pattern=bad["pattern"])
    with caplog.at_level(logging.WARNING):
        m = ExcludeMatcher([bad, R("title", "contains", "drop me", rid=5)])
    assert m.skipped_ids == [77]
    assert len(m) == 1
    assert m.is_excluded(_cfg("please DROP me"))
    assert "77" in caplog.text
    assert "unclosed" not in caplog.text and "not json" not in caplog.text


def test_log_has_ids_only(caplog):
    with caplog.at_level(logging.WARNING):
        ExcludeMatcher([R("title", "regex", "([secret-pattern", rid=9)])
    assert "ids=[9]" in caplog.text and "secret-pattern" not in caplog.text


@pytest.mark.parametrize("evil", [r"(a+)+$", r"(.*)*x", r"(\w+\s?)*$", r"(a{1,})+b"])
def test_catastrophic_regex_is_skipped_not_run(evil):
    m = ExcludeMatcher([R("title", "regex", evil, rid=3)])
    assert m.skipped_ids == [3] and len(m) == 0
    assert m.matches_values("a" * 40 + "b", "CSPM") is False


def test_ordinary_grouped_regex_still_works():
    m = ExcludeMatcher([R("title", "regex", r"^(cve|ghsa)-\d+(\.\d+)?$")])
    assert len(m) == 1 and m.matches_values("CVE-2024", "VULN") and m.matches_values("ghsa-1.2", "VULN")


# ── raw-node helpers ─────────────────────────────────────────────────────────

def test_item_helpers_match_wizi_js_semantics():
    cfg = _cfg("Rule T")
    assert (item_title(cfg, "configurationFindings"), item_category(cfg, "configurationFindings"),
            item_resource(cfg, "configurationFindings")) == ("Rule T", "CSPM", "res")
    assert item_title({"name": "N"}, "configurationFindings") == "N"
    issue = {"sourceRules": [{"name": "Iss"}], "entitySnapshot": {"type": "KUBERNETES_CLUSTER", "name": "c1"}}
    assert (item_title(issue, "issues"), item_category(issue, "issues"), item_resource(issue, "issues")) == ("Iss", "KSPM", "c1")
    assert item_title({"description": "D"}, "issues") == "D"
    assert item_title({"id": "e1", "exposedEntity": {"name": "vm"}}, "networkExposures") == "Network Exposure — vm"
    assert item_title({"id": "e1"}, "networkExposures") == "Network Exposure — e1"
    eol = {"technology": {"name": "Py", "version": "2.7"}, "vulnerableAsset": {"name": "h1"}}
    assert item_title(eol, "endOfLifeFindings") == "Py 2.7 — h1"
    assert item_title({"packageName": "lib", "packageVersion": "1", "resource": {"name": "r"}},
                      "softwareSupplyChainFindings") == "lib 1 — r"
    assert item_category({}, "malwareFindings") == "HSPM" and item_category({}, "nope") == "CSPM"
    assert item_category({}, "vulnerabilityFindings") == "VULN"
    vuln = {"detailedName": "pkg on host-9"}
    assert item_resource(vuln, "vulnerabilityFindings") == "host-9"
    assert item_resource({"projects": [{"name": "P1"}]}, "vulnerabilityFindings") == "P1"
    assert item_resource({}, "malwareFindings") is None
    assert item_paths({"path": "/a", "filePath": "/b", "fileDetails": {"path": "/c"}}) == ["/a", "/b", "/c"]
    assert item_paths({"path": 5, "fileDetails": None}) == []


def test_pipeline_category_is_the_shared_mapping():
    assert pl._map_category_from_entity({"type": "DATABASE"}) == "DSPM"
    for qt, cat in (("configurationFindings", "CSPM"), ("vulnerabilityFindings", "VULN"),
                    ("hostConfigurationRuleAssessments", "HSPM"), ("dataFindingsV2", "DSPM"),
                    ("secretInstances", "SECR"), ("excessiveAccessFindings", "EAPM"),
                    ("networkExposures", "NEXP"), ("inventoryFindings", "EOLM"),
                    ("malwareFindings", "HSPM")):
        node = {"queryType": qt, "id": "x", "severity": "HIGH"}
        assert item_category(node, qt) == pl._transform_finding(node, {})["category"] == cat


# ── DB loading ───────────────────────────────────────────────────────────────

def test_load_active_matcher_reads_only_active_rows(app):
    db.session.add_all([
        ExcludeRule(field="title", operator="contains", pattern="alpha", active=True),
        ExcludeRule(field="title", operator="contains", pattern="beta", active=False),
        ExcludeRule(field="title", operator="regex", pattern="([bad", active=True),
    ])
    db.session.commit()
    m = load_active_matcher()
    assert len(m) == 1 and m.is_excluded(_cfg("ALPHA x")) and not m.is_excluded(_cfg("beta"))


# ── end-to-end scan with mocked Wiz ──────────────────────────────────────────

class _FakeWiz:
    nodes_by_type: dict = {}

    def __init__(self, **kw):
        pass

    def _get_token(self):
        return "t"

    def resolve_subscription(self, name):
        return {"ids": ["id1"], "externalIds": [], "names": [name]}

    def fetch_all_findings_paginated(self, qtype, filter_by):
        return [dict(n) for n in self.nodes_by_type.get(qtype, [])]


def _vuln(name, asset):
    return {"id": f"v-{name}", "name": name, "severity": "HIGH", "vulnerableAsset": {"name": asset}}


def _scan(app, nodes_by_type, monkeypatch):
    monkeypatch.setenv("WIZI_CLIENT_ID", "x")
    monkeypatch.setenv("WIZI_CLIENT_SECRET", "y")
    _FakeWiz.nodes_by_type = nodes_by_type
    _product()
    sid = _snap()
    pl._scan_jobs[sid] = {"status": "fetching", "excluded_by_rules": 0}
    with patch.object(pl, "WizService", _FakeWiz), \
            patch.object(pl, "QUERY_TYPE_MAP", {k: None for k in nodes_by_type}), \
            patch.object(pl, "build_bulk_filter", lambda *a, **k: {}):
        pl._run_wiz_fetch(app, sid, [SUB])
    snap = db.session.get(ReportSnapshot, sid)
    rows = [f.finding_data for f in Finding.query.filter_by(snapshot_id=sid).all()]
    return snap, rows


def _rule(field, operator, pattern, active=True):
    db.session.add(ExcludeRule(field=field, operator=operator, pattern=pattern, active=active))
    db.session.commit()


def test_scan_drops_excluded_nodes_and_counts_them(app, monkeypatch):
    _rule("title", "contains", "[govil]")
    _rule("title_resource", "contains", pair("bucket", "prod", "resource"))
    _rule("title", "regex", "([bad")          # invalid: must not fail the scan
    cfg = [
        {**_cfg("[GovIL] Something", "r1")},
        {**_cfg("Public Bucket", "r2"), "resource": {"name": "prod-1"}},
        {**_cfg("Keep me", "r3")},
    ]
    snap, rows = _scan(app, {"configurationFindings": cfg}, monkeypatch)
    assert [r["title"] for r in rows] == ["Keep me"]
    assert snap.snapshot_data["_scan_status"] == "done"
    assert snap.snapshot_data["_excluded_by_rules"] == 2
    assert snap.snapshot_data["findings_count"] == 1
    assert pl._scan_jobs.pop(snap.id)["excluded_by_rules"] == 2


def test_scan_without_rules_is_unchanged(app, monkeypatch):
    snap, rows = _scan(app, {"configurationFindings": [_cfg("A", "r1"), _cfg("B", "r2")]}, monkeypatch)
    assert len(rows) == 2 and snap.snapshot_data["_excluded_by_rules"] == 0


def test_excluded_nodes_are_removed_before_vuln_aggregation(app, monkeypatch):
    _rule("title_resource", "startsWith", pair("cve-", "ignored", "resource"))
    vulns = [_vuln("CVE-1", "ignored-host"), _vuln("CVE-2", "real-host"), _vuln("CVE-3", "other-host")]
    snap, rows = _scan(app, {"vulnerabilityFindings": vulns}, monkeypatch)
    assert len(rows) == 1
    assert "Total Vulnerabilities: 2" in rows[0]["technical"]
    assert snap.snapshot_data["_excluded_by_rules"] == 1


def test_all_nodes_excluded_stores_nothing(app, monkeypatch):
    _rule("category", "startsWith", "vuln")
    snap, rows = _scan(app, {"vulnerabilityFindings": [_vuln("CVE-1", "h")]}, monkeypatch)
    assert rows == [] and snap.snapshot_data["_scan_status"] == "done"
