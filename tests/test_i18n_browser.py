"""Optional browser test: DOM re-render on a mid-session language toggle (BL-23 follow-ups).

Runs the real page in Playwright (Microsoft Edge) against a temporary COPY of the app on PORT 8765 with
a brand-new SQLite DB inside the temp copy. It never touches the working tree's instance/ DB, uploads
or port 8080. Skipped (with an explicit reason) only when Playwright, msedge, or port 8765 is unavailable.
"""
from __future__ import annotations

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
    tmp = Path(tempfile.mkdtemp(prefix="cspm-i18n-browser-"))
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
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(BASE + "/")
        pg.evaluate("localStorage.setItem('ui-lang', 'he'); localStorage.removeItem('cspm_report_autosave')")
        pg.reload()
        pg.wait_for_selector("#btn-lang-toggle")
        pg.page_errors = errors
        yield pg
        browser.close()


_SEED = """
async () => {
  const { state } = await import('/static/js/src/state.js');
  const f = await import('/static/js/src/findings.js');
  const ui = await import('/static/js/src/ui.js');
  state.findings.length = 0;
  for (let i = 1; i <= 3; i++) {
    state.findings.push({ id: 'F-' + i, title: 'Finding ' + i, severity: ['critical', 'high', 'low'][i - 1],
      category: 'Other', description: 'd', impact: 'i', technical: [], policies: [], recs: ['r'],
      priority: '', owner: 'o', exception: { active: false, reason: '' } });
  }
  f.renderFindingsTable();
  ui.renderDashboard();
  document.getElementById('tab-findings-list').click();
}
"""


def _caption(pg):
    return pg.inner_text("#findings-table-wrapper caption").strip()


def _first_sev_chip(pg):
    return pg.inner_text("#findings-table-wrapper tbody tr:first-child .severity-chip").strip()


def test_table_rerenders_on_language_toggle(page):
    page.evaluate(_SEED)
    page.wait_for_selector("#findings-table-wrapper caption")
    # Hebrew default, unchanged strings
    assert _caption(page) == "1–3 מתוך 3"
    assert _first_sev_chip(page) == "קריטי"

    page.click("#btn-lang-toggle")  # he -> en, mid-session, no reload
    page.wait_for_function("document.querySelector('#findings-table-wrapper caption').innerText.includes(' of ')")
    assert _caption(page) == "1–3 of 3"
    assert _first_sev_chip(page) == "Critical"
    assert page.get_attribute("html", "lang") == "en"
    assert page.get_attribute("html", "dir") == "ltr"

    page.click("#btn-lang-toggle")  # en -> he
    page.wait_for_function("document.querySelector('#findings-table-wrapper caption').innerText.includes('מתוך')")
    assert _caption(page) == "1–3 מתוך 3"
    assert _first_sev_chip(page) == "קריטי"
    assert page.get_attribute("html", "dir") == "rtl"
    assert not page.page_errors, page.page_errors


def test_dashboard_recent_findings_rerender(page):
    page.evaluate(_SEED)
    if page.get_attribute("html", "lang") != "he":
        page.click("#btn-lang-toggle")
    page.evaluate("document.getElementById('tab-dashboard') && document.getElementById('tab-dashboard').click()")
    assert "קריטי" in page.inner_text("#dashboard-recent-findings")
    page.click("#btn-lang-toggle")
    page.wait_for_function("document.documentElement.lang === 'en'")
    text = page.inner_text("#dashboard-recent-findings")
    assert "critical" in text.lower() and "severity" in text.lower() and "קריטי" not in text
    page.click("#btn-lang-toggle")


def _open_reason_dialog(page):
    page.evaluate(_SEED)
    page.evaluate("document.getElementById('tab-findings-list').click()")
    page.click("#findings-table-wrapper tbody tr:first-child td:nth-child(3)")
    page.wait_for_selector("#findings-detail-content", state="visible")
    page.evaluate("document.getElementById('btn-detail-exception').click()")
    page.wait_for_selector("#detail-exception-dialog", state="visible")


def test_reason_dialog_focus_after_toggle(page):
    if page.get_attribute("html", "lang") != "he":
        page.click("#btn-lang-toggle")
    _open_reason_dialog(page)
    page.fill("#detail-exception-reason-input", "typed reason")

    # Focus inside the dialog (the Cancel button) -> moves to the textarea; content and dialog survive
    page.focus("#btn-exception-cancel")
    page.evaluate("document.getElementById('btn-lang-toggle').dispatchEvent(new MouseEvent('click', {bubbles: true}))")
    page.wait_for_function("document.documentElement.lang === 'en'")
    assert page.is_visible("#detail-exception-dialog")
    assert page.input_value("#detail-exception-reason-input") == "typed reason"
    assert page.evaluate("document.activeElement.id") == "detail-exception-reason-input"

    # Focus outside the dialog -> unchanged
    page.focus("#findings-search")
    page.evaluate("document.getElementById('btn-lang-toggle').dispatchEvent(new MouseEvent('click', {bubbles: true}))")
    page.wait_for_function("document.documentElement.lang === 'he'")
    assert page.is_visible("#detail-exception-dialog")
    assert page.input_value("#detail-exception-reason-input") == "typed reason"
    assert page.evaluate("document.activeElement.id") == "findings-search"
    assert not page.page_errors, page.page_errors


# ── Dashboard English leftovers + dimmed-row ID contrast (BL-23 follow-ups, round 3) ──

_HEB = "[֐-׿]"

_SEED_DASH = """
async (withExc) => {
  const { state } = await import('/static/js/src/state.js');
  const f = await import('/static/js/src/findings.js');
  const ui = await import('/static/js/src/ui.js');
  state.findings.length = 0;
  const sev = ['critical', 'high', 'medium', 'low'];
  for (let i = 1; i <= 4; i++) {
    state.findings.push({ id: 'F-' + i, title: 'Finding ' + i, severity: sev[i - 1], category: 'CSPM',
      description: 'd', impact: 'i', technical: [], policies: [], recs: ['r'], priority: '', owner: 'o',
      exception: { active: withExc && i === 2, reason: withExc && i === 2 ? 'r' : '' } });
  }
  document.getElementById('report-risk').value = 'גבוהה';
  f.renderFindingsTable();
  ui.renderDashboard();
}
"""

_EMPTY_DASH = """
async () => {
  const { state } = await import('/static/js/src/state.js');
  const f = await import('/static/js/src/findings.js');
  const ui = await import('/static/js/src/ui.js');
  state.findings.length = 0;
  document.getElementById('report-risk').value = '';
  f.renderFindingsTable();
  ui.renderDashboard();
}
"""


def _to_he(page):
    if page.get_attribute("html", "lang") != "he":
        page.click("#btn-lang-toggle")
        page.wait_for_function("document.documentElement.lang === 'he'")


def _dash_text(page):
    parts = page.evaluate("""() => [
        ...['dashboard-donut', 'dashboard-risk-summary', 'dashboard-categories', 'dashboard-recent-findings']
            .map(i => document.getElementById(i).innerText),
        document.getElementById('dashboard-donut').innerHTML,
        document.getElementById('category-badges').innerText]""")
    return " | ".join(parts)


def test_dashboard_english_no_hebrew_and_live_toggle(page):
    import re
    _to_he(page)
    page.evaluate(_SEED_DASH, False)
    he = _dash_text(page)
    assert "תרשים עוגה לפי חומרה" in he and "4 ממצאים | 1 קריטיים | 1 גבוהים" in he
    assert "גבוהה" in he and "הכל" in page.inner_text("#category-badges")

    page.click("#btn-lang-toggle")  # he -> en, mid-session
    page.wait_for_function("document.documentElement.lang === 'en'")
    en = _dash_text(page)
    assert not re.search(_HEB, en), re.findall(_HEB + "+", en)
    assert "4 findings | 1 critical | 1 high" in en
    assert 'aria-label="Donut chart by severity"' in en
    assert "All" in page.inner_text("#category-badges")
    donut = page.inner_text("#dashboard-donut")
    assert "Critical 1" in donut and "Findings" in donut

    page.click("#btn-lang-toggle")  # en -> he, live
    page.wait_for_function("document.documentElement.lang === 'he'")
    assert _dash_text(page) == he  # Hebrew byte-identical after the round trip
    assert not page.page_errors, page.page_errors


def test_dashboard_empty_states_translate(page):
    import re
    _to_he(page)
    page.evaluate(_EMPTY_DASH)
    ids = ["dashboard-donut", "dashboard-categories", "dashboard-risk-summary", "dashboard-recent-findings"]
    he = [page.inner_text("#" + i) for i in ids]
    assert he[0] == "אין ממצאים" and he[1] == "אין נתונים" and he[3] == "אין ממצאים עדיין"
    assert he[2].startswith("לא הוגדר") and "0 ממצאים | 0 קריטיים | 0 גבוהים" in he[2]
    page.click("#btn-lang-toggle")
    page.wait_for_function("document.documentElement.lang === 'en'")
    en = [page.inner_text("#" + i) for i in ids]
    assert en[0] == "No findings" and en[1] == "No data" and en[3] == "No findings yet"
    assert en[2].startswith("Not set") and "0 findings | 0 critical | 0 high" in en[2]
    assert not re.search(_HEB, "".join(en))
    page.click("#btn-lang-toggle")
    page.wait_for_function("document.documentElement.lang === 'he'")


_CONTRAST_JS = """
() => {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const mix = (a, b, al) => a.slice(0, 3).map((v, i) => v * al + b[i] * (1 - al));
  const lum = (c) => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const behindOf = (el) => { let n = el; while (n) { const b = rgba(getComputedStyle(n).backgroundColor);
    if (b[3] === 1) return b.slice(0, 3); n = n.parentElement; } return [255, 255, 255]; };
  const measure = (td) => {
    const tr = td.closest('tr');
    const op = parseFloat(getComputedStyle(tr).opacity);
    const behind = behindOf(tr.parentElement);
    let rowBg = behind;
    for (const el of [td, tr]) { const b = rgba(getComputedStyle(el).backgroundColor);
      if (b[3] > 0) { rowBg = mix(b, behind, b[3]); break; } }
    const fg = rgba(getComputedStyle(td).color);
    const fgEff = mix(fg, behind, op), bgEff = mix(rowBg, behind, op);
    const a = lum(fgEff) + 0.05, b = lum(bgEff) + 0.05;
    return { color: getComputedStyle(td).color, ratio: Math.max(a, b) / Math.min(a, b), opacity: op };
  };
  const cells = [...document.querySelectorAll('#findings-table-wrapper tbody tr')].map(tr => measure(tr.querySelector('.finding-id-cell')));
  return cells;
}
"""


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_dimmed_row_id_cell_contrast_aa(page, theme):
    _to_he(page)
    page.evaluate(_SEED_DASH, True)
    page.evaluate("document.getElementById('tab-findings-list').click()")
    page.evaluate("t => { if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); "
                  "else document.documentElement.removeAttribute('data-theme'); }", theme)
    try:
        cells = page.evaluate(_CONTRAST_JS)
        assert len(cells) == 4
        dimmed = cells[1]
        print("DIMMED_ID_CONTRAST", theme, round(dimmed["ratio"], 2), dimmed["color"])
        assert dimmed["opacity"] == 0.65
        assert dimmed["ratio"] >= 4.5, dimmed
        # non-dimmed rows keep the base accent colour and full opacity
        accent = page.evaluate("""() => { const p = document.createElement('span');
            p.style.color = 'var(--accent)'; document.body.appendChild(p);
            const c = getComputedStyle(p).color; p.remove(); return c; }""")
        for i in (0, 2, 3):
            assert cells[i]["opacity"] == 1 and cells[i]["color"] == accent, (i, cells[i], accent)
    finally:
        page.evaluate("document.documentElement.removeAttribute('data-theme')")
