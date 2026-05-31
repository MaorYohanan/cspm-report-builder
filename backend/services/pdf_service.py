"""
PDF Service - Handles PDF and HTML rendering for CSPM reports.

This service encapsulates the PDF generation logic using Playwright,
including header/footer templates and page splitting for long findings.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Dict

from playwright.sync_api import sync_playwright, Error as PlaywrightError


class PDFService:
    """
    Service for rendering CSPM reports to PDF or HTML format.

    This service handles:
    - Building header and footer templates from metadata
    - Rendering HTML content to PDF using Playwright
    - Applying page break logic for long findings
    - Managing CSS for print layout
    """

    CLEAN_PRINT_CSS = r"""
/* Hide HTML header/footer unconditionally — Playwright provides its own */
.print-header, .print-footer {
  display: none !important;
  position: static !important;
  height: 0 !important;
  width: 0 !important;
  overflow: hidden !important;
  visibility: hidden !important;
  top: auto !important;
  bottom: auto !important;
  left: auto !important;
  right: auto !important;
}

@media print {
  html, body { height: auto !important; }
  body { margin: 0 !important; padding: 0 !important; overflow: visible !important; }
  .report-content, .page-section, .finding-card { overflow: visible !important; }
  .page-section { box-shadow: none !important; border-radius: 0 !important; padding-top:20mm !important; }
  .page-section { break-after: page !important; page-break-after: always !important; }
  .page-section:last-child { break-after: auto !important; page-break-after: auto !important; }
  /* Findings intro: don't force page break after, so first finding shares the page */
  .findings-intro { break-after: auto !important; page-break-after: auto !important; }
  .findings-intro + .finding-page { break-before: auto !important; page-break-before: auto !important; }
  .finding-page { padding-top: 20mm !important; }
  /* Cards now pre-split, each chunk fits on one page */
  .finding-card { break-inside: avoid !important; page-break-inside: avoid !important; overflow: visible !important; }
  .finding-header { break-inside: avoid !important; page-break-inside: avoid !important; break-after: avoid !important; }
  .finding-section-title { break-after: avoid !important; page-break-after: avoid !important; }
  .finding-card li { break-inside: avoid !important; page-break-inside: avoid !important; }
}
"""

    def __init__(self, template_dir: Path | str | None = None):
        """
        Initialize the PDF service.

        Args:
            template_dir: Optional path to template directory (currently unused,
                         reserved for future Jinja2 template support)
        """
        self.template_dir = Path(template_dir) if template_dir else None

    def _build_header(self, meta: Dict[str, Any]) -> str:
        """
        Build the PDF header HTML from metadata.

        Args:
            meta: Report metadata dictionary containing client, env, reportDate,
                 consultant, and teamName fields

        Returns:
            HTML string for the header template
        """
        client = meta.get("client") or "__________"
        env = meta.get("env") or "__________"
        report_date = meta.get("reportDate") or "DD/MM/YYYY"
        consultant = meta.get("consultant") or ""
        team_name = meta.get("teamName") or "CSPM Report"

        return f"""
    <div style="width:100%;box-sizing:border-box;padding:0 15mm;font-family:Arial;font-size:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;color:#0b3c5d;">
        <div>
          <div style="font-weight:700;font-size:11px;">{team_name}</div>
          <div style="color:#64748b;">{client} · {env}</div>
        </div>
        <div style="text-align:left;">
          <div style="color:#64748b;">תאריך הדו״ח: {report_date}</div>
          <div style="font-weight:700;">{consultant}</div>
        </div>
      </div>
      <div style="border-bottom:1px solid #cbd5e1;margin-top:6px;"></div>
    </div>"""

    def _build_footer(self, meta: Dict[str, Any]) -> str:
        """
        Build the PDF footer HTML from metadata.

        Args:
            meta: Report metadata dictionary containing reportDate and footerText fields

        Returns:
            HTML string for the footer template
        """
        report_date = meta.get("reportDate") or "DD/MM/YYYY"
        footer_text = meta.get("footerText") or ""

        return f"""
    <div style="width:100%;box-sizing:border-box;padding:0 15mm;font-family:Arial;font-size:10px;">
      <div style="border-top:1px solid #cbd5e1;margin-bottom:6px;"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;color:#64748b;">
        <div>{footer_text}</div>
        <div>תאריך הדו״ח: {report_date}</div>
        <div>עמוד <span class="pageNumber"></span> מתוך <span class="totalPages"></span></div>
      </div>
    </div>"""

    def render_html(self, report_data: str, meta: Dict[str, Any]) -> str:
        """
        Render report data to HTML string.

        This is a pass-through method that returns the HTML as-is.
        Can be extended to support template rendering in the future.

        Args:
            report_data: HTML content string
            meta: Report metadata dictionary

        Returns:
            HTML string ready for rendering or conversion to PDF
        """
        return report_data

    def render_pdf(self, html_content: str, meta: Dict[str, Any]) -> bytes:
        """
        Render HTML content to PDF bytes using Playwright.

        This method:
        1. Writes HTML to a temporary file
        2. Launches a Chromium browser instance
        3. Loads the HTML and applies print CSS
        4. Splits long finding cards across pages
        5. Generates PDF with custom headers/footers

        Args:
            html_content: Full HTML report content
            meta: Report metadata for header/footer generation

        Returns:
            PDF file content as bytes

        Raises:
            RuntimeError: If PDF generation fails at any step
        """
        browser = None
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                html_path = Path(tmpdir) / "report.html"
                pdf_path = Path(tmpdir) / "report.pdf"

                try:
                    html_path.write_text(html_content, encoding="utf-8")
                except Exception as e:
                    raise RuntimeError(f"Failed to write HTML file: {e}")

                header = self._build_header(meta)
                footer = self._build_footer(meta)

                try:
                    with sync_playwright() as p:
                        try:
                            browser = p.chromium.launch()
                        except PlaywrightError as e:
                            raise RuntimeError(
                                f"Failed to launch Chromium browser. "
                                f"Ensure Playwright is installed: {e}"
                            )
                        except Exception as e:
                            raise RuntimeError(f"Browser launch failed: {e}")

                        try:
                            page = browser.new_page()
                            # A4 viewport at 96 DPI: 794 x 1123 px.
                            # Set viewport to printable A4 width (after 15mm margins)
                            # so measurements match PDF.
                            page.set_viewport_size({"width": 720, "height": 900})
                            page.goto(html_path.as_uri(), wait_until="load", timeout=30000)
                            page.add_style_tag(content=self.CLEAN_PRINT_CSS)

                            # Remove HTML header/footer elements — Playwright provides its own
                            page.evaluate("""() => {
                                document.querySelectorAll('.print-header, .print-footer')
                                    .forEach(el => el.remove());
                            }""")

                            # Pre-render and measure: split long finding cards into
                            # multiple sections so each split chunk becomes a new section
                            # (with padding-top from CSS).
                            page.evaluate("""() => {
                                // Available content height per page in pixels.
                                // A4 = 297mm. Top margin 70mm + bottom 25mm = 95mm reserved.
                                // Printable: 297 - 95 = 202mm. At 96 DPI: 202mm * 3.78 = ~764px.
                                // Allow more height before splitting so we don't waste space.
                                const MAX_CARD_HEIGHT_PX = 950;

                                const cards = document.querySelectorAll('.finding-card');
                                cards.forEach((card) => {
                                    if (card.offsetHeight <= MAX_CARD_HEIGHT_PX) return;

                                    // Card is too tall — split at section boundaries
                                    const parentSection = card.closest('.finding-page');
                                    if (!parentSection) return;

                                    // Identify split boundaries: each finding-section-title
                                    // starts a logical block. Group siblings between section titles.
                                    const children = Array.from(card.children);
                                    const headerEl = children.find(
                                        c => c.classList.contains('finding-header')
                                    );
                                    if (!headerEl) return;

                                    // Build chunks: header + sections, where each chunk
                                    // fits on a page
                                    const chunks = [];
                                    let currentChunk = [headerEl];
                                    let currentHeight = headerEl.offsetHeight + 30; // approx padding

                                    // Iterate through children after the header
                                    const headerIdx = children.indexOf(headerEl);
                                    const afterHeader = children.slice(headerIdx + 1);

                                    // Group by section: each "finding-section-title" + content
                                    // until next title
                                    const sections = [];
                                    let currentSection = [];
                                    afterHeader.forEach((el) => {
                                        if (el.classList.contains('finding-section-title')
                                            && currentSection.length) {
                                            sections.push(currentSection);
                                            currentSection = [];
                                        }
                                        currentSection.push(el);
                                    });
                                    if (currentSection.length) sections.push(currentSection);

                                    // Pack sections into chunks
                                    sections.forEach((section) => {
                                        const sectionHeight = section.reduce(
                                            (h, el) => h + el.offsetHeight, 0
                                        );
                                        if (currentHeight + sectionHeight > MAX_CARD_HEIGHT_PX
                                            && currentChunk.length > 1) {
                                            chunks.push(currentChunk);
                                            currentChunk = [];
                                            currentHeight = 30; // reset, no header on continuation
                                        }
                                        currentChunk = currentChunk.concat(section);
                                        currentHeight += sectionHeight;
                                    });
                                    if (currentChunk.length) chunks.push(currentChunk);

                                    // If only one chunk, no split needed (just safety)
                                    if (chunks.length <= 1) return;

                                    // Get original finding info for continuation header
                                    const titleEl = card.querySelector('.finding-title');
                                    const idEl = card.querySelector('.finding-id');
                                    const sevEl = card.querySelector('.severity-badge');
                                    const titleText = titleEl ? titleEl.textContent : '';
                                    const idText = idEl ? idEl.textContent : '';
                                    const sevHTML = sevEl ? sevEl.outerHTML : '';

                                    // Replace the card with multiple chunked cards
                                    // in their own page-sections
                                    const newCards = chunks.map((chunk, i) => {
                                        const newSection = document.createElement('section');
                                        newSection.className = 'page-section finding-page';

                                        const newCard = document.createElement('div');
                                        newCard.className = 'finding-card';

                                        if (i === 0) {
                                            // First chunk: keep original header + content
                                            chunk.forEach(el => newCard.appendChild(el));
                                        } else {
                                            // Continuation chunks: add a "continued" header
                                            const contHeader = document.createElement('div');
                                            contHeader.className = 'finding-header';
                                            contHeader.innerHTML =
                                                '<div><div class="finding-title">' + titleText +
                                                ' <span style="font-size:11px;color:#6b7280;' +
                                                'font-weight:normal;">(המשך)</span></div>' +
                                                '<div class="finding-id">' + idText +
                                                '</div></div>' + sevHTML;
                                            newCard.appendChild(contHeader);
                                            chunk.forEach(el => newCard.appendChild(el));
                                        }

                                        newSection.appendChild(newCard);
                                        return newSection;
                                    });

                                    // Insert new sections before the original and remove
                                    // the original
                                    newCards.forEach(
                                        s => parentSection.parentNode.insertBefore(
                                            s, parentSection
                                        )
                                    );
                                    parentSection.remove();
                                });
                            }""")

                            page.pdf(
                                path=str(pdf_path),
                                format="A4",
                                print_background=True,
                                display_header_footer=True,
                                header_template=header,
                                footer_template=footer,
                                margin={
                                    "top": "70mm",
                                    "bottom": "25mm",
                                    "left": "15mm",
                                    "right": "15mm",
                                },
                            )
                        except PlaywrightError as e:
                            raise RuntimeError(f"PDF generation failed: {e}")
                        except Exception as e:
                            raise RuntimeError(f"Page rendering failed: {e}")
                        finally:
                            if browser:
                                try:
                                    browser.close()
                                except Exception:
                                    pass  # Best effort cleanup
                except RuntimeError:
                    raise  # Re-raise our custom errors
                except Exception as e:
                    raise RuntimeError(f"Playwright operation failed: {e}")

                try:
                    return pdf_path.read_bytes()
                except Exception as e:
                    raise RuntimeError(f"Failed to read generated PDF: {e}")
        except RuntimeError:
            raise  # Re-raise with context
        except Exception as e:
            raise RuntimeError(f"PDF rendering failed: {e}")
