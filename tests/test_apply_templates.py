"""Import-time smart templates (static/js/src/apply-templates.js): plan only complete matches, keep the title."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

MOD = (Path(__file__).resolve().parent.parent / "static" / "js" / "src" / "apply-templates.js").as_uri()

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def _run(findings):
    script = (
        f"import * as m from {json.dumps(MOD)};"
        f"const fs = {json.dumps(findings)};"
        "const plan = m.planTemplates(fs);"
        "const n = m.applyPlan(plan);"
        "console.log(JSON.stringify({planned: plan.length, n, fs}));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


GIT = {"category": "SECR", "title": "Git Credentials (https://u:---REDACTED---@github.com/o/r.git) in Scripts and Code",
       "description": "old", "impact": "old", "recs": ["old"],
       "technical": ["Cloud: AWS", "Resource: x", "Type: image", "Secret Type: GIT_CREDENTIAL", "Path: /a.sh"]}
EAPM_AWS = {"category": "EAPM", "title": "AWS excessive access for role r1", "description": "policy `P1` has 2 unused permissions",
            "impact": "old", "recs": ["old"], "technical": ["Cloud: AWS", "Principal: r1", "Remediation Type: DETACH_POLICY"]}
EAPM_NODATA = {"category": "EAPM", "title": "AWS excessive access", "description": "", "impact": "old", "recs": ["old"],
               "technical": ["Cloud: AWS"]}
OTHER = {"category": "CSPM", "title": "x", "description": "d", "impact": "i", "recs": ["r"], "technical": []}


def test_complete_matches_are_rewritten_and_titles_kept():
    r = _run([GIT, EAPM_AWS, OTHER])
    assert (r["planned"], r["n"]) == (2, 2)
    git, aws, other = r["fs"]
    assert git["title"] == GIT["title"] and aws["title"] == EAPM_AWS["title"]
    assert "github.com/o/r.git" in git["description"] and isinstance(git["recs"], list) and len(git["recs"]) >= 3
    assert "`r1`" in aws["description"] and aws["recs"] != ["old"]
    assert other == OTHER


def test_findings_with_unresolved_placeholders_are_left_alone():
    r = _run([EAPM_NODATA])
    assert r["planned"] == 0 and r["fs"][0] == EAPM_NODATA


VPC = {"category": "CSPM", "title": "VPC firewall rules should restrict MULTIPLE accesses",
       "description": "נמצאו 3 כללי VPC firewall על משאב fw-1", "impact": "old", "recs": ["old"], "technical": ["Resource: fw-1"]}
VPC_SINGLE = {"category": "CSPM", "title": "VPC firewall rule should restrict SSH access", "description": "d",
              "impact": "old", "recs": ["old"], "technical": []}


def test_vpc_multiple_gets_fixed_impact_and_recs_but_keeps_title_and_description():
    r = _run([VPC, VPC_SINGLE])
    assert (r["planned"], r["n"]) == (1, 1)
    vpc, single = r["fs"]
    assert vpc["title"] == VPC["title"] and vpc["description"] == VPC["description"]
    assert vpc["impact"].startswith("ריבוי פורטים פתוחים") and len(vpc["recs"]) == 2
    assert single == VPC_SINGLE


HSPM = {"category": "HSPM", "title": "Ensure Redis is configured with a strong password", "description": "d", "impact": "old",
        "recs": ["old"], "technical": ["Cloud: GCP", "Resource: vm-1"]}
EOLM = {"category": "EOLM", "title": "רכיבים בסוף חיים (End of Life)", "description": "זוהו 1 רכיבים", "impact": "old",
        "recs": ["old"], "technical": ["- Linux Ubuntu.", "Subscription: s1"]}
HSPM_NODATA = dict(HSPM, technical=["Cloud: GCP"])


def test_config_templates_apply_on_import_and_keep_the_title():
    r = _run([HSPM, EOLM, HSPM_NODATA])
    assert (r["planned"], r["n"]) == (2, 2)
    hspm, eolm, nodata = r["fs"]
    assert hspm["title"] == HSPM["title"] and "`vm-1`" in hspm["description"] and len(hspm["recs"]) == 4
    assert "`Linux Ubuntu`" in eolm["description"] and eolm["title"] == EOLM["title"]
    assert nodata == HSPM_NODATA  # no resource: left alone
