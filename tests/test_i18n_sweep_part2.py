"""BL-36 Part 2 guard: user-facing sinks in wizi.js / pipeline.js / products.js / export.js
must not carry raw Hebrew string literals; they go through t() / tFormat() / countPhrase().

Only UI sinks are checked (toasts, confirm dialogs, status text, table headers, prompts,
tooltips, placeholders). Finding content, report/PDF template text and Gemini prompts are
intentionally Hebrew and live outside these sinks.
"""
import re
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parent.parent / "static" / "js" / "src"
FILES = ["wizi.js", "pipeline.js", "products.js", "export.js"]

HEBREW = re.compile(r"[֐-׿]")
# A line that writes to the UI.
SINK = re.compile(
    r"showToast\(|styledConfirm\(|\bprompt\(|statusMsg|StatusMsg|\.textContent\s*=|\.title\s*=|"
    r"<th>|<caption|placeholder=|title=\"|confirmText|cancelText|showAutosaveStatus\(|_showError\(|_stopWithError\("
)
WRAPPED = re.compile(r"\b(?:t|tFormat)\('(?:[^'\\]|\\.)*'|\b(?:t|tFormat)\(\"(?:[^\"\\]|\\.)*\"")

# (file, substring of the line) -> reason. Intentional leftovers inside sink lines.
ALLOWED = [
    ("products.js", "<th>כותרת ממצא</th>", "regression chapter inside the report/PDF HTML (report-language driven)"),
    ("products.js", "regression-trend", "TOC entry injected into the report/PDF HTML"),
    ("export.js", "golden5", "TOC entry injected into the report/PDF HTML"),
]


def _code_lines(name):
    for no, line in enumerate((SRC / name).read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
            continue
        yield no, line


@pytest.mark.parametrize("name", FILES)
def test_ui_sinks_have_no_raw_hebrew(name):
    offenders = []
    for no, line in _code_lines(name):
        if not SINK.search(line):
            continue
        rest = WRAPPED.sub("", line)
        if not HEBREW.search(rest):
            continue
        if any(f == name and sub in line for f, sub, _ in ALLOWED):
            continue
        offenders.append("%s:%d: %s" % (name, no, line.strip()[:140]))
    assert not offenders, "raw Hebrew in UI sinks (wrap in t()/tFormat()):\n" + "\n".join(offenders)


def test_modules_import_translation_helpers():
    for name in ["wizi.js", "pipeline.js", "products.js"]:
        text = (SRC / name).read_text(encoding="utf-8")
        assert re.search(r"import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*'\./i18n\.js'", text), name
        # no accidental duplicate import of the same helper
        assert len(re.findall(r"from\s*'\./i18n\.js'", text)) == 1, name


# ── Dialog / toast sinks across every UI module (BL-36 QA leftovers) ──────────
DIALOG_SINK = re.compile(r"\balert\(|\bconfirm\(|styledConfirm\(|showToast\(|confirmText|cancelText")
# admin.js drives the separate admin page, which is Hebrew-only by design (no i18n module).
DIALOG_EXCLUDED_FILES = {"admin.js"}


# t(cond ? 'he a' : 'he b') - both branches are keys, translated by the surrounding t().
TERNARY_WRAPPED = re.compile(r"\bt\([^()?]*\?\s*'(?:[^'\\]|\\.)*'\s*:\s*'(?:[^'\\]|\\.)*'\)")


def _dialog_offenders(name):
    offenders = []
    for no, line in _code_lines(name):
        if not DIALOG_SINK.search(line):
            continue
        rest = re.sub(r"countPhrase\([^)]*\)", "", WRAPPED.sub("", TERNARY_WRAPPED.sub("", line)))
        if HEBREW.search(rest):
            offenders.append("%s:%d: %s" % (name, no, line.strip()[:140]))
    return offenders


def test_dialog_and_toast_sinks_have_no_raw_hebrew_in_any_module():
    offenders = []
    for path in sorted(SRC.glob("*.js")):
        if path.name in DIALOG_EXCLUDED_FILES:
            continue
        offenders += _dialog_offenders(path.name)
    assert not offenders, "raw Hebrew in alert/confirm/toast sinks:\n" + "\n".join(offenders)


def test_dialog_scanner_flags_raw_alert(tmp_path):
    line = "alert('" + "אין" + "');"
    assert HEBREW.search(re.sub(r"countPhrase\([^)]*\)", "", WRAPPED.sub("", line)))
    ok = "alert(t('" + "אין" + "'));"
    assert not HEBREW.search(WRAPPED.sub("", ok))


def test_batch_delete_confirm_uses_shared_translated_helper():
    text = (SRC / "findings.js").read_text(encoding="utf-8")
    assert text.count("function confirmBatchDelete(") == 1
    assert text.count("confirmBatchDelete(indices.length)") == 2
    helper = text[text.index("function confirmBatchDelete("):]
    helper = helper[: helper.index("\n}\n")]
    for needle in ("tFormat(", "title: t(", "confirmText: t(", "cancelText: t("):
        assert needle in helper, needle


def test_smart_template_toast_and_download_links_are_translated():
    findings = (SRC / "findings.js").read_text(encoding="utf-8")
    start = findings.index("function t_filled()")
    block = findings[start: findings.index("templateSelect.addEventListener('change'", start)]
    assert "return t(" in block and "tFormat(" in block
    export = (SRC / "export.js").read_text(encoding="utf-8")
    assert "download>' + escapeHtml(t('" in export
    assert "download>הורד</a>" not in export


def test_ltr_progress_lines_restore_direction():
    css = (SRC.parent.parent / "css" / "src" / "ltr-overrides.css").read_text(encoding="utf-8")
    m = re.search(r'\[dir="ltr"\] \.sidebar-progress-label[^{]*\{([^}]*)\}', css)
    assert m and "direction: ltr" in m.group(1)
    built = (SRC.parent.parent / "css" / "builder.css").read_text(encoding="utf-8")
    assert '[dir="ltr"] .sidebar-progress-label' in built
