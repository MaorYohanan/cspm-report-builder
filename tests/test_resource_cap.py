"""Resource-list cap for imported findings (static/js/src/resource-cap.js), run through Node."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
MOD = (ROOT / "static" / "js" / "src" / "resource-cap.js").as_uri()

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def _node(expr: str, data):
    script = (
        f"import * as m from {json.dumps(MOD)};"
        f"const d = {json.dumps(data)};"
        f"console.log(JSON.stringify({expr}));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


def _names(n):
    return [f"r{i}" for i in range(1, n + 1)]


def test_five_or_fewer_unchanged():
    f = {"technical": ["Resource: " + ", ".join(_names(5))]}
    out = _node("(m.capResourceLine(d), d)", f)
    assert out["technical"][0] == "Resource: r1, r2, r3, r4, r5"
    assert "_resources" not in out


def test_more_than_five_keeps_five_and_counts_rest():
    f = {"technical": ["x", "Affected Resources: " + ", ".join(_names(8))]}
    out = _node("(m.capResourceLine(d), d)", f)
    assert out["technical"][1] == "Affected Resources: r1, r2, r3, r4, r5 ועוד 3..."
    assert out["_resources"] == _names(8)


def test_idempotent_and_merge_uses_full_list():
    f = {"technical": ["Resource: " + ", ".join(_names(8))]}
    out = _node("(m.capResourceLine(d), m.capResourceLine(d), d)", f)
    assert out["technical"][0] == "Resource: r1, r2, r3, r4, r5 ועוד 3..."
    # merging a new resource into an already-capped finding keeps the hidden ones
    out2 = _node("(m.capResourceLine(d, m.getFullResources(d).concat(['r9'])), d)", out)
    assert out2["technical"][0] == "Resource: r1, r2, r3, r4, r5 ועוד 4..."


def test_legacy_suffix_is_parsed_not_counted_as_a_name():
    f = {"technical": ["Resource: a, b (+ 4 more — see Wiz report)"]}
    assert _node("m.getFullResources(d)", f) == ["a", "b"]


def test_no_resource_line_is_noop():
    f = {"technical": ["CVSS Score: 9"]}
    assert _node("(m.capResourceLine(d), d)", f)["technical"] == ["CVSS Score: 9"]


# ── Wiz reference link ───────────────────────────────────────────────────────
REF = (ROOT / "static" / "js" / "src" / "wiz-reference.js").as_uri()


def _ref(expr: str, data):
    script = (
        f"import * as m from {json.dumps(MOD)}; import * as r from {json.dumps(REF)};"
        f"const d = {json.dumps(data)}; console.log(JSON.stringify({expr}));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


def test_reference_added_only_when_capped():
    capped = {"technical": ["Resource: " + ", ".join(_names(8)), "Other"], "_wizRef": "https://app.wiz.io/x"}
    out = _ref("(m.capResourceLines([d]), d)", capped)
    assert out["technical"][-1] == "Reference: https://app.wiz.io/x"   # always the last line
    assert out["technical"][1] == "Other"
    assert "_wizRef" not in out
    small = {"technical": ["Resource: a, b"], "_wizRef": "https://app.wiz.io/x"}
    out = _ref("(m.capResourceLines([d]), d)", small)
    assert out["technical"] == ["Resource: a, b"] and "_wizRef" not in out


def test_reference_replaces_existing_reference_line():
    f = {"technical": ["Resource: " + ", ".join(_names(7)), "Reference: https://old"], "_wizRef": "https://new"}
    out = _ref("(m.capResourceLines([d]), d)", f)
    assert [l for l in out["technical"] if l.startswith("Reference:")] == ["Reference: https://new"]


def test_build_reference_urls():
    vuln = _ref("r.buildWizReference('vulnerabilityFindings', [], {subscriptionExternalId: '888577045751'})", {})
    assert vuln.startswith("https://app.wiz.io/findings/vulnerability-findings?filters=")
    assert "888577045751" in vuln and "validatedInRuntime" in vuln and "hasExploit" in vuln
    assert _ref("r.buildWizReference('vulnerabilityFindings', [], {})", {}) is None  # no subscription id
    cfg = _ref("r.buildWizReference('configurationFindings', d, {})", [
        {"rule": {"id": "3c732d97-9576-42be-8cad-c4827bfe95d5"},
         "resource": {"subscription": {"id": "438a95de-6bc6-5d6f-b42a-45eeca37700b"}}}])
    # byte-identical to a valid portal link supplied by the user
    assert cfg == ("https://app.wiz.io/findings/configuration-findings/cloud#%7E%28filters%7E%28status%7E%28equals"
                   "%7E%28%7E%27OPEN%29%29%7Erule%7E%28equals%7E%28%7E%273c732d97-9576-42be-8cad-c4827bfe95d5%29%29"
                   "%7EcloudAccount%7E%28equals%7E%28%7E%27438a95de-6bc6-5d6f-b42a-45eeca37700b%29%29%29%7EgroupBy"
                   "%7E%28%7E%29%29")
    assert _ref("r.buildWizReference('hostConfigurationRuleAssessments', d, {})", [{"rule": {"id": "x1"}}]).startswith(
        "https://app.wiz.io/findings/host-configuration#%7E%28filters")
    assert _ref("r.buildWizReference('secretInstances', d, {})", [{}]) is None


def test_host_config_and_issue_links_match_real_portal_links():
    from urllib.parse import unquote
    hspm = _ref("r.buildWizReference('hostConfigurationRuleAssessments', d, {})",
                [{"rule": {"id": "6393df1c-6497-44a1-a0d6-2eb50055c05a"}}])
    # decoded form of a Reference link already used in a real report
    assert unquote(hspm.split("#", 1)[1]) == (
        "~(filters~(status~(equals~(~'OPEN))~hostConfigurationRule~(equals~(~'6393df1c-6497-44a1-a0d6-2eb50055c05a))))")
    issue = _ref("r.buildWizReference('issues', [], {title: 'Internet-facing container on VM'})", {})
    assert "Internet-facing+container+on+VM" in issue and "%2B" not in issue and "%20" not in issue


def test_host_config_link_includes_subscription_filter():
    from urllib.parse import unquote
    items = [{"rule": {"id": "r1"}, "resource": {"subscription": {"id": "s1"}}},
             {"rule": {"id": "r1"}, "resource": {"subscription": {"id": "s2"}}},
             {"rule": {"id": "r1"}, "resource": {"subscription": {"id": "s1"}}}]
    url = _ref("r.buildWizReference('hostConfigurationRuleAssessments', d, {})", items)
    assert unquote(url.split("#", 1)[1]) == (
        "~(filters~(status~(equals~(~'OPEN))~hostConfigurationRule~(equals~(~'r1))~cloudAccount~(equals~(~'s1~'s2))))")


def test_eol_reference_matches_real_portal_link_shape():
    from urllib.parse import unquote
    one = _ref("r.buildWizReference('endOfLifeFindings', [], {subscriptionExternalId: '706193894390'})", {})
    assert one.startswith("https://app.wiz.io/findings/end-of-life-findings?filters=")
    # same filters / groupBy as the end-of-life Reference link already used in real reports
    assert unquote(one.split("?", 1)[1]) == 'filters={"cloudAccount":{"equals":["706193894390"]}}&groupBy=["VULNERABLE_ASSET"]'
    many = _ref("r.buildWizReference('endOfLifeFindings', [], {subscriptionExternalIds: ['1','2','1']})", {})
    assert '"equals":["1","2"]' in unquote(many)
    assert _ref("r.buildWizReference('endOfLifeFindings', [], {})", {}) is None  # no external id -> no link
    vuln = _ref("r.buildWizReference('vulnerabilityFindings', [], {subscriptionExternalIds: ['9']})", {})
    assert '"cloudAccount":{"equals":["9"]}' in unquote(vuln)


def test_reference_is_always_last_even_when_not_capped_or_added_earlier():
    f = {"technical": ["Reference: https://old", "Resource: a, b", "Subscription: s", "reference: https://manual"]}
    out = _ref("(m.capResourceLines([d]), d)", f)
    assert out["technical"] == ["Resource: a, b", "Subscription: s", "Reference: https://old", "reference: https://manual"]
    # merging more resources into a capped finding keeps Reference last too
    g = {"technical": ["Resource: " + ", ".join(_names(8)), "Reference: https://x", "Subscription: s"]}
    out = _ref("(m.capResourceLine(d, m.getFullResources(d).concat(['r9'])), d)", g)
    assert out["technical"][-1] == "Reference: https://x"
    assert out["technical"][0].endswith("ועוד 4...")
