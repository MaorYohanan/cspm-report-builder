"""BL-40: build the findings XLSX workbook (server-side, openpyxl).

Column set and order follow the B.18 CSV export (Hebrew headers, no id).
Pure function: takes findings (already stripped of acknowledged ones by the
route) and returns the workbook bytes.  Nothing is written to disk.
"""
from __future__ import annotations

import io

from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

HEADERS = [
    "כותרת", "חומרה", "קטגוריה", "תיאור", "השפעה", "פרטים טכניים",
    "מדיניות", "המלצות", "עדיפות", "בעלים", "מוחרג", "סיבת חריג",
]
COLUMN_WIDTHS = [34, 12, 20, 50, 40, 50, 36, 50, 14, 18, 10, 36]

_SEVERITY_WEIGHT = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}

# (fill, font colour) per severity: light fills, dark text (contrast well above WCAG AA 4.5:1).
_SEVERITY_STYLE = {
    "critical": ("FEE2E2", "7F1D1D"),
    "high": ("FFEDD5", "9A3412"),
    "medium": ("FEF3C7", "78350F"),
    "low": ("DCFCE7", "14532D"),
    "info": ("E5E7EB", "374151"),
}

_FONT_NAME = "Arial"
_MAX_CELL_CHARS = 32000  # Excel hard limit is 32767
_FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")


def sanitize_cell_text(value) -> str:
    """Return text that is safe to store in a cell.

    - None -> ''
    - illegal XML control characters (which openpyxl rejects) are removed
    - values starting with = + - @ TAB CR get a leading apostrophe (OWASP CSV/formula
      injection guidance) so Excel never evaluates them
    - truncated to Excel's per-cell character limit
    """
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    text = ILLEGAL_CHARACTERS_RE.sub("", text)
    if text.startswith(_FORMULA_TRIGGERS):
        text = "'" + text
    return text[:_MAX_CELL_CHARS]


def _join(value) -> str:
    """Array fields: one item per line inside the cell (wrap text is on)."""
    if isinstance(value, (list, tuple)):
        return "\n".join(
            ILLEGAL_CHARACTERS_RE.sub("", i if isinstance(i, str) else str(i))
            for i in value if i is not None and i != ""
        )
    return "" if value is None else value


def _weight(finding: dict) -> int:
    return _SEVERITY_WEIGHT.get(str(finding.get("severity") or "").lower(), -1)


def build_findings_xlsx(findings: list) -> bytes:
    rows = [f for f in findings if isinstance(f, dict)]
    rows.sort(key=lambda f: -_weight(f))  # stable: critical -> info -> unknown

    wb = Workbook()
    ws = wb.active
    ws.title = "Findings"
    ws.sheet_view.rightToLeft = True

    thin = Side(style="thin", color="BFBFBF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    header_font = Font(name=_FONT_NAME, bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", start_color="1F3864", end_color="1F3864")
    body_font = Font(name=_FONT_NAME)

    ws.append(HEADERS)
    for c in ws[1]:
        c.font = header_font
        c.fill = header_fill
        c.border = border
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    for f in rows:
        exc = f.get("exception") if isinstance(f.get("exception"), dict) else {}
        active = bool(exc.get("active"))
        values = [
            f.get("title"), f.get("severity"), f.get("category"),
            f.get("description"), f.get("impact"),
            _join(f.get("technical")), _join(f.get("policies")), _join(f.get("recs")),
            f.get("priority"), f.get("owner"),
            "כן" if active else "לא",
            exc.get("reason"),
        ]
        ws.append([sanitize_cell_text(v) for v in values])
        row = ws[ws.max_row]
        for c in row:
            # Force string type: openpyxl would otherwise store '='-leading text as a formula.
            c.data_type = "s"
            c.font = body_font
            c.border = border
            c.alignment = Alignment(vertical="top", wrap_text=True, horizontal="right")
        style = _SEVERITY_STYLE.get(str(f.get("severity") or "").lower())
        if style:
            sev = row[1]
            sev.fill = PatternFill("solid", start_color=style[0], end_color=style[0])
            sev.font = Font(name=_FONT_NAME, bold=True, color=style[1])
            sev.alignment = Alignment(vertical="top", horizontal="center", wrap_text=True)

    for i, w in enumerate(COLUMN_WIDTHS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 24
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(HEADERS))}{max(ws.max_row, 2)}"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
