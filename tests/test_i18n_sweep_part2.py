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
