"""UI i18n regression tests (BL-23 follow-ups).

* Static scan: every key used by t() / tFormat() / countPhrase() in static/js/src/*.js exists in the
  en dictionary (and resolves in he), and variable-keyed t(expr) calls are allowlisted with finite key sets.
* Execution: static/js/src/i18n.js is run with node for plural / toast composition. These tests FAIL
  (never skip) with a clear message when node is missing.
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

HEB = re.compile("[֐-׿]")
_STR = r"'((?:[^'\\]|\\.)*)'"


def test_node_is_available():
    """The plural / toast composition tests execute i18n.js with node. They must never skip silently."""
    assert NODE is not None, (
        "node was not found on PATH: install Node.js to run tests/test_i18n_ui.py "
        "(plural and carry-forward toast tests execute static/js/src/i18n.js)"
    )


def _unescape(raw: str) -> str:
    return raw.replace("\\'", "'")


def _dict_keys(start_marker: str, end_marker: str) -> set[str]:
    text = I18N.read_text(encoding="utf-8")
    block = text[text.index(start_marker):text.index(end_marker)]
    return {_unescape(m.group(1)) for m in re.finditer(r"^\s+" + _STR + r"\s*:", block, re.M)}


def _en_keys() -> set[str]:
    return _dict_keys("  en: {", "export const LANG_CHANGE_EVENT")


def _he_keys() -> set[str]:
    return _dict_keys("  he: {", "  en: {")


def test_i18n_en_keys_unique_and_nonempty():
    assert len(_en_keys()) > 100


# ── Static scan of t() / tFormat() / countPhrase() calls ──

def _scan_string(text: str, i: int) -> int:
    """Index just past the string literal that starts at text[i] (the quote character)."""
    q = text[i]
    i += 1
    while i < len(text):
        if text[i] == "\\":
            i += 2
            continue
        if text[i] == q:
            return i + 1
        i += 1
    return i


def _split_args(text: str, start: int) -> list[str]:
    """Top-level comma separated arguments of the call whose '(' sits at text[start - 1]."""
    args, depth, cur, i = [], 0, start, start
    while i < len(text):
        c = text[i]
        if c in "'\"`":
            i = _scan_string(text, i)
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                args.append(text[cur:i].strip())
                return args
            depth -= 1
        elif c == "," and depth == 0:
            args.append(text[cur:i].strip())
            cur = i + 1
        i += 1
    return args


def _literals(expr: str) -> list[str]:
    out, i = [], 0
    while i < len(expr):
        if expr[i] in "'\"`":
            j = _scan_string(expr, i)
            out.append(_unescape(expr[i + 1:j - 1]))
            i = j
        else:
            i += 1
    return out


def _top_level_qmark(expr: str) -> int:
    depth, i = 0, 0
    while i < len(expr):
        c = expr[i]
        if c in "'\"`":
            i = _scan_string(expr, i)
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == "?" and depth == 0:
            return i
        i += 1
    return -1


def _key_arg(expr: str):
    """(literal_keys, dynamic_expr_or_None) for one key-argument expression."""
    expr = expr.strip()
    if len(expr) >= 2 and expr[0] in "'\"" and _scan_string(expr, 0) == len(expr):
        return _literals(expr), None
    q = _top_level_qmark(expr)
    if q != -1:
        return _literals(expr[q + 1:]), None  # ternary: only the branches are keys
    return [], expr


def _scan_js(path: Path):
    text = path.read_text(encoding="utf-8")
    keys: set[str] = set()
    dynamic: set[str] = set()
    for m in re.finditer(r"(?<![\w.$])(t|tFormat|countPhrase)\(", text):
        args = _split_args(text, m.end())
        which = m.group(1)
        if which == "countPhrase":
            key_exprs = args[1:3] if len(args) >= 3 else []
        else:
            key_exprs = args[:1]
        for expr in key_exprs:
            if not expr:
                continue
            lits, dyn = _key_arg(expr)
            keys.update(lits)
            if dyn is not None:
                dynamic.add(dyn)
    return keys, dynamic


JS_FILES = sorted(SRC.glob("*.js"))


def _state_severity_texts() -> set[str]:
    text = (SRC / "state.js").read_text(encoding="utf-8")
    found = set(re.findall(r"text:\s*'([^']+)'", text))
    assert len(found) == 5, "state.js severityMap changed - update the i18n test"
    return found


def _wizi_sev_label_values() -> set[str]:
    text = (SRC / "wizi.js").read_text(encoding="utf-8")
    m = re.search(r"var sevLabel = \{([^}]*)\}", text)
    assert m, "wizi.js sevLabel map not found - update the i18n test allowlist"
    return set(re.findall(r":\s*'([^']+)'", m.group(1)))


def _findings_dismiss_keys() -> set[str]:
    text = (SRC / "findings.js").read_text(encoding="utf-8")
    out: set[str] = set()
    for name in ("ackKey", "excKey"):
        m = re.search(r"var " + name + r" = [^;]*\? " + _STR + r" : " + _STR + ";", text)
        assert m, f"findings.js {name} assignment not found - update the i18n test allowlist"
        out.update((_unescape(m.group(1)), _unescape(m.group(2))))
    return out


# Dynamic t(<expr>) calls that are allowed, each with the finite set of keys it can produce.
# Anything not listed fails test_no_unlisted_dynamic_t_calls: use a literal key, or add the expression
# and its key source here.
DYNAMIC_ALLOWED = {
    ("i18n.js", "key"): lambda: set(),       # t() / tFormat() own parameter
    ("i18n.js", "oneKey"): lambda: set(),    # countPhrase() own parameters; its callers are scanned
    ("i18n.js", "manyKey"): lambda: set(),
    ("findings.js", "ackKey"): _findings_dismiss_keys,
    ("findings.js", "excKey"): _findings_dismiss_keys,
    ("findings.js", "sev.text"): _state_severity_texts,
    ("ui.js", "sev.text"): _state_severity_texts,
    ("wizi.js", "sevInfo.text"): _state_severity_texts,
    ("wizi.js", "sevLabel[sev]"): _wizi_sev_label_values,
}


def _unresolved(keys: set[str], en: set[str], he: set[str]) -> list[str]:
    # The he dictionary is empty by design (the key IS the Hebrew text). A key without Hebrew letters
    # would render untranslated in he, so it must then be listed in he explicitly.
    return sorted(k for k in keys if k not in en or (k not in he and not HEB.search(k)))


@pytest.mark.parametrize("path", JS_FILES, ids=lambda p: p.name)
def test_literal_t_keys_exist_in_he_and_en(path):
    """Every literal key passed to t / tFormat / countPhrase resolves in both languages."""
    keys, _ = _scan_js(path)
    missing = _unresolved(keys, _en_keys(), _he_keys())
    assert not missing, f"{path.name}: t() keys missing from the en (or he) dictionary in i18n.js: {missing}"


@pytest.mark.parametrize("path", JS_FILES, ids=lambda p: p.name)
def test_no_unlisted_dynamic_t_calls(path):
    """Variable-keyed t(expr) calls cannot be checked statically: each must be allowlisted with its key set."""
    _, dynamic = _scan_js(path)
    unlisted = sorted(e for e in dynamic if (path.name, e) not in DYNAMIC_ALLOWED)
    assert not unlisted, (
        f"{path.name}: dynamic t(variable) calls {unlisted} - use literal keys or add the expression and "
        "its finite key set to DYNAMIC_ALLOWED in tests/test_i18n_ui.py"
    )
    en, he = _en_keys(), _he_keys()
    for expr in dynamic:
        keys = DYNAMIC_ALLOWED[(path.name, expr)]()
        missing = _unresolved(keys, en, he)
        assert not missing, f"{path.name}: t({expr}) can produce keys missing from en: {missing}"


def test_dynamic_allowlist_has_no_stale_entries():
    seen = set()
    for path in JS_FILES:
        _, dynamic = _scan_js(path)
        seen.update((path.name, e) for e in dynamic)
    stale = sorted(set(DYNAMIC_ALLOWED) - seen)
    assert not stale, f"DYNAMIC_ALLOWED entries no longer used in the JS: {stale}"


def test_scanner_self_check(tmp_path):
    """Guards the scanner itself so a regex regression cannot make the key tests vacuous."""
    f = tmp_path / "x.js"
    f.write_text(
        "t('א'); tFormat('ב {n}', {n: 1}); countPhrase(n, 'ג', 'ד {n}'); "
        "t(c === 'q' ? 'ה' : 'ו'); t(v); t[x]; foo.t('z'); t(a.b)",
        encoding="utf-8",
    )
    keys, dyn = _scan_js(f)
    assert keys == {"א", "ב {n}", "ג", "ד {n}", "ה", "ו"}
    assert dyn == {"v", "a.b"}


def test_html_data_i18n_keys_have_english():
    keys = _en_keys()
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    used = {htmllib.unescape(k) for k in re.findall(r'data-i18n(?:-title)?="([^"]+)"', html)}
    missing = sorted(k for k in used if HEB.search(k) and k not in keys)
    assert not missing, f"index.html keys without English translation: {missing}"


# ── Execution of i18n.js with node ──

_NODE_SCRIPT = """
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
globalThis.document = {
  documentElement: { setAttribute() {} }, querySelectorAll: () => [], getElementById: () => null,
  dispatchEvent(e) { (globalThis.__events = globalThis.__events || []).push(e.detail.lang); },
};
globalThis.CustomEvent = class { constructor(n, o) { this.type = n; this.detail = o.detail; } };
const m = await import(process.argv[2]);
const out = { combos: {}, counts: {}, fmt: {} };
for (const lang of ['he', 'en']) {
  m.setLang(lang);
  out.combos[lang] = {};
  for (const [x, a] of [[1,0],[3,0],[0,1],[0,3],[1,1],[3,1],[1,2],[3,2],[0,0]])
    out.combos[lang][x + ',' + a] = m.carryForwardMessage(x, a);
  out.counts[lang] = [0, 1, 2].map(n => m.countPhrase(n, 'ממצא אחד נבחר', '{n} ממצאים נבחרו'));
  out.counts[lang + '_inline'] = [1, 4].map(n => m.countPhrase(n, 'נבחר אחד', '{n} נבחרו'));
  out.fmt[lang] = {
    caption: m.tFormat('{a}–{b} מתוך {c}', { a: 1, b: 20, c: 57 }),
    note: m.tFormat('(מציג {a} מתוך {b})', { a: 3, b: 10 }),
    sev: m.t('קריטי'),
    del1: m.countPhrase(1, '1 ממצאים נמחקו', '{n} ממצאים נמחקו'),
    del5: m.countPhrase(5, '1 ממצאים נמחקו', '{n} ממצאים נמחקו'),
    dollar: m.tFormat('שגיאה בשיפור הניסוח: {e}', { e: "$& $1" }),
  };
}
out.events = globalThis.__events;
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def js_out():
    assert NODE is not None, "node was not found on PATH: install Node.js to run the i18n composition tests"
    with tempfile.TemporaryDirectory() as d:
        mod = Path(d) / "i18n_copy.mjs"
        mod.write_text(I18N.read_text(encoding="utf-8"), encoding="utf-8")
        script = Path(d) / "run.mjs"
        script.write_text(_NODE_SCRIPT, encoding="utf-8")
        res = subprocess.run([NODE, str(script), mod.as_uri()], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


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


def test_count_phrase_singular_plural(js_out):
    assert js_out["counts"]["he"] == ["0 ממצאים נבחרו", "ממצא אחד נבחר", "2 ממצאים נבחרו"]
    assert js_out["counts"]["en"] == ["0 findings selected", "One finding selected", "2 findings selected"]
    assert js_out["counts"]["he_inline"] == ["נבחר אחד", "4 נבחרו"]
    assert js_out["counts"]["en_inline"] == ["1 selected", "4 selected"]


def test_caption_severity_and_toast_keys_he_unchanged_en_translated(js_out):
    he, en = js_out["fmt"]["he"], js_out["fmt"]["en"]
    # Hebrew output must be byte-identical to the pre-i18n hard-coded strings
    assert he["caption"] == "1–20 מתוך 57"
    assert he["note"] == "(מציג 3 מתוך 10)"
    assert he["sev"] == "קריטי"
    assert he["del1"] == "1 ממצאים נמחקו" and he["del5"] == "5 ממצאים נמחקו"
    assert he["dollar"] == "שגיאה בשיפור הניסוח: $& $1"
    assert en["caption"] == "1–20 of 57"
    assert en["note"] == "(showing 3 of 10)"
    assert en["sev"] == "Critical"
    assert en["del1"] == "1 finding deleted" and en["del5"] == "5 findings deleted"
    assert en["dollar"] == "Error improving wording: $& $1"


def test_lang_change_event_fires_only_on_real_change(js_out):
    # first setLang('he') (page load) silent; he->en fires 'en'
    assert js_out["events"] == ["en"]
