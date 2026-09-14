# CSPM Report Builder — Implemented Feature Inventory

All features below are confirmed shipped to `main` per `memory/roadmap-status.md`. No backlog or planned items are included.

---

## 1. Report Management

### Report State and Autosave
The in-memory report state (`state.findings`, metadata, bulk import status) is declared once in `state.js` and imported by all other modules. The app autosaves the current snapshot to `cspm_report_autosave` in `localStorage` and displays a timestamp in the sticky header bar and below the sidebar progress bar.

### New Report Action
The "New Report" button (in `export.js`) clears `state.findings`, resets all metadata form fields (including cloud, env-stage checkboxes, date pickers, and cover image), removes the localStorage autosave entry, and navigates to the Report Details tab. A `styledConfirm` danger dialog is shown when unsaved data is present.

### JSON Snapshot Save and Load
Users can download the full report state as a JSON snapshot (Config Download) and reload it (Load Config). The load path calls `applySnapshot()` which applies all metadata and findings back into the form and `state.findings`. Round-trips are preserved including cover image, language preference, and env-stage checkboxes.

### CSV Export
The CSV export (in `export.js`) writes all findings sorted by severity (Critical → Info), with Hebrew column headers, array fields joined by `'; '` for Excel compatibility, exception columns (מוחרג / סיבת חריג), and a UTF-8 BOM for correct Excel encoding. The `id` column is excluded from output.

### Report Lifecycle: Draft → Published
Every product version starts as a `draft` snapshot. Drafts can be updated in-place. Publishing a draft via `POST /api/products/<id>/versions/<ver>/publish` sets `status = "published"` and stamps `published_at`. Once published, a snapshot is immutable — no route modifies a published snapshot's findings or metadata. Deletion of published snapshots is also blocked (returns HTTP 409).

### Pre-Publish Checklist
When an editor clicks "פרסם" on a draft version, `checkReportDetailsFilled()` in `products.js` checks all 14 required report detail fields (client name, subscription IDs, cloud, at least one env-stage checkbox, consultant, team, org, date, date range, risk select, version, exec summary, key topics). If any field is empty, a `styledConfirm` warning dialog appears before the normal publish confirm, allowing the editor to abort or proceed anyway. When all fields are filled the warning is skipped and the normal publish confirm fires directly.

---

## 2. PDF Export

### PDF Rendering Service (Playwright)
`PDFService` in `backend/services/pdf_service.py` uses Playwright's headless Chromium to render HTML to A4 PDF. Key fixed parameters: `margin.top=30mm`, `margin.bottom=20mm`, `margin.left/right=10mm`, `MAX_CARD_HEIGHT_PX=900`. The service applies `print` media emulation and supplies Playwright-native header/footer templates built from report metadata. HTML entities in metadata are escaped via `html.escape()` before injection.

### Tall-Finding Card Splitter
`PDFService` automatically splits finding cards that exceed `MAX_CARD_HEIGHT_PX` (900 px) into multiple page-safe segments. This prevents content cut-off on very long findings without manual page breaks.

### PDF Render Route
`POST /api/render-pdf` (in `backend/routes/reports.py`, `require_role("editor")`) accepts a JSON body with `{ html, meta }`, enforces a 20 MB size cap, passes the HTML to `PDFService.render_pdf()`, saves the output to the `output/` directory, and returns the PDF as an attachment with a descriptive filename (client + cloud + env stages + date, max 60 chars, slugified).

### PDF Filename Builder
`_build_pdf_filename()` in `reports.py` constructs a human-readable download filename from report metadata. Fields: client name, cloud platform, environment stage list (dev/test/prod/preprod), and report date converted from DD/MM/YYYY to ISO format. All components are slugified with `unicodedata.normalize`.

### Golden 5 Chapter (Conditional PDF Chapter)
`buildGolden5Html()` in `export.js` selects the top 5 non-excepted findings sorted by severity weight (critical=4, high=3, medium=2, low=1). Each card shows rank, title (max 80 chars), severity badge, impact (max 200 chars), and first recommendation (max 150 chars). The chapter is injected into the HTML string immediately before `POST /api/render-pdf`. Controlled by the "Include Golden 5 Chapter" checkbox (default checked, persisted in `export-pdf-lang` localStorage). Toggled from the export panel.

### Regression Chapter (Zombie Detection + Gemini Trend)
`export.js` maintains a `_loadedBaseline` reference set when the user loads a comparison snapshot. Before PDF rendering, if a baseline is loaded and the current report version is a minor version (e.g. `1.1`, `2.3`), `_detectZombies()` identifies findings that were previously excepted in the baseline but now reappear as active (matched by normalised title). `buildRegressionChapterHtml()` renders a zombie table and an AI-generated trend paragraph fetched from `POST /api/generate-regression-trend`. The chapter is injected into the PDF HTML and a TOC entry is added. Degrades gracefully if the Gemini call fails. Not triggered on major versions (`X.0`).

### Interactive HTML Export Route
`POST /api/export/html` (in `backend/routes/reports.py`, `require_role("editor")`) accepts the full report snapshot JSON (20 MB cap), renders it using Jinja2's `render_template("interactive_export_template.html")`, and returns the rendered HTML as a downloadable attachment named `report-YYYY-MM-DD.html`. No PDF pipeline is involved.

### HTML Report Upload
`POST /api/upload-html` (in `reports.py`, `require_role("editor")`) accepts an `.html` file via multipart or raw body, validates the extension, and saves it with a UUID suffix to the `output/` directory.

### Affected Resources Cap in Technical Details
When the Wiz vulnerability importer aggregates multiple affected resources into a single `f.technical` entry, the list is capped at 10 items. If more than 10 resources exist, the string is truncated with a `(+ N more — see Wiz report)` suffix, preventing a single `<li>` element from spanning multiple PDF pages. A safety-net `capTechnicalItem()` function in `findings.js` applies the same 300-character truncation to any legacy state already in memory before the cap was introduced.

### Executive Summary Risk Label (Always Computed)
The risk label displayed in the executive summary section of the PDF is always taken from `calcRiskScore().label` (computed from current findings) rather than the free-text `reportRisk` field. The label is followed by `(מחושב אוטומטית)` to indicate it is computed, eliminating the possibility of a user-entered risk label contradicting the computed risk score shown on the same page.

### Appendix A Framework Tags
The Appendix A compliance table now renders all policies for each finding via `f.policies.join(', ')` rather than only `f.policies[0]`, and derives the framework label from the same joined string rather than the hardcoded string `'ISO / NIST'`. For CSPM findings (where `importConfigFinding` maps Wiz `securitySubCategories` to framework names), the correct framework names now appear in both the Organisation/Policy and Framework columns. Findings with no policies still show `—`.

---

## 3. AI Integration (Gemini)

### GeminiService
`backend/services/ai_service.py` wraps the Google Gemini REST API. Supports multiple models (`gemini-2.5-flash`, `gemini-2.0-flash-exp`, `gemini-2.5-pro`) with automatic fallback to the next model on HTTP 429 (rate limit). All methods use urllib for HTTP calls with a configurable timeout and retry count. Credentials read from `GEMINI_API_KEY` environment variable; never logged.

### AI Text Improvement (Suggest)
`POST /api/suggest` (`require_role("editor")`) sends a text string and optional field hint to `GeminiService.improve_text()`. Returns improved Hebrew phrasing suitable for security reports. The model can be specified by the caller but is validated against a whitelist; invalid or missing model defaults to `gemini-2.5-flash`.

### AI Exception Reason Improver
A "✨ שפר ניסוח" button appears beneath the exception-reason textarea in two places: the Add Finding form and the detail-pane exception dialog. Both buttons call `POST /api/suggest` with `field: "exception_reason"` and replace the textarea value with the returned suggestion, dispatching an `input` event. Buttons are only attached when `ai_enabled` is true, guarded against double-attachment with sentinel classes, and show a loading state during the fetch. Errors surface via `showToast` rather than `window.alert`.

### AI Remediation Summarizer
`POST /api/summarize-remediation` (`require_role("editor")`) sends finding title, description, and remediation text to `GeminiService.summarize_remediation()`. Returns a 2–3 sentence explanation of the reasoning behind the remediation steps (why it works, not what to do). Output is in Hebrew with English technical terms preserved.

### AI Executive Summary Generator
`POST /api/generate-exec-summary` (`require_role("editor")`) accepts up to 500 findings (sanitised to safe scalar fields only, preventing prompt injection) and a client name. `GeminiService.generate_exec_summary()` produces a 3-paragraph formal Hebrew executive summary covering posture, key risk areas, and priorities.

### AI Key Topics Suggestion
`POST /api/generate-key-topics` (`require_role("editor")`) accepts up to 500 findings (sanitised to `{title, severity}` only) and a client name. `GeminiService.generate_key_topics()` sends up to 200 findings as `severity: title` lines to Gemini and returns 3–5 concise Hebrew topic strings (one per line), keeping technical terms like IAM, S3, VPC, and API in English. The `export.js` "✨ הצע נושאים" button in the Report Details tab populates the "נושאי מפתח" textarea, dispatches an `input` event, and is only attached when `ai_enabled` is true. A zero-findings guard prevents a network request when no findings are loaded.

### AI Regression Trend Generator
`POST /api/generate-regression-trend` (`require_role("editor")`) receives the previous snapshot data, current findings list, and zombie finding list. Inputs are sanitised (title truncated to 200 chars, severity to 20 chars). `GeminiService.generate_regression_trend()` returns a Hebrew trend paragraph comparing the two snapshots. Used by `export.js` to populate the regression chapter in minor-version PDF exports.

---

## 4. Wiz Integration

### WizService Authentication
`backend/services/wiz_service.py` manages OAuth 2.0 client-credentials flow against `WIZI_AUTH_URL`. Token expiry is tracked and refreshed proactively. A `threading.Lock` (`_token_lock`) prevents concurrent token-refresh races in multi-threaded gunicorn workers. Credentials are read from environment variables at call time and never logged.

### WizService GraphQL Execution
`WizService._graphql()` performs authenticated GraphQL requests over HTTPS using urllib. Supports cursor-based pagination via `fetch_all_findings_paginated()`, which loops until `hasNextPage` is false and accumulates all nodes. Used by both the single-query and bulk-import paths.

### Wiz Subscription Resolution
`WizService.resolve_subscription()` resolves a user-supplied subscription name to Wiz cloud account UUIDs, external IDs, and canonical names. Used by all query paths to translate user text input into API-level filter values. Falls back to fuzzy token-matching for client-side filtering when no exact match is found.

### Wiz Status Check
`GET /api/wizi/status` (`require_role("viewer")`) checks whether Wiz credentials are configured and executes a minimal `issues` query to verify connectivity. Returns `{ enabled, totalIssues }`.

### Wiz Projects and Subscriptions
`GET /api/wizi/projects` and `GET /api/wizi/subscriptions` (`require_role("editor")`) fetch paginated lists of Wiz projects and cloud accounts respectively, used to populate autocomplete inputs in the UI.

### Wiz GraphQL Proxy
`POST /api/wizi/graphql` (`require_role("editor")`) proxies a raw GraphQL query to Wiz. Mutations are blocked (line-comment stripping prevents bypass). Query size is capped at 10,000 characters.

### Wiz Schema Introspection
`GET /api/wizi/discover` (`require_role("admin")`) returns all root query field names via GraphQL introspection. `GET /api/wizi/introspect-type` (`require_role("admin")`) introspects a named input type or returns all root query field names.

### Wiz Filtered Single-Type Query
`POST /api/wizi/issues` (`require_role("editor")`) supports 11 Wiz query types (issues, configurationFindings, vulnerabilityFindings, hostConfigurationRuleAssessments, dataFindingsV2, secretInstances, excessiveAccessFindings, networkExposures, inventoryFindings, endOfLifeFindings, softwareSupplyChainFindings, malwareFindings). Accepts severity, status, project, and subscription filters, which are translated into the correct Wiz filter structure per query type. Uses `fetch_all_findings_paginated()` for the initial fetch; supports manual pagination via `after` cursor for "Load More".

### Wiz Bulk Fetch (All Query Types)
`POST /api/wizi/bulk-fetch` (`require_role("editor")`) fetches findings across all 9 supported query types for a subscription in a single call. `POST /api/wizi/bulk-fetch-single` fetches one query type at a time, used by the frontend for progress-tracked bulk import (one API call per query type, progress bar updated between calls).

### Wiz Find by ID
`POST /api/wizi/find-by-id` (`require_role("editor")`) implements a 6-strategy search cascade: direct UUID filter across all query types, then rule ID filter (issues), config finding rule filter, host config rule filter, cloud config rule short ID lookup (two-step), and free-text search fallback. Supports optional subscription scoping with client-side fuzzy filtering. Results are paginated.

### Wiz Ignore / Reject Issue
`POST /api/wizi/ignore-issue` (`require_role("editor")`) dispatches the correct Wiz mutation to set a finding status to `REJECTED`. Supports 11 query types via two mutation patterns: patch-style (configurationFindings, vulnerabilityFindings, etc.) and flat-style (dataFindingsV2, secretInstances). Issues use `REJECT_ISSUE_MUTATION`. NetworkExposures have no Wiz mutation and return a `notSupported` response. Issue UUID is validated with a regex before dispatch.

### Wiz Bulk Import — Keep Existing vs Start Fresh
Two distinct import modes in `wizi.js`. "Keep Existing" (הוסף לקיים) appends Wiz findings to the current `state.findings` without clearing them. "Start Fresh" (דוח חדש) clears `state.findings` entirely before import, requiring a double confirmation (styledConfirm + danger confirmation) to prevent accidental data loss. Both modes apply the exclude-rules filter.

### Exclude-Rules Engine (Pattern-Based Suppression)
`backend/models.py` defines the `ExcludeRule` ORM model (fields: `field` — title or category; `operator` — startsWith, contains, regex; `pattern`; `active`; `created_at`). Four CRUD routes at `/api/wizi/exclude-rules` (GET `viewer`, POST/PUT/DELETE `editor`) with allowlist validation on field and operator values. The `isExcludedByRules()` function in `exclude_rules.js` is called on every Wiz item in both the single-query path and the bulk import path before a finding is added to `state.findings`. The `[GovIL]` suppression rule previously hardcoded in `wizi.js` is now seeded as a DB row on app startup and managed through the UI.

---

## 5. Product Registry (Backend)

### Product CRUD
`GET /api/products` (`viewer`) lists all products with latest version and risk score. `POST /api/products` (`editor`) creates a product with a Hebrew-aware slug generator (`_slugify()` includes a transliteration table for all Hebrew letters) and collision-safe suffix deduplication. `GET /api/products/<id>` (`viewer`) returns a single product. `PUT /api/products/<id>` (`editor`) updates mutable fields (name, owner, ownerEmail, env, subscriptionIds, scanFrequency). `DELETE /api/products/<id>` (`admin`) cascades to all snapshots and memory entries.

### Product Version Lifecycle
`POST /api/products/<id>/versions` (`editor`) saves a new version snapshot. Version type must be `major`, `minor`, or `draft`. Draft versions are updated in-place; a new major/minor version cannot be created if a draft already exists (returns HTTP 409). Snapshot payload is split: findings stored as individual `Finding` rows, metadata stored in `snapshot_data` JSON. 50 MB payload size cap enforced before `get_json()`. `POST /api/products/<id>/versions/<ver>/publish` (`editor`) transitions a draft to published and stamps `published_at`. `DELETE /api/products/<id>/versions/<ver>` (`admin`) blocks deletion of published snapshots and any snapshot while a background scan is active (checked both in-memory via `_scan_jobs` and in DB via `_scan_status` with a 10-minute staleness guard).

### Version Numbering
`_next_version()` in `products.py` computes the next version string. First version is `1.0`. Major bump: `N+1.0`. Minor bump: `N.M+1` (wraps to `N+1.0` at M=9). Draft type reuses the current version. `_valid_version_str()` enforces `^\d+\.\d+$` format on URL parameters.

### Product Memory (Exception and Deletion History)
`GET /api/products/<id>/memory` (`viewer`) returns the full product memory as a dict keyed by `subscription::title`. `POST /api/products/<id>/memory/entry` (`editor`) upserts a memory entry with `source = "excepted"` or `"deleted"`. `DELETE /api/products/<id>/memory/entry` (`editor`) removes an entry. Capped at 2,000 entries per product. Used by the pipeline scanner to automatically re-apply exceptions and skip deleted findings in future scans.

### Cross-Product Exception List
`GET /api/exceptions` (`viewer`) queries every product's latest published snapshot and returns a flat list of all active exceptions across all products. Products with no published snapshot appear as placeholder rows. Results are sorted by product name ascending, then by published date descending.

### Risk Score Computation
`compute_risk_score()` in `backend/utils.py` calculates `(Critical×4) + (High×3) + (Medium×2) + (Low×1)` from non-excepted findings in a snapshot dict. Used by the version-save route, the pipeline scanner, and the AI regression-trend route.

---

## 6. Pipeline Dashboard (Backend)

### Pipeline Status Feed
`GET /api/pipeline` (`viewer`) returns all products joined with their latest published snapshot. For each product, `_pipeline_status()` computes a status label (`overdue`, `due_this_month`, `upcoming`, `no_scans`) based on `scan_frequency` (monthly/quarterly/annual) and `published_at`. Results are sorted by status urgency then product name.

### Automated Product Scan
`POST /api/pipeline/<id>/start-scan` (`editor`) validates that no draft snapshot already exists, creates a new draft snapshot, and starts a daemon thread (`_run_wiz_fetch`) that fetches all 11 Wiz query types for all selected subscriptions using a 3-worker `ThreadPoolExecutor`. Findings are de-duplicated by `(queryType, ruleId)` across subscriptions — the same rule found in multiple subscriptions is merged into one finding with all contributing subscriptions listed. Vulnerability findings are aggregated into a single summary finding when more than 0 raw results are returned (mirrors the `wizi.js` >5-vuln aggregation).

### Scan Progress Polling
`GET /api/pipeline/<id>/scan-status/<snapshot_id>` (`viewer`) returns the current scan progress from an in-memory `_scan_jobs` dict (fast path) or falls back to the `_scan_status` field on the snapshot record (for multi-worker gunicorn deployments). Completed jobs are evicted from memory after a 10-minute TTL.

### Finding Transformation (Server-Side)
`_transform_finding()` in `pipeline.py` mirrors the JavaScript import functions in `wizi.js` for all 12 query types, producing finding records in the same shape as UI-imported findings. `_extract_finding_title()` and `_extract_rule_id()` mirror `getWiziItemTitle()` and `getWiziRuleId()` from `wizi.js` to ensure Product Memory keys match between server-side scans and UI imports.

### Product Memory Applied During Scans
During `_run_wiz_fetch`, the pipeline looks up the product's `ProductMemoryEntry` rows. Findings matching a `"deleted"` entry are skipped entirely. Findings matching an `"excepted"` entry have their exception flag set and reason populated automatically, so they appear in the PDF with the exception banner without requiring manual action.

---

## 7. Authentication and Roles

### Google OAuth 2.0 Login
`GET /auth/login` initiates the Google OAuth flow via Authlib's `oauth.google.authorize_redirect()`. `GET /auth/callback` validates the token, checks email verification, applies a domain whitelist (`ALLOWED_DOMAIN` env var), and calls `get_or_create_user()`. On success, user email, role, and ID are stored in the Flask session.

### Bootstrap Admin
The first user to log in is automatically promoted to `admin` role. If `INITIAL_ADMIN_EMAIL` is set, only that specific email may claim the bootstrap slot; others are rejected until the admin adds them. Race condition between two concurrent first-logins is handled via `IntegrityError` catch + re-query.

### Role Hierarchy
Three roles: `viewer` (read-only), `editor` (can create/modify reports, import from Wiz, save versions), `admin` (can delete products, versions, and manage users). The `require_role(min_role)` decorator from `backend/services/auth_service.py` is applied to every route. The role hierarchy `viewer < editor < admin` is enforced via `_ROLE_ORDER` dict comparison. When `GOOGLE_CLIENT_ID` is not set (OAuth disabled), `require_role` is a no-op. An `APP_TOKEN` bearer header grants implicit admin access even in OAuth mode.

### User Management API
`GET /api/users` (`admin`) lists all users. `POST /api/users` (`admin`) creates a new user with a role. `PATCH /api/users/<id>` (`admin`) updates a user's role (self-demotion blocked). `DELETE /api/users/<id>` (`admin`) removes a user (self-deletion blocked). All managed via SQLAlchemy ORM.

### Admin Panel
`GET /admin` (`admin`) renders the `admin.html` template, providing a browser UI for user management.

### Current User Info
`GET /api/me` returns the authenticated user's email and role (or `authenticated: false` if not logged in). Used by the frontend to show/hide admin links and set the user info row in the sidebar.

### Auth Error Page
`GET /auth/error` renders a localised Hebrew error message for OAuth failures: domain mismatch, unauthorized user, forbidden, or invalid token.

---

## 8. File and State Management

### State File Upload
`POST /api/upload-state` (`editor`) accepts a JSON state file via multipart or raw body, validates JSON, writes atomically to `states/state_<uuid12>.json` via temp file + `os.replace()`. Returns the generated state ID.

### State File Download and Listing
`GET /api/download-state/<id>` (`viewer`) validates the state ID against `^[0-9a-f]{12}$` and serves the file. `GET /api/list-states` (`viewer`) scans the `states/` directory and returns metadata (client name, report date, file size) extracted from each file's `meta` block; marks corrupted files rather than failing.

### State File Deletion
`DELETE /api/delete-state/<id>` (`editor`) validates the ID format and removes the file.

### Output File Management
`GET /api/list-outputs` (`viewer`) lists files in the `output/` directory with pagination (default page size 100, max 200). `GET /api/download-output/<filename>` (`viewer`) uses `Path(filename).name` to prevent directory traversal and serves the file. `DELETE /api/delete-output/<filename>` (`editor`) validates the same way before deletion.

### Atomic File Writes
All state file writes use the `tmp_path → os.replace(final_path)` pattern to prevent partial-write corruption. The `init_directories()` function in `files.py` is called by `app.py` to inject the correct directory paths at startup.

---

## 9. Data Model / ORM

### User Model
`User` table (SQLAlchemy ORM): `id` (integer PK), `email` (string 254, unique, indexed), `role` (string 20, DB check constraint: admin/editor/viewer), `created_at` (datetime). Used for Google OAuth identity and role-based access control.

### Product Model
`Product` table: `id` (string 100, URL-safe Hebrew-transliterated slug, PK), `name` (string 100, unique), `owner`, `owner_email`, `env`, `subscription_ids` (JSON array), `scan_frequency` (DB check constraint: monthly/quarterly/annual), `created_at`, `latest_version` and `latest_risk_score` (denormalized, kept in sync on every save/delete for fast list-view queries).

### ReportSnapshot Model
`ReportSnapshot` table: `id` (integer PK), `product_id` (FK → products), `version` (unique with product_id), `report_version`, `version_notes`, `version_type` (major/minor/draft), `status` (draft/published), `saved_at`, `published_at`, `risk_score`, `snapshot_data` (JSON — full metadata minus findings). Findings stored separately in the `Finding` table.

### Finding Model
`Finding` table: `id` (integer PK), `snapshot_id` (FK → report_snapshots, indexed), `severity` (string, indexed, `server_default='medium'`), `exception_active` (boolean, indexed), `finding_data` (JSON — full finding payload). Indexed columns enable efficient risk score calculation without loading full payloads.

### ProductMemoryEntry Model
`ProductMemoryEntry` table: `id`, `product_id` (FK), `subscription` (string 200), `title` (string 500), `reason` (string 1000), `source` (excepted/deleted, DB check constraint). Unique constraint on `(product_id, subscription, title)`. Used to persist user decisions about findings across report cycles and automated scans.

### ExcludeRule Model
`ExcludeRule` table: `id` (integer PK), `field` (title or category), `operator` (startsWith, contains, regex), `pattern` (string 500), `active` (boolean), `created_at`. Used by both the Wiz import UI and pipeline scans to suppress matching findings before they enter `state.findings`.

---

## 10. Dashboard / UI Screens and Layout

### Two-Column RTL App Shell
Fixed right-anchored sidebar plus fluid main content area; `direction: rtl` globally; sidebar at `right: 0`, main content offset by `margin-right: var(--sidebar-width)`.

### Animated Mesh Background Canvas
90 moving dots with proximity line connections drawn on a `<canvas>` element inserted behind all panel content; dot and line colors adapt to dark and light theme in real time.

### Sticky Content Header Bar
Shows the active panel title (updated dynamically on tab switch) and autosave timestamp; `position: sticky; top: 0`.

### Dashboard KPI Row
Five cards — total findings, critical count, high count, medium count, low count — all live-updated from in-memory state.

### Dashboard Severity Donut Chart
Inline SVG with severity-colored segments and a center-text total count; legend positioned below the chart.

### Dashboard Category Bar Chart
Horizontal bars per finding category present in the current session, sorted by count descending, each bar color-coded to its category.

### Dashboard Risk Assessment Summary Card
Overall risk level in a large colored badge with total, critical, and high sub-counts.

### Dashboard Recent Findings Mini-Table
Last five findings with ID, category chip, truncated title, severity chip, and owner; "Show All" button navigates to the Findings List panel.

### Toast Notification System
`aria-live="polite"` container; used for success, error, and info feedback across all panels; null-guarded to avoid failures when the container is absent.

### Keyboard Shortcuts Overlay Dialog
Full-screen modal listing 7 shortcuts; toggled by pressing `?` (when no input is focused) or the sidebar button; closed by Escape, the close button, or clicking outside.

### Finding Preview Slide-In Panel
`#finding-preview-panel`; read-only summary of a selected finding with an "Edit Finding" action button.

### Wiz Auto-Fill Banner
Dismissible banner that appears when Wiz query data is available to pre-fill the report metadata fields; "Auto-fill" and dismiss action buttons.

---

## 11. Sidebar Navigation

### Three Accordion Sections
Clickable section labels with rotating chevron indicators and emoji section icons: Workspace (Dashboard, Report Details, Findings, Add Finding, Wiz Import — 5 tabs), Files and Reports (export panel, Server Files — 2 tabs), Products (Products, Scan Board, Exceptions List, Filter Rules — 4 tabs).

### Accordion Pinning Behavior
One section pinned open at a time; accordion state persists in `cspm_active_tab` localStorage.

### Collapsed Sidebar Mode
Narrows to 52px icon-rail; hover flyouts open to the left of the rail (RTL-correct); collapsed state in `cspm_sidebar_collapsed` localStorage.

### Sidebar Brand Area
"W" logo plus "Wizi REPORTER" text; clicking navigates to Dashboard.

### "New Report" Button
Shows cloud value and checked environment stage chips dynamically, or "No environment set".

### Findings Count Badge
Accent-colored pill auto-hidden when count is zero via CSS `:empty`.

### Sidebar Footer Utilities Row
Theme toggle, keyboard shortcuts button, language toggle (EN/HE), collapse/expand toggle; language and theme buttons hidden in collapsed sidebar mode.

### 4-Step Workflow Progress Bar
Percentage plus gradient fill bar plus "X of 4 steps" label; hover tooltip checklist: client name, cloud environment, findings, export report.

### Autosave Indicator
Last autosave timestamp below the progress bar.

### Sidebar User Info Row
Logged-in user email, admin panel link (admin role only), logout link; hidden when not authenticated.

---

## 12. Findings Management UI

### Add / Edit Finding Form
Category selector (9 options: CSPM, KSPM, DSPM, VULN, NEXP, EAPM, HSPM, SECR, EOLM), auto-generated read-only ID field (category prefix plus sequential number), pre-made template selector, finding title, severity selector, description, impact/risk, technical details, policies/standards, recommendations, owner, priority selector with "Other" free-text sub-input, evidence drag-and-drop zone (file picker, drag-and-drop, Ctrl+V clipboard paste with image preview), exception toggle with optional reason textarea, and action buttons (Add Finding Ctrl+Enter, Cancel Edit, Clear Form).

### Findings List Master-Detail Layout
List pane with full-text search, category filter, severity filter, "show excluded only" checkbox, category badge pill row, sort dropdown (Severity/ID/Title/Category/Owner), more-actions dropdown (AI enrich selected, AI enrich all, delete selected, delete all), page size selector (20/50/100/200), batch selection count, paginated findings table, and footer with findings count plus Add button. Detail pane with draggable resize handle, severity color accent bar, finding detail header, position indicator, 9-tab view (Description, Impact, Technical, Recommendations, Standards, Evidence, Additional Info, Notes, Excluded), inline exception confirmation dialog, footer navigation (Previous/Next/Copy/Expand/Exclude/Edit/Delete); the 9-tab strip is fully keyboard-accessible with ARIA tab pattern (role="tablist", role="tab", aria-selected, roving tabindex, RTL arrow-key navigation, and role="tabpanel" on the panel).

### Findings Keyboard Shortcuts
J/K navigate rows, E edit, D delete, Ctrl+Enter submit form, Ctrl+V paste image, left/right arrow navigate detail tabs.

---

## 13. Report Details Panel

### Top Action Bar
Save as Default, Load Default, Delete Default, Save as Product Version.

### Client Details Section
Client name, subscription IDs, cloud field, environment stage checkboxes (dev/test/prod/preprod as chips), consultant, team name, organization.

### Dates and Assessment Section
Date range picker pair, overall risk assessment dropdown (Low/Medium/High/Critical), report version field.

### Report Content Section
Executive summary textarea, key topics textarea.

### Settings and Design Section
Footer text, cover note, PDF language selector (Hebrew/English, persisted in `export-pdf-lang` localStorage), cover image upload with preview, AI model selector (conditionally visible).

---

## 14. Export / Files Panel UI

### Export Card
Export PDF (disabled when no findings), Export ZIP Bundle (disabled when no findings), Preview HTML, Download HTML, Export Interactive HTML, Export CSV (always enabled), "Include Golden 5 Chapter" checkbox (default checked, localStorage-persisted).

### ZIP Bundle Export
A single button labelled "ייצא ZIP" posts the rendered HTML, metadata, and findings list to `POST /api/export-zip`. The server renders the HTML to a PDF via Playwright, bundles `report.pdf` and `findings.json` (a versioned snapshot) into an in-memory ZIP archive, and returns it as an `application/zip` attachment. Nothing is saved server-side. The Golden 5 chapter is injected before the PDF render if the "Include Golden 5 Chapter" checkbox is checked. The download triggers `updateStepper()` and sets the `cspm_has_exported` localStorage flag, consistent with the PDF export flow.

### Import and Configuration Card
Download Config (JSON snapshot), Load Config (JSON snapshot), Import CSV, Compare to Previous (baseline JSON for regression comparison).

### Save to Server Card
Save to Server, Save as Product Version.

### Trend Comparison Area
Shown after baseline is loaded and compared.

---

## 15. Cloud Manager (Server Files) Panel

### Saved States List
List of server-saved JSON state files.

### Generated Outputs List
List of previously rendered PDF output files.

### Config Upload Input
Upload a JSON state file to the server.

---

## 16. Wiz Import Panel UI

### Bulk Import Sub-Tab
Subscription autocomplete, progress bar, sticky action bar (Import Selected, Select/Deselect All, expand/collapse all, selected count), results list.

### Find by ID Sub-Tab
Control ID/Short ID/UUID input, optional subscription filter, results area.

### Filtered Query Sub-Tab
Query type selector (10 Wiz API types), subscription autocomplete, multi-select severity/status filters, quantity limit (10/50/100/200/500), query presets (save/load/delete), progress bar, results area, "Load More" button, import selected action.

### Filter Rules Summary Sub-Tab
Active rule count badge, "Manage Filter Rules" navigation button.

---

## 17. Product Registry UI

### Grid / List View Toggle
Persisted in `products-view-mode` localStorage.

### Grid View
Card per product with risk score, environment, last version date, action buttons.

### List View
Table with Product Name, Environment, Version, Risk Score, Last Date, Actions columns.

### Per-Product Action Buttons
Timeline, edit, delete (event delegation).

### Empty-State Guard
View toggle hidden when no products exist.

### Product Version Timeline View
Version history for a product; "Export PDF" button for stored version snapshot (try/finally state restore). `_exportVersionAsPdf()` fetches the stored version JSON, reads the system `version` field, applies the snapshot, overrides the report-version DOM field before `buildReportHtml()`, and restores the original state via try/finally.

---

## 18. Pipeline Dashboard UI

### Scan Board Panel
Default landing panel on page load.

### Pipeline KPI Cards
Four cards: overdue, due this month, upcoming, never scanned — each clickable to filter the product table. Counts and status class derived from server data.

### Pipeline Filter Bar
Filter buttons (All, Overdue, This Month, Upcoming, Not Scanned) with active state highlighting.

### Pipeline Product Table
Sortable table with columns: Client, Environment, Frequency, Last Published, Next Due, Status, Actions. Empty state shown when no products match the current filter.

### Start Scan Action
"New Scan" button opens a subscription-selection dialog then calls `POST /api/pipeline/<id>/start-scan`. Progress is polled from `GET /api/pipeline/<id>/scan-status/<snapshot_id>` and displayed in a modal with a progress bar. On completion, the user is offered to open the draft version in the report editor.

---

## 19. Exception List UI

### Cross-Product Exception Table
Columns: Product, Finding, Severity, Category, Exception Reason, Date; aggregates data from all published product snapshots via `GET /api/exceptions`.

### Lazy-Loading on First Tab Activation
Fetched once per session with a module-scope `_loaded` guard; guard resets on error for retry.

### Text and Severity Filters
Client-side text search (product name or finding title) and severity dropdown filter, combined without re-fetch.

### Empty and No-Published State Rows
"No published version" placeholder and error state row.

---

## 20. Exclude-Rules UI

### Full Rules Panel
Add-rule form (field selector: Title/Category; operator: Starts With/Contains/Regular Expression; pattern input; Active checkbox; Add Rule button); rules table (pattern in `<code>`, field, operator, active toggle, delete with confirm dialog); inactive rule visual styling; toast notifications; eager rule fetch on module init via `_loadRules()`.

### Exclude-Rules Filter Summary (Wiz Sub-Tab)
Active rule count badge, navigate to full panel button.

---

## 21. PDF Report Layout Sections

### Running Header (All Pages)
Team name plus client and cloud block; report date plus consultant block.

### Running Footer (All Pages)
Footer text field value.

### Cover Page
Team name title, client name, cloud field, conditional test environment field, date range, consultant, report date, cover note.

### Table of Contents
Anchor links for all sections; Golden 5 entry conditional; Regression Chapter entry conditional.

### Section 1 — Executive Summary
Free-text paragraph plus overall risk level in bold.

### Section 1.5 — Golden 5 Chapter (Conditional)
Top 5 non-excluded findings sorted by severity weight; each card shows rank, title (80 chars), severity badge, impact (200 chars), first recommendation (150 chars); severity-colored left border; controlled by "Include Golden 5 Chapter" checkbox (localStorage-persisted); injected by JavaScript before POST to `/api/render-pdf`.

### Regression Chapter (Conditional)
Injected by `export.js` when a baseline snapshot is loaded and the current version is a minor version (e.g. 1.1, 2.3); contains zombie findings table (reappeared from baseline), Gemini AI-generated trend paragraph, "no zombies" fallback; TOC entry injected dynamically; degrades gracefully if Gemini fetch fails.

### Section 2 — Scope and Methodology
Sub-sections 2.1 Assessment Scope, 2.2 Tools Used, 2.3 Methodology Steps (bulleted list).

### Section 3 — Findings Summary by Severity
Table (severity, count with excluded sub-count, notes); sub-section 3.1 key topics list.

### Section 4 — Detailed Findings
Per-category page breaks; per-finding card (title, ID, severity badge, exception banner, Description, Business Impact, Technical Details with `dir="auto"` per list item, Policies/Standards tag list, Recommendations with `dir="auto"`, Priority, Evidence image).

### Section 5 — Recommendations and Treatment Plan
Table (Finding ID anchor, short description, Severity, Owner, Target Closure Date, Status "מוחרג"/"פתוח").

### Appendix A — Policy/Standards Mapping
Table (Finding ID, first policy, standard framework label, Notes).

---

## 22. Interactive HTML Export UI

### Self-Contained Single HTML File
CSS inline, JS inline, findings data as `window.__REPORT_DATA__` JSON literal; zero external dependencies, offline-capable.

### Report Header Block
Client name as heading; risk level badge; meta row (date, cloud, consultant).

### Controls Bar
RTL text search (title/description/category), severity dropdown filter, "Show exceptions" checkbox — combined client-side filtering.

### Live Summary Bar
Visible active finding count plus per-severity breakdown; label switches Hebrew/English based on exceptions checkbox.

### Collapsible Finding Cards
Expand/collapse on header click with chevron rotation; card header (severity border-right, title, ID, severity badge, exception badge, category chip, chevron); excepted cards grey border; card body sections (Description, Impact, Technical, Policies, Recommendations, Priority, Owner, Evidence flex-wrap grid, Exception block).

### Empty State
Shown when no findings or all filtered out.

### Report Footer
Generator attribution.

---

## 23. RTL / i18n Features

### Default RTL Document
`<html lang="he" dir="rtl">` on all pages.

### RTL Sidebar Anchoring
Fixed `right: 0`; active tab indicator on `border-right`; main content `margin-right`; collapsed flyout opens leftward via `right: 100%`.

### RTL Interactive HTML Export
`dir="rtl"` on `<html>`, `direction: rtl; text-align: right` on body; `padding-right` for list indentation; severity on `border-right`.

### `dir="auto"` on PDF List Items
Per-`<li>` direction self-detection for mixed Hebrew/English content.

### `ltr-overrides.css`
Complete `[dir="ltr"]` attribute-selector override file flipping physical properties for English mode.

### Hebrew / English Language Toggle
`#btn-lang-toggle` in sidebar footer; displays "EN" in Hebrew mode, "HE" in English mode.

### `setLang()` Behavior
Sets `lang`/`dir` on `<html>`; translates `data-i18n` elements via `textContent` (XSS-safe); updates `data-i18n-title` tooltip titles; updates toggle label.

### 248 `data-i18n` Attributes
Covering all user-facing labels, buttons, options, section titles, tooltips, placeholders.

### Hebrew Fallback Mechanism
`TRANSLATIONS.he` intentionally empty; key itself is the Hebrew display string.

### UI Language Persistence
`ui-lang` localStorage key; restored on every page load via `setLang(getLang())`.

### PDF Report Language Selector
Hebrew/English in Report Details; persisted in `export-pdf-lang` localStorage.

### Dark / Light Theme Toggle
`data-theme="light"` attribute on `<html>`; persisted in `cspm_theme` localStorage; mesh background adapts to theme.

### Draft Watermark on Unpublished PDF
When exporting a product version PDF whose status is `'draft'`, every page shows a large diagonal faint grey watermark ("טיוטה" in Hebrew reports, "DRAFT" in English reports) centered behind content. The watermark is injected as a separate `<style>` block via `buildReportHtml({ isDraft: true })` and uses `position: absolute` on `.page-section::before` so it is Playwright-safe. Published versions and the standalone Report Builder PDF export never receive the watermark.

### Sidebar Section Group Color Coding
Workspace = blue, Files and Reports = orange, Products = yellow-green; active items inherit group accent color via CSS custom properties.
