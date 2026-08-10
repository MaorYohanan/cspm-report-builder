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
