"""Smart CSPM / HSPM / EOLM templates (static/js/src/config-fill.js): data comes from the finding, title is kept."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parent.parent / "static" / "js" / "src"
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")

# (category, Wiz title, expected variant)
CASES = [
    ("CSPM", "VPC firewall rule should not allow access from any IP", "vpc-any-ip"),
    ("CSPM", "VPC firewall rule should allow access to specific private networks only", "vpc-private-networks"),
    ("CSPM", "VPC firewall rule should allow access over specific ports only", "vpc-all-ports"),
    ("CSPM", "VPC firewall rule should restrict access over uncommon ports", "vpc-uncommon-ports"),
    ("CSPM", "VPC firewall rule should restrict VNC access (TCP - ports 5500, 5800 and 5900)", "vpc-vnc"),
    ("CSPM", "VPC subnet should have Private Google Access enabled", "subnet-private-google-access"),
    ("CSPM", "Compute instance should not use the default Compute Engine service account with full API access", "default-service-account"),
    ("HSPM", "Ensure CopyFail2 and DirtyFrag vulnerable kernel modules are disabled", "hspm-kernel-modules"),
    ("HSPM", "Check if CUPS browsed was installed and was active at least once", "hspm-cups-browsed"),
    ("HSPM", "Ensure Redis is in 'protected-mode'", "hspm-redis-protected-mode"),
    ("HSPM", "Ensure Redis is configured with a strong password", "hspm-redis-password"),
    ("EOLM", "רכיבים בסוף חיים (End of Life)", "eolm-end-of-life"),
]


def _run(body: str):
    script = f"import * as m from {json.dumps((SRC / 'config-fill.js').as_uri())};{body}"
    out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


def _build(category, title, technical):
    return _run(
        f"const src = {{title: {json.dumps(title)}, technical: {json.dumps(technical)}}};"
        f"const v = m.pickConfigVariant({json.dumps(category)}, {json.dumps(title)});"
        "const b = v && m.buildConfigFinding(v, m.extractConfigData(src), src.title);"
        "console.log(JSON.stringify({v, b}));"
    )


@pytest.mark.parametrize("category,title,variant", CASES)
def test_every_wiz_title_picks_its_variant_and_fills_completely(category, title, variant):
    tech = ["Cloud: GCP", "Subscription: sub-1", "Region: me-west1", "Resource: r1, r2", "Type: x", "- Linux Ubuntu.", "- pkg:python/boto."]
    r = _build(category, title, tech)
    assert r["v"] == variant
    f = r["b"]["fields"]
    assert r["b"]["missing"] == []
    assert f["title"] == title  # the Wiz title is kept
    assert f["description"] and f["impact"] and len(f["recs"].split("\n")) >= 2
    assert "<RESOURCES>" not in f["description"]


def test_wrong_category_or_unknown_title_picks_nothing():
    assert _build("SECR", CASES[0][1], [])["v"] is None
    assert _build("CSPM", "Some other rule", [])["v"] is None


def test_resource_list_is_plain_and_the_wiz_cut_is_kept():
    f = _build("CSPM", CASES[0][1], ["Resource: a, b, c ועוד 3..."])["b"]["fields"]
    assert "`a`, `b`, `c` ועוד 3" in f["description"]


def test_missing_resource_leaves_a_visible_placeholder():
    b = _build("HSPM", CASES[8][1], ["Cloud: GCP"])["b"]
    assert b["missing"] == ["RESOURCES"] and "<RESOURCES>" in b["fields"]["description"]


def test_private_google_access_has_no_pe_subnet_wording_and_fills_the_command():
    one = _build("CSPM", CASES[5][1], ["Region: me-west1", "Resource: sub-a"])["b"]["fields"]
    assert "Private Endpoint" not in one["recs"] and "pe-subnet" not in one["recs"]
    assert "update sub-a --region=me-west1" in one["recs"]
    many = _build("CSPM", CASES[5][1], ["Region: me-west1", "Resource: sub-a, sub-b"])["b"]["fields"]
    assert "update <SUBNET> --region=me-west1" in many["recs"]


def test_end_of_life_uses_listed_components_and_several_subscriptions():
    tech = ["- OpenSSL, EOL date 2025-01-31.", "- pkg:python/boto.", "- OpenSSL.", "Subscription: s1, s2"]
    f = _build("EOLM", CASES[11][1], tech)["b"]["fields"]
    assert "במנויים `s1`, `s2`" in f["description"]
    assert "זוהו 2 רכיבים" in f["description"] and "`OpenSSL`" in f["description"] and "2025" not in f["description"]
    one = _build("EOLM", CASES[11][1], ["- Linux Ubuntu.", "Subscription: s1"])["b"]["fields"]
    assert "במנוי `s1` זוהה רכיב אחד" in one["description"]


def test_end_of_life_list_is_capped_at_eight():
    tech = [f"- comp{i}." for i in range(11)] + ["Subscription: s1"]
    d = _build("EOLM", CASES[11][1], tech)["b"]["fields"]["description"]
    assert "זוהו 11 רכיבים" in d and "`comp7`" in d and "`comp8`" not in d and "ועוד 3" in d


def test_dropdown_has_one_entry_per_variant():
    r = _run("console.log(JSON.stringify(m.configDropdownEntries()));")
    assert [(e["category"], e["title"]) for e in r] == [(c, t) for c, t, _ in CASES if c != "EOLM"] + [("EOLM", CASES[11][1])]
    assert all(e["smart"] for e in r)
