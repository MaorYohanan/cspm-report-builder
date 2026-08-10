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
