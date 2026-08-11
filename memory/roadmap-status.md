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
