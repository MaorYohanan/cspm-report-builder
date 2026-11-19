"""BL-41 (pipeline product name -> product timeline) and BL-42 (finding edit save/cancel -> findings list).

Source-level guards always run; the browser tests drive the real page in Playwright (Microsoft Edge)
against a temporary COPY of the app on PORT 8766 with a brand-new SQLite DB inside the copy. They never
touch the working tree's instance/ DB or port 8080, and skip with an explicit reason when Playwright,
msedge, or the port is unavailable.
"""
from __future__ import annotations

import os
import re
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
JS = ROOT / "static" / "js" / "src"
PORT = 8766
BASE = f"http://127.0.0.1:{PORT}"

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

_COPY_ITEMS = ["app.py", "index.html", "alembic.ini", "backend", "static", "templates", "migrations", "services", "blueprints"]


def _src(name: str) -> str:
    return (JS / name).read_text(encoding="utf-8")


# ── source-level guards ──────────────────────────────────────────────────────

def test_pipeline_name_is_real_button_with_escaped_values_and_no_inline_handler():
    s = _src("pipeline.js")
    m = re.search(r"<button type=\"button\" class=\"pipeline-product-link\"[^;]*", s)
    assert m, "product name must render as a real <button class=pipeline-product-link>"
    tag = m.group(0)
    assert "_esc(p.name)" in tag and "_esc(p.id)" in tag
    assert "aria-label" in tag and "tFormat(" in tag
    assert "onclick" not in tag
    assert "ProductsPanel.openTimelineById(" in s


def test_open_timeline_helper_uses_switch_to_tab_and_handles_unknown_id():
    s = _src("products.js")
    body = s[s.index("openTimelineById: function"):]
    body = body[:body.index("_loadProductAndEdit")]
    assert "switchToTab('tab-products')" in body
    assert "404" in body and "showToast(" in body
    assert "t('המוצר לא נמצא')" in body


def test_edit_save_and_cancel_return_to_findings_without_touching_filters():
    s = _src("findings.js")
    fn = s[s.index("export function returnToFindingsAfterEdit"):]
    fn = fn[:fn.index("export function startEditFinding")]
    assert "switchToTab('tab-findings-list')" in fn
    assert "findings-filter" not in fn and "renderFindingsTable" not in fn   # filters are not re-initialised
    # save (edit branch only) and cancel both return; add-new branch has no return call
    save = s[s.index("export function handleAddOrUpdateFinding"):s.index("addBtn.addEventListener('click', handleAddOrUpdateFinding)")]
    assert save.count("returnToFindingsAfterEdit()") == 1
    assert save.index("wasEdit = true") < save.index("returnToFindingsAfterEdit()")
    cancel = s[s.index("cancelEditBtn.addEventListener('click'"):]
    assert "returnToFindingsAfterEdit()" in cancel[:300]


def test_new_strings_have_english():
    s = _src("i18n.js")
    for key in ("פתח היסטוריית גרסאות של {name}", "המוצר לא נמצא"):
        assert f"'{key}':" in s


# ── browser tests ────────────────────────────────────────────────────────────

def _port_free() -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", PORT)) != 0


@pytest.fixture(scope="module")
def server():
    if sync_playwright is None:
        pytest.skip("browser test skipped: the 'playwright' Python package is not installed")
    if not _port_free():
        pytest.skip(f"browser test skipped: port {PORT} is already in use")
    tmp = Path(tempfile.mkdtemp(prefix="cspm-bl41-42-"))
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
                pytest.fail(f"temp copy of the app exited during start-up (port {PORT})")
            try:
                urllib.request.urlopen(BASE + "/", timeout=2).read(1)
                break
            except Exception:
                time.sleep(0.5)
        else:
            pytest.fail(f"temp copy of the app did not become ready on port {PORT} within 40s")
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
        except Exception as exc:
            pytest.skip(f"browser test skipped: Playwright could not launch Microsoft Edge: {exc}")
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


EVIL_NAME = 'Acme <b>"x"</b> & Co'


def _set_lang(page, lang):
    if page.get_attribute("html", "lang") != lang:
        page.click("#btn-lang-toggle")
        page.wait_for_function(f"document.documentElement.lang === '{lang}'")


def test_pipeline_name_opens_that_products_timeline_he_and_en(page):
    ids = []
    for name in (EVIL_NAME, "Other Product"):
        r = page.request.post(BASE + "/api/products", data={
            "name": name, "owner": "Owner", "ownerEmail": "o@example.com", "env": "Production",
            "subscriptionIds": ["sub-1"]})
        assert r.ok, r.text()
        ids.append(r.json()["id"])
    for lang in ("he", "en"):
        page.evaluate(f"localStorage.setItem('ui-lang', '{lang}')")
        page.reload()
        page.wait_for_selector("#btn-lang-toggle")
        page.click("#tab-pipeline")
        page.wait_for_selector(".pipeline-product-link")
        btn = page.locator(f'.pipeline-product-link[data-product-id="{ids[0]}"]')
        assert btn.inner_text().strip() == EVIL_NAME            # escaped, shown literally
        label = btn.get_attribute("aria-label")
        assert EVIL_NAME in label
        assert ("Open version history of" in label) if lang == "en" else ("פתח היסטוריית" in label)
        btn.focus()
        page.keyboard.press("Enter")                              # real <button>: keyboard activation
        page.wait_for_selector("#tab-products.active")
        page.wait_for_selector("#products-panel-content .timeline-header")
        assert EVIL_NAME in page.inner_text("#products-panel-content .timeline-header")
        assert page.get_attribute('.sidebar-section-label[data-section="nav-products"]', "aria-expanded") == "true"
        assert page.evaluate("localStorage.getItem('cspm_active_tab')") == "tab-products"
        assert "Other Product" not in page.inner_text("#products-panel-content .timeline-header")
    assert not page.page_errors, page.page_errors


def test_unknown_product_id_shows_toast_and_stays_put(page):
    page.evaluate("localStorage.setItem('ui-lang', 'en')")
    page.reload()
    page.wait_for_selector("#btn-lang-toggle")
    page.click("#tab-pipeline")
    ok = page.evaluate("""async () => {
      const { ProductsPanel } = await import('/static/js/src/products.js');
      return await ProductsPanel.openTimelineById('no-such-product');
    }""")
    assert ok is False
    page.wait_for_function("document.body.innerText.includes('Product not found')")
    assert page.evaluate("document.getElementById('tab-pipeline').classList.contains('active')")
    assert not page.page_errors, page.page_errors


_SEED = """
async () => {
  const { state } = await import('/static/js/src/state.js');
  const f = await import('/static/js/src/findings.js');
  state.findings.length = 0;
  for (let i = 1; i <= 60; i++) {
    state.findings.push({ id: 'F-' + i, title: 'Finding ' + i, severity: i % 2 ? 'high' : 'low',
      category: 'Other', description: 'd', impact: 'i', technical: [], policies: [], recs: ['r'],
      priority: '', owner: 'o', exception: { active: false, reason: '' } });
  }
  state.editingIndex = null;
  f.renderFindingsTable();
  document.getElementById('tab-findings-list').click();
}
"""

_SCROLL = "document.querySelector('.findings-list-scroll').scrollTop"


def _prepare_list(page):
    page.evaluate("localStorage.setItem('ui-lang', 'he')")
    page.reload()
    page.wait_for_selector("#btn-lang-toggle")
    page.evaluate(_SEED)
    page.wait_for_selector("#findings-table-wrapper tbody tr")
    page.select_option("#findings-filter-severity", "high")      # filter -> 30 rows
    page.evaluate("document.querySelector('.findings-list-scroll').scrollTop = 150")
    assert page.evaluate(_SCROLL) > 50


def _assert_back_on_list(page, expect_rows):
    assert page.evaluate("document.getElementById('tab-findings-list').classList.contains('active')")
    assert page.evaluate("document.getElementById('tab-finding-form').classList.contains('active')") is False
    assert page.input_value("#findings-filter-severity") == "high"                # filter kept
    assert page.locator("#findings-table-wrapper tbody tr").count() == expect_rows
    assert page.evaluate(_SCROLL) > 50                                             # scroll kept
    assert page.evaluate("import('/static/js/src/state.js').then(m => m.state.editingIndex)") is None
    assert page.inner_text("#edit-state").strip() == ""
    assert page.is_hidden("#btn-cancel-edit")


def test_edit_save_returns_to_list_via_keyboard_shortcut(page):
    _prepare_list(page)
    rows = page.locator("#findings-table-wrapper tbody tr").count()
    page.keyboard.press("j")                                  # J/K row navigation, then E = edit
    page.keyboard.press("j")
    page.evaluate("document.querySelector('.findings-list-scroll').scrollTop = 150")
    page.keyboard.press("e")
    page.wait_for_selector("#tab-finding-form.active")
    page.fill("#f-title", "Renamed via row")
    page.click("#btn-add-finding")
    page.wait_for_selector("#tab-findings-list.active")
    _assert_back_on_list(page, rows)
    assert page.evaluate("import('/static/js/src/state.js').then(m => m.state.findings[1].title)") == "Renamed via row"
    assert not page.page_errors, page.page_errors


def test_edit_cancel_and_save_return_via_detail_button_and_actions_menu(page):
    _prepare_list(page)
    rows = page.locator("#findings-table-wrapper tbody tr").count()
    page.click("#findings-table-wrapper tbody tr:nth-child(12) td:nth-child(3)")
    page.wait_for_selector("#findings-detail-content", state="visible")
    page.evaluate("document.getElementById('btn-detail-edit').click()")
    page.wait_for_selector("#tab-finding-form.active")
    page.click("#btn-cancel-edit")
    page.wait_for_selector("#tab-findings-list.active")
    _assert_back_on_list(page, rows)
    assert page.is_visible("#findings-detail-content")                              # selection kept
    page.evaluate("document.querySelector('.findings-list-scroll').scrollTop = 150")
    page.click("#btn-detail-actions")
    page.click("#detail-action-edit")
    page.wait_for_selector("#tab-finding-form.active")
    page.fill("#f-title", "Renamed via menu")
    page.click("#btn-add-finding")
    page.wait_for_selector("#tab-findings-list.active")
    _assert_back_on_list(page, rows)
    assert "Renamed via menu" in page.inner_text("#findings-detail-content")        # detail refreshed
    assert not page.page_errors, page.page_errors


def test_add_new_finding_behaviour_unchanged(page):
    _prepare_list(page)
    page.click("#tab-finding-form")
    page.wait_for_selector("#tab-finding-form.active")
    page.fill("#f-title", "Brand new")
    page.fill("#f-description", "d")
    page.click("#btn-add-finding")
    assert page.evaluate("document.getElementById('tab-finding-form').classList.contains('active')")  # stays on form
    assert page.evaluate("import('/static/js/src/state.js').then(m => m.state.findings.length)") == 61
    assert not page.page_errors, page.page_errors
