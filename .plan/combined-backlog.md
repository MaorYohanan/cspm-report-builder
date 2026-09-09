# CSPM Report Builder — Combined Improvement Backlog

_Merged from: `single-agent.md` (solo brainstorm) + `team-agents.md` (team brainstorm)_
_Ranked by impact-to-effort ratio: H/S → H/M → H/L → M/S → M/M → L/S_
_Feature items separated at bottom. Solo item #27 (general WCAG audit) dropped — superseded by specific team accessibility findings._

| # | Title | Dimension | Effort | Impact | Source | Owner/Angle | Description |
|---|-------|-----------|--------|--------|--------|-------------|-------------|
| 1 | `#batch-actions` silently broken by `!important` | UI/UX | S | H | Team | Designer | `components.css` sets `display: none !important` — `updateBatchActions()` can never show the bar; multi-select batch delete/severity/AI-enrich are fully non-functional. |
| 2 | Move `escapeHtml` to `core.js` + fix table/preview XSS | Reliability | S | H | Solo | — | `escapeHtml` lives in `findings.js` creating a circular-import risk; moving it to `core.js` also unblocks fixing raw-string injection in the findings table, preview panel, and dashboard that the audit confirmed but Phase 5 only partially addressed (category+id only — title, owner, description are still raw). |
| 3 | `renderDashboard` XSS in `ui.js` | Reliability | S | H | Solo | — | `ui.js` inserts finding data directly into innerHTML without `escapeHtml` (which it can't import because `escapeHtml` is in `findings.js`); unblocked entirely once item #2 is done. |
| 4 | Startup auth-bypass guard | Reliability | S | H | Solo | — | If neither `GOOGLE_CLIENT_ID` nor `APP_TOKEN` is set on a fresh deploy, every endpoint is fully open; add a startup `RuntimeError` that refuses to launch without at least one auth method configured. |
| 5 | Add `Content-Security-Policy` header | Tech Debt | S | H | Solo | — | `app.py` sends no CSP header; a single `@app.after_request` hook adding `default-src 'self'; script-src 'self'` eliminates the whole class of injected-script attacks. |
| 6 | `_scan_jobs` dict threading lock | Reliability | S | H | Solo | — | `scan_state.py`'s `_scan_jobs` dict is read/written from multiple threads (background worker + Flask request thread) with no lock, a race that can silently corrupt or lose scan-job state. |
| 7 | Wiz API retry with backoff | Reliability | S | H | Solo | — | `wiz_service.py` makes GraphQL calls with no retry; transient Wiz 5xx failures surface as immediate errors; add 2–3 retries with exponential backoff, mirroring the pattern already in `ai_service.py`. |
| 8 | `styledConfirm` HTML injection → XSS | Reliability | S | H | Solo | — | `core.js` `styledConfirm()` concatenates caller-supplied text directly into an innerHTML template; a finding title containing `<script>` triggers XSS on any delete/confirm action. |
| 9 | Infinite pagination loop when `endCursor` is null | Reliability | S | H | Team | Developer | `fetch_all_findings_paginated()` and `fetch_cloud_accounts()` loop forever if Wiz returns `hasNextPage: true` with `endCursor: null`; `fetch_projects()` already has the correct break guard. |
| 10 | `api_wizi_bulk_fetch` unguarded `resolve_subscription` returns 500 | Reliability | S | H | Team | Developer | `resolve_subscription()` called before any `try/except`; the sister route already has a 502 wrapper — apply the same pattern. |
| 11 | No `page.pdf()` timeout — Playwright hangs indefinitely | Reliability | S | H | Team | Developer | `page.goto()` has a 30 s timeout; `page.pdf()` has none, blocking the Flask worker forever on a Chromium stall. |
| 12 | Dark-mode WCAG AA contrast failures on muted text and placeholders | Accessibility | S | H | Team | Designer | `--text-muted` on card bg ≈ 3.8:1 and `::placeholder` on input bg ≈ 2.7:1 — both below the 4.5:1 minimum. |
| 13 | Animated mesh canvas bypasses `prefers-reduced-motion` | Accessibility | S | H | Team | Designer | `ui.js` runs a perpetual `requestAnimationFrame` loop regardless of OS reduce-motion; only CSS transitions are suppressed. |
| 14 | Toast container not announced to screen readers | Accessibility | S | H | Team | Designer | `#toast-container` has no `role="status"` or `aria-live`; toasts auto-dismiss at 3 s and are never read aloud. |
| 15 | `sidebar-item` buttons use `aria-selected` on invalid role | Accessibility | S | H | Team | Designer | `aria-selected` is not permitted on `role="button"`; screen readers ignore the state — replace with `aria-current="page"` or a proper tablist. |
| 16 | Remove real Kubernetes CSV from git history | Reliability | S | H | Solo | — | `kubernetes/kubernetes_clusters.csv` contains 33 rows of real AWS account IDs and cluster names; `git rm --cached` + `.gitignore` + history rewrite is a one-time operation that eliminates an already-committed data exposure. |
| 17 | PDF generation progress indicator | UI/UX | M | H | Both | Designer | ~~Moved to `.plan/backlog.md`~~ |
| 18 | N+1 DB queries in `list_products()` | Performance | M | H | Both | Developer | One `_latest_snapshot()` query per product in a Python loop (51 queries for 50 products); `get_pipeline()` already shows the correct single-subquery pattern. |
| 19 | Session role not re-read from DB — demoted users retain access | Reliability | M | H | Solo | — | A demoted user retains their old role for up to 8 hours because `require_role()` reads `session["role"]` set at login; re-read from DB once per request (cacheable with a short TTL in the session). |
| 20 | Bearer token URL exposure (`APP_TOKEN` as `?token=`) | Reliability | M | H | Solo | — | `app.py` accepts the APP_TOKEN as a URL query param for download links, which leaks it into server logs, browser history, and HTTP `Referer` headers; replace with short-lived signed tokens or remove query-param support. |
| 21 | Extract shared `_persist_findings()` service | Tech Debt | M | H | Solo | — | Findings-insertion logic is duplicated (with drift) across `products.py` and `pipeline.py`; one path computes risk score and the other doesn't; extract into `backend/services/snapshot_service.py`. |
| 22 | Modal dialogs missing focus trap and ARIA semantics | Accessibility | M | H | Team | Designer | `.kbd-overlay` and `styledConfirm` dialogs lack `role="dialog"`, `aria-modal`, and focus trapping — keyboard users can Tab past them. |
| 23 | 2N+1 DB queries in `list_exceptions()` | Performance | M | H | Team | Developer | 41 round-trips for 20 products per page load; rewrite as a single JOIN with a subquery on the latest published snapshot per product. |
| 24 | No rate limiting on AI and Wiz import endpoints | Security | M | H | Team | Developer | `/api/suggest`, `/api/generate-exec-summary`, Wiz bulk-fetch, etc. have no per-user/per-IP rate limiting; a loop exhausts Gemini quota or Wiz API limits. |
| 25 | No HTTP-level tests for any `wiz.py` routes | Testing | M | H | Team | QA | All `wiz_bp` endpoints — auth, body validation, 501/502/400 branches — have zero coverage. |
| 26 | No HTTP-level tests for any `pipeline.py` routes | Testing | M | H | Team | QA | Auth enforcement, 409 draft-exists conflict, subscription validation, and in-memory status fallback are all untested. |
| 27 | Scan status stuck `"fetching"` permanently after server restart | Reliability | M | H | Team | Developer | `_scan_jobs` is in-memory; restart while scanning leaves snapshots permanently in `"fetching"` with no recovery. Add startup migration to set them to `"error"`. |
| 28 | Move `buildReportHtml` → `export.js` + extract embedded CSS | Tech Debt | L | H | Solo | — | The 900-line `buildReportHtml` function and its ~500-line embedded stylesheet live in `findings.js`; moving to `export.js` and extracting the stylesheet to `assets/report.css` cuts `findings.js` from ~3,200 to ~1,800 lines. |
| 29 | Refactor `renderFindingsTable` into focused sub-functions | Tech Debt | L | H | Solo | — | One 250-line function handles filtering, sorting, pagination, HTML generation, event wiring, checkboxes, inline editing, drag-drop, and sort headers; split into at least 6 named functions, one concern each. |
| 30 | Wiz bulk-fetch pagination blocks the Flask request thread | Performance | L | H | Team | Developer | `api_wizi_issues()` runs `fetch_all_findings_paginated()` synchronously on the worker thread for minutes; pipeline scan already offloads this to a daemon thread. |
| 31 | No Alembic migration infrastructure — schema drift on every deploy | Tech Debt | L | H | Team | Developer | Column changes use ad hoc `CREATE TABLE IF NOT EXISTS`; `ALTER TABLE` is hand-crafted with no rollback story despite Alembic being listed in the architecture doc. |
| 32 | `DELETE` operations check `resp.ok` before UI update | Reliability | S | M | Solo | — | `export.js` updates UI state (removes rows) before verifying the server returned success; a failed delete silently disappears from the UI but persists on the server. |
| 33 | Product edit/picker server-error guards | Reliability | S | M | Solo | — | `products.js` calls `.json()` on every response without checking `resp.ok`; a 4xx/5xx silently yields undefined data and the form populates with blank fields. |
| 34 | Extract `compareFindingsBySort()` shared comparator | Tech Debt | S | M | Solo | — | The same 5-column severity/priority sort comparator is copy-pasted verbatim in both `renderFindingsTable` and `buildReportHtml`; extract once into `state.js` or `core.js`. |
| 35 | Extract `isEligibleForAiEnrich(finding)` predicate | Tech Debt | S | M | Solo | — | AI-enrichment eligibility is checked in three separate places with slightly different conditions; extract into one named predicate to prevent the next drift from introducing a silent inconsistency. |
| 36 | Move `switchToTab` from `findings.js` → `ui.js` | Tech Debt | S | M | Solo | — | Navigation logic lives in the wrong module, coupling `findings.js` to sidebar/tab management; moving it to `ui.js` is a clean extraction with no behavioral change. |
| 37 | Loading skeletons for slow operations | UI/UX | S | M | Solo | — | ~~Moved to `.plan/backlog.md`~~ |
| 38 | Introspect/discover endpoints → Admin-only | Reliability | S | M | Solo | — | `/discover` and `/introspect-type` expose the full Wiz GraphQL schema to any Editor-role user; restrict to Admin role to limit the blast radius of a compromised Editor account. |
| 39 | `GEMINI_API_KEY` frozen at module import time | Tech Debt | S | M | Team | Developer | `ai.py` reads the key once at import — late `.env` loading or runtime rotation is invisible until restart; match `get_wiz_service()` read-at-call-time pattern. |
| 40 | `_wiz_service` singleton not refreshed on credential rotation | Tech Debt | S | M | Team | Developer | Rotating `WIZI_CLIENT_ID`/`WIZI_CLIENT_SECRET` at runtime has no effect; credentials are baked in at construction time. |
| 41 | `api_list_states` reads every state file on every request | Performance | S | M | Team | Developer | Opens and JSON-parses every `state_*.json` on each call with no pagination or caching; `api_list_outputs()` already has the right pattern. |
| 42 | `_framework_patterns` regexes recompiled per finding | Performance | S | M | Team | Developer | 13 `re.compile()` calls inside `_transform_finding()` — 13,000 redundant compilations per 1,000-finding scan; promote to module-level constants. |
| 43 | `output/` directory grows without eviction | Tech Debt | S | M | Team | Developer | Every PDF/HTML export writes a new file; nothing deletes old ones. Add TTL cleanup or a rolling max-count cap. |
| 44 | Gemini model names hardcoded — deprecation requires a code deploy | Tech Debt | S | M | Team | Developer | `GEMINI_MODELS` list hardcoded in `ai.py` and duplicated in `ai_service.py`; add a comma-separated env var with the current list as default. |
| 45 | Report version absent from PDF cover page | UI/UX | S | M | Team | Designer | Cover renders client/cloud/env/date/consultant but never `meta.reportVersion`; recipients cannot identify which version they are reading. |
| 46 | `titleMap` and `updateStepper()` hardcoded Hebrew bypass i18n | UI/UX | S | M | Team | Designer | Content-area tab titles and stepper tooltips are hardcoded Hebrew, not `t()` calls — English toggle leaves them in Hebrew. |
| 47 | Base `<select>` dropdown arrow at inline-start in RTL | UI/UX | S | M | Team | Designer | `background-position: right 10px center` places the arrow where Hebrew text begins; `.filter-select` already uses the correct `left 8px center`. |
| 48 | `.cat-badge` filters not keyboard-reachable | Accessibility | S | M | Team | Designer | `<span>` elements with click listeners but no `role="button"`, `tabindex`, or `keydown` handler — keyboard-only users can't filter by category. |
| 49 | `api_upload_html` lacks size cap and writes non-atomically | Reliability | S | M | Team | Developer | No body size check and uses `write_bytes()` in-place; a process kill mid-write leaves a corrupt file with no detection. |
| 50 | Wiz import endpoints missing explicit request body size guard | Reliability | S | M | Team | Developer | `get_json(silent=True)` with no prior size check; relies solely on a global `MAX_CONTENT_LENGTH` that may be absent. |
| 51 | `_get_token()` holds lock through full OAuth HTTP roundtrip | Performance | S | M | Team | Developer | Lock held for up to 15 s during `urlopen()`; all `ThreadPoolExecutor` threads stall on mid-scan token expiry. Move HTTP call outside the lock. |
| 52 | Move report utilities (`buildSnapshot`, `applySnapshot`, `buildFilename`, `calcRiskScore`) → `export.js` | Tech Debt | M | M | Solo | — | These helpers live in `findings.js` but logically belong in `export.js`; their current location forces `findings.js` to import from itself and inflates the file past 3,200 lines. |
| 53 | Move `save_version` business logic → `snapshot_service.py` | Tech Debt | M | M | Solo | — | The `save_version` route in `products.py` contains 115 lines of inline state management, version computation, risk scoring, and DB writes; move to a service so it can be tested without Flask context. |
| 54 | Move `_run_wiz_fetch()` → `scan_service.py` | Tech Debt | M | M | Solo | — | 95 lines of domain logic (Wiz fetch, Product Memory application, finding persistence) live in the `pipeline.py` route layer; extracting to a service makes it independently testable and decoupled from request context. |
| 55 | Refactor `importSelectedBulkFindings` (520 lines) | Tech Debt | M | M | Solo | — | `wizi.js` contains a 520-line import function that mixes API calls, aggregation strategies, de-duplication, and UI updates; extract each aggregation strategy as its own named function. |
| 56 | `renderDashboard()` chart labels bypass i18n | UI/UX | M | M | Team | Designer | All dashboard string literals are hardcoded Hebrew in `innerHTML` — not passed through `t()`; English toggle leaves the entire dashboard panel in Hebrew. |
| 57 | `get_version()` materialises full finding JSON for every finding | Performance | M | M | Team | Developer | Loads `f.finding_data` for every row on every call; a `?fields=` projection or lightweight summary endpoint would serve list-view without the full payload. |
| 58 | `publish_version` allows publishing an empty draft | Reliability | S | L | Team | Developer | No minimum-content guard before the draft → published status transition; a zero-finding draft becomes an immutable record. |
| 59 | `styledConfirm` uses `textContent` — `<br>` line breaks dropped silently | Tech Debt | S | L | Team | Developer | Callers in `export.js` pass strings with `<br>` expecting line breaks; `textContent` renders them as literal text. Switch callers to `\n` with `white-space: pre-line`. |

---

## Notes on Related Items

Items that touch the **same component** but describe different bugs — fix together in one pass:

- **#8 + #59** (`styledConfirm` in `core.js`): #8 is XSS via innerHTML; #59 is `<br>` silently dropped via textContent. The fix for #8 (switch to textContent) creates the problem in #59 if callers aren't updated simultaneously. Fix both in one PR.

- **#3 + #56** (`renderDashboard()` in `ui.js`): #3 is XSS via raw innerHTML insert; #56 is hardcoded Hebrew bypassing i18n. Fix XSS first (#3, which depends on #2), then i18n (#56).

- **#6 + #27** (`_scan_jobs` in `scan_state.py`): #6 is the threading race (no lock on dict access); #27 is the restart-recovery gap (stuck `"fetching"` state). Same dict, same function — fix the lock (#6) and the startup recovery (#27) in the same commit.

- **#2 + #3** (escapeHtml chain): #3 is blocked by #2. Moving `escapeHtml` to `core.js` first (#2) is the prerequisite that unblocks the `ui.js` fix (#3) and several others in the XSS chain.

---

## Feature Ideas

| Title | Effort | Impact | Description |
|-------|--------|--------|-------------|
| Admin user management UI | M | H | ~~Moved to `.plan/backlog.md`~~ |
| Report diff view (version comparison) | L | H | ~~Moved to `.plan/backlog.md`~~ |
| Scan-due push notifications | L | M | ~~Moved to `.plan/backlog.md`~~ |
