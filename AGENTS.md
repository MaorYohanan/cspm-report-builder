# CSPM Report Builder — AI Agent Context

This file provides structured context for AI agents working on this codebase.

## System Overview

A single-page web app (Flask + vanilla JS) that builds Hebrew-language cloud security PDF reports. It connects to the Wiz cloud security platform API to import findings, and uses Playwright/Chromium for server-side PDF rendering.

**Stack:** Python 3.12, Flask, Playwright, vanilla JavaScript (no framework), HTML/CSS. Runs in Docker.

**Primary language of output:** Hebrew (RTL). Technical terms (IAM, S3, VPC, MFA, RBAC) stay in English.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (index.html + builder.js + builder.css)    │
│  - All report logic is client-side                  │
│  - Findings stored in JS array, rendered to HTML    │
│  - Auto-saves to localStorage every 10s             │
└──────────────┬──────────────────────────────────────┘
               │ REST API (JSON)
┌──────────────▼──────────────────────────────────────┐
│  Flask Backend (app.py)                             │
│  - PDF rendering (Playwright + Chromium)            │
│  - State file management (JSON on disk)             │
│  - Wiz API proxy (OAuth + GraphQL)                  │
│  - Gemini AI proxy (optional)                       │
│  - Rate limiting, auth, security headers            │
└──────────────┬──────────────────────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
  Wiz API   Gemini API   Filesystem
  (GraphQL)  (REST)      (uploads/, output/)
```

## File Map

| File | Purpose | Size |
|---|---|---|
| `app.py` | Flask entry point: blueprint registration, auth/rate-limit middleware, `/`, `/assets/<file>`, `/api/health` | ~230 lines |
| `backend/routes/wiz.py` | Wiz proxy blueprint (`/api/wizi/*`) — all Wiz endpoints including ignore mutations | ~600 lines |
| `backend/routes/ai.py` | Gemini proxy (`/api/suggest`, `/api/summarize-remediation`) | — |
| `backend/routes/reports.py` | PDF rendering (`/api/render-pdf`, `/api/upload-html`) | — |
| `backend/routes/files.py` | State + output file CRUD | — |
| `backend/routes/products.py` | Product registry CRUD + versioning | — |
| `backend/services/wiz_service.py` | OAuth2 + GraphQL execution + auto-pagination | — |
| `backend/services/ai_service.py` | Gemini calls with retry + model fallback | — |
| `backend/services/pdf_service.py` | Playwright → PDF (DO NOT change tuned values) | — |
| `backend/graphql/queries.py` | All Wiz GraphQL query strings, mutation strings, `QUERY_TYPE_MAP` | — |
| `index.html` | Single-page UI: tabs, forms, modals, all HTML structure | ~800 lines |
| `static/js/builder.js` | Built artifact — concatenated from `src/*.js` via `build_js.py` | ~9300 lines |
| `static/css/builder.css` | Styles: dark/light themes, RTL layout, responsive design | ~3300 lines |
| `templates/report_template.html` | Jinja2 template for PDF report (cover, TOC, findings, charts) | ~200 lines |
| `assets/report.css` | Stylesheet embedded in generated reports | ~300 lines |

## Key Patterns

### Client-Side State

- `findings[]` — array of finding objects, the core data model
- `buildSnapshot()` / `applySnapshot()` — serialize/deserialize full report state (meta + findings + form draft)
- `autoSave()` / `autoRestore()` — localStorage persistence every 10s
- `editingIndex` — tracks which finding is being edited (null = adding new)

### Finding Object Shape

```javascript
{
  id: "CSPM-001",           // Auto-generated, category-prefixed
  title: "string",
  severity: "critical|high|medium|low|info",
  category: "CSPM|DSPM|KSPM|VULN|NEXP|EAPM|HSPM|SECR|EOLM",
  description: "string",    // Free text
  impact: "string",         // Free text
  technical: ["line1", "line2"],  // Array of strings
  policies: ["ISO 27001", "NIST CSF"],  // Array of framework names
  recs: ["recommendation1", "recommendation2"],  // Array of strings
  priority: "string",       // Hebrew priority label or custom
  owner: "string",          // Team/subscription responsible
  evidence: ["data:image/png;base64,..."]  // Array of base64 images
}
```

### Wiz API Integration

- OAuth2 client_credentials flow → `WizService._get_token()`
- All queries go through `WizService.graphql(query, variables)`
- 11 query types, each with its own GraphQL query constant in `backend/graphql/queries.py` (`ISSUES_QUERY`, `CONFIG_FINDINGS_QUERY`, etc.) plus `QUERY_TYPE_MAP` for dispatch
- Ignore/suppress mutations live in `backend/routes/wiz.py` (`POST /api/wizi/ignore-issue`) — dispatches to the correct per-type mutation; `networkExposures` has no mutation in the Wiz schema
- Subscription filtering resolves text → cloud account UUIDs/externalIds via `cloudAccounts` query
- Find-by-ID runs 6 search strategies in sequence

### Subscription Filter Field Mapping

Each query type uses a different field for subscription filtering:

| Query Type | Filter Field | ID Type |
|---|---|---|
| `issues` | `cloudAccountOrCloudOrganizationId` | UUID |
| `configurationFindings` | `resource.subscriptionId` | UUID |
| `vulnerabilityFindings` | `subscriptionExternalId` | externalId |
| `hostConfigurationRuleAssessments` | `resource.subscriptionId` | UUID |
| `dataFindingsV2` | `graphEntityCloudAccount.equals` | externalId |
| `secretInstances` | `cloudAccount.equals` | externalId |
| `excessiveAccessFindings` | _(no server filter, client-side only)_ | — |
| `networkExposures` | `cloudAccount` | externalId |
| `inventoryFindings` | `resource.subscriptionId.equals` | UUID |
| `endOfLifeFindings` | `subscriptionExternalId` | externalId |
| `softwareSupplyChainFindings` | `resource.subscriptionId` | UUID |

### Project Filter Field Mapping

Each query type uses a different field for project filtering:

| Query Type | Filter Field | Format |
|---|---|---|
| `issues` | `project` | `[id]` |
| `configurationFindings` | `resource.projectId` | `[id]` |
| `vulnerabilityFindings` | `projectIdV2` | `{equals: [id]}` |
| `hostConfigurationRuleAssessments` | `resource.projectId` | `[id]` |
| `dataFindingsV2` | `projectId` | `[id]` |
| `secretInstances` | `projectId` | `[id]` |
| `excessiveAccessFindings` | `project` | `[id]` |
| `networkExposures` | `projectId` | `id` (scalar) |
| `inventoryFindings` | `projects` | `{equals: [id]}` |
| `endOfLifeFindings` | `projectIdV2` | `{equals: [id]}` |
| `softwareSupplyChainFindings` | `projectId` | `[id]` |

### Import Functions

Each query type has a dedicated `import*Finding()` function in `builder.js` that maps API response fields to the finding object shape. Key details:

- `importIssueFinding` — uses `sourceRules[0]` for rule data, `entitySnapshot` for resource data, `notes` go to technical (not recommendations)
- `importConfigFinding` — has framework detection logic mapping `securitySubCategories` to known framework names
- `importVulnFinding` — uses `remediation` field and `fixedVersion` for recommendations
- `importHostConfigFinding` — node has no `name` field, uses `rule.name` for both title and description
- `importExcessiveAccessFinding` — `remediationInstructions` is on the node itself (not on a `rule` sub-object)
- `importDataFinding`, `importSecretFinding` — hardcoded Hebrew recommendations (no remediation field available)
- `importNetworkExposureFinding` — no severity from API, inferred from `sourceIpRange` containing `0.0.0.0`
- `importInventoryFinding` — `InventoryRule` has no `remediationInstructions` or `shortId`
- `importEndOfLifeFinding` — uses `technology.name/version/endOfLifeDate` for description; severity comes from node directly
- `importSoftwareSupplyChainFinding` — API returns `componentName`/`componentVersion` aliased to `packageName`/`packageVersion` in the query; resource has no `cloudAccount` field, uses `resource.subscription` instead

### Recommendation Extraction

`extractRecommendations(rule, sevLabel)` is the shared helper:
1. Uses `rule.remediationInstructions` first (strips markdown code blocks)
2. Falls back to "It is recommended..." sentences from `rule.description`
3. Last resort: generic Hebrew recommendation

### Wiz Schema Constraints

Things that DON'T exist (confirmed via API errors):
- `HostConfigurationRule` has no `shortId` (use `shortName` or `externalId`)
- `InventoryRule` has no `shortId` or `remediationInstructions`
- `IssueSourceRule` has no `remediationInstructions` or `externalReferences`
- `SecuritySubCategory` has no `framework` field
- `HostConfigurationRuleAssessment` has no `name` field
- `DataFindingLocation` has no `region` field
- `dataFindings` is deprecated (use `dataFindingsV2`)
- No `subscriptions` root query exists
- `networkExposures` has no ignore/suppress mutation in the Wiz GraphQL schema (confirmed via introspection); the `POST /api/wizi/ignore-issue` endpoint returns `notSupported: true` for this type

## Security

- Optional bearer token auth (`APP_TOKEN`)
- Rate limiting on POST/DELETE endpoints (in-memory, per-IP)
- `_safe_filename()` strips path separators to prevent directory traversal
- GraphQL proxy blocks mutations and limits query size to 10KB
- Security headers: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`
- API responses have `Cache-Control: no-store`
- Upload-html restricted to `.html` suffix
- Health endpoint exempt from auth and rate limiting
- Wiz credentials stored in `.env` (gitignored), never exposed to client

## Development Notes

- Frontend files are volume-mounted in docker-compose — edit and refresh
- Only `app.py` changes require `docker compose up --build -d`
- Cache busting: `index.html` uses `?v=N` on CSS/JS includes — bump after changes
- Current versions: JS `?v=99`, CSS `?v=38`
- `.env` file is gitignored — never commit credentials
- The tool is branded "Wizi" (rebranded from Wiz) in the UI — keep it public-ready with no org-specific references

## PDF Rendering — DO NOT CHANGE THESE VALUES

**This combination is the result of extensive trial-and-error tuning. Changing any one of these values will cause page header overlap, content cut-off, or excessive blank space between header and content.**

In `backend/services/pdf_service.py`:

| Setting | Value | Why |
|---|---|---|
| Playwright `margin.top` | `30mm` | Matches actual header HTML height (~14mm) plus breathing room. Higher values create huge blank space; lower values overlap the header. |
| Playwright `margin.bottom` | `20mm` | Matches footer height plus breathing room. |
| Playwright `margin.left/right` | `10mm` | Maximizes usable content width. |
| `MAX_CARD_HEIGHT_PX` | `900` | Calibrated to printable height: A4 (297mm) − 50mm margins = 247mm = ~933px at 96 DPI. 900px gives safety margin. Lower → over-splits short cards. Higher → cards overflow next page header. |
| `page.emulate_media(media="print")` | required | Without this, `@media print` rules in `CLEAN_PRINT_CSS` are ignored and styles never apply. |
| `.page-section` / `.finding-page` `padding-top` (in `CLEAN_PRINT_CSS`) | `4mm` | Small inner spacing. The 30mm Playwright top margin already handles outer spacing. |

**If the PDF rendering looks wrong, do NOT change these values without first reading the discussion in commit history about page header overlap.**
