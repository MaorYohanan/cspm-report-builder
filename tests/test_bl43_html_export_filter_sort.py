"""BL-43: category filter + severity sort in the interactive HTML export.

Backend tests render the template through POST /api/export/html and assert on markup/data embedding.
The browser test opens a rendered export directly via file:// in Playwright (Microsoft Edge); it needs
no server, DB or port, and skips with a reason when Playwright/msedge is unavailable.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "templates" / "interactive_export_template.html"


def _client():
    from flask import Flask

    from backend.routes import reports

    app = Flask(__name__, template_folder=str(ROOT / "templates"))
    app.config["TESTING"] = True
    app.register_blueprint(reports.reports_bp)
    return app.test_client()


def _render(findings, meta=None) -> str:
    r = _client().post("/api/export/html", json={"meta": meta or {"client": "לקוח"}, "findings": findings})
    assert r.status_code == 200
    return r.get_data(as_text=True)


def _f(i, sev, cat, title=None, **kw):
    d = {"id": f"F{i}", "title": title or f"ממצא {i}", "severity": sev, "category": cat}
    d.update(kw)
    return d


# ── backend / markup ─────────────────────────────────────────────────────────

def test_controls_markup_present():
    body = _render([_f(1, "high", "IAM")])
    assert 'id="sort-btn"' in body and 'type="button"' in body
    assert 'id="category-group"' in body and 'id="category-chips"' in body
    assert 'id="result-count"' in body and 'role="status"' in body
    # existing controls still there
    assert 'id="search-input"' in body and 'id="severity-select"' in body and 'id="show-excepted-cb"' in body
    assert "aria-pressed" in body


def test_no_inline_event_handlers_in_template():
    src = TEMPLATE.read_text(encoding="utf-8")
    assert not re.search(r"\son[a-z]+\s*=", src), "inline event handler attribute found"
    assert "javascript:" not in src


def test_data_embedded_with_categories():
    body = _render([_f(1, "high", "IAM"), _f(2, "low", "Network"), _f(3, "info", "IAM")])
    m = re.search(r"window\.__REPORT_DATA__ = (\{.*?\});\n", body, re.S)
    assert m
    import json
    data = json.loads(m.group(1))
    assert [f["category"] for f in data["findings"]] == ["IAM", "Network", "IAM"]


def test_script_in_title_and_category_cannot_break_out():
    evil = "</script><script>window.__pwn=1</script>"
    body = _render([_f(1, "high", evil, title=evil)])
    # tojson escapes '<' so the literal closing tag never appears inside the data blob
    assert body.count("</script>") == 1
    assert "<script>window.__pwn" not in body


def test_acknowledged_findings_stay_stripped():
    body = _render([
        _f(1, "high", "IAM", title="ACK-SECRET", exception={"active": True, "kind": "acknowledge", "reason": "r"}),
        _f(2, "low", "IAM", title="visible-one"),
    ])
    assert "ACK-SECRET" not in body and "visible-one" in body


def test_js_uses_text_content_for_category_labels():
    src = TEMPLATE.read_text(encoding="utf-8")
    seg = src[src.index("BL-43: category filter + severity sort"):src.index("Filter & summary logic")]
    assert "innerHTML" not in seg
    assert "textContent" in seg


# ── browser (file://) ────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def browser_page():
    if sync_playwright is None:
        pytest.skip("Playwright not installed")
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="msedge", headless=True)
        except Exception as exc:
            pytest.skip(f"Playwright could not launch Microsoft Edge: {exc}")
        yield browser
        browser.close()


def _open(browser, tmp_path, findings, width=1200):
    f = tmp_path / "export.html"
    f.write_text(_render(findings), encoding="utf-8")
    ctx = browser.new_context(viewport={"width": width, "height": 900})
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(f.as_uri())
    pg.wait_for_selector(".finding-card")
    pg._errors = errors
    return pg


def _titles(pg):
    return pg.eval_on_selector_all(
        ".finding-card", "els => els.filter(e => e.style.display !== 'none')"
        ".map(e => e.querySelector('.finding-title').textContent)")


def _sevs(pg):
    return pg.eval_on_selector_all(
        ".finding-card", "els => els.filter(e => e.style.display !== 'none').map(e => e.dataset.sev)")


def test_browser_filter_sort_combine(browser_page, tmp_path):
    findings = [
        _f(1, "low", "IAM", "low-iam"),
        _f(2, "critical", "Network", "crit-net"),
        _f(3, "medium", "IAM", "med-iam"),
        _f(4, "info", "<b>Evil</b>", "info-evil <script>window.__x=1</script>"),
        _f(5, "high", "IAM", "high-iam"),
        _f(6, "high", "", "high-nocat"),
    ]
    pg = _open(browser_page, tmp_path, findings)
    try:
        # default order high -> low
        assert _sevs(pg) == ["critical", "high", "high", "medium", "low", "info"]
        assert "6 מתוך 6" in pg.inner_text("#result-count")
        # chips: All + 4 categories (incl. none), counts
        chips = pg.locator(".cat-chip-btn")
        assert chips.count() == 5
        assert "(6)" in chips.nth(0).inner_text()
        iam = pg.get_by_role("button", name=re.compile("^IAM"))
        assert "(3)" in iam.inner_text()
        # escaped category label rendered literally
        assert pg.locator(".cat-chip-btn", has_text="<b>Evil</b>").count() == 1
        assert pg.evaluate("window.__x") is None

        iam.click()
        assert iam.get_attribute("aria-pressed") == "true"
        assert _titles(pg) == ["high-iam", "med-iam", "low-iam"]
        assert "3 מתוך 6" in pg.inner_text("#result-count")

        # reverse sort after filtering
        pg.click("#sort-btn")
        assert _titles(pg) == ["low-iam", "med-iam", "high-iam"]
        assert pg.get_attribute("#sort-btn", "data-dir") == "asc"

        # AND with search
        pg.fill("#search-input", "med")
        assert _titles(pg) == ["med-iam"]
        # facet counts follow other filters
        assert "(1)" in iam.inner_text()
        # AND with severity select -> empty state
        pg.select_option("#severity-select", "critical")
        assert _titles(pg) == []
        assert pg.locator(".empty-state").count() == 1
        assert "0 מתוך 6" in pg.inner_text("#result-count")
        pg.select_option("#severity-select", "")
        pg.fill("#search-input", "")
        assert pg.locator(".empty-state").count() == 0

        # multi-select: add Network, then All resets
        pg.get_by_role("button", name=re.compile("^Network")).click()
        assert len(_titles(pg)) == 4
        pg.get_by_role("button", name=re.compile("^הכל")).click()
        assert len(_titles(pg)) == 6
        assert pg._errors == []
    finally:
        pg.context.close()


def test_browser_keyboard_operation(browser_page, tmp_path):
    pg = _open(browser_page, tmp_path, [_f(1, "low", "A", "a1"), _f(2, "high", "B", "b1")])
    try:
        pg.focus("#sort-btn")
        pg.keyboard.press("Enter")
        assert pg.get_attribute("#sort-btn", "data-dir") == "asc"
        pg.keyboard.press("Space")
        assert pg.get_attribute("#sort-btn", "data-dir") == "desc"
        b = pg.get_by_role("button", name=re.compile("^B"))
        b.focus()
        pg.keyboard.press("Space")
        assert _titles(pg) == ["b1"]
        assert b.get_attribute("aria-pressed") == "true"
    finally:
        pg.context.close()


def test_browser_large_export_and_narrow_viewport(browser_page, tmp_path):
    sevs = ["info", "low", "medium", "high", "critical"]
    cats = ["IAM — זהויות והרשאות", "רשת", "Storage " + "x" * 80, "Compute"]
    findings = [_f(i, sevs[i % 5], cats[i % 4], f"ממצא ארוך {i} " + "טקסט " * 20) for i in range(300)]
    pg = _open(browser_page, tmp_path, findings, width=360)
    try:
        assert len(_titles(pg)) == 300
        order = [["critical", "high", "medium", "low", "info"].index(s) for s in _sevs(pg)]
        assert order == sorted(order)
        pg.get_by_role("button", name=re.compile("^רשת")).click()
        assert len(_titles(pg)) == 75
        # no horizontal overflow at 360px
        assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
        assert pg._errors == []
    finally:
        pg.context.close()
