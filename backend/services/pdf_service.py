"""
PDF Service - Handles PDF and HTML rendering for CSPM reports.

This service encapsulates the PDF generation logic using Playwright,
including header/footer templates and page splitting for long findings.

⚠️  CRITICAL — DO NOT CHANGE THESE VALUES WITHOUT UNDERSTANDING WHY:

  - page.pdf margin.top=30mm    → matches header HTML height (~14mm) plus gap
  - page.pdf margin.bottom=20mm → matches footer height plus gap
  - page.pdf margin.left/right=10mm → max content width (10mm, not 15mm)
  - MAX_PAGE_CARD_HEIGHT_PX=908 → early-return guard (card.offsetHeight, border-box)
                                   = 933.54px printable − 5px border-top − 15.12px padding-top
                                   − 5px safety, floor → 908
  - MAX_PACK_HEIGHT_PX=886      → per-chunk packer budget (getBoundingClientRect delta)
                                   = 933.54px − 20.12px section overhead − 22px card border+padding
                                   − 5px safety, floor → 886
  - page.emulate_media("print") → REQUIRED, without it @media print is ignored
  - .page-section padding-top: 4mm, padding-bottom: 0 in CLEAN_PRINT_CSS

  These two constants measure DIFFERENT things with DIFFERENT methods.
  Do not conflate them — swapping the methods produced the original bug.
  Changing any margin/padding value requires re-deriving both constants.
  Measured 2026-09-14 in print-emulated headless Chromium, viewport 720x900.
"""

from __future__ import annotations

import html
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
  .page-section { box-shadow: none !important; border-radius: 0 !important; padding-top: 4mm !important; }
  /* Reclaim the 45.35px (12mm) padding-bottom that the screen rule sets but the
     previous print reset did not clear. Reclaiming it restores ~45px of page budget
     per section and allows the card's margin-bottom to collapse out instead of
     consuming space. Section overhead is now: 5px border-top + 15.12px padding-top
     = 20.12px total — matching the derivation of MAX_PAGE_CARD_HEIGHT_PX and
     MAX_PACK_HEIGHT_PX in pdf_service.py. */
  .page-section { padding-bottom: 0 !important; }
  .page-section { break-after: page !important; page-break-after: always !important; }
  .page-section:last-child { break-after: auto !important; page-break-after: auto !important; }
  /* Findings intro: don't force page break after, so first finding shares the page */
  .findings-intro { break-after: auto !important; page-break-after: auto !important; }
  .findings-intro + .finding-page { break-before: auto !important; page-break-before: auto !important; }
  /* Keep section headings and their intro paragraph glued to the table that
     follows. The break we need to suppress is INTERNAL to .section-intro,
     between its child siblings — not after the section itself. */
  .section-intro h1,
  .section-intro h2,
  .section-intro p { break-after: avoid !important; page-break-after: avoid !important; }
  .finding-page { padding-top: 4mm !important; }
  /* Category heading: keep heading with the first card on the same page */
  .finding-category-header { break-after: avoid !important; page-break-after: avoid !important; }
  /* Force a page break after each continuation section so Chromium does not
     flow continuation content onto the same physical page as the next finding.
     No :not(:last-child) guard is needed: .page-section:last-child (specificity
     0,2,0) overrides this rule (specificity 0,1,0) via the CSS cascade when an
     element is both .finding-continuation and :last-child — even with !important,
     the higher-specificity declaration wins. */
  .finding-continuation { break-after: page !important; page-break-after: always !important; }
  /* Cards now pre-split, each chunk fits on one page */
  /* break-inside without !important lets Chromium override for genuinely tiny chunks */
  .finding-card { break-inside: avoid; page-break-inside: avoid; overflow: visible !important; overflow-wrap: break-word !important; word-break: break-word !important; }
  .finding-header { break-inside: avoid !important; page-break-inside: avoid !important; break-after: avoid !important; }
  .finding-section-title { break-before: avoid !important; page-break-before: avoid !important; break-after: avoid !important; page-break-after: avoid !important; }
  .finding-card li { break-inside: avoid !important; page-break-inside: avoid !important; }
  .report-table tr {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  /* break-inside REMOVED: the treatment and appendix tables are taller than one
     page, making `avoid` unsatisfiable. Chromium first honours it by pushing the
     whole table to the next fragmentainer — stranding the heading and leaving a
     ~92% blank page — then breaks the table anyway. Row atomicity is preserved by
     the .report-table tr rule below; <thead> repeats automatically because
     Chromium defaults thead to display: table-header-group (CSS 2.1 §17.5.1). */
  .report-table { break-inside: auto; page-break-inside: auto; }
  .report-table thead { break-after: avoid !important; page-break-after: avoid !important; }
  .detail-box { overflow: visible !important; max-height: none !important; }
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
        client    = html.escape(meta.get("client") or "__________")
        env       = html.escape(meta.get("env") or "__________")
        report_date = html.escape(meta.get("reportDate") or "DD/MM/YYYY")
        consultant  = html.escape(meta.get("consultant") or "")
        team_name   = html.escape(meta.get("teamName") or "CSPM Report")

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
        report_date = html.escape(meta.get("reportDate") or "DD/MM/YYYY")
        footer_text = html.escape(meta.get("footerText") or "")

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
                            # Set viewport to printable A4 width (after 10mm left/right margins)
                            # so measurements match PDF.
                            page.set_viewport_size({"width": 720, "height": 900})
                            page.goto(html_path.as_uri(), wait_until="load", timeout=30000)
                            # Force print media so @media print rules apply
                            page.emulate_media(media="print")
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
                                // ──────────────────────────────────────────────────────────────
                                // HEIGHT CONSTANTS — empirically derived 2026-09-14
                                // Measured in print-emulated headless Chromium with CLEAN_PRINT_CSS
                                // injected, viewport 720x900, using getComputedStyle /
                                // getBoundingClientRect.
                                //
                                // Printable height (A4 297mm, 30mm top + 20mm bottom margin):
                                //   (297 - 50) mm x (96 / 25.4) px/mm = 933.54 px
                                //
                                // .page-section overhead (after reclaiming padding-bottom):
                                //   border-top:     5.00 px
                                //   padding-top:   15.12 px  (4mm)
                                //   padding-bottom: 0.00 px  (reclaimed via CLEAN_PRINT_CSS)
                                //   Total overhead = 20.12 px
                                //
                                // .finding-card border + padding: 22 px
                                //
                                // MAX_PAGE_CARD_HEIGHT_PX = 908
                                //   Measurement method: card.offsetHeight (border-box, excludes margins)
                                //   Derivation: 933.54 - 5 (border-top) - 15.12 (padding-top) = 913.42
                                //              minus 5 px safety, floor = 908
                                //
                                // MAX_PACK_HEIGHT_PX = 886
                                //   Measurement method: getBoundingClientRect delta (captures collapsed margins)
                                //   Derivation: 933.54 - 20.12 (section overhead) - 22 (card border+padding)
                                //              = 891.42, minus 5 px safety, floor = 886
                                //
                                // These two constants measure DIFFERENT things with DIFFERENT methods.
                                // Do not conflate them: swapping the methods was the original bug.
                                // A sum-of-offsetHeight approach would require subtracting 48.72 px
                                // (worst-case collapsed margin) as an extra pessimistic allowance;
                                // BCR-delta avoids that entirely.
                                // ──────────────────────────────────────────────────────────────

                                // MAX_PAGE_CARD_HEIGHT_PX: early-return guard.
                                // Measurement method: card.offsetHeight (border-box, excludes margins).
                                const MAX_PAGE_CARD_HEIGHT_PX = 908;

                                // MAX_PACK_HEIGHT_PX: per-chunk packer budget.
                                // Measurement method: getBoundingClientRect delta (captures collapsed margins).
                                const MAX_PACK_HEIGHT_PX = 886;

                                const MIN_CONTINUATION_HEIGHT_PX = 200;

                                const cards = document.querySelectorAll('.finding-card');
                                cards.forEach((card) => {
                                    // Early-return guard: card.offsetHeight (border-box) vs MAX_PAGE_CARD_HEIGHT_PX.
                                    if (card.offsetHeight <= MAX_PAGE_CARD_HEIGHT_PX) return;

                                    // Card is too tall — split into per-page sections.
                                    const parentSection = card.closest('.finding-page');
                                    if (!parentSection) return;

                                    const children = Array.from(card.children);
                                    const headerEl = children.find(
                                        c => c.classList.contains('finding-header')
                                    );
                                    if (!headerEl) return;

                                    const headerIdx = children.indexOf(headerEl);
                                    const afterHeader = children.slice(headerIdx + 1);

                                    // ── Collect all BCRs before any DOM mutation ──────────────
                                    // Layout is frozen: print emulation is active and
                                    // CLEAN_PRINT_CSS is applied. Reading BCRs now ensures
                                    // measurements match the layout being split. Any DOM
                                    // mutation after this point would invalidate rects — read
                                    // everything needed before touching the DOM.
                                    const bcrOf = new Map();
                                    children.forEach(el => bcrOf.set(el, el.getBoundingClientRect()));

                                    // ── Greedy BCR-delta packer ───────────────────────────────
                                    // Uses getBoundingClientRect delta (MAX_PACK_HEIGHT_PX) — not
                                    // offsetHeight sum — so inter-element collapsed margins are
                                    // automatically captured without a pessimistic allowance.
                                    const chunks = [];
                                    let currentChunk = [headerEl];
                                    let chunkFirstBcr = bcrOf.get(headerEl);

                                    afterHeader.forEach((el) => {
                                        const elBcr = bcrOf.get(el);

                                        // BCR-delta: distance from top of chunk's first element to
                                        // bottom of this element. Captures collapsed margins exactly.
                                        //
                                        // First-element case (explicit branch): when currentChunk is
                                        // empty, this element IS the chunk's first child and the
                                        // delta is just its own height — there is no prior
                                        // first-child top to subtract from. Written as an explicit
                                        // branch so the intention is clear, not relying on
                                        // arithmetic falling out of a null chunkFirstBcr.
                                        let delta;
                                        if (currentChunk.length === 0) {
                                            // First-child case: delta equals the element's own height.
                                            delta = elBcr.height;
                                        } else {
                                            // General case: BCR-delta from chunk start to element bottom.
                                            // Pairs with MAX_PACK_HEIGHT_PX (BCR-delta method).
                                            delta = elBcr.bottom - chunkFirstBcr.top;
                                        }

                                        if (delta > MAX_PACK_HEIGHT_PX) {
                                            // Avoid orphaned section title at page bottom:
                                            // carry it forward to the next page.
                                            const last = currentChunk[currentChunk.length - 1];
                                            if (last && last.classList.contains('finding-section-title')) {
                                                currentChunk.pop();
                                                chunks.push(currentChunk);
                                                currentChunk = [last, el];
                                                chunkFirstBcr = bcrOf.get(last);
                                            } else {
                                                chunks.push(currentChunk);
                                                currentChunk = [el];
                                                chunkFirstBcr = elBcr;
                                            }
                                        } else {
                                            currentChunk.push(el);
                                        }
                                    });
                                    if (currentChunk.length) chunks.push(currentChunk);

                                    // ── Min-tail merge with capacity check ────────────────────
                                    // Only merge the short tail into the previous chunk if the
                                    // combined height stays within MAX_PACK_HEIGHT_PX (BCR-delta
                                    // method). Without this check, merging could push the
                                    // receiving chunk back over budget — recreating the overflow
                                    // the packer was meant to prevent.
                                    while (chunks.length > 1) {
                                        const lastChunk = chunks[chunks.length - 1];
                                        const prevChunk = chunks[chunks.length - 2];

                                        // Tail height via BCR-delta (consistent with packer method).
                                        const tailFirst  = lastChunk[0];
                                        const tailLast   = lastChunk[lastChunk.length - 1];
                                        const tailHeight = lastChunk.length === 1
                                            ? bcrOf.get(tailFirst).height
                                            : bcrOf.get(tailLast).bottom - bcrOf.get(tailFirst).top;

                                        if (tailHeight < MIN_CONTINUATION_HEIGHT_PX) {
                                            // Capacity check: only merge if the receiving chunk
                                            // has room. Uses BCR-delta from prev chunk's first
                                            // element to tail's last element.
                                            const prevFirst    = prevChunk[0];
                                            const mergedLast   = lastChunk[lastChunk.length - 1];
                                            const mergedHeight =
                                                bcrOf.get(mergedLast).bottom - bcrOf.get(prevFirst).top;

                                            if (mergedHeight <= MAX_PACK_HEIGHT_PX) {
                                                chunks[chunks.length - 2] = prevChunk.concat(lastChunk);
                                                chunks.pop();
                                            } else {
                                                // Merging would overflow the receiving chunk — leave tail.
                                                break;
                                            }
                                        } else {
                                            break;
                                        }
                                    }

                                    // ── No single-chunk bail-out ──────────────────────────────
                                    // The old code returned early here when chunks.length <= 1,
                                    // leaving oversized cards for Chromium to break naturally.
                                    // Those natural breaks produced sub-200 px spill pages
                                    // (e.g. p38/p42) because Chromium, not the splitter, chose
                                    // the break point.
                                    //
                                    // We now always proceed to section creation. A single-chunk
                                    // card gets one page-section finding-page (structurally
                                    // identical to the original), ensuring all cards that passed
                                    // MAX_PAGE_CARD_HEIGHT_PX are rebuilt consistently rather
                                    // than silently left for the browser's fragmenter.

                                    // Build page sections. Continuation pages carry no header —
                                    // content flows directly from where the previous page ended.
                                    const newCards = chunks.map((chunk, i) => {
                                        const newSection = document.createElement('section');
                                        newSection.className = i === 0
                                            ? 'page-section finding-page'
                                            : 'page-section finding-continuation';

                                        const newCard = document.createElement('div');
                                        newCard.className = 'finding-card';
                                        chunk.forEach(el => newCard.appendChild(el));
                                        newSection.appendChild(newCard);
                                        return newSection;
                                    });

                                    // Insert new sections before the original and remove
                                    // the original.
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
                                    "top": "30mm",
                                    "bottom": "20mm",
                                    "left": "10mm",
                                    "right": "10mm",
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
