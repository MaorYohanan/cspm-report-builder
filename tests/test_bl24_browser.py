"""BL-24 browser test: exception carry-forward through BOTH Wiz import paths (single query + bulk).

Runs the real page in Playwright (Microsoft Edge) against a temporary COPY of the app on PORT 8765 with a
brand-new SQLite DB inside the temp copy (never the working tree's instance/ DB, never port 8080). Wiz is
mocked at the network layer (page.route) -- no real Wiz calls. Skipped (with a reason) only when Playwright,
msedge or port 8765 is unavailable.

What it asserts per path: stable-rule-id restore after a title change, `_matchedLoosely` data present,
exact title match not loose, the `memory:unmatched` event (detail shape, scope, in-scope-only), dropping a
stale entry through the dropMemoryEntry helper (server row gone + event re-published), and that the PDF
HTML builder output is identical with and without the UI-only markers.

UI rendering of the unmatched panel / loose badge belongs to the designer's part; extend this file with
DOM assertions on that panel once it exists (it already listens to the same event + helper).
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
SUB = "BL24-Sub"

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

_COPY_ITEMS = ["app.py", "index.html", "alembic.ini", "backend", "static", "templates", "migrations", "services", "blueprints"]


def _port_free() -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", PORT)) != 0


@pytest.fixture(scope="module")
def server():
    if sync_playwright is None:
        pytest.skip("browser test skipped: the 'playwright' Python package is not installed (pip install playwright)")
    if not _port_free():
        pytest.skip(f"browser test skipped: port {PORT} is already in use; stop that server and re-run")
    tmp = Path(tempfile.mkdtemp(prefix="cspm-bl24-browser-"))
    proc = None
    try:
        for name in _COPY_ITEMS:
            src = ROOT / name
            if src.is_dir():
                shutil.copytree(src, tmp / name, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            elif src.is_file():
                shutil.copy2(src, tmp / name)
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(("DATABASE_URL", "APP_TOKEN", "GOOGLE_", "WIZI_", "GEMINI_"))}
        env.update({"PORT": str(PORT), "FLASK_DEBUG": "0", "PYTHONUTF8": "1"})
        proc = subprocess.Popen([sys.executable, "app.py"], cwd=tmp, env=env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + 40
        while time.time() < deadline:
            if proc.poll() is not None:
                pytest.fail("temp copy of the app exited during start-up (port 8765 test server)")
            try:
                urllib.request.urlopen(BASE + "/", timeout=2).read(1)
                break
            except Exception:
                time.sleep(0.5)
        else:
            pytest.fail("temp copy of the app did not become ready on port 8765 within 40s")
        yield tmp
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture(scope="module")
def page(server):
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="msedge", headless=True)
        except Exception as exc:  # msedge not installed
            pytest.skip(f"browser test skipped: Playwright could not launch Microsoft Edge (channel 'msedge'): {exc}")
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        pg = ctx.new_page()
        errors: list = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(BASE + "/")
        pg.evaluate("localStorage.setItem('ui-lang', 'he'); localStorage.removeItem('cspm_report_autosave')")
        pg.reload()
        pg.wait_for_selector("#btn-lang-toggle")
        pg.page_errors = errors
        yield pg
        browser.close()


# ---------------------------------------------------------------------------
# server-side seeding over HTTP (temp app, auth disabled locally)
# ---------------------------------------------------------------------------

def _api(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"{}")


def _seed_product(name: str) -> str:
    pid = _api("POST", "/api/products", {
        "name": name, "owner": "o", "ownerEmail": "o@example.com", "env": "Test", "subscriptionIds": [SUB],
    })["id"]
    entries = [
        # rule key match, title changed -> restored + loose
        dict(subscription=SUB, title="Old cfg title", source="excepted", reason="accepted risk",
             rule_key="configurationFindings|R-1"),
        # exact title match, no key (legacy entry) -> restored, not loose
        dict(subscription=SUB, title="Exact cfg", source="acknowledged", reason="n/a"),
        # stale: rule gone / title gone
        dict(subscription=SUB, title="Stale one", source="excepted", reason="s1",
             rule_key="configurationFindings|GONE"),
        dict(subscription=SUB, title="Stale two", source="deleted"),
        # other subscription: never in scope
        dict(subscription="Elsewhere-Sub", title="Elsewhere", source="excepted"),
    ]
    if name.endswith("single"):  # single-query scope is limited to the queried type's rule keys
        entries.append(dict(subscription=SUB, title="Stale issues rule", source="excepted",
                            rule_key="issues|gone"))
    for e in entries:
        _api("POST", f"/api/products/{pid}/memory/entry", e)
    return pid


def _cfg_node(i: int, rule_id: str, rule_name: str) -> dict:
    return {
        "id": f"node-{i}", "severity": "HIGH", "status": "OPEN",
        "rule": {"id": rule_id, "name": rule_name, "shortId": f"S{i}", "description": "d"},
        "resource": {"id": f"res-{i}", "name": f"res-{i}", "type": "VM", "nativeType": "vm",
                     "region": "eu", "subscription": {"name": SUB, "externalId": "ext", "cloudProvider": "AWS"}},
    }


NODES = [_cfg_node(1, "R-1", "New cfg title"), _cfg_node(2, "R-2", "Exact cfg"), _cfg_node(3, "R-3", "Brand new")]


def _mock_wiz(pg):
    def single(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "queryType": "configurationFindings",
            "configurationFindings": {"nodes": NODES, "pageInfo": {"hasNextPage": False, "endCursor": None},
                                      "totalCount": len(NODES)},
        }))

    def bulk(route):
        body = json.loads(route.request.post_data or "{}")
        nodes = NODES if body.get("queryType") == "configurationFindings" else []
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "resolvedSubscription": {"ids": ["id1"], "externalIds": [], "names": [SUB]},
            "result": {"nodes": nodes, "pageInfo": {"hasNextPage": False}},
        }))

    pg.route("**/api/wizi/issues", single)
    pg.route("**/api/wizi/bulk-fetch-single", bulk)


_PREPARE = """
async (pid) => {
  const { state } = await import('/static/js/src/state.js');
  const { ProductsPanel } = await import('/static/js/src/products.js');
  ProductsPanel.selectedProduct = { id: pid, name: 'bl24' };
  state.findings.length = 0;
  state.unmatchedMemory = { entries: [], scope: null };
  document.querySelectorAll('#confirm-no').forEach(b => b.click()); // leftover AI-enrichment prompt
  window.__memEvents = [];
  if (!window.__memListener) {
    window.__memListener = true;
    document.addEventListener('memory:unmatched', e => window.__memEvents.push(e.detail));
  }
}
"""

_SNAPSHOT = """
async () => {
  const { state } = await import('/static/js/src/state.js');
  return state.findings.map(f => ({ title: f.title, exception: f.exception || null,
    loose: !!f._matchedLoosely, ruleKey: f._ruleKey || null, src: f._sourceSubscription || null }));
}
"""

_REPORT_HTML_UNCHANGED = """
async () => {
  const { state } = await import('/static/js/src/state.js');
  const { buildReportHtml } = await import('/static/js/src/findings.js');
  const withMarkers = buildReportHtml({});
  const saved = state.findings;
  state.findings = saved.map(f => { const c = Object.assign({}, f); delete c._matchedLoosely; delete c._ruleKey; return c; });
  const without = buildReportHtml({});
  state.findings = saved;
  return { equal: withMarkers === without, len: withMarkers.length, hasMarker: withMarkers.indexOf('_matchedLoosely') >= 0 };
}
"""


def _wait_event(pg, count=1):
    # wait_for_function evals a string, which the page CSP forbids; poll with evaluate instead
    deadline = time.time() + 15
    while time.time() < deadline:
        evs = pg.evaluate("() => window.__memEvents || []")
        if len(evs) >= count:
            return evs
        time.sleep(0.2)
    pytest.fail("memory:unmatched event was not dispatched within 15s")


def _titles(rows):
    return {r["title"]: r for r in rows}


def _check_restore(rows):
    t = _titles(rows)
    loose = t["New cfg title"]
    assert loose["exception"] == {"active": True, "reason": "accepted risk"}
    assert loose["loose"] is True
    assert loose["ruleKey"] == "configurationfindings|r-1"
    assert loose["src"] == SUB
    exact = t["Exact cfg"]
    assert exact["exception"] == {"active": True, "reason": "n/a", "kind": "acknowledge"}
    assert exact["loose"] is False
    fresh = t["Brand new"]
    assert not (fresh["exception"] or {}).get("active")
    assert fresh["loose"] is False


def _mem_titles(pid):
    return {e["title"] for e in _api("GET", f"/api/products/{pid}/memory")["entries"].values()}


def _drop_and_check(pg, pid, event_detail, title):
    entry = next(e for e in event_detail["entries"] if e["title"] == title)
    pg.evaluate(
        "async ([pid, entry]) => { const m = await import('/static/js/src/memory-match.js');"
        " return await m.dropMemoryEntry(pid, entry); }", [pid, entry])
    assert title not in _mem_titles(pid)
    evs = pg.evaluate("() => window.__memEvents")
    assert title not in {e["title"] for e in evs[-1]["entries"]}
    assert pg.evaluate("async () => (await import('/static/js/src/state.js')).state.unmatchedMemory.entries.length") \
        == len(evs[-1]["entries"])


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------

def test_single_query_path(page, server):
    _mock_wiz(page)
    pid = _seed_product("bl24 single")
    page.evaluate(_PREPARE, pid)
    page.evaluate("""() => {
      document.getElementById('wizi-query-type').value = 'configurationFindings';
      document.getElementById('wizi-project').value = '%s';
      document.getElementById('btn-wizi-fetch').click();
    }""" % SUB)
    page.wait_for_selector(".wizi-check", state="attached", timeout=15000)
    page.evaluate("""() => {
      document.querySelectorAll('.wizi-check').forEach(cb => { cb.checked = true; });
      document.getElementById('btn-wizi-import-selected').click();
    }""")
    evs = _wait_event(page)
    ev = evs[-1]

    _check_restore(page.evaluate(_SNAPSHOT))
    assert ev["scope"]["type"] == "single" and ev["scope"]["subscription"] == SUB
    assert ev["scope"]["productId"] == pid and ev["scope"]["queryType"] == "configurationFindings"
    got = {e["title"]: e for e in ev["entries"]}
    # single-query scope: this subscription AND this query type's rule keys only
    assert set(got) == {"stale one"}
    assert set(got["stale one"]) == {"subscription", "title", "source", "reason", "ruleKey"}
    assert got["stale one"]["ruleKey"] == "configurationfindings|gone"
    assert got["stale one"]["source"] == "excepted" and got["stale one"]["reason"] == "s1"

    _drop_and_check(page, pid, ev, "stale one")
    remaining = _mem_titles(pid)
    assert {"old cfg title", "exact cfg", "stale two", "elsewhere", "stale issues rule"} <= remaining

    res = page.evaluate(_REPORT_HTML_UNCHANGED)
    assert res["equal"] is True and res["hasMarker"] is False
    assert page.page_errors == []


def test_bulk_path(page, server):
    _mock_wiz(page)
    pid = _seed_product("bl24 bulk")
    page.evaluate(_PREPARE, pid)
    page.evaluate("""() => {
      document.getElementById('bulk-import-sub').value = '%s';
      document.getElementById('btn-bulk-import').click();
    }""" % SUB)
    # the panel itself is not on screen (tab not active): wait for the actions bar to be switched on
    deadline = time.time() + 20
    while time.time() < deadline:
        if page.evaluate("() => document.getElementById('bulk-import-actions').style.display !== 'none'"):
            break
        time.sleep(0.2)
    else:
        pytest.fail("bulk results were not rendered")
    page.evaluate("() => document.getElementById('btn-bulk-select-all').click()")
    page.evaluate("() => document.getElementById('btn-bulk-import-selected').click()")
    page.wait_for_selector("#confirm-yes", timeout=10000)
    page.evaluate("() => document.getElementById('confirm-yes').click()")  # "add to existing"
    evs = _wait_event(page)
    ev = evs[-1]
    # decline the AI-enrichment prompt (no Gemini)
    try:
        page.wait_for_selector("#confirm-no", timeout=3000)
        page.evaluate("() => document.getElementById('confirm-no').click()")
    except Exception:
        pass

    _check_restore(page.evaluate(_SNAPSHOT))
    assert ev["scope"]["type"] == "bulk" and ev["scope"]["subscription"] == SUB
    got = {e["title"] for e in ev["entries"]}
    # bulk scope: every remembered entry of the subscription that matched nothing in the fetch
    assert got == {"stale one", "stale two"}
    assert {e["source"] for e in ev["entries"]} == {"excepted", "deleted"}

    _drop_and_check(page, pid, ev, "stale two")
    assert {"old cfg title", "exact cfg", "stale one", "elsewhere"} <= _mem_titles(pid)

    res = page.evaluate(_REPORT_HTML_UNCHANGED)
    assert res["equal"] is True
    assert page.page_errors == []


def test_event_always_dispatched_even_with_nothing_stale(page, server):
    """No product selected -> the event still fires (empty list) so the panel hides."""
    page.evaluate(_PREPARE, "does-not-exist")
    page.evaluate("""async () => {
      const { ProductsPanel } = await import('/static/js/src/products.js');
      ProductsPanel.selectedProduct = null;
      document.getElementById('wizi-query-type').value = 'configurationFindings';
      document.getElementById('wizi-project').value = '%s';
      document.getElementById('btn-wizi-fetch').click();
    }""" % SUB)
    page.wait_for_selector(".wizi-check", state="attached", timeout=15000)
    page.evaluate("""() => {
      document.querySelectorAll('.wizi-check').forEach(cb => { cb.checked = true; });
      document.getElementById('btn-wizi-import-selected').click();
    }""")
    ev = _wait_event(page)[-1]
    assert ev["entries"] == []
