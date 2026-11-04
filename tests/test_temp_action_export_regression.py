"""BL-12 follow-ups: export field stripping + regression zombie exclusion.

The JS helpers are pure ESM modules, exercised through Node.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "static" / "js" / "src"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def _node(module: str, expr: str, data: dict):
    script = (
        f"import * as m from {json.dumps((JS / module).as_uri())};"
        f"const d = {json.dumps(data)};"
        f"console.log(JSON.stringify({expr}));"
    )
    out = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True, text=True, check=True, timeout=30,
    )
    return json.loads(out.stdout)


def test_strip_removes_internal_fields_and_does_not_mutate():
    findings = [{
        "title": "A", "_wasTempActioned": True, "_tempActionReason": "excepted",
        "_sourceSubscription": "sub-1",
        "exception": {"active": True, "reason": "r", "source": "temp_excepted"},
    }, {
        "title": "B", "exception": {"active": True, "reason": "p"},
    }]
    res = _node("export-sanitize.js", "{out: m.stripInternalExportFields(d.f), orig: d.f}", {"f": findings})
    a, b = res["out"]
    assert "_wasTempActioned" not in a and "_tempActionReason" not in a
    assert "_sourceSubscription" not in a
    assert a["exception"] == {"active": True, "reason": "r"}
    assert b["exception"] == {"active": True, "reason": "p"}

    # Mutation check inside a single process.
    script = (
        f"import {{stripInternalExportFields as s}} from {json.dumps((JS / 'export-sanitize.js').as_uri())};"
        f"const f=[{json.dumps(findings[0])}]; s(f); console.log(JSON.stringify(f));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    assert json.loads(out.stdout) == [findings[0]]


def _zombies(baseline, curr):
    return _node("regression-utils.js", "m.detectZombies(d.b, d.c)", {"b": baseline, "c": curr})


def test_temp_excepted_baseline_is_not_a_zombie():
    base = [{"title": "X", "exception": {"active": True, "source": "temp_excepted"}}]
    assert _zombies(base, [{"title": "x", "exception": {"active": False}}]) == []


def test_permanent_excepted_baseline_is_still_a_zombie():
    base = [{"title": "X", "exception": {"active": True, "reason": "ok"}}]
    z = _zombies(base, [{"title": " x ", "severity": "high"}])
    assert len(z) == 1 and z[0]["prevStatus"] == "הוחרג"


def test_exception_source_survives_version_roundtrip(client):
    pid = client.post("/api/products", json={
        "name": "Rt Product", "owner": "O", "ownerEmail": "o@example.com",
        "env": "Production", "subscriptionIds": ["sub-001"],
    }).get_json()["id"]
    findings = [{"severity": "High", "title": "T",
                 "exception": {"active": True, "reason": "", "source": "temp_excepted"}}]
    client.post(f"/api/products/{pid}/versions", json={
        "type": "minor", "notes": "v1", "snapshot": {"findings": findings}})
    client.post(f"/api/products/{pid}/versions/1.0/publish")
    body = client.get(f"/api/products/{pid}/versions/1.0").get_json()
    assert body["findings"][0]["exception"]["source"] == "temp_excepted"
