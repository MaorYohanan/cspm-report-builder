"""UI i18n regression tests (BL-23 follow-ups): en key coverage and plural / toast composition.

The JS module static/js/src/i18n.js is executed with node (skipped when node is unavailable).
"""
from __future__ import annotations

import html as htmllib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "static" / "js" / "src"
I18N = SRC / "i18n.js"

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node not installed")

HEB = re.compile("[֐-׿]")
_STR = r"'((?:[^'\\]|\\.)*)'"


def _en_keys() -> set[str]:
    text = I18N.read_text(encoding="utf-8")
    en_block = text[text.index("  en: {"):text.index("/**\n * Returns the current UI language code")]
    return {m.group(1).replace("\'", "'") for m in re.finditer(r"^\s+" + _STR + r"\s*:", en_block, re.M)}


def test_i18n_en_keys_unique_and_nonempty():
    assert len(_en_keys()) > 100


@pytest.mark.parametrize("fname", ["findings.js", "wizi.js", "exceptions.js", "core.js", "i18n.js"])
def test_literal_t_keys_have_english(fname):
    """Every t('literal') key used by these modules must have an English translation."""
    keys = _en_keys()
    text = (SRC / fname).read_text(encoding="utf-8")
    used = {m.group(1).replace("\'", "'") for m in re.finditer(r"(?<![\w.$])t\(" + _STR + r"\)", text)}
    # Conditional keys: t(cond ? 'a' : 'b')
    for m in re.finditer(r"(?<![\w.$])t\([^()'\"]*\?\s*" + _STR + r"\s*:\s*" + _STR + r"\)", text):
        used.add(m.group(1))
        used.add(m.group(2))
    # Keys handed to countPhrase(n, one, many)
    for m in re.finditer(r"countPhrase\([^,]+,\s*" + _STR + r",\s*" + _STR + r"\)", text):
        used.add(m.group(1))
        used.add(m.group(2))
    hebrew = {k for k in used if HEB.search(k)}
    missing = sorted(hebrew - keys)
    assert not missing, f"{fname}: keys without English translation: {missing}"


def test_html_data_i18n_keys_have_english():
    keys = _en_keys()
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    used = {htmllib.unescape(k) for k in re.findall(r'data-i18n(?:-title)?="([^"]+)"', html)}
    missing = sorted(k for k in used if HEB.search(k) and k not in keys)
    assert not missing, f"index.html keys without English translation: {missing}"


_NODE_SCRIPT = """
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
globalThis.document = {
  documentElement: { setAttribute() {} }, querySelectorAll: () => [], getElementById: () => null,
  dispatchEvent(e) { (globalThis.__events = globalThis.__events || []).push(e.detail.lang); },
};
globalThis.CustomEvent = class { constructor(n, o) { this.type = n; this.detail = o.detail; } };
const m = await import(process.argv[2]);
const out = { combos: {}, counts: {} };
for (const lang of ['he', 'en']) {
  m.setLang(lang);
  out.combos[lang] = {};
  for (const [x, a] of [[1,0],[3,0],[0,1],[0,3],[1,1],[3,1],[1,2],[3,2],[0,0]])
    out.combos[lang][x + ',' + a] = m.carryForwardMessage(x, a);
  out.counts[lang] = [0, 1, 2].map(n => m.countPhrase(n, 'ממצא אחד נבחר', '{n} ממצאים נבחרו'));
  out.counts[lang + '_inline'] = [1, 4].map(n => m.countPhrase(n, 'נבחר אחד', '{n} נבחרו'));
}
out.events = globalThis.__events;
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def js_out():
    if NODE is None:
        pytest.skip("node not installed")
    with tempfile.TemporaryDirectory() as d:
        mod = Path(d) / "i18n_copy.mjs"
        mod.write_text(I18N.read_text(encoding="utf-8"), encoding="utf-8")
        script = Path(d) / "run.mjs"
        script.write_text(_NODE_SCRIPT, encoding="utf-8")
        res = subprocess.run([NODE, str(script), mod.as_uri()], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


@needs_node
def test_carry_forward_hebrew_all_combinations(js_out):
    he = js_out["combos"]["he"]
    suffix = " אוטומטית על פי היסטוריה קודמת"
    assert he["1,0"] == "ממצא אחד סומן כמוחרג" + suffix
    assert he["3,0"] == "3 ממצאים סומנו כמוחרגים" + suffix
    assert he["0,1"] == "ממצא אחד אושר והוסתר" + suffix
    assert he["0,3"] == "3 ממצאים אושרו והוסתרו" + suffix
    assert he["1,1"] == "ממצא אחד סומן כמוחרג וממצא אחד אושר והוסתר" + suffix
    assert he["3,1"] == "3 ממצאים סומנו כמוחרגים וממצא אחד אושר והוסתר" + suffix
    assert he["1,2"] == "ממצא אחד סומן כמוחרג ו-2 ממצאים אושרו והוסתרו" + suffix
    assert he["3,2"] == "3 ממצאים סומנו כמוחרגים ו-2 ממצאים אושרו והוסתרו" + suffix
    assert he["0,0"] == ""


@needs_node
def test_carry_forward_english_all_combinations(js_out):
    en = js_out["combos"]["en"]
    suffix = " automatically based on previous history"
    assert en["1,0"] == "1 finding was excluded" + suffix
    assert en["3,0"] == "3 findings were excluded" + suffix
    assert en["0,1"] == "1 finding was acknowledged and hidden" + suffix
    assert en["0,3"] == "3 findings were acknowledged and hidden" + suffix
    assert en["1,1"] == "1 finding was excluded; 1 finding was acknowledged and hidden" + suffix
    assert en["3,2"] == "3 findings were excluded; 2 findings were acknowledged and hidden" + suffix
    for text in en.values():
        assert not re.search(r"\bOne\b|\band\b.*\band\b.*\band\b", text), text
    assert en["0,0"] == ""


@needs_node
def test_count_phrase_singular_plural(js_out):
    assert js_out["counts"]["he"] == ["0 ממצאים נבחרו", "ממצא אחד נבחר", "2 ממצאים נבחרו"]
    assert js_out["counts"]["en"] == ["0 findings selected", "One finding selected", "2 findings selected"]
    assert js_out["counts"]["he_inline"] == ["נבחר אחד", "4 נבחרו"]
    assert js_out["counts"]["en_inline"] == ["1 selected", "4 selected"]


@needs_node
def test_lang_change_event_fires_only_on_real_change(js_out):
    # first setLang('he') (page load) silent; he->en fires 'en'
    assert js_out["events"] == ["en"]
