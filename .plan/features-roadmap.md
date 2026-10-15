# CSPM Report Builder — Full Roadmap Implementation Plan

_Schema: unified item template v1 — see docs/INDEX.md for legend._

## Standard Per-Task Git Workflow (MANDATORY — applies to every task below)

Before starting any task:
1. Run `git status` — if not clean, commit + push all changes and merge to `origin/main` first.
2. Create a task-specific branch: `git checkout -b feature/<name>` or `fix/<name>`.

After implementing the task:
3. Run `python -m pytest tests/ -x -q` (backend tests).
4. Run the **`cspm-reviewer`** agent on all modified files (code correctness, conventions, security).
5. Run the **`qa`** agent if any changes touch `templates/report_template.html` or `backend/services/pdf_service.py`.
6. If either agent surfaces bugs or required fixes → plan the fixes inline and apply them before committing.
7. Once all checks pass with no remaining issues: `git add <files>`, commit, `git push`, merge to `origin/main`.
8. Update `memory/roadmap-status.md` status for the task to `✅ merged to main`.
9. Display a **summary report** of work done (what changed, what was fixed, what was verified).

This workflow must be written into `CLAUDE.md` under a new "## Per-Task Git Workflow" section — see TASK 0.5 below.

---

## Context

This plan covers all pending work across the CSPM Report Builder project:
- The current uncommitted feature branch (`feature/hspm-malware-filepath`)
- Milestone 2.4 (Interactive HTML export)
- Milestone 3.1–3.3 (Regression chapter, Golden 5, Multi-language)
- 15 pending backlog items

The goal is a detailed, self-contained plan that an implementing agent can follow task by task without needing further clarification from the user.

---

### TASK-0.5 — Document the workflow in CLAUDE.md
**Type:** Tech Debt
**Effort:** Low
**Milestone:** 0.5
**Files:** `CLAUDE.md`
**Branch:** none — edit directly on `main` (or a quick `fix/claude-md-workflow` branch)
**What:** Add a "Per-Task Git Workflow" section to `CLAUDE.md` immediately after "## Critical Conventions" so all agents follow a consistent commit/test/merge process before any implementation begins.
**Steps:**
1. Add a new section to `CLAUDE.md` immediately after "## Critical Conventions":

```markdown
## Per-Task Git Workflow (mandatory)

Before starting any task:
1. `git status` — if not clean, commit + push all pending changes and merge to `origin/main` first.
2. `git checkout -b feature/<name>` or `fix/<name>` for the new task.

After implementing the task:
3. `python -m pytest tests/ -x -q` — no regressions.
4. Run the **`cspm-reviewer`** agent on all modified files.
5. Run the **`qa`** agent if any change touches `templates/report_template.html` or `backend/services/pdf_service.py`.
6. Fix any issues flagged by agents. Repeat steps 3–5 until clean.
7. `git add <files>` → commit → `git push` → merge to `origin/main`.
8. Update `memory/roadmap-status.md` to `✅ merged to main`.
9. Display a summary report: what changed, what was verified, what's next.
```

**Verification:** Read CLAUDE.md after editing — section should appear in the right place, conventions table still intact.

---

### TASK-0 — Commit & merge `feature/hspm-malware-filepath`
**Type:** Feature
**Effort:** Medium
**Milestone:** 0
**Files:** `backend/graphql/queries.py`, `backend/routes/pipeline.py`, `backend/routes/wiz.py`, `backend/services/wiz_service.py`, `backend/services/ai_service.py`, `static/js/src/wizi.js`, `README.md`, `TESTING.md`
**What:** Commit and merge the complete MALW malware findings support already built in the working tree — GraphQL query, backend route handlers, wiz_service filter builder, frontend single-item importer, bulk aggregation by malware name, and AI tone tuning.
**Steps:**
1. Run `python -m pytest tests/ -x -q` — confirm no regressions.
2. Commit all 8 files with message: `feat(wiz): MALW malware findings — file path tracking + bulk aggregation`

   Modified files detail:
   - `backend/graphql/queries.py` — added `MALWARE_FINDINGS_QUERY` + `QUERY_TYPE_MAP` entry
   - `backend/routes/pipeline.py` — added `malwareFindings` handler in `_transform_finding()` + filePath support for HSPM
   - `backend/routes/wiz.py` — added `malwareFindings` case in `api_wizi_issues()` and `api_wizi_find_by_id()`
   - `backend/services/wiz_service.py` — added `malwareFindings` filter in `build_bulk_filter()`
   - `backend/services/ai_service.py` — tone tuning (measured language when <4 critical / ≤10 high-or-above)
   - `static/js/src/wizi.js` — `importMalwareFinding()`, bulk aggregation by malware name, queryTypeMap entry
   - `README.md` / `TESTING.md` — documentation updates

3. Get user approval then merge to `main`.
4. Update `memory/roadmap-status.md` — mark B.6 (AI tone tuning) as merged (it was applied on this branch too).
**Verification:** Open Wiz import tab → select "MALW — Malware Findings" from the query type dropdown → run a search → confirm findings appear with File Path in technical details. Run bulk import → confirm multiple instances of same malware are consolidated into one finding.

---

### TASK-2.4 — Interactive HTML export
**Type:** Feature
**Effort:** High
**Milestone:** 2.4
**Files:** `templates/interactive_export_template.html` (new), `backend/routes/reports.py`, `static/js/src/export.js`
**Branch:** `feature/interactive-html-export`
**What:** Export the current report as a single self-contained `.html` file (no server calls, no CDN) with filter/search, expand/collapse, and excepted-findings toggle — all pure JS, fully read-only with no localStorage state mutation.
**Steps:**
1. **Backend (`backend/routes/reports.py`):** Add endpoint `POST /api/export/html` (requires `editor` role): accept the current snapshot JSON in the request body, render `templates/interactive_export_template.html` with the snapshot data embedded as a `<script>` block (`window.__REPORT_DATA__ = { ... }`), return the rendered HTML as a file download (`Content-Disposition: attachment; filename=report-{date}.html`).
2. **Template (`templates/interactive_export_template.html`):** Create a self-contained single-file HTML with all CSS and JS inlined (no external references). Structure:
   ```
   <head>: inline CSS (report styling + interactive controls)
   <body>:
     - Report header (client name, date, risk score)
     - Interactive controls bar:
         [חיפוש...] [סינון חומרה ▼] [הצג חריגות ✓] [מה שנבדק ✓]
     - Findings list (all findings embedded as JSON in <script>)
     - <script>: all interactivity logic
     - window.__REPORT_DATA__ embedded JSON blob
   ```
   Implement the following interactivity features (all pure JS, no framework). The export is fully read-only — no localStorage, no state mutation:
   - **Filter/search:** Text input filters by finding title, description, category. Severity dropdown (`הכל / Critical / High / Medium / Low`). Both filters combine (AND logic). Matching is case-insensitive.
   - **Expand/collapse:** Each finding renders collapsed (title + severity badge + category chip visible). Clicking expands to show description, impact, technical details, recommendations. Default: all collapsed.
   - **Toggle excepted:** Checkbox "הצג חריגות" (show excepted). When unchecked (default), findings with `_excepted: true` are hidden. When checked, they appear with an "חריגה" badge.
   - **Summary bar:** Shows live counts as filters change: `{N} ממצאים | Critical: X High: Y Medium: Z Low: W`.
   - **No "mark as done" feature** — removed because `file://` pages share a single localStorage origin across all exported files, causing state collisions between reports. Remediation tracking is handled via CSV export (see B.18).
3. **Frontend (`static/js/src/export.js`):** Add `[ייצוא HTML אינטראקטיבי]` button in the export panel next to the existing PDF button. On click: call `buildSnapshot()` to get current report state, POST to `/api/export/html` with snapshot JSON, trigger download of returned HTML blob.
**Verification:** Build a test report with ~10 findings (mix of severities, some excepted). Export HTML. Open in browser with no network. Verify: search works, severity filter works, excepted toggle works, mark-as-done persists after page reload.

---

### TASK-3.1 — Regression chapter in PDF (minor versions only)
**Type:** Feature
**Effort:** High
**Milestone:** 3.1
**Files:** `backend/routes/reports.py`, `backend/services/ai_service.py`, `templates/report_template.html`, `static/css/src/` (new styles), `static/js/src/export.js`
**Branch:** `feature/pdf-regression-chapter`
**What:** When generating a PDF for a minor version (e.g. `2.1`, not `2.0`), include an extra "פרק רגרסיה" chapter listing zombie findings (previously excepted/deleted but reappearing in current draft) and a Gemini-generated 2–3 sentence Hebrew trend assessment.
**Steps:**
1. **Backend (`backend/routes/reports.py`):** When `/api/pdf` is called with `productId` and `versionType=minor`:
   - Fetch the last published version of that product from `uploads/products/{productId}/`
   - Extract its `findings` list and identify those with `_excepted: true` or `_deleted: true`
   - Compare against current snapshot's findings (match by normalized `title`, case-insensitive)
   - Collect zombie findings: those in the previous-deleted/excepted list AND present in the current draft as non-excepted/non-deleted
   - If zombies exist, call Gemini to generate a trend paragraph (see step 2), then pass `regression_data` to the Jinja2 PDF template
2. **AI service (`backend/services/ai_service.py`):** Add `generate_regression_trend()` function using this prompt:
   ```
   You are a security analyst. Write 2-3 sentences in Hebrew assessing the security trend.
   Previous version: risk score {prev_score}, {prev_total} findings ({prev_excepted} excepted, {prev_deleted} deleted).
   Current version: risk score {curr_score}, {curr_total} findings.
   Zombie findings (previously resolved, now reappeared): {zombie_count}.
   New findings since last version: {new_count}.
   Be professional and measured. Focus on trajectory.
   ```
3. **Template (`templates/report_template.html`):** Add a new section at the beginning of chapter 4 (findings), rendered only when `regression_data` is provided:
   ```html
   {% if regression_data %}
   <section class="regression-chapter page-break-before">
     <h2>רגרסיה — ממצאים שחזרו</h2>
     {% if regression_data.zombies %}
     <table class="regression-table">
       <thead><tr><th>ממצא</th><th>חומרה</th><th>סטטוס קודם</th></tr></thead>
       <tbody>
       {% for z in regression_data.zombies %}
       <tr>
         <td>{{ z.title }}</td>
         <td class="sev-{{ z.severity }}">{{ z.severity }}</td>
         <td>{{ 'הוחרג' if z.was_excepted else 'נמחק' }}</td>
       </tr>
       {% endfor %}
       </tbody>
     </table>
     {% endif %}
     {% if regression_data.trend_text %}
     <p class="trend-paragraph">{{ regression_data.trend_text }}</p>
     {% endif %}
   </section>
   {% endif %}
   ```
4. **CSS (`static/css/src/`):** Add `.regression-chapter` and `.regression-table` styles, then run `build_css.py`.
5. **Frontend (`static/js/src/export.js`):** When generating PDF, if the current report context has a `productId` and the version type is minor, pass `productId` and `versionType=minor` as query params on the `/api/pdf` call.
**Verification:** Create a product with a published v1.0 that has 2 excepted findings. Create draft v1.1 and re-import those same findings (not excepted). Generate PDF → confirm regression chapter appears with those 2 zombie findings and a Gemini trend paragraph. Generate PDF for a major version — confirm no regression chapter.

---

### TASK-3.2 — "Golden 5" chapter in PDF
**Type:** Feature
**Effort:** High
**Milestone:** 3.2
**Files:** `backend/routes/reports.py`, `templates/report_template.html`, `static/css/src/` (new styles), `static/js/src/export.js`
**Branch:** `feature/pdf-golden-5`
**What:** Add an optional PDF chapter "5 הממצאים המשמעותיים ביותר" (Top 5 Most Impactful Findings), toggled from the Export UI, showing the top 5 non-excepted findings automatically selected by severity weight descending.
**Steps:**
1. **Frontend (`static/js/src/export.js`):** Add a checkbox `[✓] כלול פרק "Golden 5"` in the Export panel (default: checked, state saved in `localStorage` key `export-golden5-enabled`). When generating PDF, if checked, pass `golden5=true` as a query param.
2. **Backend (`backend/routes/reports.py`):** When `golden5=true` param is present, extract the snapshot's findings, sort by severity weight descending (Critical=4, High=3, Medium=2, Low=1), take top 5 non-excepted findings, and pass them as `golden5_findings` to the PDF template.
3. **Template (`templates/report_template.html`):** Add a new chapter after the executive summary (before the main findings list):
   ```html
   {% if golden5_findings %}
   <section class="golden5-chapter page-break-before">
     <h2>5 הממצאים המשמעותיים ביותר</h2>
     {% for f in golden5_findings %}
     <div class="golden5-card sev-border-{{ f.severity }}">
       <div class="golden5-header">
         <span class="golden5-rank">#{{ loop.index }}</span>
         <span class="golden5-title">{{ f.title }}</span>
         <span class="sev-badge sev-{{ f.severity }}">{{ f.severity }}</span>
       </div>
       <p class="golden5-impact">{{ f.impact }}</p>
       {% if f.recs %}
       <p class="golden5-rec">{{ f.recs[0] }}</p>
       {% endif %}
     </div>
     {% endfor %}
   </section>
   {% endif %}
   ```
4. **CSS (`static/css/src/`):** Add `.golden5-chapter`, `.golden5-card`, `.golden5-header`, `.golden5-rank` styles, then run `build_css.py`.
**Verification:** Build a report with 8 findings of mixed severities. Export PDF with Golden 5 on → confirm chapter appears with correct top 5 in severity order. Export with toggle off → confirm chapter is absent. Test with fewer than 5 non-excepted findings → chapter still appears with however many are available (e.g. 3 findings → chapter shows 3 cards, not hidden).

---

### TASK-3.3 — Multi-language support (Hebrew/English)
**Type:** Feature
**Effort:** High
**Milestone:** 3.3
**Files:** `static/js/src/i18n.js` (new), `static/css/src/ltr-overrides.css` (new), `index.html`, `static/js/src/main.js`, `static/js/src/export.js`, `backend/routes/reports.py`, `backend/services/pdf_labels.py` (new), `templates/report_template.html`, `static/css/src/`
**Branch:** `feature/multi-language`
**What:** Add two independent language toggles — a UI language toggle (Hebrew RTL ↔ English LTR) and a PDF label language button — using an i18n JSON dictionary with `data-i18n` attributes and persistent localStorage preferences.

**Steps:**

**Part A — UI Language Toggle (approach: i18n JSON dictionary + `data-i18n` attributes):**
1. Create `static/js/src/i18n.js` (new module):
   ```javascript
   const TRANSLATIONS = {
     he: { /* default — all Hebrew strings */ },
     en: {
       'ייצוא דוח': 'Export Report',
       'שמור גרסה': 'Save Version',
       'ממצאים': 'Findings',
       // ... (full dictionary)
     }
   };

   export function setLang(lang) {
     localStorage.setItem('ui-lang', lang);
     document.documentElement.setAttribute('lang', lang);
     document.documentElement.setAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
     document.querySelectorAll('[data-i18n]').forEach(el => {
       const key = el.getAttribute('data-i18n');
       el.textContent = TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.he[key] ?? key;
     });
   }

   export function getLang() {
     return localStorage.getItem('ui-lang') || 'he';
   }
   ```
2. **`index.html` changes:** Add `data-i18n="<Hebrew text>"` attributes to all static Hebrew strings in the HTML (sidebar labels, section headings, button text). Add a language toggle button in the top-right corner of the sidebar (or header): `[HE | EN]`.
3. **`static/js/src/main.js`:** Import `setLang`, `getLang` from `i18n.js`. On load, call `setLang(getLang())` to restore saved preference. Wire toggle button to call `setLang('en')` / `setLang('he')`.
4. **Dynamically rendered Hebrew strings (in JS):** Audit all `showToast(...)` calls and dynamic `innerHTML` with Hebrew text across JS modules (findings.js, products.js, etc.). Wrap each via a `t('key')` helper function that looks up the translation. **Scope estimate:** ~200 translatable strings across `index.html` and JS modules.
5. **RTL/LTR CSS:** Create `static/css/src/ltr-overrides.css` with `[dir="ltr"]` override rules for any rules that need to flip (margin-left ↔ margin-right, text-align, etc.). The existing stylesheet is RTL-first.

**Part B — PDF Language Button:**
6. **`static/js/src/export.js`:** Add a `[PDF בעברית | PDF באנגלית]` toggle button next to "ייצא PDF" in the Export panel. State stored in `localStorage` key `export-pdf-lang` (default: `'he'`). Pass `lang=he` or `lang=en` as a query param on `/api/pdf` calls.
7. **`backend/routes/reports.py`:** Read `lang` param and pass `labels` dict to the Jinja2 template renderer.
8. **`backend/services/pdf_labels.py` (new):** Create `PDF_LABELS` dict with both language keys:
   ```python
   PDF_LABELS = {
       'he': {
           'findings_title': 'ממצאים',
           'executive_summary': 'תקציר מנהלים',
           'severity': 'חומרה',
           'category': 'קטגוריה',
           'recommendations': 'המלצות',
           'impact': 'השפעה',
           'technical': 'פרטים טכניים',
           # ... all section headings and fixed labels in the PDF template
       },
       'en': {
           'findings_title': 'Findings',
           'executive_summary': 'Executive Summary',
           'severity': 'Severity',
           'category': 'Category',
           'recommendations': 'Recommendations',
           'impact': 'Impact',
           'technical': 'Technical Details',
           # ...
       }
   }
   ```
9. **`templates/report_template.html`:** Replace all hardcoded Hebrew label strings with `{{ labels.findings_title }}`, `{{ labels.executive_summary }}`, etc. The finding content fields (title, description, impact, recs) are user-entered content — they stay as-is regardless of lang toggle.
10. Run `python3 build_css.py` after CSS changes.

**Note:** The PDF language toggle only affects the chrome/labels of the PDF (section headings, table headers, severity labels), not the content fields. If a user wants English content, they type in English.

**Verification:**
1. Toggle UI to English → sidebar labels flip to English, dir=ltr
2. Reload page → language preference persists
3. Toggle back to Hebrew → RTL restored
4. Export PDF with EN toggle → section headings in English, finding content unchanged
5. Export PDF with HE toggle → all Hebrew labels

---

## BACKLOG ITEMS (priority order)

#### BUG FIXES (do first)

### B.13 — Bug: "EOL — Software Supply Chain" throws "Unknown query type"
**Type:** Bug Fix
**Effort:** Low
**Milestone:** B.13
**Files:** `backend/routes/pipeline.py`, `backend/routes/wiz.py`
**Branch:** `fix/ssc-query-type`
**What:** Fix the plural/singular mismatch in the softwareSupplyChain dispatch key so the "EOL — Software Supply Chain" query type works without error in both the filtered-query and bulk import paths.
**Steps:**
1. In `backend/routes/pipeline.py` (in `_transform_finding()`), find the `softwareSupplyChainFinding` handler and ensure it also handles the key `softwareSupplyChainFindings` (plural). The bulk import path uses the plural form; the pipeline/filtered-query path uses singular.
2. In `backend/routes/wiz.py`, align both paths to use the same dispatch key as the `QUERY_TYPE_MAP` entry (`softwareSupplyChainFindings`).
**Verification:** Open "שאילתה מסוננת" → select "EOL — Software Supply Chain" → run → no error.

---

### B.17 — Suppress "[GovIL]" findings in bulk import
**Type:** Bug Fix
**Effort:** Low
**Milestone:** B.17
**Files:** `static/js/src/wizi.js` (bulk import page-fetching loop)
**Branch:** `fix/govil-suppression`
**What:** Filter out any finding whose `name` or `rule.name` contains `[govil]` (case-insensitive) during bulk import before adding it to the results array — silent skip, no toast, no counter increment.
**Steps:**
1. In `static/js/src/wizi.js`, in the bulk import loop (after fetching each page of results), filter out any item whose `name` or `rule.name` (case-insensitive) contains `[govil]` before adding to the results array. Silent skip — no toast, no counter increment.
**Verification:** Mock or run a real bulk import against a subscription with [GovIL] findings → confirm they don't appear in the findings list.

---

### B.11 — EOL query: hardcode Medium and above
**Type:** Bug Fix
**Effort:** Low
**Milestone:** B.11
**Files:** `backend/services/wiz_service.py`, `tests/test_bulk_filter.py`
**Branch:** `fix/eol-severity-filter`
**What:** Change the EOL bulk filter hardcoded severity from `["CRITICAL", "HIGH"]` to `["MEDIUM", "HIGH", "CRITICAL"]` so Medium-severity EOL findings are included in bulk import results.
**Steps:**
1. In `backend/services/wiz_service.py`, in `build_bulk_filter()` for the `endOfLifeFindings` query type, change the hardcoded severity from `["CRITICAL", "HIGH"]` to `["MEDIUM", "HIGH", "CRITICAL"]`. Bulk import has no per-import severity filter — all severities are hardcoded per query type. שאילתה מסוננת (single filtered query) is separate and unaffected.
2. Update the assertion in `tests/test_bulk_filter.py` to expect MEDIUM included.
**Verification:** Run bulk import for EOL type → confirm Medium, High, and Critical EOL findings are returned.
**Tests:** Update `tests/test_bulk_filter.py` — change severity assertion to include `"MEDIUM"`.

---

#### QUICK WINS

### B.10 — Add favicon
**Type:** Feature
**Effort:** Low
**Milestone:** B.10
**Files:** `static/favicon.ico` (new), `index.html`
**Branch:** `fix/favicon`
**What:** Add a cloud/shield security-themed favicon to the app so it appears in browser tabs and bookmarks.
**Steps:**
1. Create a favicon SVG or PNG with a cloud/shield icon fitting the security theme at `static/favicon.ico` (or `static/favicon.svg`).
2. Add `<link rel="icon" href="/static/favicon.ico">` to `index.html` `<head>`.
**Verification:** Open the app in a browser → confirm the favicon appears in the browser tab.

---

### B.15 — Products page: sort alphabetically
**Type:** Feature
**Effort:** Low
**Milestone:** B.15
**Files:** `static/js/src/products.js`
**Branch:** `fix/products-sort`
**What:** Sort the products grid alphabetically by Hebrew product name before rendering, using the data already fetched from `GET /api/products` — no backend change needed.
**Steps:**
1. In `static/js/src/products.js`, in `renderGrid(products)`, sort the products array before rendering: `products.sort((a, b) => a.name.localeCompare(b.name, 'he'))`.
**Verification:** Open the products page → confirm products appear in Hebrew alphabetical order.

---

### B.1 — PDF cover page version mismatch
**Type:** Bug Fix
**Effort:** Low
**Milestone:** B.1
**Files:** `backend/routes/reports.py`, `static/js/src/export.js`
**Branch:** `fix/pdf-cover-version`
**What:** Ensure the PDF cover always shows the system-tracked auto-assigned version, never the value typed in the report metadata form which may diverge.
**Steps:**
1. **From the product timeline:** In `static/js/src/export.js`, pass `productId` and `ver` as query params when exporting from the timeline; in `backend/routes/reports.py`, fetch the version file and use its `reportVersion` for the cover.
2. **From the current draft:** Use the draft's system-assigned version already available in the snapshot directly; ignore the form field value.
**Verification:** Edit the form's version field to a wrong value → generate PDF → confirm the cover shows the system-assigned version, not the form value.

---

#### PDF IMPROVEMENTS

### B.2 — PDF filename + split environment field
**Type:** Feature
**Effort:** Medium
**Milestone:** B.2
**Files:** `index.html`, `static/js/src/reports.js`, `backend/routes/reports.py`, `templates/report_template.html`
**Branch:** `fix/pdf-filename`
**What:** Split the single `report-env` field into separate cloud-provider and deployment-stage fields, add a data migration for existing snapshots, and build a descriptive `{product_name}-{env_stages}-{date}.pdf` filename.
**Steps:**

**Part 1 — Split "סביבת בדיקה / ענן" into two fields (form change):**
1. In `index.html`, replace the current `report-env` input with two fields:
   - `report-cloud` (label: "ענן") — free-text input for cloud provider: AWS / GCP / Azure / Multi-Cloud.
   - `report-env` (label: "סביבת בדיקה") — multi-value: render as a row of checkboxes or toggle chips for deployment stage (dev / test / prod / preprod). Store as comma-separated string in the snapshot.
2. In `static/js/src/reports.js` (snapshot-load path), add data migration: if `report-cloud` is absent but `report-env` looks like a cloud name (AWS/GCP/Azure), move it to `report-cloud` and clear `report-env`.
3. In `templates/report_template.html`, update the environment line to render both fields: "ענן: AWS | סביבה: prod, preprod".

**Part 2 — PDF filename:**
4. In `backend/routes/reports.py`, build the `Content-Disposition` filename as `{product_name}-{env_stages}-{date}.pdf`:
   - `product_name`: from `meta.clientName`
   - `env_stages`: from `report-env` (stage field, e.g. "prod" or "test+prod"). Join multiple values with `+`. If blank, omit from filename.
   - `date`: report date in `YYYY-MM-DD` format.
   - Sanitize: strip special chars, replace spaces with hyphens, max 60 chars total.
   - Example: `MFA-Service-prod-2026-08-11.pdf`
**Verification:** Fill in cloud = "AWS" and stages = "prod, preprod" → generate PDF → confirm filename is `{name}-prod+preprod-{date}.pdf` and cover shows "ענן: AWS | סביבה: prod, preprod". Load an old snapshot where `report-env = "AWS"` → confirm migration moves it to `report-cloud = "AWS"`.

---

### B.3 — PDF section 4: each category starts on a new page
**Type:** Feature
**Effort:** Low
**Milestone:** B.3
**Files:** `templates/report_template.html`
**Branch:** `fix/pdf-category-page-breaks`
**What:** Add CSS page-break-before rules to the category subsection loop in PDF chapter 4 so each category starts on a new page.
**Steps:**
1. In `templates/report_template.html`, find the category subsection loop in chapter 4 (findings). Add `page-break-before: always` CSS class to each `<section class="category-section">` element (except the first one).
2. Add `.category-section + .category-section { page-break-before: always; }` to the PDF stylesheet block.
**Verification:** Run the **`qa`** agent after modifying the template. Test with Playwright PDF render after change — confirm each category starts on a new page.

---

#### NAVBAR WORK (do all three together in one branch)

### B.4 + B.9 — Navbar restructure + rename
**Type:** Feature
**Effort:** Medium
**Milestone:** B.4
**Files:** `index.html`, `static/css/src/layout.css`
**Branch:** `fix/navbar-restructure`
**What:** Restructure the sidebar into 3 sections (אזור עבודה | קבצים ודוחות | מוצרים) by removing the "נתונים" section, relocating buttons, and renaming labels — decided names, do not defer.
**Steps:**
1. In `index.html`:
   - Remove "נתונים" section entirely
   - Move "Wiz Import" button into "אזור עבודה" section (after "הוסף ממצא")
   - Move "קבצי שרת" into the "פלט" section (now renamed)
   - Rename "פלט" section label → **"קבצים ודוחות"**
   - Rename "ייצוא דו"ח" sidebar button → **"קבצים ודוחות"**
2. Update `static/css/src/layout.css` if section label styles need updating.

After restructure the sidebar has 3 sections: אזור עבודה | קבצים ודוחות | מוצרים
**Verification:** Open the sidebar → confirm exactly 3 sections with correct names. "Wiz Import" appears inside "אזור עבודה". "קבצי שרת" appears inside "קבצים ודוחות".

---

### B.5 — Navbar UX overhaul: accordion-style click-pinned categories
**Type:** Feature
**Effort:** Medium
**Milestone:** B.5
**Files:** `index.html`, `static/js/src/ui.js`, `static/css/src/layout.css`
**Branch:** included in `fix/navbar-restructure`
**What:** Replace the always-visible sidebar with an accordion where clicking any tab or section label pins that section and collapses the others, with state persisted in localStorage.
**Steps:**
1. In `index.html`:
   - Set default pinned section on first load to "מוצרים"
   - Set default active tab / home page to "לוח סריקות" (replaces "לוח בקרה" as the landing tab)
   - Add `title` attribute tooltips to section labels for hover descriptions
2. In `static/js/src/ui.js`, add `initSidebarAccordion()` function with `pinSection(sectionId)` that:
   - Removes `is-pinned` from all `nav.sidebar-nav` elements
   - Adds `is-pinned` to the target section's nav
   - Saves `sectionId` to `localStorage` key `sidebar-pinned-section`
3. Wire each `.sidebar-item` tab click and each `.sidebar-section-label` click to call `pinSection(sectionId)`. On load, restore pinned section from localStorage; if none, default to "מוצרים".
4. In `static/css/src/layout.css`, add: `.sidebar-nav { display: none; } .sidebar-nav.is-pinned { display: block; }`.
**Verification:** Click a tab → its parent section pins, previous section collapses. Reload page → pinned section is restored. Hover over section label → tooltip appears.

---

#### PRODUCT REGISTRY FEATURES

### B.7 — Product registry: list-view toggle
**Type:** Feature
**Effort:** Low
**Milestone:** B.7
**Files:** `static/js/src/products.js`, `static/css/src/products.css`
**Branch:** `feature/products-list-view`
**What:** Add a `[רשת | רשימה]` toggle button to the products page so consultants can switch between the card grid and a tabular list view, with the preference stored in localStorage.
**Steps:**
1. In `static/js/src/products.js`, add a `[רשת | רשימה]` toggle button at the top of the grid view. Store preference in `localStorage` key `products-view-mode`.
2. In list view, render products as a `<table>` with columns: שם מוצר | סביבה | גרסה | ציון סיכון | תאריך אחרון | פעולות. Reuse the same product data already fetched for grid view.
3. Add list-view styles in `static/css/src/products.css`.
**Verification:** Click "רשימה" toggle → products render as a table with all columns. Click "רשת" → grid view restored. Reload → preference persists.

---

### B.8 — Exception List view (cross-product)
**Type:** Feature
**Effort:** High
**Milestone:** B.8
**Files:** `backend/routes/products.py`, `index.html`, `static/js/src/products.js` (or new `exceptions.js`), `static/css/src/products.css`
**Branch:** `feature/exception-list-view`
**What:** Add a new "רשימת חריגות" sidebar entry and backend endpoint that aggregates all excepted findings across all products into a single filterable cross-product table.
**Steps:**
1. **Backend (`backend/routes/products.py`):** Add `GET /api/exceptions` endpoint: scan all products, for each find the latest Published version file, collect all findings with `_excepted: true`, return array of `{ productName, productId, findingTitle, findingId, severity, category, exceptionReason, publishedAt }`. Products with no published version must be included with `publishedAt: null` and `findings: []` — do not silently skip them.
2. In `index.html`, add "רשימת חריגות" sidebar entry and `panel-exceptions` panel.
3. In `static/js/src/products.js` (or new `exceptions.js`), fetch `/api/exceptions` and render a filterable table with columns: מוצר | ממצא | חומרה | קטגוריה | סיבת חריגה | תאריך. Display "אין גרסה מפורסמת" indicator for products with no published version.
4. Add styles in `static/css/src/products.css`.
**Verification:** Open "רשימת חריגות" → confirm table shows all excepted findings from all products. Products with no published version appear with "אין גרסה מפורסמת". Filters work correctly.

---

#### LARGER BACKLOG FEATURES

### B.16 — Bulk import: choose between "Start fresh" or "Keep existing"
**Type:** Feature
**Effort:** Low
**Milestone:** B.16
**Files:** `static/js/src/wizi.js`
**Branch:** `feature/bulk-import-mode`
**What:** Show a modal before the bulk import confirmation step letting the consultant choose to wipe all existing findings ("Start fresh") or keep them ("Keep existing", current default behavior), with a mandatory second confirmation for the destructive option.
**Steps:**
1. Before the bulk import confirmation step (after user has selected findings to import), show a modal:
   > "ייבוא ממצאים — בחר מצב:"
   > - `[דוח חדש]` — מחיקת ממצאים קיימים לפני הייבוא
   > - `[הוסף לקיים]` — שמירת ממצאים קיימים ✓ (ברירת מחדל)
2. If "Start fresh" (`[דוח חדש]`) is selected, show a second confirmation popup: "פעולה זו תמחק את כל הממצאים הקיימים (מכל הקטגוריות). להמשיך?" — wiping ALL findings across ALL categories, not just the category being imported.
3. If confirmed, clear `state.findings` entirely before running the import loop in `importSelectedBulkFindings()`. Default is "Keep existing" (current behavior — no change to flow).
**Verification:** Select findings in bulk import → confirm modal appears. Choose "Keep existing" → existing findings preserved after import. Choose "Start fresh" → second popup appears → confirm → all prior findings cleared before import.

---

### B.12 — Findings exclude list (pattern-based suppression rules)
**Type:** Feature
**Effort:** High
**Milestone:** B.12
**Files:** `backend/models/exclude_rule.py` (new), `backend/routes/wiz.py` (or new blueprint), `static/js/src/wizi.js`, `index.html`, `static/css/src/wizi.css`
**Branch:** `feature/exclude-list`
**What:** Add a backend DB model and CRUD routes for pattern-based suppression rules stored in the DB (shared across all users and devices), with a management UI and frontend filtering applied silently at bulk import time.
**Steps:**
1. Create `backend/models/exclude_rule.py` with model `ExcludeRule` (fields: `id`, `field` ('title'|'category'), `operator` ('startsWith'|'contains'|'regex'), `pattern`, `active` (bool), `created_at`).
2. Add CRUD routes in `backend/routes/wiz.py` (or new blueprint), all requiring `editor` role: `GET /api/exclude-rules`, `POST /api/exclude-rules`, `PUT /api/exclude-rules/<id>`, `DELETE /api/exclude-rules/<id>`.
3. In `static/js/src/wizi.js`, at bulk import time, fetch active rules from `GET /api/exclude-rules` and filter out any item that matches any rule before adding to the import queue.
4. Add rule management UI in `index.html` (new section "רשימת סינון ממצאים" inside Wiz import tab or separate panel) and add styles in `static/css/src/wizi.css`.
**Verification:** Add a rule matching `contains "test"` on field `title`. Run bulk import with findings that include "test" in title → confirm those findings are silently skipped. Deactivate the rule → findings appear again on next import.

---

### B.18 — Improve CSV export readability
**Type:** Feature
**Effort:** Low
**Milestone:** B.18
**Files:** `backend/routes/reports.py` (or `static/js/src/export.js` if client-side)
**Branch:** `fix/csv-readability`
**What:** Improve the existing CSV export so it is consultant-friendly: human-readable Hebrew column headers, proper severity ordering, stripped internal fields, and inclusion of exception reason and status for use as a remediation tracking tool.
**Steps:**
1. In `backend/routes/reports.py` (or `static/js/src/export.js`), review the current CSV structure and update it: use human-readable Hebrew column headers, proper severity ordering (Critical first), strip internal fields (IDs, raw JSON), and include exception reason and status columns.
**Verification:** Export CSV from a report with mixed findings (some excepted, varied severities) → open in Excel → confirm columns are human-readable in Hebrew, severity order is correct, no raw IDs or JSON appear, exception reason is visible.

---

## Execution Order (recommended for implementing agent)

```
── WAVE 0 — already done ──────────────────────────────────────────────────
[✅ done] 0.5  Document workflow in CLAUDE.md
[✅ done] 0.   Commit + merge feature/hspm-malware-filepath
[✅ done] B.13 fix/ssc-query-type
[✅ done] B.10 fix/favicon

── WAVE 1 — Quick bug fixes ───────────────────────────────────────────────
[✅ done] B.17  fix/govil-suppression       ([GovIL] suppression, both import paths)
[✅ done] B.11  fix/eol-severity-filter     (EOL hardcoded to MEDIUM+)
[✅ done] B.15  fix/products-sort           (alphabetical sort)

── WAVE 2 — PDF improvements ──────────────────────────────────────────────
[✅ done] 4.  B.1   fix/pdf-cover-version          (cover shows system version)
[✅ done] 5.  B.2   fix/pdf-filename               (split ענן/סביבה fields + filename)
[✅ done] 6.  B.3   fix/pdf-category-page-breaks   (category page breaks)

── WAVE 3 — UX & structure ────────────────────────────────────────────────
[✅ done] 7.  B.18  fix/csv-readability            (CSV readability)
[✅ done] 8.  B.4+B.5+B.9  fix/navbar-restructure  (accordion + rename)

── WAVE 4 — Product registry features ─────────────────────────────────────
[✅ done] 9.  B.7   feature/products-list-view     (list-view toggle)
[✅ done] 10. B.8   feature/exception-list-view    (cross-product exception table)

── WAVE 5 — Import features ───────────────────────────────────────────────
[✅ done] 11. B.16  feature/bulk-import-mode       (start fresh vs keep)
[✅ done] 12. B.12  feature/exclude-list           (exclude rules DB + UI)

── WAVE 6 — Milestones ────────────────────────────────────────────────────
[✅ done] 13. 2.4   feature/interactive-html-export  (read-only HTML export)
[✅ done] 14. 3.2   feature/pdf-golden-5             (top 5 findings chapter)
[✅ done] 15. 3.1   feature/pdf-regression-chapter   (zombie findings + Gemini)
[✅ done] 16. 3.3   feature/multi-language           (Hebrew/English UI + PDF)

── WAVE 7 — Finish audit fixes (Phase 3 + Phase 7) ───────────────────────
⬜  17. DES-CRIT-1  (Google Fonts → local @font-face, fixes PDF font metrics)
⬜  18. DES-CRIT-2  (ui.js null-unguarded DOM queries)
⬜  19. DES-H-1     (table rows split across PDF pages — break-inside: avoid)
⬜  20. DES-H-2     (select chevron wrong side for RTL)
⬜  21. DES-H-3     (note delete button wrong corner for RTL)
⬜  22. DES-H-4     (preview panel anchored to wrong side for RTL)
⬜  23. DES-H-5     (dashboard bar count LTR exception undocumented)
⬜  24. DES-H-6     (back button arrow wrong direction for RTL)
⬜  25. DES-H-7     (sidebar collapse arrows semantically inverted)
⬜  26. DES-I-01    (tab elements missing aria-selected state management)
⬜  27. DES-I-02    (SVG donut missing role + aria-label)
⬜  28. DES-I-03    (show-all link → semantic <button>)
⬜  29. DES-I-04    (exec summary + scope separated into distinct PDF page sections)
⬜  30. DES-I-05    (prefers-reduced-motion media query for animations)
⬜  31. DES-I-06    (severity chip accent border wrong side for RTL)
⬜  32. DES-I-07    (oklch() fallback for unsupported browsers)
⬜  33. DES-I-08    (delete user → styledConfirm instead of window.confirm)
⬜  34. DES-I-09    (pipeline KPI card text-align right to match dashboard)
Full specs: `.plan/improvements-and-fixes-roadmap.md` Phase 3 (items 17–25) and Phase 7 (items 26–34).
Suggested branches: fix/audit-critical-frontend (17–25) then fix/audit-improvements (26–34).

── WAVE 8 — Quick wins (Tier 1 backlog) ──────────────────────────────────
⬜  35. BL-09  Bulk Finding Field Edit (un-hide existing hidden batch controls + add category)
⬜  36. BL-03  Draft Watermark on Unpublished PDF
⬜  37. BL-10  Pre-Publish Checklist (frontend validation modal before publish)
⬜  38. BL-20  ZIP Bundle Export (PDF + HTML + CSV in one download)
⬜  39. BL-06  AI Exception Reason Improver (UI-only — reuses /api/suggest)
⬜  40. BL-05  AI Key Topics Suggestion (new Gemini method + route + button)
⬜  41. BL-21  Treatment Priority Auto-Default from Severity
⬜  42. BL-22  System Version Indicator in Report Details Panel (read-only badge)
⬜  43. BL-25  PDF Export Animated Spinner (reuse .ai-progress-container pattern)
⬜  44. BL-26  Skeleton Rows During Wiz Bulk Import
⬜  45. BL-28  Report Version on PDF Cover Page (one template line)
Full specs: `.plan/backlog.md`.

── WAVE 9 — High value, moderate work (Tier 2 backlog) ───────────────────
⬜  46. BL-11  Custom Org-Level Finding Templates (DB model + admin CRUD)
⏭️  47. BL-02  Executive vs Technical PDF Mode — DROPPED (PDF already contains both executive + technical sections in sequence)
⬜  48. BL-19  Risk Score SLA / Threshold Alerts (max_risk_score field + highlights)
⬜  49. BL-07  AI Finding Deduplication Detector (post-import semantic similarity via Gemini)
⬜  50. BL-17  Backup and Restore (admin ZIP download + restore route)
⬜  51. BL-27  Scan-Due Push Notifications (SSE or polling interval + badge/toast)
⬜  52. BL-29  AI-Generated Diff Summary (Gemini narrative paragraph above diff table)
Full specs: `.plan/backlog.md`.

── WAVE 10 — Significant features (Tier 3 backlog) ───────────────────────
⬜  53. BL-01  Longitudinal Risk Score Trend Chapter (SVG line chart across all published versions)
⬜  54. BL-12  Finding "Review Next Cycle" Flag (new finding state; affects regression chapter)
⬜  55. BL-04  PDF Bookmarks / Named Destinations (pypdf/pikepdf post-processing)
⬜  56. BL-23  Acknowledge vs Exclude — Dual Dismissal States (replaces single exception boolean)
⬜  57. BL-24  Exception Carry-Forward Hardening ⚠️ DESIGN-FIRST — no code until design session done
Full specs: `.plan/backlog.md`.

── WAVE 11 — Enterprise & Integration (Tier 4 backlog) ───────────────────
⬜  58. BL-14  Webhook on Scan / Publish Events (build first — establishes event infrastructure)
⬜  59. BL-13  Email Report Delivery on Publish (reuses BL-14 publish event hook)
⬜  60. BL-15  Monday.com Finding-to-Task Export
⬜  61. BL-16  Full Audit Log (append-only AuditEvent model + admin view)
⬜  62. BL-18  Scheduled Auto-Scan (APScheduler or cloud-scheduler; multi-worker guards)
⬜  63. BL-08  AI Remediation Priority Ranker (highest AI effort — schedule last)
Full specs: `.plan/backlog.md`.
```

Each task: clean `git status` → new branch → implement → run tests → show user → merge to main → next.

---

## Critical Conventions (all tasks must follow)

- **JS**: edit `static/js/src/*.js` — no build step, hard-refresh browser. Bump `?v=NNN` in `index.html`.
- **CSS**: edit `static/css/src/*.css` → run `python3 build_css.py` before testing.
- **RTL**: Hebrew UI — test layout after any CSS/HTML change.
- **PDF**: run the **`qa`** agent after touching `templates/report_template.html` or `backend/services/pdf_service.py`; also run the PDF geometry check in TESTING.md.
- **Auth**: `require_role()` decorator required on every new route. Never omit.
- **Atomic writes**: always write state files to temp file then rename. Never write in-place.
- **After each task**: update `memory/roadmap-status.md` status before moving to next task.
