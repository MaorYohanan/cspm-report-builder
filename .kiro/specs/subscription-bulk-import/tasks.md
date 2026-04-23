# Implementation Plan: Subscription Bulk Import

## Overview

Implement the "ייבוא מרוכז" (Bulk Import) feature by adding a Flask backend endpoint that orchestrates all 9 Wiz query types for a given subscription, and a client-side UI module in `builder.js` that renders the aggregated results and imports selected findings using the existing `import*Finding()` functions.

## Tasks

- [x] 1. Add `/api/wizi/bulk-fetch` backend endpoint to `app.py`
  - [x] 1.1 Implement the `api_wizi_bulk_fetch()` route with subscription resolution
    - Add `@app.route("/api/wizi/bulk-fetch", methods=["POST"])` after the existing `api_wizi_issues` route
    - Validate that `subscription` field is non-empty; return 400 with Hebrew-friendly error if missing
    - Reuse the existing subscription resolution block from `api_wizi_issues()` (cloudAccounts search → UUIDs + externalIds)
    - Return `resolvedSubscription` dict with `ids`, `externalIds`, `names` fields
    - _Requirements: 1.1, 1.3, 1.4, 2.1_

  - [x] 1.2 Implement per-query-type filter construction and sequential fetching
    - For each of the 9 query types, build a `filterBy` dict using the same field mapping already in `api_wizi_issues()`:
      - Severity: `["CRITICAL", "HIGH"]` (plain list for issues/config/vuln/host; `{equals:[...]}` for data/secret/excessive/inventory)
      - Status: `["FAIL"]` for `configurationFindings`; `["OPEN", "IN_PROGRESS"]` for all others (same wrapping rules)
      - Subscription: UUID-based fields for issues/configurationFindings/hostConfigurationRuleAssessments/inventoryFindings; externalId-based for vulnerabilityFindings/dataFindingsV2/secretInstances/networkExposures; no filter for excessiveAccessFindings
    - Fetch up to 500 results per type (`first: 500`)
    - Catch per-query exceptions, store error string in `errors[queryType]`, continue loop
    - Return `{"results": {...}, "resolvedSubscription": {...}, "errors": {...}}`
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_

  - [x] 1.3 Write property test for filter construction (Property 1)
    - **Property 1: Filter construction produces correct filter object per query type**
    - Use `hypothesis` to generate random query types (from the 9 valid strings) and random UUID/externalId lists
    - Extract the filter-building logic into a standalone helper function `build_bulk_filter(query_type, sub_ids, sub_ext_ids)` so it can be tested in isolation
    - Assert: severity always contains `["CRITICAL", "HIGH"]`; status is `["FAIL"]` for configurationFindings and `["OPEN", "IN_PROGRESS"]` for others; correct subscription field name and ID type per query type; no subscription filter key for excessiveAccessFindings
    - **Validates: Requirements 2.2, 2.3, 2.6**

- [x] 2. Add bulk import HTML section to `index.html`
  - Insert the bulk import section at the top of `#panel-wizi .section-body`, before the existing `<div class="wizi-quick-add">` (find-by-ID block)
  - Add elements: `#bulk-import-sub` text input (dir="ltr"), `#btn-bulk-import` primary button, `#bulk-import-progress` status div, `#bulk-import-results` results div, `#bulk-import-actions` div (hidden) containing `#btn-bulk-import-selected`, `#btn-bulk-select-all`, `#bulk-selected-count`
  - Add a `<hr>` separator between the new bulk section and the existing find-by-ID section
  - Bump JS cache-bust version: change `?v=46` to `?v=47` on the `builder.js` script tag
  - _Requirements: 5.1, 5.2_

- [x] 3. Implement `handleBulkImport()` and progress display in `builder.js`
  - [x] 3.1 Wire up button click handler and input validation
    - Add event listener for `#btn-bulk-import` click
    - Read `#bulk-import-sub` value; if empty, show Hebrew error "יש להזין שם Subscription" in `#bulk-import-progress` and return
    - Set `bulkImportRunning = true`, disable `#btn-bulk-import`, clear previous results
    - POST to `/api/wizi/bulk-fetch` with `{subscription: value}`
    - On network error, show "שגיאת רשת" in progress div, re-enable button, reset flag
    - On 501 response, show "Wizi לא מוגדר"
    - On 429 response, show "חריגה ממגבלת קצב בקשות"
    - _Requirements: 1.2, 2.4, 5.3_

  - [x] 3.2 Implement `renderBulkResults(data)` — aggregated results table
    - Show `resolvedSubscription` warning toast if `ids` and `externalIds` are both empty
    - Show per-query-type errors as warning lines in `#bulk-import-progress`
    - If all query types returned 0 nodes and no errors, show empty state: "לא נמצאו ממצאים עבור Subscription זה"
    - Build a results table in `#bulk-import-results` with columns: checkbox, query type label (Hebrew), severity chip (reuse `sev-*` CSS classes), title/name, resource/subscription info
    - Group rows under collapsible `<details>` section headers per query type, showing count in summary
    - Show total count and per-type breakdown in `#bulk-import-progress`
    - Show `#bulk-import-actions` div once results are rendered
    - Store results in closure variable `bulkImportResults` (queryType → nodes[])
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_

  - [x] 3.3 Implement select-all toggle and selected count display
    - Wire `#btn-bulk-select-all` to toggle all checkboxes in `#bulk-import-results`
    - On any checkbox change, update `#bulk-selected-count` with current selected count
    - _Requirements: 3.4_

- [x] 4. Checkpoint — verify backend and UI render correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement `importSelectedBulkFindings()` with duplicate detection
  - [x] 5.1 Implement the import routing and `_wizSourceId` tracking
    - Define `importFnMap` mapping each of the 9 query type strings to the corresponding `import*Finding()` function
    - For each selected checkbox, read `data-query-type` and `data-node-index` attributes to look up the node from `bulkImportResults`
    - Before calling `import*Finding()`, check if any existing finding in `findings[]` has `_wizSourceId === node.id`; if so, increment skip counter and continue
    - After `import*Finding()` returns the new finding object, set `finding._wizSourceId = node.id` on it before pushing to `findings[]`
    - Ensure `_wizSourceId` is excluded from report HTML generation and JSON export (add to the exclusion list alongside other internal fields)
    - _Requirements: 4.1, 4.2, 4.5_

  - [x] 5.2 Write property test for import routing (Property 3)
    - **Property 3: Import routing calls the correct import function per query type**
    - Use `fast-check` to generate random query type strings from the 9 valid values
    - For each generated type, assert that `importFnMap[queryType]` is strictly equal to the expected named function
    - **Validates: Requirements 4.1**

  - [x] 5.3 Write property test for duplicate detection (Property 4)
    - **Property 4: Duplicate detection skips already-imported findings**
    - Use `fast-check` to generate: an initial `findings[]` array with some `_wizSourceId` values, and a set of nodes to import where some share those IDs
    - Run the import logic and assert: `findings.length` increases by exactly `(total - duplicates)`; reported skip count equals the number of duplicates; no finding appears twice with the same `_wizSourceId`
    - **Validates: Requirements 4.5**

  - [x] 5.4 Show success toast and switch tab after import
    - After import loop completes, call `showToast()` with Hebrew message including imported count and skipped count (if > 0), e.g. "יובאו 12 ממצאים" or "יובאו 8 ממצאים, דולגו 4 כפולים"
    - Call `renderFindingsTable()` and `updateStepper()`
    - Switch active tab to `tab-findings-list` via `switchToTab('tab-findings-list')`
    - _Requirements: 4.3, 4.4_

- [x] 6. Write property test for count invariant (Property 2)
  - **Property 2: Total finding count equals sum of per-query-type counts**
  - Use `fast-check` to generate random `bulkImportResults` objects with arbitrary node arrays per query type
  - Assert that the total count displayed equals the sum of `nodes.length` across all query types
  - **Validates: Requirements 3.2**

- [x] 7. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The backend filter-building logic should be extracted into a standalone `build_bulk_filter()` helper to enable Property 1 testing with `hypothesis`
- `_wizSourceId` is a transient client-side field — exclude it from `buildSnapshot()` serialization and report HTML generation
- Cache-bust version bump (JS `?v=47`) is part of task 2 — required so browsers pick up the new `builder.js` code
- `excessiveAccessFindings` has no server-side subscription filter; the backend returns all results and the client can optionally filter by subscription name client-side
