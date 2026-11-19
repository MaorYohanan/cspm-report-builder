"""BL-39: treatment priority defaults from severity on every creation path.

One map in static/js/src/priority-defaults.js, mirrored in backend/services/priority_defaults.py.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from backend.routes.pipeline import _aggregate_vulns, _transform_finding
from backend.services.priority_defaults import SEVERITY_PRIORITY_MAP, default_priority_for_severity
from tests.test_bl24_carry_forward import SUB, _cfg, _vuln

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "static" / "js" / "src"
needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")

CRIT, HIGH, MED, LOW = (SEVERITY_PRIORITY_MAP[k] for k in ("critical", "high", "medium", "low"))


def _node(expr: str, data=None):
    script = (
        f"import * as m from {json.dumps((JS / 'priority-defaults.js').as_uri())};"
        f"const d = {json.dumps(data)};"
        f"console.log(JSON.stringify({expr}));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


# ── backend ──────────────────────────────────────────────────────────────────

def test_backend_default_priority_values():
    assert default_priority_for_severity("critical") == CRIT
    assert default_priority_for_severity(" HIGH ") == HIGH
    assert default_priority_for_severity("info") == ""
    assert default_priority_for_severity("bogus") == ""
    assert default_priority_for_severity(None) == ""


@pytest.mark.parametrize("wiz_sev,expected", [("CRITICAL", CRIT), ("HIGH", HIGH), ("MEDIUM", MED),
                                              ("LOW", LOW), ("INFORMATIONAL", "")])  # info has no default
def test_pipeline_transform_finding_sets_default_priority(wiz_sev, expected):
    f = _transform_finding(_cfg("T", "R-1", sev=wiz_sev), {})
    assert f["priority"] == expected


def test_pipeline_issue_and_vuln_aggregate_set_default_priority():
    issue = {"queryType": "issues", "severity": "CRITICAL", "sourceRules": [{"name": "r"}],
             "entitySnapshot": {"name": "e"}, "_sourceSubscription": SUB, "_subscriptions": [SUB]}
    assert _transform_finding(issue, {})["priority"] == CRIT
    agg = _aggregate_vulns([_vuln("CVE-1", "sub-a")])
    assert agg["priority"] == default_priority_for_severity(agg["severity"]) != ""


# ── parity ───────────────────────────────────────────────────────────────────

@needs_node
def test_js_and_python_maps_are_identical():
    assert _node("m.SEVERITY_PRIORITY_MAP") == SEVERITY_PRIORITY_MAP


@needs_node
def test_priority_values_match_form_options():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for value in SEVERITY_PRIORITY_MAP.values():
        assert f'value="{value}"' in html


# ── shared JS module ─────────────────────────────────────────────────────────

@needs_node
def test_js_default_and_apply_keep_explicit():
    res = _node("""{
      crit: m.defaultPriorityForSeverity('Critical'), info: m.defaultPriorityForSeverity('info'),
      unknown: m.defaultPriorityForSeverity('x'), proto: m.defaultPriorityForSeverity('constructor'),
      empty: m.applyPriorityDefault({severity:'high', priority:''}).priority,
      missing: m.applyPriorityDefault({severity:'low'}).priority,
      blank: m.applyPriorityDefault({severity:'low', priority:'   '}).priority,
      kept: m.applyPriorityDefault({severity:'high', priority:'למעקב'}).priority,
      custom: m.applyPriorityDefault({severity:'high', priority:'עד סוף הרבעון'}).priority,
      nul: m.applyPriorityDefault(null)
    }""")
    assert res == {"crit": CRIT, "info": "", "unknown": "", "proto": "", "empty": HIGH, "missing": LOW,
                   "blank": LOW, "kept": "למעקב", "custom": "עד סוף הרבעון", "nul": None}


@needs_node
def test_js_fill_priority_defaults_counts_only_filled():
    res = _node("""(() => {
      const l = [{severity:'critical', priority:''}, {severity:'high', priority:'למעקב'},
                 {severity:'info', priority:''}, {severity:'medium'}];
      const n = m.fillPriorityDefaults(l);
      return {n, p: l.map(f => f.priority)};
    })()""")
    assert res == {"n": 2, "p": [CRIT, "למעקב", "", MED]}


@needs_node
def test_csv_semantics_explicit_kept_blank_defaulted():
    # export.js: priority = hasPriority(cell) ? cell.trim() : '' then applyPriorityDefault
    res = _node("""d.map(c => {
      const f = {severity:'high', priority: m.hasPriority(c) ? c.trim() : ''};
      return m.applyPriorityDefault(f).priority;
    })""", ["", "  ", "למעקב", " נמוכה (60–120 ימים) "])
    assert res == [HIGH, HIGH, "למעקב", LOW]


@needs_node
@pytest.mark.parametrize("old,new,start,changed,end", [
    ("high", "critical", "", True, CRIT),                 # empty -> follows
    ("high", "critical", HIGH, True, CRIT),               # equals old default -> follows
    ("high", "critical", "למעקב", False, "למעקב"),        # manual different -> kept
    ("high", "critical", "עד סוף הרבעון", False, "עד סוף הרבעון"),  # custom -> kept
    ("high", "critical", LOW, False, LOW),                # another severity's default set by hand -> kept
    ("high", "info", HIGH, True, ""),                     # new severity has no default -> cleared (was default)
    ("high", "info", "", False, ""),                      # nothing to do
    ("info", "low", "", True, LOW),
])
def test_batch_severity_follow_rules(old, new, start, changed, end):
    res = _node("(() => { const f = {severity: d.new, priority: d.start};"
                " const c = m.followSeverityChange(f, d.old); return {c, p: f.priority}; })()",
                {"old": old, "new": new, "start": start})
    assert res == {"c": changed, "p": end}


# ── wiring (source-level guards: the DOM-bound modules cannot be imported under node) ─────

def test_single_source_of_truth_wiring():
    findings = (JS / "findings.js").read_text(encoding="utf-8")
    assert "from './priority-defaults.js'" in findings
    assert "critical: 'מיידי" not in findings  # BL-21's local map was extracted, not duplicated
    for name in ("wizi.js", "export.js"):
        src = (JS / name).read_text(encoding="utf-8")
        assert "from './priority-defaults.js'" in src
        assert "critical: 'מיידי" not in src
    wizi = (JS / "wizi.js").read_text(encoding="utf-8")
    # 4 import flows (2 single-query aggregate returns, single main flow, bulk) + 2 find-by-id paths
    assert wizi.count("fillPriorityDefaults(") >= 6
    findings_src = findings
    assert findings_src.count("applyPriorityDefaultFromSeverity()") >= 2  # both template branches
    assert "followSeverityChange(f, oldSev)" in findings_src
