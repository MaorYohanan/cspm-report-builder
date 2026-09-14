# PDF Layout — Fragmentation Fix Branch (`fix/pdf-layout-fragmentation`)

---

## Authoritative Geometry — Corrected Figures (2026-09-14)

The table below was measured with the **repaired** harness (drawing-aware filter; commit
range up to `02fd203`).  Earlier figures in this branch's history came from two successive
broken instruments and must be disregarded; see "Instrument Faults" below.

| Snapshot | Pages | Spills | Near-blank |
|---|---|---|---|
| baseline | 68 | 5 | 2 |
| after_commit1 | 66 | 3 | 0 |
| after_commit2 | 67 | 2 | 1 |
| after_commit3 | 66 | 1 | 0 |
| after_border | 66 | 1 | 0 |

### Active gates (spills and near-blank; max-content-height retired)

- **Spill count** (content height < 150 pt): gate value **1** (p04, ~104.9 pt)
- **Near-blank count** (content < 50 pt OR > 90% blank): gate value **0**
- **Max-content-height**: **dropped as a gate**.  The metric sits at ~697.2 pt on every
  clean run of this template; any threshold either false-alarms or is trivially satisfied.
  The only actionable signal it carries is the 701.0 sentinel (see "Instrument Faults").

### Instrument faults — why earlier numbers in this branch are wrong

**Fault 1 — text-only measurement.**  The first harness measured `get_text("blocks")`
only.  Pages whose structure is carried by vector card borders (dark finding-card outlines)
appeared shorter than reality; page and spill counts were under-reported.

**Fault 2 — white-container saturation.**  The drawing-aware repair added
`get_drawings()` but did not filter white, unstroked background container rects.  A
full-height white rect (the page wrapper box) survived the filter and pinned every page's
`first_y` → TOP_MARGIN and `last_y` → BOT_MARGIN, collapsing `cont_h` to exactly
701.0 pt = BOT_MARGIN (786) − TOP_MARGIN (85) = USABLE_H.  This saturated
`max_h_pt` to 701.0 pt on all documents, masking all real variation.

**Working filter** (committed to `03_measure_pdf.py`):
`fill == (1,1,1) AND color is None (no stroke) AND width > 50% of page width`.
This drops page containers while keeping dark finding-card borders, which extend
measurements correctly beyond raw text extent.  If `max_content_height` ever reads
exactly **701.0 pt**, the filter has broken — treat it as an invalid run, not a
measurement.  (This sentinel is also documented as a code comment in
`03_measure_pdf.py`.)

---

## STATUS: SUPERSEDED — Analysis Contains Errors

This document was written before empirical measurement was done. All seven issues have since been addressed (commits `a4d0dd0`, `a7de68c`, `0ffcf85`, `ad7f99d` on branch `fix/pdf-layout-fragmentation`). The original analysis below contains at least six factual errors listed here so it is not mistaken for a correct diagnosis:

**1. Issues 1/2/3 root cause wrong — `break-after` on `.section-intro` is a guaranteed no-op.**
`.section-intro` is a `<section>` wrapper element. `break-after` governs the break _after the whole section_, but the orphan breaks were _internal_, between the `<h1>`, `<h2>`, and `<p>` children of that section. The actual fix was scoping the `break-after: avoid` rule to `.section-intro h1, .section-intro h2, .section-intro p`. Additionally, `.report-table` had `break-inside: avoid`, which is unsatisfiable on multi-page tables: Chromium pushes the entire table to the next fragmentainer (stranding the heading), then breaks it anyway. The fix changed `.report-table` to `break-inside: auto`.

**2. Code snippet misquotes live code.**
The Issue 6 orphan-protection block shown in this document includes `currentHeight = last.offsetHeight + elH + 20;` — the `+ 20` does not exist in the actual source.

**3. Issues 4/5/7 root cause wrong — the splitter was not at fault.**
The analysis blames the min-tail merge loop. The actual cause was the inflated height budget (`918px`) combined with the `if (chunks.length <= 1) return;` bail-out. The ~64px pages observed were Chromium natural breaks of cards the splitter chose not to split — not artifacts of the merge loop. The real fix was replacing the untraceable `918` with empirically-measured constants: `MAX_PAGE_CARD_HEIGHT_PX = 908` (guard, `offsetHeight`-based) and `MAX_PACK_HEIGHT_PX = 886` (packer, BCR-delta-based), and reclaiming the 45.35px `padding-bottom` leak.

**4. Issue 6 DOM description wrong.**
The analysis refers to `div.finding-section-content`. That selector has zero matches anywhere in the repository. The real element is a plain `<ul>`. The actual fix registered the generic `splitElement` descent for `UL` and `OL` nodes.

**5. `templates/report_template.html` is not in the PDF rendering path.**
`POST /api/render-pdf` takes client-supplied `html_content` built by `findings.js`. Any CSS edits made to `report_template.html` for PDF fixes were no-ops.

**6. `static/css/src/` contains no fragmentation CSS.**
All print CSS that Playwright sees is the `CLEAN_PRINT_CSS` string inside `pdf_service.py`. Edits to `static/css/src/` for PDF fragmentation were no-ops.

---

### What Was Actually Fixed (branch `fix/pdf-layout-fragmentation`)

| Commit | Change |
|--------|--------|
| `a4d0dd0` | Scoped `break-after: avoid` to `.section-intro h1, h2, p`; changed `.report-table` from `break-inside: avoid` to `break-inside: auto` |
| `a7de68c` | Replaced `MAX_CARD_HEIGHT_PX = 918` with `MAX_PAGE_CARD_HEIGHT_PX = 908` (guard) and `MAX_PACK_HEIGHT_PX = 886` (packer); reclaimed 45.35px `padding-bottom` budget leak |
| `0ffcf85` | Removed dead `.finding-continuation { break-after: page }` rule |
| `ad7f99d` | Registered generic `splitElement` descent for `UL`/`OL` so oversized list children are split instead of overflowing |

---

## ORIGINAL ANALYSIS (retained for reference — contains the errors noted above, do not use as a guide for further fixes)

---

## Tech Context

- **PDF CSS:** `backend/services/pdf_service.py` → `CLEAN_PRINT_CSS` string (inside `@media print {}`)
- **Card splitter JS:** `backend/services/pdf_service.py` → `page.evaluate()` block (~lines 235–315)
- **HTML builder:** `static/js/src/findings.js` → `buildReportHtml()`. No build step needed. After any change bump `?v=NNN` on the `main.js` import line in `index.html`.
- **Current values:** `MAX_CARD_HEIGHT_PX = 918`, `MIN_CONTINUATION_HEIGHT_PX = 200`
- **`.section-intro` class** was added in the previous fix batch; currently has `break-after: auto !important`

**Mandatory rule:** Each fix must be verified in the code BEFORE implementation (to confirm the plan is correct) and AFTER implementation (to confirm nothing else broke).

---

## Summary Table

| # | Pages | Description | Status | Fix location |
|---|-------|-------------|--------|--------------|
| 1 | 7→8 | "3.2 פילוח לפי קטגוריה" heading orphaned from table | NOT FIXED | `pdf_service.py` CLEAN_PRINT_CSS |
| 2 | 40 | "5. המלצות ותכנית טיפול" heading alone on page | NOT FIXED | Same CSS change as #1 |
| 3 | 43→44 | "נספח א'" heading orphaned from policy table | NOT FIXED | Same CSS change as #1 |
| 4 | 12 | CSPM-001 sparse continuation (improved: was 3 pages, now 2) | PARTIAL | `pdf_service.py` card splitter |
| 5 | 10 | EOLM-001 sparse continuation (1 bullet + priority alone) | NOT FIXED | Same splitter fix as #4 |
| 6 | 28,30,32,34,36,38 | EAPM findings: large whitespace on first page, recommendations on next | NOT FIXED | `pdf_service.py` card splitter |
| 7 | 39 | EAPM-010 sparse continuation (1 bullet + priority alone) | NOT FIXED | Same splitter fix as #4 |

---

## Issue 1 — "3.2 פילוח לפי קטגוריה" heading orphaned from its table

**What you see:** Page 7 ends with the "3.2 פילוח לפי קטגוריה" heading as the very last element. Page 8 starts with the category breakdown table. Heading and table are separated across pages.

**Root cause:** The `.section-intro` CSS class has `break-after: auto !important`. The value `auto` does not prevent page breaks — it means Chromium decides freely. Chromium puts the heading at the bottom of page 7 and breaks after it. To prevent the heading from being left alone, `break-after: avoid` is needed, which tells Chromium: "do not break after this element — keep it together with what follows."

**Fix:** In `backend/services/pdf_service.py`, inside `CLEAN_PRINT_CSS`, find:
```css
.section-intro { break-after: auto !important; page-break-after: auto !important; }
```
Change to:
```css
.section-intro { break-after: avoid !important; page-break-after: avoid !important; }
```

This same change also fixes Issues 2 and 3 (identical root cause).

---

## Issue 2 — "5. המלצות ותכנית טיפול" heading alone on page 40

**What you see:** Page 40 has the section heading "5. המלצות ותכנית טיפול" and one intro line ("סעיף זה מרכז את הממצאים בטבלת עבודה, לצורך מעקב אחר סטטוס סגירה ובעלות."), then a huge blank space. The treatment table starts on page 41.

**Root cause:** Same as Issue 1 — `.section-intro { break-after: auto }` allows Chromium to break after the heading.

**Fix:** The same CSS change from Issue 1 resolves this. No additional change needed.

---

## Issue 3 — "נספח א' – מיפוי ממצאים למדיניות / תקנים" heading orphaned from its table

**What you see:** The appendix heading appears at the bottom of page 43 (after the last treatment table row). The policy mapping table starts at the top of page 44.

**Root cause:** Same as Issues 1 and 2.

**Fix:** Same CSS change from Issue 1. No additional change needed.

---

## Issue 4 — CSPM-001 continuation page 12 still sparse

**What you see:** Page 11 = CSPM-001 full card content. Page 12 = only "pod-security.kubernetes.io/enforce: baseline" (one bullet) + "עדיפות טיפול" + "בינונית (30–60 ימים)". Page 12 is nearly empty. *(Improved from 3 pages to 2 in previous batch.)*

**Root cause:** The min-tail merge loop runs and sees that chunk2 is tiny (< 200px), so it merges chunk2 back into chunk1. This creates a single oversized card (> 918px). Chromium then natural-breaks the card — `break-inside: avoid` on `.finding-card` is ignored when the card is taller than one page — and puts the last bullet + priority on page 12. The merge made things worse by letting Chromium choose the break point instead of the packer.

**Fix:** In the card splitter `page.evaluate()` block in `pdf_service.py`, add a size-check to the min-tail merge `while` loop so it only merges when the previous chunk has room for the tail content.

**Current code** (locate after `if (currentChunk.length) chunks.push(currentChunk);`):
```javascript
while (chunks.length > 1) {
    const lastChunk = chunks[chunks.length - 1];
    const lastHeight = lastChunk.reduce((h, el) => h + el.offsetHeight, 0);
    if (lastHeight < MIN_CONTINUATION_HEIGHT_PX) {
        chunks[chunks.length - 2] = chunks[chunks.length - 2].concat(lastChunk);
        chunks.pop();
    } else {
        break;
    }
}
```

**Replace with:**
```javascript
while (chunks.length > 1) {
    const lastChunk = chunks[chunks.length - 1];
    const lastHeight = lastChunk.reduce((h, el) => h + el.offsetHeight, 0);
    if (lastHeight < MIN_CONTINUATION_HEIGHT_PX) {
        const prevChunk = chunks[chunks.length - 2];
        const prevHeight = prevChunk.reduce((h, el) => h + el.offsetHeight, 0);
        if (prevHeight + lastHeight <= MAX_CARD_HEIGHT_PX) {
            // Only merge if the previous chunk has room
            chunks[chunks.length - 2] = prevChunk.concat(lastChunk);
            chunks.pop();
        } else {
            break; // Can't merge without overflow — accept sparse tail
        }
    } else {
        break;
    }
}
```

**Why this works:** The merge only happens when the preceding chunk's measured height + the tail's height fits within 918px. If not, the split is kept as-is. A sparse last page is better than letting Chromium break at an uncontrolled point inside an oversized merged card.

---

## Issue 5 — EOLM-001 continuation page 10 still sparse

**What you see:** Page 9 = EOLM-001 full card. Page 10 = "לבחון חשיפות אבטחה הנובעות מחוסר עדכוני אבטחה ב-EOL" (one bullet) + "עדיפות טיפול" + "גבוהה (עד 30 ימים)". Very sparse.

**Root cause:** Same as Issue 4 — min-tail merge merged the tiny tail into chunk1, creating one oversized card. Chromium natural-broke it, placing one bullet + priority on page 10.

**Fix:** Resolved by the same code change as Issue 4.

---

## Issue 6 — EAPM findings: large whitespace on first page, recommendations on next

**What you see:** Pages 28, 30, 32, 34, 36, 38 all show EAPM finding cards ending at the "חוקים / מדיניות רלוונטיים" section with a large blank gap (40–50% of the page empty). The recommendations section ("המלצות") starts on the next page (29, 31, 33, 35, 37, 39). Affected findings: EAPM-005 through EAPM-010.

**Root cause:** The recommendations section of each EAPM card is a single large DOM element (a `div.finding-section-content` containing the Hebrew summary + multi-step CLI instructions, approximately 500px tall measured at the 720px viewport). The greedy packer adds the "המלצות" section title (~25px) to chunk1 (total ~525px), then tries to add the recommendations content block (~500px): 525+500 = 1025px > 918px — overflow. The **orphan-protection** block fires: it pops the "המלצות" section title out of chunk1 and moves both the title AND the content block to chunk2. chunk1 is left ending at "חוקים" (~500px rendered ≈ 54% of page). Result: 46% of the first page is blank.

**Fix (partial improvement):** Remove the orphan-protection block from the greedy packer. Instead of moving the section title to the next chunk, keep the title in chunk1 and start chunk2 with just the content element. chunk1 gains 25px (the title) and the split is cleaner.

**Current orphan-protection block** (inside `afterHeader.forEach`, inside the overflow `if` branch — the block that checks `last.classList.contains('finding-section-title')`):
```javascript
const last = currentChunk[currentChunk.length - 1];
if (last && last.classList.contains('finding-section-title')) {
    currentChunk.pop();
    chunks.push(currentChunk);
    currentChunk = [last, el];
    currentHeight = last.offsetHeight + elH + 20;
} else {
    chunks.push(currentChunk);
    currentChunk = [el];
    currentHeight = elH;
}
```

**Replace the entire `if/else` with just the `else` branch:**
```javascript
chunks.push(currentChunk);
currentChunk = [el];
currentHeight = elH;
```

**What this changes:** When the content block overflows, the section title stays in chunk1 and chunk2 starts directly with the content. chunk1 now ends with "המלצות" title visible, and chunk2 starts with the recommendations text (no title — consistent with the "no continuation header" design already in place). This removes the blank gap caused by the title being pulled to the next chunk.

**Known limitation:** This is a partial improvement only. A full fix requires `findings.js` to emit each recommendation bullet/paragraph as a direct child element of `.finding-card` (instead of bundled inside one `div.finding-section-content`). That way the greedy packer can distribute individual bullets between chunks and fill pages more evenly. This structural change is tracked as a separate follow-up task.

---

## Issue 7 — EAPM-010 continuation page 39 sparse

**What you see:** Page 38 = EAPM-010 card with most content. Page 39 = "If this resource was deployed via Infrastructure-as-Code, implement this fix to the relevant IaC template to prevent this issue from repeating." (one bullet) + "עדיפות טיפול" + "גבוהה (עד 30 ימים)". Very sparse.

**Root cause:** Same as Issues 4 and 5 — min-tail merge attempted to merge the tiny tail but created an oversized card.

**Fix:** Resolved by the same code change as Issue 4.
