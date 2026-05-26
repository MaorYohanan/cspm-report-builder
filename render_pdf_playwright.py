from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from playwright.sync_api import sync_playwright


def build_header(meta: Dict[str, Any]) -> str:
    client = meta.get("client") or "__________"
    env = meta.get("env") or "__________"
    report_date = meta.get("reportDate") or "DD/MM/YYYY"
    consultant = meta.get("consultant") or ""
    team_name = meta.get("teamName") or "CSPM Report"

    return f"""
    <div style="width:100%; box-sizing:border-box; padding:0 15mm; font-family:Arial; font-size:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; color:#0b3c5d;">
        <div>
          <div style="font-weight:700; font-size:11px;">{team_name}</div>
          <div style="color:#64748b;">{client} · {env}</div>
        </div>
        <div style="text-align:left;">
          <div style="color:#64748b;">תאריך הדו״ח: {report_date}</div>
          <div style="font-weight:700;">{consultant}</div>
        </div>
      </div>
      <div style="border-bottom:1px solid #cbd5e1; margin-top:6px;"></div>
    </div>
    """



def build_footer(meta: Dict[str, Any]) -> str:
    report_date = meta.get("reportDate") or "DD/MM/YYYY"
    footer_text = meta.get("footerText") or ""
    return f"""
    <div style="width:100%; box-sizing:border-box; padding:0 15mm; font-family:Arial; font-size:10px;">
      <div style="border-top:1px solid #cbd5e1; margin-bottom:6px;"></div>
      <div style="display:flex; justify-content:space-between; align-items:center; color:#64748b;">
        <div>{footer_text}</div>
        <div>תאריך הדו״ח: {report_date}</div>
        <div>עמוד <span class="pageNumber"></span> מתוך <span class="totalPages"></span></div>
      </div>
    </div>
    """



def read_meta_from_json(json_path: Path) -> Dict[str, Any]:
    if not json_path.exists():
        return {}
    try:
        snapshot = json.loads(json_path.read_text(encoding="utf-8"))
        return (snapshot.get("meta") or {}) if isinstance(snapshot, dict) else {}
    except Exception:
        return {}


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def export_pdf(
    html_path: Path,
    pdf_path: Path,
    meta: Dict[str, Any],
    margin_top_mm: int = 60,
    margin_bottom_mm: int = 28,
) -> None:
    html_path = html_path.resolve()
    pdf_path = pdf_path.resolve()
    ensure_parent_dir(pdf_path)

    header = build_header(meta)
    footer = build_footer(meta)

    clean_print_css = r"""
    @media print {
      /* Don't print HTML-embedded header/footer (Playwright will handle header/footer) */
      .print-header, .print-footer { display: none !important; }

      html, body { height: auto !important; }
      body { margin: 0 !important; padding: 0 !important; overflow: visible !important; }

      /* Prevent clipping */
      .report-content, .page-section, .finding-card { overflow: visible !important; }

      /* Make print layout stable */
      .page-section { box-shadow: none !important; border-radius: 0 !important; }
      .page-section { break-after: page !important; page-break-after: always !important; }
      .page-section:last-child { break-after: auto !important; page-break-after: auto !important; }

      /* Cards */
      .finding-card { break-inside: auto !important; page-break-inside: auto !important; overflow: visible !important; }
      .finding-header { break-inside: avoid !important; page-break-inside: avoid !important; break-after: avoid !important; }
      .finding-section-title { break-after: avoid !important; page-break-after: avoid !important; }
      .finding-card li { break-inside: avoid !important; page-break-inside: avoid !important; }
    }
    """

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        page.goto(html_path.as_uri(), wait_until="load")
        page.add_style_tag(content=clean_print_css)

        page.pdf(
            path=str(pdf_path),
            format="A4",
            print_background=True,
            display_header_footer=True,
            header_template=header,
            footer_template=footer,
            margin={
                "top": f"{margin_top_mm}mm",
                "bottom": f"{margin_bottom_mm}mm",
                "left": "15mm",
                "right": "15mm",
            },
        )

        browser.close()


def pick_file_dialog(title: str, filetypes: tuple[tuple[str, str], ...]) -> Optional[Path]:
    """Windows-friendly file picker (works locally). Returns None if cancelled."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception:
        return None

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    path = filedialog.askopenfilename(title=title, filetypes=filetypes)
    root.destroy()
    return Path(path) if path else None


def pick_save_dialog(title: str, defaultextension: str, filetypes: tuple[tuple[str, str], ...]) -> Optional[Path]:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception:
        return None

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    path = filedialog.asksaveasfilename(
        title=title,
        defaultextension=defaultextension,
        filetypes=filetypes,
    )
    root.destroy()
    return Path(path) if path else None


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Render HTML report to PDF using Playwright/Chromium.")
    ap.add_argument("-i", "--input", type=str, help="Path to input HTML report.")
    ap.add_argument("-o", "--output", type=str, help="Path to output PDF file.")
    ap.add_argument("--state-json", type=str, default=None, help="Optional JSON snapshot (for header meta).")
    ap.add_argument("--top", type=int, default=50, help="Top margin in mm (space for header).")
    ap.add_argument("--bottom", type=int, default=28, help="Bottom margin in mm (space for footer).")
    ap.add_argument("--no-dialogs", action="store_true", help="Don't open file dialogs; require -i and -o.")
    return ap.parse_args()


def main() -> None:
    args = parse_args()

    html_path: Optional[Path] = Path(args.input) if args.input else None
    pdf_path: Optional[Path] = Path(args.output) if args.output else None

    if (not html_path or not html_path.exists()) and not args.no_dialogs:
        html_path = pick_file_dialog(
            title="בחר קובץ HTML לדו\"ח",
            filetypes=(("HTML files", "*.html"), ("All files", "*.*")),
        )

    if not html_path or not html_path.exists():
        print("ERROR: Input HTML not provided or not found. Use -i <file.html>", file=sys.stderr)
        sys.exit(1)

    if (not pdf_path) and not args.no_dialogs:
        pdf_path = pick_save_dialog(
            title="בחר שם/מיקום לשמירת PDF",
            defaultextension=".pdf",
            filetypes=(("PDF files", "*.pdf"), ("All files", "*.*")),
        )

    if not pdf_path:
        # default output next to input
        pdf_path = html_path.with_suffix(".pdf")

    meta: Dict[str, Any] = {}
    if args.state_json:
        meta = read_meta_from_json(Path(args.state_json))
    else:
        # Try common snapshot file next to HTML
        candidate = html_path.with_name("cspm_report_state.json")
        if candidate.exists():
            meta = read_meta_from_json(candidate)

    export_pdf(
        html_path=html_path,
        pdf_path=pdf_path,
        meta=meta,
        margin_top_mm=int(args.top),
        margin_bottom_mm=int(args.bottom),
    )
    print(f"OK -> {pdf_path}")


if __name__ == "__main__":
    main()
