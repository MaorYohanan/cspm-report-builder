"""BL-37 review fixes: static regex validator, save-time validation, Product Memory interplay,
rules_load_failed / skipped_rules reporting.

SAFETY: patterns known to backtrack catastrophically are only ever fed to the VALIDATOR (static
analysis, never matched). Real matching of safe patterns runs in a subprocess with a timeout.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.database import db
from backend.models import ExcludeRule, ProductMemoryEntry
from backend.routes import pipeline as pl
from backend.routes.wiz import _pattern_error
from backend.services import exclude_matching as em
from backend.services.exclude_matching import ExcludeMatcher, MAX_MATCH_TEXT, regex_error
from tests.test_bl24_carry_forward import SUB, _cfg, _mem
from tests.test_bl37_pipeline_exclude_rules import R, _rule, _scan
from tests.test_exclude_rules import real_client  # noqa: F401  (fixture)

ROOT = Path(__file__).resolve().parent.parent

PROD_RULES = [
    r"^GCP excessive access for service account \S+iac\S+@\S+.gserviceaccount.com$",
    r"^GCP excessive access for service account .*-iac@dgt-gcp-.*\.iam\.gserviceaccount\.com$",
]

UNSAFE = [
    r"(a|aa)+$", r"((a+))+$", r"(.*a){12}$", r".*.*.*.*x", r"(a+)+", r"(.*)*x", r"(\w+\s?)*$",
    r"(a{1,})+b", r"(?:ab|cd)+e", r"(a+){2,}", r"(x*)*", r"^a.*a.*a.*a.*b",
    r"(?=a)a", r"(?!a)b", r"(?<=a)b", r"(a)\1", r"(?>a+)b", r"a++b", r"(?(1)a|b)",
    r"(?P<n>a)", "a" * 501, "", "(", "[a-", r"x{2,1}",
]
SAFE = [
    *PROD_RULES, r"^s3 .*public$", r"\bkey\d+\b", r"^(cspm|kspm)$", r"[()]", r"^(cve|ghsa)-\d+(\.\d+)?$",
    r"(?:ab)+c", r"^\[govil\]", r"a.*a.*b", r"(a|b)c", r"foo|bar|baz", r"(?:a|b)*c",
]


@pytest.mark.parametrize("pat", UNSAFE)
def test_validator_rejects_unsafe(pat):
    assert regex_error(pat), pat


@pytest.mark.parametrize("pat", SAFE)
def test_validator_accepts_safe(pat):
    assert regex_error(pat) is None, pat


def test_validator_fails_closed_without_parser(monkeypatch):
    monkeypatch.setattr(em, "_sp", None)
    assert regex_error("abc")
    assert ExcludeMatcher([R("title", "regex", "abc", rid=4)]).skipped_ids == [4]


def test_matched_text_cap_is_1024():
    assert MAX_MATCH_TEXT == 1024
    m = ExcludeMatcher([R("title", "regex", r"x$")])
    assert m.matches_values("a" * 1023 + "x", "c")
    assert not m.matches_values("a" * 1024 + "x", "c")  # tail beyond the cap is not scanned


def test_production_rules_remain_valid_and_match():
    m = ExcludeMatcher([R("title", "regex", p, rid=i) for i, p in enumerate(PROD_RULES, 1)])
    assert m.skipped_ids == [] and len(m) == 2
    assert m.matches_values("GCP excessive access for service account x-iac-y@p.gserviceaccount.com", "EAPM")
    assert m.matches_values("GCP excessive access for service account a-iac@dgt-gcp-1.iam.gserviceaccount.com", "EAPM")
    assert not m.matches_values("GCP excessive access for service account bob@p.gserviceaccount.com", "EAPM")


_CHILD = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
from backend.services.exclude_matching import ExcludeMatcher
cases = json.loads(sys.argv[2])
out = []
for pat, text in cases:
    m = ExcludeMatcher([{"id": 1, "field": "title", "operator": "regex", "pattern": pat, "active": True}])
    out.append([len(m), m.matches_values(text, "CSPM")])
print(json.dumps(out))
"""


def test_safe_patterns_run_fast_on_adversarial_input_in_subprocess():
    pre = "GCP excessive access for service account "
    cases = [
        [PROD_RULES[0], pre + "iac" * 300],
        [PROD_RULES[0], pre + "iac@" * 250],
        [PROD_RULES[1], pre + "-iac@dgt-gcp-" * 70],
        [r"a.*a.*b", "a" * 600],
        [r"(?:ab)+c", "ab" * 500],
        [r"^(cve|ghsa)-\d+(\.\d+)?$", "cve-" + "1" * 900],
    ]
    # subprocess.run kills the child on timeout; a hang fails the test instead of the suite
    r = subprocess.run([sys.executable, "-I", "-c", _CHILD, str(ROOT), json.dumps(cases)],
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert all(n == 1 for n, _ in json.loads(r.stdout))


# ── save-time validation ─────────────────────────────────────────────────────

def test_pattern_error_rejects_unsafe_regex_with_hebrew_message():
    err = _pattern_error("title", r"(a+)+$", "regex")
    assert err and any("א" <= c <= "ת" for c in err)
    assert _pattern_error("title", r"(a+)+$", "contains") is None      # literal operators unaffected
    assert _pattern_error("title", r"^s3 .*public$", "regex") is None
    assert _pattern_error("title", "plain") is None                      # operator omitted: legacy call


def test_pattern_error_validates_both_parts_of_pair_rules():
    ok = json.dumps({"title": "^a", "resource": "b$"})
    bad_title = json.dumps({"title": "(a|aa)+$", "resource": "b"})
    bad_second = json.dumps({"title": "a", "path": "(.*a){12}$"})
    assert _pattern_error("title_resource", ok, "regex") is None
    assert _pattern_error("title_resource", bad_title, "regex")
    assert _pattern_error("title_path", bad_second, "regex")
    assert _pattern_error("title_path", bad_second, "contains") is None


def test_create_and_update_routes_reject_unsafe_regex(real_client):
    r = real_client.post("/api/wizi/exclude-rules",
                         json={"field": "title", "operator": "regex", "pattern": "(a|aa)+$"})
    assert r.status_code == 400 and "רגולרי" in r.get_json()["error"]
    r = real_client.post("/api/wizi/exclude-rules", json={
        "field": "title_resource", "operator": "regex",
        "pattern": json.dumps({"title": "ok", "resource": "((a+))+$"})})
    assert r.status_code == 400
    ok = real_client.post("/api/wizi/exclude-rules",
                          json={"field": "title", "operator": "regex", "pattern": "^s3"})
    assert ok.status_code == 201
    rid = ok.get_json()["rule"]["id"]
    bad = real_client.put(f"/api/wizi/exclude-rules/{rid}", json={"pattern": "(.*a){12}$"})
    assert bad.status_code == 400
    assert real_client.get("/api/wizi/exclude-rules").get_json()["rules"][0]["pattern"] == "^s3"
    # switching an existing literal rule to the regex operator re-validates it
    lit = real_client.post("/api/wizi/exclude-rules",
                           json={"field": "title", "operator": "contains", "pattern": "(a+)+"})
    assert lit.status_code == 201
    sw = real_client.put(f"/api/wizi/exclude-rules/{lit.get_json()['rule']['id']}", json={"operator": "regex"})
    assert sw.status_code == 400


def test_unsafe_rule_in_db_is_skipped_at_load_and_reported(app, caplog):
    db.session.add_all([
        ExcludeRule(field="title", operator="regex", pattern="(a|aa)+$", active=True),
        ExcludeRule(field="title", operator="contains", pattern="drop", active=True),
    ])
    db.session.commit()
    m = em.load_active_matcher()
    assert len(m) == 1 and len(m.skipped_ids) == 1 and not m.load_failed
    assert m.is_excluded(_cfg("please drop"))


# ── Product Memory vs rule-excluded findings ─────────────────────────────────

def _unmatched(snap):
    return snap.snapshot_data["_unmatched_memory"]


def test_rule_excluded_node_is_not_reported_as_unmatched_memory(app, monkeypatch):
    _mem("Hidden by rule", source="excepted", rule_key="configurationfindings|r1")
    _mem("Title only hidden", source="excepted")
    _mem("Really gone", source="excepted", rule_key="configurationfindings|r9")
    _rule("title", "regex", r"^hidden by rule$")
    _rule("title", "contains", "title only")
    nodes = [_cfg("Hidden by rule", "r1"), _cfg("Title only hidden", None), _cfg("Keep", "r3")]
    snap, rows = _scan(app, {"configurationFindings": nodes}, monkeypatch)
    assert [r["title"] for r in rows] == ["Keep"]
    assert [u["title"] for u in _unmatched(snap)] == ["really gone"]
    assert ProductMemoryEntry.query.count() == 3


def test_rule_excluded_node_does_not_consume_temp_entry(app, monkeypatch):
    _mem("Temp one", source="temp_excepted", rule_key="configurationfindings|r1")
    _rule("title", "contains", "temp one")
    snap, rows = _scan(app, {"configurationFindings": [_cfg("Temp one", "r1")]}, monkeypatch)
    assert rows == [] and _unmatched(snap) == []
    assert ProductMemoryEntry.query.filter_by(source="temp_excepted").count() == 1


def test_without_rule_the_same_missing_entry_is_unmatched(app, monkeypatch):
    _mem("Hidden by rule", source="excepted", rule_key="configurationfindings|r1")
    snap, rows = _scan(app, {"configurationFindings": [_cfg("Keep", "r3")]}, monkeypatch)
    assert [u["title"] for u in _unmatched(snap)] == ["hidden by rule"]


# ── rules_load_failed / skipped_rules ────────────────────────────────────────

def test_scan_records_skipped_rules_and_load_ok(app, monkeypatch):
    _rule("title", "regex", "(a+)+$")
    _rule("title", "contains", "x")
    snap, _ = _scan(app, {"configurationFindings": [_cfg("A", "r1")]}, monkeypatch)
    sd = snap.snapshot_data
    assert sd["_rules_load_failed"] is False and len(sd["_skipped_rules"]) == 1
    job = pl._scan_jobs.pop(snap.id)
    assert job["rules_load_failed"] is False and job["skipped_rules"] == sd["_skipped_rules"]


def test_db_failure_loading_rules_is_flagged_and_logged(app, monkeypatch, caplog):
    _rule("title", "contains", "a")
    boom = patch.object(ExcludeRule, "query", property(lambda self: (_ for _ in ()).throw(RuntimeError("db down"))))
    with boom, caplog.at_level("WARNING"):
        snap, rows = _scan(app, {"configurationFindings": [_cfg("A", "r1")]}, monkeypatch)
    assert len(rows) == 1                      # scan continues unfiltered...
    assert snap.snapshot_data["_rules_load_failed"] is True   # ...but visibly so
    assert pl._scan_jobs.pop(snap.id)["rules_load_failed"] is True
    assert "WITHOUT exclude rules" in caplog.text
    assert any(r.exc_info for r in caplog.records if "WITHOUT" in r.getMessage())


def test_scan_status_endpoint_exposes_rule_fields(app, monkeypatch):
    app.register_blueprint(pl.pipeline_bp)
    client = app.test_client()
    snap, _ = _scan(app, {"configurationFindings": [_cfg("A", "r1")]}, monkeypatch)
    pl._scan_jobs.pop(snap.id, None)   # force the DB fallback path
    body = client.get(f"/api/pipeline/p1/scan-status/{snap.id}").get_json()
    assert body["status"] == "done"
    assert body["excluded_by_rules"] == 0 and body["rules_load_failed"] is False and body["skipped_rules"] == []


# ── Product Memory: aggregate VULN-001 when rules drop its vulnerability nodes ──

def _vn(name, asset="host"):
    return {"id": f"v-{name}", "name": name, "severity": "HIGH", "vulnerableAsset": {"name": asset}}


def test_all_vulns_rule_excluded_aggregate_memory_not_unmatched(app, monkeypatch):
    _mem(pl.VULN_AGG_TITLE, source="excepted")
    _mem(pl.VULN_AGG_TITLE, source="temp_excepted", sub=SUB + ", other-sub")
    _rule("category", "startsWith", "vuln")
    snap, rows = _scan(app, {"vulnerabilityFindings": [_vn("CVE-1"), _vn("CVE-2")]}, monkeypatch)
    assert rows == [] and _unmatched(snap) == []
    # never applied or consumed by an exclusion
    assert ProductMemoryEntry.query.count() == 2
    assert ProductMemoryEntry.query.filter_by(source="temp_excepted").count() == 1


def test_some_vulns_excluded_aggregate_matches_as_before(app, monkeypatch):
    _mem(pl.VULN_AGG_TITLE, source="excepted", reason="accepted")
    _rule("title_resource", "startsWith", json.dumps({"title": "cve-1", "resource": "gone"}))
    snap, rows = _scan(app, {"vulnerabilityFindings": [_vn("CVE-1", "gone-host"), _vn("CVE-2")]}, monkeypatch)
    assert len(rows) == 1 and rows[0]["exception"] == {"active": True, "reason": "accepted"}
    assert _unmatched(snap) == []


def test_vuln_memory_without_rule_or_vulns_is_still_unmatched(app, monkeypatch):
    _mem(pl.VULN_AGG_TITLE, source="excepted")
    snap, rows = _scan(app, {"vulnerabilityFindings": []}, monkeypatch)
    assert rows == [] and [u["title"] for u in _unmatched(snap)] == [pl.VULN_AGG_TITLE.lower()]
