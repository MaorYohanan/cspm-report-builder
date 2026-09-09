# Audit Fixes Plan — CSPM Report Builder
_Schema: unified item template v1 — see docs/INDEX.md for legend._

**Source:** 2026-08-10 full codebase audit (86 findings across Developer, Designer, QA agents)
**Save to:** `.plan/audit-fixes.md` in project root (per CLAUDE.md convention) once approved
**Scope exclusions:**
- No auth/credential-based tests (QA-CRIT-1 skipped)
- `tests/test_ssc_query.py` stays in `tests/` — no relocation

---

## Phase 1 — Critical Backend Bugs (do first, highest data-integrity risk)

### DEV-CRIT-1 — Product Memory exception key matching
**Type:** Bug Fix
**Effort:** High
**Phase:** 1 — Critical Backend Bugs
**Files:** `backend/routes/pipeline.py` ~958–980
**What:** The `exception_keys` set uses `(e.subscription, e.title)` tuples built from `_extract_finding_title`, but the titles it produces differ from what the `import*Finding` functions in `wizi.js` store, causing exceptions to never match.
**Steps:**
1. Audit each branch of `_extract_finding_title` against its matching JS import function:
   - `issues` → `importIssueFinding` — title from `f["name"]`
   - `vulnerabilityFindings` → `importVulnFinding` — title from rule name
   - `hostConfigurationRuleAssessments` → `importHspmFinding` — title from rule title
   - `dataFindingsV2` → `importDataFinding` — title from classifier name
   - `endOfLifeFindings` → `importEndOfLifeFinding` — title from tech label + resource name pattern
   - `malwareFindings` → `importMalwareFinding` — title from `item.name`
   - `softwareSupplyChainFindings` → `importSscFinding` — title from finding name
   - `networkExposures`, `excessiveAccessFindings`, `secretInstances`, `inventoryFindings` — align similarly
2. For each mismatch found, update `_extract_finding_title` to produce the same string the JS import function stores.
**Verification:** Feed the same raw Wiz node through both `_extract_finding_title(node, qt)` and the JS-equivalent Python reimplementation and assert titles match for each query type.
**Tests:** `test_exception_key_matching.py` — feed a raw Wiz node through both `_extract_finding_title(node, qt)` and the JS-equivalent Python reimplementation, assert titles match for each query type. (No Wiz credentials needed — use fixture dicts.)

---

### DEV-CRIT-2 — Deleted Product Memory entries applied as exceptions
**Type:** Bug Fix
**Effort:** Medium
**Phase:** 1 — Critical Backend Bugs
**Files:** `backend/routes/pipeline.py` ~958
**What:** The exception query fetches all `ProductMemoryEntry` rows including deleted ones, causing deleted entries to be incorrectly applied as active exceptions instead of silently dropping their findings.
**Steps:**
1. Change the exceptions query to filter by `source="excepted"`:
```python
# Current (wrong):
exceptions = ProductMemoryEntry.query.filter_by(product_id=snap.product_id).all()

# Fix:
exceptions = ProductMemoryEntry.query.filter_by(
    product_id=snap.product_id, source="excepted"
).all()
```
2. Add a second query to collect deleted keys:
```python
deleted_keys = {(e.subscription, e.title) for e in ProductMemoryEntry.query.filter_by(product_id=snap.product_id, source="deleted").all()}
```
3. During finding insertion, skip findings that match `deleted_keys` entirely (do not add to snapshot at all).
**Verification:** Verify a deleted entry causes its finding to be absent from the snapshot, not marked `exception_active=True`.
**Tests:** Add to `test_product_memory.py` (Phase 8) — verify deleted entry causes finding to be absent from snapshot, not excepted.

---

### DEV-CRIT-3 — Background scan writes to published snapshot
**Type:** Bug Fix
**Effort:** Low
**Phase:** 1 — Critical Backend Bugs
**Files:** `backend/routes/pipeline.py` (in `_run_wiz_fetch` before the finding-write loop)
**What:** The background scan job does not re-check snapshot status before writing findings, allowing it to overwrite a snapshot that was published between scan start and write.
**Steps:**
1. Add an immutability guard before the finding-write loop in `_run_wiz_fetch`:
```python
snap = db.session.get(ReportSnapshot, snapshot_id)
if snap is None or snap.status == "published":
    _log.error("scan aborted: snapshot %s is published or missing", snapshot_id)
    return
```
2. Re-fetch from DB (not from the closure) so the check reflects current DB state at time of write.
**Verification:** Publish a snapshot mid-scan (simulate by setting `status="published"` in DB) and assert no findings are written.
**Tests:** Add to `test_pipeline.py` (Phase 8) — publish a snapshot mid-scan (simulate by setting status="published" in DB), assert that findings are NOT written.

---

### DEV-CRIT-4 — Bare `except Exception` swallows subscription resolution errors
**Type:** Bug Fix
**Effort:** Low
**Phase:** 1 — Critical Backend Bugs
**Files:** `backend/services/wiz_service.py` ~193–206
**What:** The UUID fallback in `resolve_subscription` catches all exceptions and silently sets `nodes = []`, causing the pipeline to query the entire tenant instead of failing loudly when subscription lookup fails.
**Steps:**
1. Replace the bare except in the UUID fallback:
```python
except Exception:
    nodes = []
```
With:
```python
except Exception:
    _log.exception("UUID subscription lookup failed for %r", subscription_name)
    raise RuntimeError(f"Subscription lookup failed: {subscription_name!r}")
```
2. Verify the caller (pipeline scan) receives and handles the `RuntimeError`.
**Verification:** Mock `_execute_query` to raise an exception and assert `RuntimeError` is raised (not silently swallowed).
**Tests:** `test_wiz_service.py` — mock `_execute_query` to raise, assert `RuntimeError` is raised (not silently swallowed).

---

## Phase 2 — High Backend Bugs

### DEV-H-1 — Orphaned Finding rows on mid-scan failure
**Type:** Bug Fix
**Effort:** Medium
**Phase:** 2 — High Backend Bugs
**Files:** `backend/routes/pipeline.py` ~966–1028
**What:** The finding-insert loop commits every 200 rows, so a mid-loop failure leaves partial committed findings in the DB with no way to roll back.
**Steps:**
1. Wrap the entire finding-insert loop in a single `try/except` that rolls back on any failure:
```python
try:
    for f in findings:
        db.session.add(Finding(...))
    db.session.commit()
except Exception:
    db.session.rollback()
    _log.exception("scan write failed, rolled back all findings for snapshot %s", snapshot_id)
    raise
```
2. If performance requires chunked commits, replace `db.session.commit()` every 200 rows with `db.session.flush()` and commit once at the end.
**Verification:** Simulate a failure mid-loop (e.g., raise in the middle of the finding list) and assert no findings remain in the DB for that snapshot.

---

### DEV-H-2 — `_token` dict race condition across threads
**Type:** Bug Fix
**Effort:** Low
**Phase:** 2 — High Backend Bugs
**Files:** `backend/services/wiz_service.py`
**What:** `WizService._token` is read and written by multiple threads without a lock, creating a race condition that can corrupt or duplicate token refresh requests.
**Steps:**
1. Add a `threading.Lock` in `WizService.__init__`:
```python
self._token_lock = threading.Lock()
```
2. Wrap all reads and writes to `self._token` in `with self._token_lock:` inside `_get_token()`.
**Verification:** Run concurrent token-fetch calls in a thread pool and assert no `RuntimeError` or mixed-state token is returned.

---

### DEV-H-3 — State file non-atomic write (CLAUDE.md violation)
**Type:** Bug Fix
**Effort:** Low
**Phase:** 2 — High Backend Bugs
**Files:** `backend/routes/files.py` ~56–60
**What:** `files.py` writes state JSON directly with `Path.write_text()`, violating the CLAUDE.md atomic-write requirement and risking a partial or corrupt file if the process crashes mid-write.
**Steps:**
1. Replace `Path.write_text()` with the atomic temp-file pattern:
```python
import os, tempfile
tmp = STATES_DIR / f".tmp_{state_id}.json"
tmp.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
os.replace(tmp, STATES_DIR / filename)
```
**Verification:** Assert state file is complete and readable after the write; assert no `.tmp_` files remain.
**Tests:** Add to `test_files.py` (Phase 8) — assert state file is readable after a simulated write.

---

### DEV-H-4 — Dead body-size check in `save_version`
**Type:** Bug Fix
**Effort:** Low
**Phase:** 2 — High Backend Bugs
**Files:** `backend/routes/products.py` ~474–499
**What:** The body-size check in `save_version` reads `request.get_json()` before checking the raw body length, so Flask has already consumed and buffered the body, making the size check ineffective.
**Steps:**
1. Read the raw body before calling `request.get_json()`:
```python
raw_body = request.get_data(cache=True)
if len(raw_body) > 50 * 1024 * 1024:
    return jsonify({"error": "Payload too large"}), 413
body = request.get_json(silent=True)
```
**Verification:** POST a body exceeding 50 MB and assert the endpoint returns 413.

---

### DEV-H-5 — `fetch_projects` ignores pagination
**Type:** Bug Fix
**Effort:** Low
**Phase:** 2 — High Backend Bugs
**Files:** `backend/services/wiz_service.py` ~353–364
**What:** `fetch_projects` fetches only the first page of projects instead of using the pagination loop pattern established in `fetch_all_findings_paginated`, silently truncating results for large tenants.
**Steps:**
1. Replace the single-page fetch with an auto-pagination loop matching `fetch_all_findings_paginated`:
```python
all_nodes, after = [], None
while True:
    data = self._execute_query(PROJECTS_QUERY, {"first": 500, "after": after})
    page = data.get("projects", {})
    all_nodes.extend(page.get("nodes", []))
    pi = page.get("pageInfo", {})
    if not pi.get("hasNextPage"):
        break
    after = pi.get("endCursor")
return all_nodes
```
**Verification:** Mock `_execute_query` to return two pages and assert both pages' nodes appear in the result.

---

### DEV-H-6 — Unsanitised user metadata in PDF header HTML
**Type:** Security
**Effort:** Low
**Phase:** 2 — High Backend Bugs
**Files:** `backend/services/pdf_service.py` ~96–138
**What:** User-supplied fields (`client`, `env`, `consultant`, `team_name`, `footer_text`, `report_date`) are interpolated directly into PDF header HTML without HTML-escaping, enabling HTML injection.
**Steps:**
1. Import `html` at the top of `pdf_service.py`.
2. Wrap every user-supplied field before interpolation:
```python
import html
client_s = html.escape(meta.get("client", ""))
env_s = html.escape(meta.get("env", ""))
# etc. for consultant, team_name, footer_text, report_date
```
**Verification:** Pass a metadata field containing `<script>alert(1)</script>` and assert the rendered PDF header shows the escaped literal string, not an injected tag.

---

### DEV-H-7 — `/api/render-pdf` accessible to viewer role
**Type:** Bug Fix
**Effort:** Low
**Phase:** 2 — High Backend Bugs
**Files:** `backend/routes/reports.py` ~38
**What:** The `/api/render-pdf` endpoint is decorated with `@require_role("viewer")`, allowing viewers to trigger expensive Chromium renders; only editors should be able to initiate new renders.
**Steps:**
1. Change the decorator:
```python
@require_role("editor")
```
**Verification:** Log in as a viewer and attempt to POST to `/api/render-pdf`; assert the response is 403.

---

## Phase 3 — Critical/High Frontend Bugs

### DES-CRIT-1 — Google Fonts external `@import` breaks PDF font metrics
**Type:** Tech Debt
**Effort:** Medium
**Phase:** 3 — Critical/High Frontend Bugs
**Files:** `static/css/src/base.css` line 1
**What:** `base.css` loads Inter via a Google Fonts `@import`, which fails in offline or sandboxed Playwright PDF renders, causing incorrect font metrics and layout shifts.
**Steps:**
1. Download Inter font files (woff2, weights 400/500/600/700/800) and place under `assets/fonts/inter/`.
2. Replace the Google Fonts `@import` with `@font-face` declarations pointing to `assets/fonts/inter/`.
3. Run `python3 build_css.py` to rebuild `builder.css`.
4. Run pdf-qa agent after to verify card heights are unaffected.
**Verification:** Render a PDF in an offline environment and confirm Inter font renders correctly with no fallback substitution.

---

### DES-CRIT-2 — Null-unguarded DOM queries crash `ui.js` module
**Type:** Bug Fix
**Effort:** Low
**Phase:** 3 — Critical/High Frontend Bugs
**Files:** `static/js/src/ui.js` ~157–175
**What:** `ui.js` queries `kbd-overlay`, `btn-kbd-help`, and `kbd-overlay-close` without null-checking, crashing the entire module when any of those elements are absent from the page.
**Steps:**
1. Wrap all three element lookups and all dependent handlers in null guards:
```js
const kbdOverlay = document.getElementById('kbd-overlay');
const btnKbdHelp = document.getElementById('btn-kbd-help');
const kbdClose = document.getElementById('kbd-overlay-close');
if (kbdOverlay && btnKbdHelp && kbdClose) {
  // all event binding here
}
```
**Verification:** Load a page that omits `kbd-overlay` and assert no JavaScript errors are thrown.

---

### DES-H-1 — Table rows split across PDF pages
**Type:** Bug Fix
**Effort:** Low
**Phase:** 3 — Critical/High Frontend Bugs
**Files:** `templates/report_template.html` ~90–208
**What:** The PDF report template has no `break-inside: avoid` rule on table rows, causing finding and treatment table rows to split across page breaks.
**Steps:**
1. Add to the PDF template's `<style>` block:
```css
.findings-table tr,
.treatment-table tr { break-inside: avoid; }
```
2. Run pdf-qa agent to confirm no row is split across pages in a real render.
**Verification:** Render a PDF with a long findings table and confirm no row is visually split across a page boundary.

---

### DES-H-2 — Select chevron at wrong side for RTL
**Type:** Accessibility
**Effort:** Low
**Phase:** 3 — Critical/High Frontend Bugs
**Files:** `static/css/src/components.css` ~299–304
**What:** The select element chevron is positioned at `left 10px center`, placing it at the physical left side instead of the logical start (right) for RTL, where it overlaps text in the Hebrew UI.
**Steps:**
1. Replace physical `background-position` with the logical equivalent in `components.css`:
```css
background-position: right 10px center; /* RTL inline-start */
padding-right: 28px;
padding-left: 10px;
```
2. Remove the competing override in `wizi.css` — consolidate to one rule in `components.css`.
**Verification:** Open the UI in Hebrew RTL mode and confirm the select chevron appears on the right side with no text overlap.

---

### DES-H-3 — Note delete button at wrong corner for RTL
**Type:** Accessibility
**Effort:** Low
**Phase:** 3 — Critical/High Frontend Bugs
**Files:** `static/css/src/findings.css` ~327–336
**What:** The note delete button is positioned at `left: 4px`, placing it at the physical left instead of the logical end (right) for RTL, where the button should appear.
**Steps:**
1. Fix the position:
```css
/* wrong: */
.detail-note-msg .note-delete { left: 4px; }
/* fix: */
.detail-note-msg .note-delete { right: 4px; }
```
**Verification:** In RTL mode, open a note and confirm the delete button appears at the right corner.

---

### DES-H-4 — Preview panel anchored to wrong side for RTL
**Type:** Bug Fix
**Effort:** Low
**Phase:** 3 — Critical/High Frontend Bugs
**Files:** `static/css/src/wizi.css` ~857–872
**What:** The preview panel uses `left: 0` and LTR-specific shadow and transform values, so it slides in from the wrong side in RTL layout.
**Steps:**
1. Change `left: 0` to `right: 0`.
2. Change `border-right` to `border-left`.
3. Change `box-shadow: 4px 0` to `box-shadow: -4px 0`.
4. Change `transform: translateX(-100%)` to `transform: translateX(100%)`.
**Verification:** Toggle the preview panel in RTL mode and confirm it slides in from the correct (right) side.

---

### DES-H-5 — Undocumented LTR exception in dashboard bar count
**Type:** Tech Debt
**Effort:** Low
**Phase:** 3 — Critical/High Frontend Bugs
**Files:** `static/css/src/dashboard.css` ~95–100
**What:** The `.dashboard-bar-count` rule uses `text-align: left` without a comment explaining the intentional LTR exception, making it look like a bug to future maintainers.
**Steps:**
1. Add a comment to document the intent:
```css
.dashboard-bar-count { text-align: left; /* intentional LTR: numeric digit alignment */ }
```
**Verification:** Code review — confirm comment is present and the rule is visually correct in RTL mode.

---

### DES-H-6 — Back button arrow wrong direction for Hebrew RTL
**Type:** Accessibility
**Effort:** Low
**Phase:** 3 — Critical/High Frontend Bugs
**Files:** `templates/admin.html` ~162, `index.html` ~204
**What:** "Back" / "חזרה" links use `←` (left arrow), but in RTL layout `→` (right arrow) points toward the start of the reading direction — the semantically correct direction for "back."
**Steps:**
1. Replace `←` with `→` in any "Back" / "חזרה" link text in `templates/admin.html` ~162 and `index.html` ~204.
**Verification:** In RTL mode, verify the back button arrow points right (toward start of reading direction).

---

### DES-H-7 — Sidebar collapse arrows semantically inverted
**Type:** Bug Fix
**Effort:** Low
**Phase:** 3 — Critical/High Frontend Bugs
**Files:** `static/js/src/ui.js` ~36–43
**What:** The RTL sidebar collapse toggle assigns `»` when expanded and `«` when collapsed, but for a right-side sidebar `»` should mean "open" (point toward where the sidebar lives) and `«` should mean "close."
**Steps:**
1. Swap the two character assignments in the sidebar toggle handler in `ui.js` ~36–43 so that:
   - Collapsed state (hidden sidebar) → arrow points right `»`
   - Expanded state (visible sidebar) → arrow points left `«`
**Verification:** Toggle the sidebar and confirm `»` appears when collapsed and `«` when expanded.

---

## Phase 4 — Medium Backend Bugs

### DEV-M-1 — GraphQL errors unchecked before data access in `resolve_subscription`
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/services/wiz_service.py` ~157–183
**What:** `resolve_subscription` accesses `data.get("data")` without first checking `data.get("errors")`, so GraphQL error responses are silently ignored and produce unexpected `None` results downstream.
**Steps:**
1. After `_execute_query`, check for errors before accessing the data key:
```python
if data.get("errors"):
    raise RuntimeError(f"GraphQL error in resolve_subscription: {data['errors']}")
```
**Verification:** Mock `_execute_query` to return `{"errors": [...]}` and assert `RuntimeError` is raised.

---

### DEV-M-2 — Pagination loop does not exit on null `endCursor`
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/services/wiz_service.py` ~345–350
**What:** The pagination loop sets `after = page_info.get("endCursor")` without guarding against `None`, so a response with `hasNextPage: true` but `endCursor: null` causes an infinite loop.
**Steps:**
1. After setting `after`, add a guard:
```python
after = page_info.get("endCursor")
if not after:
    break
```
**Verification:** Mock a page response with `hasNextPage: true, endCursor: null` and assert the loop exits after one iteration.
**Tests:** `test_bulk_filter.py` — `build_bulk_filter` with `endCursor=None`: assert loop exits (covers DEV-M-2).

---

### DEV-M-3 — Auth response missing `access_token` raises `KeyError`
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/services/wiz_service.py` ~106
**What:** `wiz_service.py` accesses `result["access_token"]` with a direct key lookup, so a malformed or unexpected auth response raises an opaque `KeyError` instead of a descriptive `RuntimeError`.
**Steps:**
1. Replace direct key access with `.get()` and raise on `None`:
```python
token = result.get("access_token")
if token is None:
    raise RuntimeError("Unexpected auth response: missing access_token")
```
**Verification:** Mock the auth response to return `{}` and assert `RuntimeError` is raised with the descriptive message.

---

### DEV-M-4 — Snapshot data access raises `AttributeError` when `last` is `None`
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/routes/pipeline.py` ~1127
**What:** `pipeline.py` accesses `last.snapshot_data` without guarding against `last` being `None`, raising `AttributeError` for products with no prior published snapshot.
**Steps:**
1. Change the assignment to:
```python
snap_data = dict(last.snapshot_data or {}) if last else {}
```
**Verification:** Run the pipeline for a product with no prior published snapshots and assert no `AttributeError` is raised.

---

### DEV-M-5 — Exception reason field not copied during auto-apply
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/routes/pipeline.py` ~979
**What:** When auto-applying exceptions, `pipeline.py` matches only on the key tuple without looking up the full entry object, so the `reason` field from the `ProductMemoryEntry` is never copied to the finding.
**Steps:**
1. Look up the full entry object (not just the key) when iterating exceptions.
2. Set `reason = mem_entry.reason` when marking a finding as excepted.
**Verification:** Add an excepted entry with a reason, run a scan, and assert the finding's `reason` field matches the entry's reason.

---

### DEV-M-6 — Version list query fetches all columns and lacks sort order
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/routes/products.py` ~455–461
**What:** The version list query in `products.py` fetches all columns and has no explicit sort order, wasting memory and returning results in an undefined order.
**Steps:**
1. Add `.with_entities(ReportSnapshot.id, ReportSnapshot.version, ReportSnapshot.status, ReportSnapshot.saved_at)` to restrict column fetch.
2. Add `order_by(ReportSnapshot.saved_at.desc())` to ensure consistent ordering.
**Verification:** Assert the response lists versions in descending `saved_at` order and that only the four expected fields are present per entry.

---

### DEV-M-7 — Wiz credentials read at module load instead of per-request
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/routes/wiz.py` ~56–59
**What:** `WIZI_CLIENT_ID` and `WIZI_CLIENT_SECRET` are read from the environment at module load time in `wiz.py`, so credential rotation or missing env vars at import time cause silent failures or stale values.
**Steps:**
1. Move `WIZI_CLIENT_ID` and `WIZI_CLIENT_SECRET` reads from module level into the route functions (or into a `get_wiz_service()` factory).
**Verification:** Set the env vars after import and assert the service picks up the new values without restart.

---

### DEV-M-8 — Raw exception message exposed in API error responses
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/routes/ai.py`, `backend/routes/wiz.py` (multiple locations)
**What:** Multiple routes return `jsonify({"error": str(e)})`, leaking internal exception details (stack traces, file paths, credentials) to API callers.
**Steps:**
1. Replace all occurrences of `return jsonify({"error": str(e)})` with:
```python
_log.exception("...")
return jsonify({"error": "Internal error"})
```
**Verification:** Trigger an internal error on each affected route and assert the API response body is `{"error": "Internal error"}` with no stack trace.

---

### DEV-M-9 — `notes` field has no length cap
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/routes/products.py` ~488–495
**What:** The `notes` field in `save_version` has no server-side length validation, allowing arbitrarily large strings to be stored in the database.
**Steps:**
1. Apply `notes = notes[:_MAX_REASON_LEN]` before saving (or return 400 if exceeded):
```python
notes = notes[:_MAX_REASON_LEN]
```
**Verification:** POST notes longer than `_MAX_REASON_LEN` and assert they are either truncated or rejected with 400.

---

### DEV-M-10 — Published snapshots can be deleted
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/routes/products.py` ~619
**What:** The snapshot delete endpoint in `products.py` does not check snapshot status, allowing published (immutable) snapshots to be deleted.
**Steps:**
1. Before deletion, add a status guard:
```python
if snap.status == "published":
    return jsonify({"error": "Cannot delete a published snapshot"}), 409
```
**Verification:** Attempt to DELETE a published snapshot and assert the response is 409.

---

### DEV-M-11 — `variables` parameter not validated as object
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/routes/wiz.py` ~159
**What:** The `variables` parameter in `wiz.py` is passed to `_execute_query` without validating it is a dict, allowing non-object JSON (e.g., a string or array) to cause an obscure downstream error.
**Steps:**
1. Add a type check before use:
```python
if not isinstance(variables, dict):
    return jsonify({"error": "variables must be an object"}), 400
```
**Verification:** POST `variables` as a JSON array and assert the response is 400 with the descriptive error message.

---

### DEV-M-12 — Page size parameter has no upper bound
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/routes/wiz.py` ~588–589
**What:** The `pageSize` parameter in `wiz.py` is used as-is without capping, allowing callers to request arbitrarily large pages and causing timeouts or OOM on the Wiz API.
**Steps:**
1. Cap `pageSize` at 500:
```python
page_size = min(int(request.json.get("pageSize", 100)), 500)
```
**Verification:** POST `pageSize: 10000` and assert the effective page size used is 500.

---

### DEV-M-13 — `_aggregate_vulns` initializes highest severity to `'high'` instead of `'low'`
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/routes/pipeline.py` ~809–856
**What:** `_aggregate_vulns` initializes `highest_sev = "high"`, causing a scan with only low-severity vulnerabilities to report `"high"` as the aggregate severity.
**Steps:**
1. Change the initialization:
```python
highest_sev = "low"
```
**Verification:** Run `_aggregate_vulns` with all-low-severity input and assert the result severity is `"low"`.
**Tests:** `test_pipeline_logic.py` — `_aggregate_vulns` with all-low-severity input: assert result severity is `"low"` (regression for DEV-M-13).

---

### DEV-M-14 — Pipeline due-date comparison mixes `datetime` and `date` types
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/routes/pipeline.py` ~86–91
**What:** The due-date comparison in `pipeline.py` compares a `datetime` object with a `date` object, causing a `TypeError` (or off-by-one depending on time component) on the exact due date.
**Steps:**
1. Normalize both sides to `.date()` before comparison:
```python
if next_due.date() < today.date():
```
**Verification:** Set `next_due` to exactly today and assert the status is `"due_this_month"` (not `"overdue"`).
**Tests:** `test_pipeline_logic.py` — `_pipeline_status` date boundary: exact due date returns `"due_this_month"` not `"overdue"` (regression for DEV-M-14).

---

### DEV-M-15 — Auth service commit error handling only catches `IntegrityError`
**Type:** Bug Fix
**Effort:** Low
**Phase:** 4 — Medium Backend Bugs
**Files:** `backend/services/auth_service.py` ~57–66
**What:** The commit in `auth_service.py` only catches `IntegrityError`, leaving all other DB exceptions (connection loss, constraint violations, etc.) unhandled and the session in a dirty state.
**Steps:**
1. Broaden the except clause and always rollback:
```python
except Exception:
    db.session.rollback()
    raise
```
**Verification:** Simulate a non-integrity DB error during commit and assert the session is rolled back and the exception propagates.

---

## Phase 5 — Medium Frontend Bugs

### DES-M-01 — CSS cache-bust query string out of sync between `index.html` and `admin.html`
**Type:** Tech Debt
**Effort:** Low
**Phase:** 5 — Medium Frontend Bugs
**Files:** `index.html:7`, `templates/admin.html:7`
**What:** The `?v=` cache-bust version number in the CSS `<link>` tag is not kept in sync across `index.html` and `admin.html`, so one page may serve stale CSS after a rebuild.
**Steps:**
1. After every `python3 build_css.py` run, update the `?v=` query string to the same value in both `index.html:7` and `templates/admin.html:7`.
**Verification:** After a CSS rebuild, confirm both files have identical `?v=` values.

---

### DES-M-02 — Language detection heuristic in PDF template unreliable
**Type:** Bug Fix
**Effort:** Low
**Phase:** 5 — Medium Frontend Bugs
**Files:** `templates/report_template.html` ~146, 163
**What:** The PDF template uses a `x[:1]|lower in 'abc...'` heuristic to detect text direction, which misclassifies mixed-language content; `dir="auto"` is the correct HTML standard approach.
**Steps:**
1. Replace the `x[:1]|lower in 'abc...'` heuristic with `dir="auto"` on the affected `<li>` elements.
**Verification:** Render a PDF with mixed Hebrew/English list items and confirm text direction is correct on each item.

---

### DES-M-03 — Duplicate `.tab-panel` CSS rule block in `components.css`
**Type:** Tech Debt
**Effort:** Low
**Phase:** 5 — Medium Frontend Bugs
**Files:** `static/css/src/components.css`
**What:** `components.css` contains two `.tab-panel` rule blocks; the earlier one is dead code that causes specificity confusion.
**Steps:**
1. Remove the earlier duplicate `.tab-panel` block (keep the later one at ~228).
2. Run `python3 build_css.py` to rebuild `builder.css`.
**Verification:** Confirm only one `.tab-panel` block exists in the source and the tab UI looks unchanged.

---

### DES-M-04 — Accordion `::after` chevron misaligned in RTL flex context
**Type:** Accessibility
**Effort:** Low
**Phase:** 5 — Medium Frontend Bugs
**Files:** `static/css/src/wizi.css` ~465–473
**What:** The accordion `::after` chevron uses `margin-right: auto` in a flex container, which pushes it to the logical end in LTR but to the wrong side in RTL.
**Steps:**
1. Replace `margin-right: auto` with `margin-left: auto` on the accordion `::after` chevron rule in `wizi.css` ~465–473.
**Verification:** Open the accordion in RTL mode and confirm the chevron appears at the correct side.

---

### DES-M-05 — Keyboard overlay toggle uses inline `style.display` instead of CSS class
**Type:** Tech Debt
**Effort:** Low
**Phase:** 5 — Medium Frontend Bugs
**Files:** `static/js/src/ui.js` ~158–165
**What:** The keyboard overlay toggle in `ui.js` manipulates `style.display` directly, bypassing CSS and making it harder to animate or theme.
**Steps:**
1. Replace the `style.display` toggle with a class toggle:
```js
kbdOverlay.classList.toggle('hidden')
```
2. Add `.hidden { display: none }` to the relevant CSS file.
**Verification:** Open and close the keyboard overlay and confirm it shows/hides correctly with the class toggle.

---

### DES-M-06 — Toast container access unguarded — crashes when element missing
**Type:** Bug Fix
**Effort:** Low
**Phase:** 5 — Medium Frontend Bugs
**Files:** `static/js/src/core.js` ~26
**What:** `showToast` in `core.js` accesses `toastContainer` without a null check, throwing a `TypeError` on pages that omit the toast container element.
**Steps:**
1. Add a guard at the start of `showToast`:
```js
if (!toastContainer) return;
```
**Verification:** Load a page without a toast container element and call `showToast()`; assert no error is thrown.

---

### DES-M-07 — Button-row gaps use per-button physical margins instead of flex `gap`
**Type:** Tech Debt
**Effort:** Low
**Phase:** 5 — Medium Frontend Bugs
**Files:** `static/css/src/components.css` ~372, 406
**What:** Button rows in `components.css` use per-button `margin-left`/`margin-right` for spacing instead of `gap` on the flex container, creating inconsistent RTL behavior and duplicated rules.
**Steps:**
1. Set `gap` on the flex button-row container.
2. Remove the per-button physical margin rules at ~372 and ~406.
**Verification:** Confirm button row spacing is visually identical in both LTR and RTL modes.

---

### DES-M-08 — Scan modal action row not centered — inconsistent with other modals
**Type:** Accessibility
**Effort:** Low
**Phase:** 5 — Medium Frontend Bugs
**Files:** `static/css/src/pipeline.css` ~226–229
**What:** `.pipeline-scan-modal-actions` uses a different alignment than other modal action rows, creating visual inconsistency.
**Steps:**
1. Set `justify-content: center` on `.pipeline-scan-modal-actions` to match other modals.
**Verification:** Open the pipeline scan modal and confirm the action buttons are centered, matching other modals.

---

### DES-M-09 — Finding `category` field not HTML-escaped before DOM insertion
**Type:** Bug Fix
**Effort:** Low
**Phase:** 5 — Medium Frontend Bugs
**Files:** `static/js/src/findings.js` ~46
**What:** `findings.js` inserts `f.category` into the DOM without escaping, while `f.title` and `f.owner` are already escaped with `escapeHtml()`, allowing HTML injection via the category field.
**Steps:**
1. Wrap `f.category` with the same escape function already used on other fields:
```js
escapeHtml(f.category)
```
**Verification:** Set a finding's category to `<img src=x onerror=alert(1)>` and assert it renders as escaped text, not an injected element.

---

### DES-M-10 — Auth pages duplicate inline styles instead of sharing a stylesheet
**Type:** Tech Debt
**Effort:** Medium
**Phase:** 5 — Medium Frontend Bugs
**Files:** `templates/login.html`, `templates/auth_error.html`
**What:** `login.html` and `auth_error.html` each contain duplicated inline styles that should be shared via a common stylesheet, making maintenance harder.
**Steps:**
1. Extract the shared inline styles into a minimal `auth.css`, or import `builder.css` with a scoped override class.
2. Remove the duplicated inline `<style>` blocks from both templates.
**Verification:** Confirm both auth pages render identically before and after the extraction.

---

## Phase 6 — Low Severity Items

#### Backend Low

### DEV-L-1 — `datetime.utcnow` deprecated — switch to timezone-aware equivalent
**Type:** Tech Debt
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `backend/models.py` ~17, 32
**What:** `models.py` uses `datetime.utcnow` as a column `default=` argument, which is deprecated in Python 3.12+ and returns a naive datetime without timezone info.
**Steps:**
1. Replace `datetime.utcnow` with `lambda: datetime.now(timezone.utc)` in both `default=` args.
**Verification:** Confirm inserted rows have timezone-aware `datetime` values by inspecting a newly created record.

---

### DEV-L-2 — Dead `WIZI_END_OF_LIFE_QUERY` alias not removed
**Type:** Tech Debt
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `backend/routes/wiz.py` ~101
**What:** `wiz.py` imports and aliases `END_OF_LIFE_QUERY` as `WIZI_END_OF_LIFE_QUERY` but the alias is never used; removing it reduces noise.
**Steps:**
1. Remove the unused `WIZI_END_OF_LIFE_QUERY` alias from `wiz.py` ~101.
2. Remove the dead import of `END_OF_LIFE_QUERY` if it has no other uses.
**Verification:** Run `python -m py_compile backend/routes/wiz.py` and assert no import errors; run existing tests to confirm no breakage.

---

### DEV-L-3 — `_safe_id` missing path-traversal guard present in `_safe_param`
**Type:** Security
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `backend/routes/pipeline.py` ~54–56
**What:** `pipeline.py` defines `_safe_id` without the path-traversal check present in `_safe_param` in `products.py`, creating an inconsistent and potentially exploitable sanitization gap.
**Steps:**
1. Add a path-traversal check to `_safe_id` matching the one in `_safe_param`, or extract both to a shared `backend/utils.py`.
**Verification:** Pass a value like `../secret` through `_safe_id` and assert it is rejected or sanitized.

---

### DEV-L-4 — Upstream Wiz failure returns 500 instead of 502
**Type:** Bug Fix
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `backend/routes/wiz.py` ~575
**What:** `api_wizi_bulk_fetch_single` returns 500 for upstream Wiz API failures, but 502 (Bad Gateway) is the semantically correct status code when the error originates from an upstream service.
**Steps:**
1. Change the error response status code from 500 to 502.
**Verification:** Simulate an upstream Wiz failure and assert the response is 502.

---

### DEV-L-5 — Unused `_weights` dict defined twice
**Type:** Tech Debt
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `backend/routes/pipeline.py` ~807, 961
**What:** `pipeline.py` defines `_weights` twice; neither definition is used because scoring uses direct `if/elif` logic, making both definitions dead code.
**Steps:**
1. Remove both `_weights` dict definitions at ~807 and ~961.
**Verification:** Run existing tests and confirm no `NameError` or behavior change.

---

### DEV-L-6 — Rate-limiter key ignores `X-Forwarded-For` header behind proxy
**Type:** Bug Fix
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `backend/app.py` ~235–236
**What:** The rate-limiter in `app.py` uses `request.remote_addr` as the key, which is the proxy IP when behind a load balancer, so all clients share a single rate-limit bucket.
**Steps:**
1. Change the rate-limiter key to:
```python
request.headers.get("X-Forwarded-For", request.remote_addr).split(",")[0].strip()
```
**Verification:** Send a request with an `X-Forwarded-For` header and confirm the rate-limiter keys on the forwarded IP.

---

### DEV-L-7 — `_rate_store` reads and writes not thread-safe
**Type:** Bug Fix
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `backend/app.py` ~240–255
**What:** `_rate_store` is accessed and mutated from multiple request-handling threads without a lock, creating a race condition that can corrupt rate-limit counts under load.
**Steps:**
1. Add a `threading.Lock` and wrap all `_rate_store` reads and writes with it.
**Verification:** Run concurrent requests in a thread pool and assert no `KeyError` or inconsistent count.

---

### DEV-L-8 — Output list endpoint missing pagination
**Type:** Feature
**Effort:** Medium
**Phase:** 6 — Low Severity Items
**Files:** `backend/routes/files.py` ~128–140
**What:** `api_list_outputs` returns all output files in a single response with no pagination, which degrades performance as the output directory grows.
**Steps:**
1. Add `?page=` and `?page_size=` query params to `api_list_outputs`.
2. Default `page_size=100` and slice the file list accordingly.
**Verification:** Create 150 output files, call the endpoint without params, and assert only 100 are returned.

---

### DEV-L-9 — `CLOUD_CONFIG_RULES_QUERY` missing pagination
**Type:** Feature
**Effort:** Medium
**Phase:** 6 — Low Severity Items
**Files:** `backend/queries.py` ~274–280
**What:** `CLOUD_CONFIG_RULES_QUERY` lacks `pageInfo { hasNextPage endCursor }` fields and no pagination loop, silently truncating results beyond the first page.
**Steps:**
1. Add `pageInfo { hasNextPage endCursor }` to the `CLOUD_CONFIG_RULES_QUERY` GraphQL query.
2. Add a pagination loop to the caller that follows `hasNextPage`/`endCursor`.
**Verification:** Mock a two-page response and assert both pages' nodes are returned.

---

### DEV-L-10 — `Finding.severity` allows `NULL` and has no server default
**Type:** Tech Debt
**Effort:** Medium
**Phase:** 6 — Low Severity Items
**Files:** `backend/models.py` ~82
**What:** `Finding.severity` is defined without `nullable=False` or a `server_default`, allowing null severity values to be inserted and breaking severity-based aggregation.
**Steps:**
1. Add `nullable=False, server_default="medium"` to the `Finding.severity` column definition.
2. Create and apply a database migration.
**Verification:** Attempt to insert a `Finding` without `severity` and assert the server default is applied; assert no existing rows have `NULL` severity after migration.

---

### DEV-L-11 — OAuth callback bare `except` swallows errors silently
**Type:** Bug Fix
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `backend/routes/auth.py` ~44–47
**What:** The OAuth callback handler's bare `except` block catches all exceptions without logging, making OAuth failures invisible in production logs.
**Steps:**
1. Add `_log.exception("OAuth callback error")` inside the bare `except` block.
**Verification:** Trigger an OAuth callback error and confirm the exception appears in logs.

---

### DEV-L-12 — `Product.name` missing `unique=True` constraint
**Type:** Tech Debt
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `backend/models.py` ~27
**What:** `Product.name` has no `unique=True` constraint, allowing duplicate product names to be created and confusing queries that look up products by name.
**Steps:**
1. Add `unique=True` to the `Product.name` column definition.
2. Create and apply a database migration.
**Verification:** Attempt to create two products with the same name and assert the second returns an error (409 or 422).

---

#### Frontend Low

### DES-L-01 — Sidebar collapse button uses physical `margin-left` instead of logical property
**Type:** Tech Debt
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `static/css/src/layout.css` ~276
**What:** `.sidebar-collapse-btn` uses `margin-left: auto`, a physical LTR property that breaks the layout intent in RTL; the logical property `margin-inline-end: auto` is correct.
**Steps:**
1. Replace:
```css
.sidebar-collapse-btn { margin-left: auto }
```
With:
```css
.sidebar-collapse-btn { margin-inline-end: auto }
```
**Verification:** Confirm the collapse button aligns correctly in both LTR and RTL modes.

---

### DES-L-02 — Competing `background-position` override in `wizi.css` conflicts with `components.css`
**Type:** Tech Debt
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `static/css/src/wizi.css` ~544
**What:** `wizi.css` contains a `background-position: right 6px !important` rule that conflicts with the consolidated rule being fixed in DES-H-2, creating specificity confusion.
**Steps:**
1. Remove the competing `background-position: right 6px !important` override from `wizi.css` ~544.
2. Ensure the canonical rule in `components.css` (from DES-H-2) covers all cases.
**Verification:** Confirm select chevrons render consistently across all pages with only the `components.css` rule active.

---

### DES-L-03 — Intentional RTL flex-end exception undocumented in `products.css`
**Type:** Tech Debt
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `static/css/src/products.css` ~258
**What:** `products.css` uses `flex-end` intentionally for the version action row in RTL, but the lack of a comment makes it look like a mistake to future maintainers.
**Steps:**
1. Add a comment:
```css
/* intentional: flex-end = inline-start in RTL for version action row */
```
**Verification:** Code review — confirm comment is present and the rule is intentional.

---

### DES-L-04 — `::before` chevron uses physical `margin-left` instead of logical property
**Type:** Tech Debt
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `static/css/src/components.css` ~769
**What:** The `::before` chevron in `components.css` uses `margin-left: 10px`, a physical property that causes incorrect spacing in RTL.
**Steps:**
1. Replace:
```css
margin-left: 10px
```
With:
```css
margin-inline-start: 10px
```
**Verification:** Confirm chevron spacing is correct in both LTR and RTL modes.

---

### DES-L-05 — PDF template missing `viewport` meta tag
**Type:** Bug Fix
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `templates/report_template.html` ~1
**What:** `report_template.html` lacks a `<meta name="viewport">` tag, which may affect rendering in browser preview mode (non-Playwright) and responsive PDF sizing.
**Steps:**
1. Add to `<head>`:
```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```
**Verification:** Open the template in a browser and confirm the layout is not zoomed or cut off.

---

### DES-L-06 — Decorative `::before` visible in print layout — should be screen-only
**Type:** Bug Fix
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `static/css/src/layout.css` ~370
**What:** A decorative `position: fixed` `::before` pseudo-element in `layout.css` is not scoped to `@media screen`, so it appears in print output and PDF renders.
**Steps:**
1. Wrap the decorative `::before` rule in `@media screen { ... }` so it is absent in `@media print`.
**Verification:** Render a PDF and confirm the decorative element is not visible; confirm it is visible in browser screen view.

---

### DES-L-07 — Autosave indicator uses physical `margin-left` instead of logical property
**Type:** Tech Debt
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `static/css/src/layout.css` ~163
**What:** `.autosave-indicator` uses `margin-left: 8px`, a physical property that produces incorrect spacing in RTL.
**Steps:**
1. Replace:
```css
.autosave-indicator { margin-left: 8px }
```
With:
```css
.autosave-indicator { margin-inline-start: 8px }
```
**Verification:** Confirm autosave indicator spacing is correct in both LTR and RTL modes.

---

### DES-L-08 — `.ac-sub` uses physical `margin-right` instead of logical property
**Type:** Tech Debt
**Effort:** Low
**Phase:** 6 — Low Severity Items
**Files:** `static/css/src/wizi.css` ~51
**What:** `.ac-sub` uses `margin-right: 6px`, a physical property that causes incorrect spacing in RTL.
**Steps:**
1. Replace:
```css
.ac-sub { margin-right: 6px }
```
With:
```css
.ac-sub { margin-inline-end: 6px }
```
**Verification:** Confirm `.ac-sub` spacing is correct in both LTR and RTL modes.

---

## Phase 7 — Frontend Improvements

### DES-I-01 — Tab elements missing `aria-selected` state management
**Type:** Accessibility
**Effort:** Low
**Phase:** 7 — Frontend Improvements
**Files:** `index.html`, `static/js/src/ui.js`
**What:** The tab-switch handler in `ui.js` does not update `aria-selected` on tab elements, so screen readers cannot determine which tab is active.
**Steps:**
1. In the tab-switch handler, set `aria-selected="true"` on the newly active tab.
2. Set `aria-selected="false"` on all other tab elements.
**Verification:** Use a screen reader (or accessibility inspector) and confirm the active tab is announced as selected.

---

### DES-I-02 — Dashboard SVG donut missing `role` and `aria-label`
**Type:** Accessibility
**Effort:** Low
**Phase:** 7 — Frontend Improvements
**Files:** `static/js/src/ui.js` ~252
**What:** The dashboard severity distribution SVG donut chart has no `role` or `aria-label`, making it invisible to assistive technology.
**Steps:**
1. Add `role="img"` and `aria-label="severity distribution donut chart"` to the dashboard SVG element.
**Verification:** Inspect the SVG with an accessibility tool and confirm it is announced as an image with the label.

---

### DES-I-03 — Show-all link uses `<a href="#">` instead of semantic `<button>`
**Type:** Accessibility
**Effort:** Low
**Phase:** 7 — Frontend Improvements
**Files:** `index.html` ~204
**What:** The "show all" control uses `<a href="#">`, which is semantically incorrect for an action with no navigation; `<button type="button">` is the correct element.
**Steps:**
1. Replace `<a href="#">` with `<button type="button">` styled as a link.
**Verification:** Tab to the element and confirm it is announced as a button, not a link.

---

### DES-I-04 — Executive summary and scope not separated into distinct PDF page sections
**Type:** Tech Debt
**Effort:** Low
**Phase:** 7 — Frontend Improvements
**Files:** `templates/report_template.html` ~73
**What:** The executive summary and scope/methodology content share one HTML block, preventing clean page-break separation in the PDF output.
**Steps:**
1. Split executive summary and scope/methodology into separate `<section class="page-break">` elements.
2. Run pdf-qa agent to confirm page breaks appear at the correct locations.
**Verification:** Render a PDF and confirm executive summary and scope/methodology start on separate pages.

---

### DES-I-05 — No `prefers-reduced-motion` media query for animations
**Type:** Accessibility
**Effort:** Low
**Phase:** 7 — Frontend Improvements
**Files:** `static/css/src/base.css` (or a new `motion.css`)
**What:** The UI has CSS animations but no `prefers-reduced-motion` media query, causing motion for users who have opted out of animations in their OS settings.
**Steps:**
1. Add to `base.css` (or a new `motion.css`):
```css
@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; } }
```
2. Run `python3 build_css.py` to rebuild `builder.css`.
**Verification:** Enable "reduce motion" in the OS and confirm no animations play in the UI.

---

### DES-I-06 — Severity chip accent border on wrong side for RTL
**Type:** Bug Fix
**Effort:** Low
**Phase:** 7 — Frontend Improvements
**Files:** `static/css/src/components.css` ~570
**What:** The severity chip uses `border-left` for its accent, but all other RTL accent borders in the project use `border-right`; this chip is inconsistent.
**Steps:**
1. Change `border-left` to `border-right` on the severity chip rule in `components.css` ~570.
**Verification:** Confirm the severity chip accent appears on the right side in RTL mode, consistent with other chips.

---

### DES-I-07 — `oklch()` color used without browser support check or fallback
**Type:** Tech Debt
**Effort:** Low
**Phase:** 7 — Frontend Improvements
**Files:** `static/js/src/ui.js` ~259
**What:** `ui.js` uses `oklch()` color values without checking browser support, causing silent rendering failure in browsers that do not support `oklch()`.
**Steps:**
1. Before using `oklch()`, add a support check:
```js
if (!CSS.supports('color', 'oklch(0% 0 0)')) {
  // fall back to hex equivalent
}
```
**Verification:** Disable `oklch()` support in a test browser and confirm the hex fallback is applied.

---

### DES-I-08 — Delete user guard uses native `window.confirm` instead of styled dialog
**Type:** Tech Debt
**Effort:** Low
**Phase:** 7 — Frontend Improvements
**Files:** `templates/admin.html` ~261
**What:** The delete user action in `admin.html` uses `window.confirm(...)`, which renders an unstyled browser dialog inconsistent with the rest of the UI's styled confirmation dialogs.
**Steps:**
1. Replace `window.confirm(...)` with `styledConfirm(...)` from `core.js`.
**Verification:** Trigger the delete user action and confirm a styled dialog appears instead of the native browser dialog.

---

### DES-I-09 — Pipeline KPI card text centered instead of right-aligned
**Type:** Bug Fix
**Effort:** Low
**Phase:** 7 — Frontend Improvements
**Files:** `static/css/src/pipeline.css` ~16
**What:** Pipeline KPI cards use `text-align: center` while dashboard KPI cards use `text-align: right`, creating visual inconsistency between the two views.
**Steps:**
1. Change `text-align: center` to `text-align: right` on the pipeline KPI card rule in `pipeline.css` ~16.
**Verification:** Compare pipeline and dashboard KPI cards side by side and confirm both use right-aligned text.

---

## Phase 8 — Test Coverage (no Wiz credentials, test_ssc_query.py stays in tests/)

### Fix existing failing test

**`tests/test_bulk_filter.py` — SSC assertion**
The test expects `severity` and `status` keys for `softwareSupplyChainFindings`. The code intentionally returns `{}`. Update the test case to `("softwareSupplyChainFindings", {})`. This is the only currently failing test.

Also fix QA-API-H-1 divergence: align `wiz.py` `api_wizi_issues` SSC branch to also skip applying user-supplied severity/status (or document why the two paths differ with a comment). Pick one canonical behavior and apply it to both paths.

---

### New test files

#### `tests/test_pipeline_logic.py`
Unit tests for pipeline helper functions (no DB, no Wiz credentials):

- `test_pipeline_status_overdue` — `next_due` yesterday → `"overdue"`
- `test_pipeline_status_exact_boundary` — `next_due` is exactly today → `"due_this_month"` (regression for DEV-M-14)
- `test_pipeline_status_upcoming` — `next_due` 30 days out → `"upcoming"`
- `test_pipeline_status_no_scans` — no `published_at` → `"no_scans"`
- `test_aggregate_vulns_all_low` — all severity="low" nodes → result severity `"low"` (regression for DEV-M-13)
- `test_aggregate_vulns_mixed` — mix of critical/high → result severity `"critical"`

#### `tests/test_product_memory.py`
Uses in-memory SQLite via existing `conftest.py` app/client fixtures; registers `products_bp` + a minimal stub for Product Memory routes:

- `test_memory_excepted_entry_marks_finding` — save an excepted entry, run import transform, assert `exception_active=True`
- `test_memory_deleted_entry_drops_finding` — save a deleted entry, assert finding absent from result
- `test_memory_reason_preserved` — excepted entry with reason → reason appears in finding output

#### `tests/test_files.py`
Add `files_bp` to conftest (or a local fixture that calls `init_directories(tmp_path, ...)`):

- `test_upload_state_creates_file` — POST JSON, assert file exists under states dir
- `test_upload_state_atomic` — assert no `.tmp_` files left after write
- `test_list_states_pagination` — create 150 state files, assert default page returns ≤ 100

#### `tests/test_transform_finding.py`
Unit tests for `_transform_finding` (no DB, no Wiz credentials — pass raw fixture dicts):

One test per major query type using minimal fixture nodes:
- `issues`, `vulnerabilityFindings`, `hostConfigurationRuleAssessments`
- `malwareFindings` — assert `category="HSPM"`, title = `item["name"]`, file path in technical
- `dataFindingsV2`, `secretInstances`, `endOfLifeFindings`
- `softwareSupplyChainFindings`, `networkExposures`

Assert: `category`, `severity`, `title`, `technical` is a list, `recs` is non-empty.

#### `tests/test_products_extended.py`
Extend existing products coverage:

- `test_delete_published_version_rejected` — publish a snapshot, attempt DELETE, assert 409 (regression for DEV-M-10)
- `test_save_version_body_size_limit` — POST 51 MB body, assert 413
- `test_notes_length_capped` — POST notes > 1000 chars, assert truncated or 400

#### `tests/test_bulk_filter.py` additions
- Add `("malwareFindings", {"severity": {"equals": [...]}, "status": {"equals": [...]}, "cloudAccount": ...})` test case

#### `tests/test_wiz_service.py`
Unit tests for `WizService` helpers (mock `_execute_query`, no real Wiz API):

- `test_get_token_raises_on_bad_response` — mock auth server returns `{}`, assert `RuntimeError`
- `test_resolve_subscription_raises_on_network_error` — mock `_execute_query` to raise, assert `RuntimeError` (not silent)
- `test_pagination_exits_on_null_cursor` — mock page returns `hasNextPage: true, endCursor: null`, assert loop exits after 1 iteration

#### `tests/test_ai_service.py`
Mock `google.generativeai` client:

- `test_generate_summary_low_severity_adds_tone_hint` — critical=1, high=5 → assert tone-hint string in prompt passed to mock
- `test_generate_summary_high_severity_no_tone_hint` — critical=5 → assert tone-hint NOT in prompt
- `test_fallback_on_429` — first model raises 429, assert second model attempted

#### `tests/test_health.py`
- `test_health_includes_ai_fields` — GET `/api/health`, assert `"ai_enabled"` and `"ai_models"` present in JSON

---

## File Save Instruction

Per `CLAUDE.md`: once approved, save this plan to `.plan/audit-fixes.md` in the project root and add pointer to `MEMORY.md`:
```
- [Audit Fixes Plan](.plan/audit-fixes.md) — 86-finding fix plan from 2026-08-10 audit
```
Also add pointer to `docs/INDEX.md`.

---

## Suggested Execution Order

1. **Phase 1** (4 critical backend fixes) — branch `fix/audit-critical-backend`
2. **Phase 2** (7 high backend fixes) — branch `fix/audit-high-backend`
3. **Phase 3** (9 critical/high frontend fixes) — branch `fix/audit-critical-frontend`
4. **Phase 8 partial** (fix failing test + add pipeline/transform/wiz-service/bulk-filter tests) — alongside Phase 1-2 work
5. **Phase 4** (15 medium backend) — branch `fix/audit-medium-backend`
6. **Phase 5** (10 medium frontend) — branch `fix/audit-medium-frontend`
7. **Phase 8 remainder** (product memory, files, products-extended, ai, health tests) — branch `fix/audit-tests`
8. **Phase 6** (low items) — branch `fix/audit-low`
9. **Phase 7** (improvements) — branch `fix/audit-improvements`

Each branch: run `pytest tests/ -x -q`, pass cspm-reviewer, merge to main, update `memory/roadmap-status.md`.
