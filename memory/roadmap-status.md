# Roadmap Status

## Milestones 1 and 2 (complete)
See memory/MEMORY.md for high-level summary. Milestones 1 and 2 are fully merged to main (except task 2.4 which was skipped).

## Audit Fix Phases

Phase 1 (audit critical backend — DEV-CRIT-1 through DEV-CRIT-4): ✅ merged to main
- Branch: fix/audit-critical-backend
- Date: 2026-08-10
- Fixes: _extract_finding_title alignment with wizi.js, deleted ProductMemory entries skipped, immutability guard for published snapshots, RuntimeError propagation in resolve_subscription
- Tests: tests/test_exception_key_matching.py, tests/test_wiz_service.py (new); tests/test_bulk_filter.py (updated)

Phase 2 (audit high backend — DEV-H-1 through DEV-H-7): ✅ merged to main
- Branch: fix/audit-high-backend
- Date: 2026-08-10
- Fixes: single-transaction finding write with flush+rollback (DEV-H-1), threading.Lock for _token (DEV-H-2), atomic state file write (DEV-H-3), get_data before get_json for 413 guard (DEV-H-4), fetch_projects pagination (DEV-H-5), html.escape on PDF metadata (DEV-H-6), require_role("editor") on render-pdf (DEV-H-7)
- Tests: tests/test_files.py (new), tests/test_reports.py (new), tests/test_products.py (extended)

Phase 4 (audit medium backend — DEV-M-1,3,4,6-15): ✅ merged to main
- Branch: fix/audit-medium-backend
- Date: 2026-08-10
- Fixes: GraphQL error check in resolve_subscription (DEV-M-1), RuntimeError on missing access_token (DEV-M-3), snapshot_data None guard (DEV-M-4), list_versions column-limited query (DEV-M-6), credentials read at call time in get_wiz_service (DEV-M-7), internal errors not leaked to clients in wiz.py + ai.py (DEV-M-8), notes length silently truncated to 1000 chars (DEV-M-9), published snapshot deletion blocked with 409 (DEV-M-10), variables type check in GraphQL proxy (DEV-M-11), pageSize capped at 500 in find-by-id (DEV-M-12), _aggregate_vulns highest_sev initialized to low (DEV-M-13), date boundary fix in _pipeline_status using .date() comparison (DEV-M-14), session rollback on all commit failures in auth_service (DEV-M-15)
- Tests: tests/test_pipeline_logic.py (new), tests/test_products_extended.py (new), tests/test_wiz_service.py (extended)
- Skipped: DEV-M-2 (already fixed in Phase 2), DEV-M-5 (already fixed in Phase 1)
- Review fixes: data-null guard consistency in resolve_subscription (Advisory #1), end-of-month pytest.skip guard in test_pipeline_logic.py (Advisory #4)

Phase 5 (audit medium frontend — DES-M-01 through DES-M-10): ✅ merged to main
- Branch: fix/audit-medium-frontend
- Date: 2026-08-10
- Fixes: CSS version sync kept in sync at v=46 (DES-M-01), dir="auto" on PDF template li elements replacing LTR heuristic (DES-M-02), duplicate .tab-panel block removed from components.css (DES-M-03), accordion chevron margin-right→margin-left for RTL (DES-M-04), kbd-overlay toggle migrated from style.display to classList.toggle('hidden') (DES-M-05), toastContainer null guard in showToast (DES-M-06), button-row physical margins replaced with gap:8px on flex container (DES-M-07), pipeline modal actions justify-content: center (DES-M-08), escapeHtml applied to f.category and f.id before innerHTML injection (DES-M-09), auth page inline styles extracted to static/css/auth.css (DES-M-10)
- Review fixes: auth.css added to git tracking (was untracked), escapeHtml on f.id added alongside f.category fix

Phase 6 (audit low — DEV-L-1 through DEV-L-12, DES-L-01 through DES-L-08): ✅ merged to main
- Branch: fix/audit-low
- Date: 2026-08-10
- Backend fixes: datetime.utcnow deprecated (DEV-L-1), dead END_OF_LIFE_QUERY alias removed (DEV-L-2), _safe_id path-traversal check (DEV-L-3), 502 for upstream Wiz failures (DEV-L-4), unused weights dict in _aggregate_vulns removed (DEV-L-5), X-Forwarded-For for rate-limiter key gated on TRUSTED_PROXY env var (DEV-L-6), threading.Lock on _rate_store (DEV-L-7), api_list_outputs pagination (DEV-L-8), CLOUD_CONFIG_RULES_QUERY first raised to 100 + pageInfo added (DEV-L-9), Finding.severity nullable=False server_default=medium (DEV-L-10), OAuth callback exception logging (DEV-L-11), Product.name unique=True (DEV-L-12)
- Frontend fixes: sidebar-collapse-btn margin-inline-end (DES-L-01), RTL comment on version-row-actions (DES-L-03), chevron ::before margin-inline-end (DES-L-04), viewport meta in report_template.html (DES-L-05), decorative ::before scoped to @media screen (DES-L-06), autosave-indicator margin-inline-start (DES-L-07), ac-sub margin-inline-end (DES-L-08)
- Skipped: DES-L-02 (background-position in wizi.css is intentionally specialised for .bulk-page-size, not a duplicate)
- Side effects: export.js updated to read data.files from paginated api_list_outputs response; main.js cache-buster bumped to v=110
- Tests: 124 passed, 0 failed

Phase 8 (audit tests): ✅ merged to main
- Branch: fix/audit-tests
- Date: 2026-08-11
- Source fix: wiz.py api_wizi_issues SSC branch no longer injects severity/status into filter_by (SoftwareSupplyChainFindingFilters rejects those fields)
- New test files: tests/test_product_memory.py, tests/test_transform_finding.py, tests/test_ai_service.py, tests/test_health.py
- Extended test files: tests/test_bulk_filter.py (malwareFindings case + SSC no-severity/status guard), tests/test_products_extended.py (test_notes_length_capped)
- Dropped: test_list_states_pagination (spec error — DEV-L-8 targeted api_list_outputs which was already paginated in Phase 6, not api_list_states)
- Tests: 200 passed, 0 failed

UI feedback fixes (ui-feedback): ✅ merged to main — 2026-08-11

B.1 (PDF cover page version mismatch): ✅ merged to main — 2026-08-11
- Branch: fix/pdf-cover-version
- Added "Export PDF" button to product timeline view (products.js)
- _exportVersionAsPdf(): fetches stored version JSON, reads top-level `version` field (system version), applies snapshot, overrides report-version DOM field before buildReportHtml(), restores via try/finally
- Backend /api/render-pdf: accepts optional ?productId&ver query params, validates (length cap + regex), logs for auditing
- JS cache-buster bumped: main.js?v=116
- Tests: 200 passed, 0 failed

B.3 (PDF section 4: each category starts on a new page): ✅ merged to main — 2026-08-11
- Branch: fix/pdf-category-page-breaks
- buildReportHtml() restructured: each finding category is its own <section class="page-section finding-page">; existing break-after:page rule causes per-category page breaks; .finding-page ancestor now present for every .finding-card, activating pdf_service.py card-splitter
- Intro h1+p moved to a separate <section class="page-section findings-intro"> so findings-intro CSS exception keeps it from forcing a blank page before the first category
- JS cache-buster bumped: main.js?v=118
- Tests: 200 passed, 0 failed

B.2 (PDF filename + split environment field): ✅ merged to main — 2026-08-11
- Branch: fix/pdf-filename
- Split single report-env text input into report-cloud (text) + env-stage checkboxes (dev/test/prod/preprod) in index.html
- findings.js: buildSnapshot/applySnapshot updated; data-migration for old snapshots where env held a cloud name; buildReportHtml reads both fields; i18n tables split envLabel into cloudLabel + envLabel
- ui.js: updateStepper reads report-cloud + env-stage checkboxes for sidebar label and progress bar
- wizi.js: auto-fill redirected from report-env to report-cloud
- export.js: hasData guard, doNewReport checkbox reset, saveDefaults/loadDefaults checkbox serialization
- reports.py: _build_pdf_filename helper (client + cloud + env_stages + date slug, max 60 chars); unicodedata import at module level
- report_template.html: header and cover page use meta.cloud with meta.env fallback; cover shows two separate rows for cloud and env
- CSS: .env-chip uses CSS variables (--border, --accent, --accent-glow) for dark-mode compatibility
- JS cache-buster bumped: main.js?v=117
- Tests: 200 passed, 0 failed
- Follow-up fix (2026-08-12, branch fix/pdf-filename-env-v2): env stages were absent from the browser-side download filename because buildFilename() in findings.js only read client+date; browser uses a.download (ignores Content-Disposition for blob URLs); fixed buildFilename to also read report-cloud and checked report-env-stage checkboxes; JS cache-buster bumped to main.js?v=119; Tests: 200 passed, 0 failed

B.18 (CSV export readability): ✅ merged to main — 2026-08-12
- Branch: fix/csv-readability (v2 fix on fix/csv-readability-v2)
- All-Hebrew column headers: כותרת,חומרה,קטגוריה,תיאור,השפעה,פרטים טכניים,מדיניות,המלצות,עדיפות,בעלים,מוחרג,סיבת חריג
- id field removed from export output
- Findings sorted Critical → High → Medium → Low → Info (shallow copy, state.findings not mutated)
- Array fields (technical, policies, recs) joined with '; ' for Excel single-cell compatibility
- Exception columns added: מוחרג (כן/לא) and סיבת חריג (reason or empty)
- Import reader colRec alias updated to accept both המלצות and המלצה for round-trip compatibility
- JS cache-buster bumped to main.js?v=121
- Tests: 200 passed, 0 failed

B.4+B.5+B.9 (navbar restructure + accordion UX): ✅ merged to main — 2026-08-12
- Branch: fix/navbar-restructure + fix/navbar-accordion-guard (guard fix)
- Deleted nav-data section entirely; tab-wizi moved into nav-workspace, tab-cloud-manager moved into nav-output
- Output section label and tab-export button text renamed to "קבצים ודוחות"
- Final sidebar: 3 sections — אזור עבודה (5 tabs) | קבצים ודוחות (2 tabs) | מוצרים (2 tabs)
- Active landing tab changed from tab-dashboard to tab-pipeline
- Accordion behavior: .sidebar-nav hidden by default (display:none), shown when .is-pinned; collapsed-sidebar hover flyout preserved
- pinSection() / pinSectionForTab() added to ui.js; switchToTab() in findings.js calls pinSectionForTab() for sync
- Accordion state derived from cspm_active_tab (single source of truth — no separate sidebar-pinned-section key)
- Guard: clicking an already-pinned section label is a no-op for mouse; keyboard (Enter/Space) retains collapse for screen reader accessibility
- titleMap['tab-export'] updated to "קבצים ודוחות"; default tab fallback changed to tab-pipeline in findings.js
- Dead CSS rules (.section-data, .sidebar-group-data) removed; build_css.py run; builder.css?v=50
- JS cache-buster: main.js?v=124
- Tests: 200 passed, 0 failed

Sidebar visual fixes (fix/sidebar-visual): ✅ merged to main — 2026-08-12
- Problem A (accordion overflow): .sidebar-nav.is-pinned given width:100%; min-width:0; box-sizing:border-box — overrides base min-width:185px so tab list stays within sidebar bounds; pinned nav hidden when sidebar collapses
- Problem B1 (collapsed flyout appearance): hover flyout got min-width:180px, padding, border-radius, RTL-correct margin-left gap
- Problem B2 (icons in collapsed mode): each .sidebar-section-label now has <span class="section-icon"> (🔧/📄/📦) + <span class="section-label-text">; collapsed mode hides section-label-text; broken CSS selector targeting wrong span replaced
- CSS cache-buster bumped: builder.css?v=51

B.7 (Product registry: list-view toggle): ✅ merged to main — 2026-08-12
- Branch: feature/products-list-view
- Toggle [רשת | רשימה] injected into products header; preference persisted in localStorage key products-view-mode
- renderListView() renders <table class="products-list-table"> with 6 columns: שם מוצר | סביבה | גרסה | ציון סיכון | תאריך אחרון | פעולות
- Action buttons (timeline/edit/delete) use same data-action delegation as grid view
- Empty-state guard: when products.length === 0, toggle is hidden and existing empty-state card renders (matches renderGrid behaviour)
- CSS: .products-view-toggle, .products-list-table, .actions-cell added to products.css; build_css.py run; builder.css rebuilt
- JS cache-buster: main.js?v=125
- Tests: 200 passed, 0 failed

B.8 (Exception list view — cross-product): ✅ merged to main — 2026-08-12
- Branch: feature/exception-list-view
- New GET /api/exceptions endpoint in products.py: queries all products, returns flat list of excepted findings from latest published snapshot per product; products with no published version return publishedAt: null placeholder; @require_role("viewer"); try/except with no stack trace leak
- New static/js/src/exceptions.js: fetches endpoint once (module-scope _loaded guard), renders filterable table into #exceptions-tbody; _esc() on all dynamic values including _fmtDate(publishedAt); applyFilters() for search + severity without re-fetch
- Sidebar: "רשימת חריגות" button (tab-exceptions) added to מוצרים accordion section; panel-exceptions panel added
- titleMap and tabToNav entries added in findings.js and ui.js
- CSS: .exceptions-table, .exceptions-filter-bar, .exceptions-no-published added to products.css; builder.css?v=52
- JS cache-buster: main.js?v=126
- Tests: 200 passed, 0 failed

B.16 (Bulk import: "Start fresh" vs "Keep existing"): ✅ merged to main — 2026-08-12
- Branch: feature/bulk-import-mode
- Mode-selection dialog before bulk import: "הוסף לקיים" (keep existing, right/safe in RTL) vs "דוח חדש" (start fresh, left/destructive)
- Second danger confirm required for "דוח חדש": "פעולה זו תמחק את כל הממצאים הקיימים (מכל הקטגוריות). להמשיך?"
- state.findings = [] + beforeCount reset to 0 before import loop on start-fresh path
- styledConfirm core.js fixes: Enter guard disabled on danger:true dialogs; removeEventListener moved into cleanup() via var handler declaration (fixes listener leak + ReferenceError)
- JS cache-buster bumped: main.js?v=128
- Tests: 200 passed, 0 failed

B.12 (Findings exclude list — pattern-based suppression rules): ✅ merged to main — 2026-08-12
- Branch: feature/exclude-list
- New ExcludeRule ORM model in backend/models.py: id, field (title|category), operator (startsWith|contains|regex), pattern (≤500 chars), active (bool), created_at
- 4 CRUD routes on wiz_bp at /api/wizi/exclude-rules: GET (viewer), POST/PUT/DELETE (editor); allowlist validation on field+operator; rollback on SQLAlchemyError; no stack trace leakage
- app.py: CREATE TABLE IF NOT EXISTS exclude_rules backfill for existing SQLite DBs
- New static/js/src/exclude_rules.js: rule fetch+cache (eager on init), isExcludedByRules() filter, panel UI (render/add/toggle/delete with escapeHtml on all user data), #exclude-rules-active-count update
- wizi.js: exclude-rules filter applied additively in BOTH bulk import path (after [GovIL] suppression) and single-query import path; safe degradation if fetch not yet complete
- Designer (Part 1): sidebar tab-exclude-rules in nav-products accordion, panel-exclude-rules with add-rule form + table skeleton, wizi sub-tab ⚙ כללי סינון + summary panel; CSS in wizi.css; builder.css?v=53
- titleMap + tabToNav entries added in findings.js and ui.js
- JS cache-buster: main.js?v=129
- Tests: 214 passed, 0 failed (14 new tests in tests/test_exclude_rules.py)
- Fix: duplicate var rid renamed to var delRid in exclude_rules.js (cosmetic, no runtime impact)

Wave 5 (B.16 + B.12) — COMPLETE ✅

Post-Wave 5 hotfixes (2026-08-12):
- panel-exclude-rules blank page: inline style="display:none" on the panel section overrode CSS .tab-panel.active — removed inline style (index.html)
- [GovIL] rule not visible in exclude rules UI: hardcoded wizi.js filter predated B.12 DB system; seeded [govil] rule in DB on startup (app.py), replaced both hardcoded filter blocks in wizi.js with isExcludedByRules() — rule now manageable from UI; JS cache-buster: main.js?v=130

Wave 6 — Task 2.4 (Interactive HTML Export): ✅ merged to main — 2026-08-12
- Branch: feature/interactive-html-export
- New template: templates/interactive_export_template.html (self-contained interactive HTML, all inline — Designer delivered)
- New route: POST /api/export/html in backend/routes/reports.py (@require_role("editor"), 20 MB cap, render_template only, no PDF pipeline)
- New button: btn-export-html in export panel (index.html + export.js); disabled when no findings via updateCloudButtons()
- JS cache-buster: main.js?v=131

Wave 6 — Task 3.2 (PDF Golden 5 chapter): ✅ merged to main — 2026-08-12
- Branch: feature/pdf-golden-5
- Checkbox "כלול פרק Golden 5" in export panel (chk-golden5), default checked, localStorage persisted
- buildGolden5Html(): top 5 non-excepted findings sorted by severity weight, title ≤80 chars, impact ≤200 chars, rec ≤150 chars
- Chapter injected into HTML string before POST to /api/render-pdf (after exec-summary/scope-method section, before findings-summary section)
- Injection point regex: matches </section> whitespace <section ... <h1 id="findings-summary"
- CSS: .golden5-chapter, .golden5-card, .golden5-header, .golden5-rank, .golden5-title, .golden5-impact, .golden5-rec, .sev-border-* in assets/report.css (Designer Part 1)
- JS cache-buster: main.js?v=132
- Tests: 214 passed, 0 failed

Wave 6 — Task 3.3 (Multi-language UI + PDF toggle): ✅ merged to main — 2026-08-13
- New file: static/js/src/i18n.js (TRANSLATIONS dict, setLang, getLang, t helpers)
- New file: static/css/src/ltr-overrides.css (LTR layout overrides for [dir="ltr"]) — Designer Part 1
- 248 data-i18n attributes added to index.html — Designer Part 1
- btn-lang-toggle button in sidebar footer — Designer Part 1
- UI language persisted in localStorage key ui-lang; restored on page load via setLang(getLang()) in main.js
- PDF language (report-lang select) persisted in localStorage key export-pdf-lang; restored in export.js queueMicrotask block
- #btn-lang-toggle hidden in collapsed sidebar (layout.css updated, build_css.py run)
- JS cache-buster: main.js?v=135
- CSS cache-buster: builder.css?v=55
- Tests: 214 passed, 0 failed

Wave 6 — Task 3.1 (PDF Regression Chapter): ✅ merged to main — 2026-08-13
- Branch: feature/pdf-regression-chapter
- New GeminiService.generate_regression_trend(prev_snapshot_data, curr_findings, zombies, curr_risk_score=None) in backend/services/ai_service.py
- New POST /api/generate-regression-trend route in backend/routes/ai.py (@require_role("editor")); imports _compute_risk_score from products.py (one-liner); sanitizes inputs; returns {"trend_text": "...", "model": "..."}; 400 on missing fields, 501 on no API key, 502 on Gemini failure
- export.js: _loadedBaseline variable stores full baseline snapshot on load; _isMinorVersion() checks version string; _detectZombies() detects reappeared findings by normalised title; buildRegressionChapterHtml() builds <section class="page-section regression-chapter"> with .regression-table and .trend-paragraph; injection into PDF HTML string before POST to /api/render-pdf; only active when _loadedBaseline is set and version is minor (e.g. 1.1, 2.3); graceful degrade on AI fetch failure; TOC entry injected for #regression-trend
- CSS: .regression-chapter, .regression-table th, .trend-paragraph, .regression-no-zombies added to assets/report.css (Playwright-safe: no fixed/sticky, no external fonts, no min-height:100vh)
- JS cache-buster: main.js?v=133
- Tests: 214 passed, 0 failed

Wave 7 — Phase 3 (Critical/High Frontend Bugs — DES-CRIT-1/2, DES-H-1 through DES-H-7): ✅ complete — 2026-09-08
- Branch: fix/wave7-phase3-status (status update only — all items confirmed already fixed as side effects of earlier waves)
- DES-CRIT-1: ✅ already fixed — base.css uses local @font-face from /assets/fonts/inter/; Google Fonts @import already gone
- DES-CRIT-2: ✅ already fixed — ui.js null guard already wraps kbdOverlay, btnKbdHelp, kbdClose
- DES-H-1: ❌ NOT FIXED — the step as written targets .findings-table tr and .treatment-table tr, but neither class is ever emitted by findings.js into the PDF HTML (the only match in findings.js is the getElementById lookup for findings-table-wrapper, a live-UI element). Row-splitting behaviour attributed to this fix comes from elsewhere; the rule is inert against the rendered PDF DOM. The separately-present .report-table tr rule in CLEAN_PRINT_CSS does provide row atomicity for actual PDF tables, but that is a different selector added for different reasons and does not constitute a fix for DES-H-1 as specified.
- DES-H-2: ✅ confirmed correct — .filter-select background-position: left 8px center is the correct RTL position (matches native select arrow placement at physical inline-end); original code was already right
- DES-H-3: ✅ already fixed — findings.css note delete button already at right: 4px
- DES-H-4: ✅ already fixed — wizi.css preview panel already uses right: 0, border-left, translateX(100%)
- DES-H-5: ✅ already fixed — dashboard.css bar count already has /* intentional LTR: numeric digit alignment */ comment
- DES-H-6: ⏭️ skipped — stale spec; no back/חזרה link exists in index.html; existing ← chars are correct RTL forward-nav arrows
- DES-H-7: ✅ already fixed — ui.js sidebar collapse reads isCollapsed ? '»' : '«' — correct semantic state

Phase 7 (audit frontend improvements — DES-I-01 through DES-I-09): ✅ merged to main
- Branch: fix/audit-improvements
- Date: 2026-09-09
- Pre-scan result: 8 of 9 items confirmed already fixed as side effects of earlier waves
  - DES-I-02: SVG donut already has role="img" and aria-label in ui.js
  - DES-I-03: show-all control already a <button type="button"> in index.html
  - DES-I-04: exec-summary and scope/methodology already in separate page-section elements in report_template.html
  - DES-I-05: prefers-reduced-motion media query already in base.css
  - DES-I-06: .severity-chip already uses border-right with RTL comment in components.css
  - DES-I-07: all oklch() calls already wrapped in safeColor() with CSS.supports() fallback in ui.js
  - DES-I-08: admin.html already uses styledConfirm via dynamic import (DES-I-08 comment present)
  - DES-I-09: .pipeline-kpi-card already has text-align: right in pipeline.css
- DES-I-01: ✅ fixed — finding detail tab strip ARIA pattern fully implemented (3 rounds):
    Round 1: role="tablist", role="tab", aria-selected on all 9 buttons + JS handler
    Round 2: aria-controls, unique ids, tabindex (roving), role="tabpanel", aria-labelledby, aria-label on tablist
    Round 3: tabindex="0" on panel, activateDetailTab() helper, RTL arrow-key keydown handler
- JS cache-buster: main.js?v=136 → v=139 (3 rounds; v=137 and v=138 consumed by intermediate iterations)
- Tests: 214 passed, 0 failed

Bug fix — exclude-rules pattern field RTL mirroring: ✅ merged to main — 2026-09-09
- Branch: main (direct commit ebd879f)
- Problem: typing "[" in the תבנית input rendered "]" due to Unicode Bidi Algorithm reversing bracket chars in RTL context
- Fix: added dir="ltr" to #exclude-rule-pattern input in index.html; added dir="ltr" to <code> tag in exclude_rules.js table renderer
- JS cache-buster: main.js?v=140

## Wave 8 — Tier 1 Backlog Quick Wins

BL-28 (Report Version on PDF Cover Page): ✅ merged to main — 2026-09-10
- i18n label `גרסת דו"ח` added; `|| '1.0'` default removed; version line suppressed when field is empty; inert report_template.html edit reverted
- JS cache-buster: main.js?v=141
- Root cause note: initial dev edited wrong file (report_template.html); PDF cover is built in findings.js via JS template literals. docs/architecture.md updated to document the real rendering path.

BL-03 (Draft Watermark on Unpublished PDF): ✅ merged to main — 2026-09-10
- `buildReportHtml({ isDraft })` — watermark CSS injected when isDraft=true; empty string when false
- products.js passes `{ isDraft: versionData.status === 'draft' }`; "open in new tab" and "download HTML" paths in findings.js also detect draft status and pass isDraft accordingly
- JS cache-buster: main.js?v=142

BL-09 (Bulk Finding Field Edit): ✅ merged to main — 2026-09-10
- Batch toolbar un-hidden (removed `display:none !important` from wizi.css); severity, priority, owner, category controls all wired
- Category uses short-code labels (CSPM, KSPM, etc.)
- Bonus fixes: batch category change calls `reorderFindingIds()` after loop; single-edit form auto-updates ID prefix on category change via `generateNextId()`
- JS cache-buster: main.js?v=145

BL-21 (Treatment Priority Auto-Default from Severity): ✅ merged to main — 2026-09-10
- `change` listener on `#f-severity` auto-fills `#f-priority` using severity→priority map; manual override locks auto-fill for that session

BL-10 (Pre-Publish Checklist): ✅ merged to main — 2026-09-10
- `styledConfirm` gate before publish; lists missing required fields; user must confirm before publish proceeds

BL-22 (System Version Indicator in Report Details Panel): ✅ merged to main — 2026-09-10
- Read-only badge showing system version in report detail panel; type guard for integer schema flag

BL-05 (AI Key Topics Suggestion): ✅ merged to main — 2026-09-10
- New `GeminiService.generate_key_topics()` method; new POST `/api/generate-key-topics` route; `model` field forwarded (matching all other AI routes); service prompt cap raised from 200 to 500 findings
- Frontend button in export panel; JS cache-buster bumped

BL-06 (AI Exception Reason Improver): ✅ merged to main — 2026-09-10
- "Improve" button on both exception-reason textareas (add form + detail pane); reuses `/api/suggest`; empty-text guard + trim added to both attach functions

BL-20 (ZIP Bundle Export): ✅ merged to main — 2026-09-10
- New POST `/api/export-zip` route; ZIP contains PDF + findings JSON; `slug()` lifted to module level; Golden 5 injection applied; raw bytes body cap; stepper updated; client-side filename via `buildFilename('zip')`
- Bonus fixes: generic error message replacing `str(e)` in render-pdf and export-zip routes; `showToast()` replaces `alert()` for PDF "no findings" guard
- JS cache-buster: main.js?v=153

BL-25 (PDF Export Animated Spinner): ✅ merged to main — 2026-09-10
- Animated `.btn-loading` spinner on PDF and ZIP export buttons during async operations

BL-26 (Skeleton Rows During Wiz Bulk Import): ✅ merged to main — 2026-09-10
- `showWiziSkeletonRows()` injects 5 shimmer rows before fetch; cleared on success, error, and network failure; "load more" path unaffected
- CSS: `@keyframes shimmer`, `.wizi-skeleton-cell`, `.wizi-skeleton-row td` in wizi.css; builder.css rebuilt
- JS cache-buster: main.js?v=155

BL-30 (Unsaved-Data Warning on Version Load / PDF): ✅ merged to main — 2026-10-19
- Branch: main (direct commit)
- Prevents silent data loss when loading different version or exporting version's PDF while current draft has unsaved edits
- Added `lastSavedSnapshotHash` to state.js for dirty-state tracking
- Added `_snapshotHash()` helper for lightweight snapshot comparison (findings count + JSON length)
- Added `hasUnsavedChanges()` export to check dirty state
- Updated `applySnapshot()` to set baseline hash when loading version
- Intercepted 'load' and 'export-pdf' actions in products.js with `styledConfirm` dialog
- Dialog: "קיימים שינויים שלא נשמרו. אם תמשיך, הנתונים הנוכחיים יאבדו. להמשיך?"
- User can confirm (proceed) or cancel (abort); no dialog if no unsaved changes
- JS cache-buster: main.js?v=173
- Tests: 214 passed, 0 failed
- **Tier 1 COMPLETE** — all 12 quick wins merged to main

## Wave 9 — Tier 2 High-Value Features

BL-17 (Backup and Restore): ✅ merged to main — 2026-10-22
- New admin blueprint: backend/routes/admin.py with GET /api/admin/backup and POST /api/admin/restore routes
- Backup: serializes all 7 ORM models (User, Product, FindingTemplate, ExcludeRule, ReportSnapshot, Finding, ProductMemoryEntry) to JSON using SQLAlchemy inspect(), packages in ZIP with metadata (timestamp, row counts), returns as timestamped download
- Restore: validates ZIP structure, checks path traversal/size/file count limits (500MB uncompressed, 100 files max), invalidates sessions, drops all data, restores from backup, resets auto-increment sequences (PostgreSQL + SQLite), verifies row counts
- Transaction-safe: full rollback on any restore failure
- ZIP validation: rejects path traversal (.. / \ absolute paths), symlinks, oversized files, missing required files
- Hebrew error messages, no stack trace leakage to client
- Auth: @require_role("admin") on both routes
- Tests: 16 new tests in tests/test_backup_restore.py (all passing)
- Files: backend/routes/admin.py (NEW), app.py (blueprint registration), tests/test_backup_restore.py (NEW)
- **QA Fixes (2026-10-22):**
  - Fixed PostgreSQL sequence reset bug: changed setval third parameter from false to true (prevents duplicate key errors on next insert)
  - Row count verification moved before commit and triggers rollback on mismatch (ensures atomicity)
  - Sequence reset failures now propagate exceptions instead of silent logging
  - Removed incorrect backslash check from path traversal validation (ZIP spec uses forward slashes)
  - SQLite sequence reset now checks for sqlite_sequence table existence before operations
  - Added 3 new tests: sequence reset verification, oversized ZIP rejection, row count verification failure with rollback
  - Tests: 233 passed, 0 failed (19 backup/restore tests, all passing)
- **Tier 2: 4/7 complete**

BL-11 (Custom Org-Level Finding Templates): ✅ merged to main — 2026-10-19
- Branch: main (direct commit)
- Admin panel to save reusable finding templates to database
- FindingTemplate ORM model with all finding fields (name, category, severity, title, description, impact, technical, policies, recs, priority, owner, active)
- 5 admin CRUD routes: GET/POST/PUT/DELETE /api/admin/templates + POST toggle
- Admin panel reorganized with tab-based layout: "ניהול משתמשים" | "ניהול תבניות"
- Custom templates auto-populated in findings dropdown with "★" prefix
- CSP-compliant: all JavaScript extracted to static/js/src/admin.js (no inline scripts)
- Files: backend/models.py, backend/routes/auth.py, templates/admin.html, static/js/src/admin.js (NEW), static/js/src/findings.js, index.html
- Cache-busters: findings.js v=174, admin.js v=175
- Tests: 214 passed, 0 failed
- **Tier 2: 1/7 complete**

BL-19 (Risk Score Color Tiers): ✅ merged to main — 2026-10-19
- Branch: main (direct commit)
- Color-codes products/pipeline by risk score for instant visual triage
- 4-tier system: Green (0-15), Orange (16-35), Red (36-60), Deep Crimson (60+)
- Backend: added latestRiskScore to GET /api/pipeline response
- Products page: colored accent bars in grid/list/timeline views
- Pipeline dashboard: new "ציון סיכון" column with colored badges
- Null-safe: products without published versions show no tier badge
- Files: backend/routes/pipeline.py, static/js/src/products.js, static/js/src/pipeline.js, static/css/src/products.css, static/css/src/pipeline.css, static/css/builder.css, index.html, .plan/risk-tier-css-reference.md
- Cache-busters: builder.css v=175, main.js v=175
- Tests: 214 passed, 0 failed
- **Tier 2: 3/7 complete**

BL-07 (AI Finding Deduplication Detector): ✅ merged to main — 2026-10-22
- Branch: feature/bl-07-duplicate-detector
- Final commit: b6680d2
- AI-powered duplicate detection using Gemini 2.5 Flash for semantic similarity scoring
- Features:
  - 🔍 Detect Duplicates button in findings panel (disabled when <2 findings or no snapshot)
  - 85% similarity threshold with category pre-filtering (CSPM vs CSPM, etc.)
  - Batch processing: 20 pairs per Gemini API call for performance
  - Hebrew confirmation dialog for large products (>150 findings per category)
  - Side-by-side comparison modal with "Keep A" / "Keep B" / "Skip" actions
  - Product memory tracking for merged findings
  - Markdown code fence stripping for Gemini 2.5 JSON responses
  - Auto-load .env file with python-dotenv integration
- Performance: <3 seconds for small products (target: <5s)
- Files: backend/routes/products.py, backend/services/ai_service.py, static/js/src/duplicates.js, static/js/src/findings.js, static/css/src/findings.css, app.py, requirements.txt

BL-27 (Scan-Due Push Notifications): ✅ merged to main — 2026-10-22
- Branch: feature/scan-due-notifications
- Client-side polling for scan-due notifications with badge and toast notifications
- 10-minute polling interval for pipeline overdue status changes
- Badge shows current overdue count on Pipeline sidebar tab
- Toast notification when new products become overdue
- **Tier 2: 5/7 complete**

BL-29 (AI-Generated Diff Summary): ✅ merged to main — 2026-10-22
- Branch: main (direct commit)
- AI-generated Hebrew narrative summary for version diff view
- New GeminiService.generate_diff_summary() method with Hebrew diff narrative prompt
- New POST /api/generate-diff-summary route (@require_role("viewer"))
- Frontend: renderDiff() fires async fetch, shows loading placeholder, replaces with narrative on success
- Silent degradation: narrative section hidden on Gemini failure (no error shown to user)
- Sample finding titles capped at 5 to keep prompt concise
- **QA Fixes (2026-10-22):**
  - Added 18 integration tests in tests/test_ai_endpoints.py covering happy path, validation, errors, edge cases
  - Fixed redundant truncation (standardized to 150 chars)
  - **Delta direction bug fix (commit 161904a):** Fixed inverted interpretation where improvements were reported as deteriorations
    - Now sends both baseline_risk_score and target_risk_score instead of just delta
    - Added explicit Hebrew interpretation in prompt: "מ-X ל-Y (ירידה/עלייה של N נקודות - שיפור/החמרה באבטחה)"
    - Tests: 253 passed (20 diff summary + 233 existing)
- Cache-busters: main.js?v=180 → v=181
- **Tier 2: COMPLETE (7/7) ✅**

## PDF Layout Fragmentation Fix

PDF layout fragmentation fix + packer improvements: ✅ merged to main — 2026-10-15
- Branch: fix/pdf-layout-fragmentation
- Started: 2026-09-14
- Merged: 2026-10-15
- Commits (chronological):
  - f6a600b: WIP snapshot before PDF layout fixes (Wave 8 work in flight, not reviewed)
  - a4d0dd0: keep section headings with their tables; allow large tables to paginate
  - a7de68c: correct card-splitter height budget and reclaim leaked page padding
  - 0ffcf85: remove dead .finding-continuation break-after rule
  - ad7f99d: generic descent splitter for oversized UL/OL children (Commit 3)
  - 615b1d4: housekeeping for pdf-layout-fragmentation branch
  - fb29fd9: thin grey border on continuation pages instead of navy section accent
  - 3985cc4: untrack root pdf-layout-remaining-issues.md; move to .plan/
  - 51a5d2f: correct DES-H-1 status and update awaiting-merge entry
  - 56e5ca9: log four deferred PDF layout items as Phase 9
  - 8b3089b: comment ELIGIBLE_SPLIT_TYPES — OL path has never executed
  - 02fd203: reduce .page-section border-top from 5px to 3px navy
  - 2bad763: force page break before appendix-a and recommendations sections
  - 1c081ac: Revert "reduce .page-section border-top from 5px to 3px navy"
  - d4a39a1: correct 908/886 derivation comments — source 5px border to findings.js:2744
  - d84c23c: confirm #recommendations selector is load-bearing for zero-findings case
  - e46a0fc: reduce .page-section border-top from 5px to 2px navy
  - 5639a8b: RTL bullet markers — list-style-position:inside for Hebrew recs
  - d4d28eb: severity badge mid-word wrap — white-space:nowrap + flex-shrink:0
  - a040c5b: mark assets/report.css and report_template.html as not in PDF render path
  - d2f9aa3: replace greedy packer with balanced-fill BCR-delta packer
  - 0ea55b9: feat(pdf): severity-sorted export + layout fragmentation fixes (final commit)
- Summary: scoped heading break-after rules to children (not wrapper), replaced untraceable 918px budget with empirically-measured MAX_PAGE_CARD_HEIGHT_PX=908 / MAX_PACK_HEIGHT_PX=886, reclaimed 45.35px padding-bottom leak, registered UL/OL descent in generic splitElement, thin grey border on continuation pages replacing navy section accent, RTL bullet marker fix (list-style-position:inside), severity badge nowrap fix, balanced-fill BCR-delta packer replacing greedy algorithm, deferred items logged to Phase 9
- QA: geometry verified after border change — 66 pages / 2 spills / 0 near-blank / 915.3px max unchanged
- **New features added on this branch:**
  - **Severity-sorted PDF export**: checkbox in export tab (`מיין לפי חומרה`) allows user to export PDF sorted by severity tier (Critical → High → Medium → Low → Info → Excepted) instead of by category; within each tier: alphabetical by category; TOC updated to match body order; localStorage persisted; applies to PDF, ZIP, HTML exports
  - **Wiz truncation message update**: changed truncation text from `ראה דוח Wiz` to `לפירוט המלא יש להתחבר ל WIZ` (2 locations: single-item 300-char cap + 12-item count cap)
  - **TOC severity-sort sync**: Table of Contents now respects severity-sort checkbox — TOC order matches body order when enabled
- Files modified: backend/services/pdf_service.py, index.html, static/js/src/export.js, static/js/src/findings.js, static/js/src/products.js, .plan/backlog.md, memory/roadmap-status.md
- JS cache-buster: v=172
- Tests: 214 passed, 0 failed

## Wave 10 — Tier 3 Backlog Features

BL-01 (Risk Score Trend Chart - Product Timeline): ✅ merged to main — 2026-10-26
- Branch: main (direct commit)
- Final commit: 604f4f7
- SVG line chart showing security posture trends across last 5 published versions
- Lives on product timeline UI page (not in PDF)
- X-axis: version numbers in chronological order (RTL: oldest right, newest left)
- Y-axis: risk score values with dynamic scaling
- Color-coded data points by risk tier (Green 0-15, Orange 16-35, Red 36-60, Crimson 60+)
- Requires minimum 2 published versions to display
- Data source: ReportSnapshot.risk_score (no new backend fields needed)
- RTL-aware: Y-axis on right, chart flows right-to-left
- Security: XSS protection on all SVG text insertions
- Files: static/js/src/products.js, static/css/src/products.css, static/css/builder.css, index.html
- Cache-buster: index.html v=185
- QA fixes: XSS escaping added (lines 1237, 1263), RTL layout corrected
- User confirmation: "grate"
- **Tier 3: 1/5 complete**

BL-12 (Temporary Exception — "פעולה זמנית"): ✅ merged to main — 2026-11-04 (local merge, not pushed)
- Branch: feature/bl-12-temporary-action (fast-forwarded into main at b95ba88). Scope: temp DELETE dropped (plain delete already exists) — only the temporary exception ships
- Behaviour: the temp exception applies to the report where it was set. In the NEXT report the finding arrives as a normal ACTIVE finding (counts toward risk) with a UI-only `_wasTempActioned` reminder banner; the temp memory entry is consumed once (pipeline deletes it in the findings transaction; wizi.js `applyProductMemory` flags + DELETEs, non-blocking). Purple badge + banner never reach the PDF/CSV; markers are stripped from ZIP and interactive-HTML exports. `consumed_at` column kept but unused
- Reminder/badge survive reload, version load, JSON import and autoRestore (applySnapshot keeps `_wasTempActioned`/`_tempActionReason`/`_sourceSubscription`/`exception.source`); permanent exception clears the banner; regression chapter and AI trend baseline ignore temp-excepted findings
- UI: footer button next to ⚠ החרג + ⋮ menu item; ⋮ moved next to the severity chip, high-contrast, viewport-aware flip, closes on outside click/Esc
- Also merged: toast notifications last 30s (all types, closable, newest 5 kept)
- Alembic introduced (alembic.ini, migrations/, requirements.txt) — 2 migrations. Local DB migrated 2026-11-01 (alembic_version 48749912a976; backup in instance/backups/pre-bl12-*)
- Follow-ups logged, unscheduled: BL-31 (pipeline-scanned findings lack `_sourceSubscription`), BL-32 (no "זמני" label in /api/exceptions list)
- Tests: 276 passed, 0 failed
- Cache-busters: builder.css v=182, main.js v=196
- **Tier 3: 2/5 complete**

BL-04 (PDF Bookmarks / Named Destinations): 🔄 in progress — started 2026-11-04
- Branch: feature/bl-04-pdf-bookmarks (rollback point: main @ bfc3405, nothing else touched)
- Finding: TOC links + 17 named dests already work (Chromium); the bookmarks/outline panel is empty (0 entries). Plan: try page.pdf(outline=True) (Playwright 1.49.1) before any pypdf/pikepdf. qa baseline before, qa after.

## Next session — where to resume (written 2026-11-04)

- State: `main` == `origin/main` at 75199df (pushed 2026-11-04); working tree clean. Tests: 276 passed.
- Next roadmap task: **BL-04 PDF Bookmarks / Named Destinations** (Tier 3 #3; needs pypdf/pikepdf post-processing after the Playwright render, so run the `qa` agent before and after touching pdf_service.py). Then BL-23. **BL-24 is design-first — no code until a design session.** Tier 4 starts with BL-14 (webhooks).
- Local `instance/app.db` is already migrated (alembic 48749912a976); backup: `instance/backups/pre-bl12-20261101-232213/` (app.db + -wal + -shm). Cloud deploy steps live only in `PRODUCTION_DEPLOY.md` — not tracked as roadmap tasks (still in local dev).
- Still genuinely open (older): DES-H-1 (table-row splitting; the specified selectors are inert in the PDF DOM) and the deliberately deferred PDF items PDF-D-01..04 in `.plan/improvements-and-fixes-roadmap.md` Phase 9.
- Unscheduled backlog (do not start without scheduling): BL-31 (pipeline findings lack `_sourceSubscription`), BL-32 (no "זמני" label in /api/exceptions), BL-33 (check app.pid / app.log leftovers).
- Decided 2026-11-04: CLAUDE.md, CONTEXT.md and docs/ stay local-only (ignored by `.gitignore` `*.md`) — do not upload them to git. Closed.
- Known, left as-is: browser bulk import turns `deleted` memory entries into exceptions (pre-existing); 3 inline-handler CSP console errors on page load (findings.js ~1349, pre-existing); `export-sanitize.js` / `regression-utils.js` load without a `?v=`.
- Environment notes: the user's own app runs inside WSL on port 8080 (never kill it; ask them to restart it after backend changes). Use `PORT=8765` for test servers. Playwright needs `channel="msedge"` (bundled Chromium is not installed). Test product for manual checks: `test` (v1.0 published).
