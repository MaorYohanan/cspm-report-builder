# CSPM Report Builder

A self-hosted tool for building cloud security reports. Connects to Wiz, imports findings, organizes them into a versioned product registry, and exports professional Hebrew PDF reports.

Built for security consultants who need to document CSPM/DSPM/KSPM findings across multiple cloud environments.

![Python](https://img.shields.io/badge/python-3.12-blue)
![Flask](https://img.shields.io/badge/flask-3.1-green)
![Docker](https://img.shields.io/badge/docker-ready-blue)

---

## Table of Contents

- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Wizi Integration](#wizi-integration)
- [Product Registry](#product-registry)
- [Optional Features](#optional-features)
- [Configuration](#configuration)
- [UI Features](#ui-features)
- [Development](#development)
- [API Reference](#api-reference)
- [License](#license)

---

## Quick Start

```bash
git clone https://github.com/Metoraf007/cspm-report-builder.git
cd cspm-report-builder
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080).

No database, no external dependencies beyond Docker. State is persisted as JSON under `uploads/`.

---

## How It Works

The tool has 6 tabs in the sidebar:

1. **Report Details** — client name, environment, date, executive summary, cover image
2. **Edit Findings** — add/edit findings with severity, category, description, impact, recommendations, evidence
3. **Wizi** — connect to Wiz API, browse/search findings, bulk-import per subscription
4. **Products** — versioned per-product report registry (draft → publish workflow)
5. **Export** — generate PDF or HTML reports, export/import JSON state
6. **File Manager** — manage saved states and output files on the server

### The Report Flow

```
Wiz API  ──┐
CSV file ──┤──→  Findings List  ──→  Hebrew PDF Report
Manual    ──┘    (edit, sort,        (cover, TOC, severity chart,
                  batch edit)         per-finding pages, evidence)
                          │
                          └──→  Product Registry (versioned snapshots)
```

---

## Architecture

Layered Flask app with a thin frontend that concatenates ES5/ES6 source modules into a single bundle. No build step beyond `python build_js.py`. No frontend framework.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  BROWSER (Client)                                                       │
│  index.html + static/js/builder.js (concatenated IIFE)                  │
│  Source modules in static/js/src/: core, ui, findings, export,          │
│                                     wizi, products, init                │
│         │                                                                │
│         │  fetch() / XHR                                                 │
│         ▼                                                                │
├─────────────────────────────────────────────────────────────────────────┤
│  FLASK APPLICATION (app.py)                                              │
│  Middleware: optional Bearer auth, in-memory rate limit, security headers│
│                                                                          │
│  Blueprints (backend/routes/):                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  wiz_bp  │ │  ai_bp   │ │reports_bp│ │ files_bp │ │products_bp│     │
│  │/api/wizi │ │   /api   │ │   /api   │ │   /api   │ │/api/products│   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘      │
│       │            │            │            │            │             │
│       ▼            ▼            ▼            ▼            ▼             │
│  Services (backend/services/):              File-based persistence     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                    │
│  │ WizService   │ │ GeminiSvc    │ │ PDFService   │                    │
│  │ (OAuth+GQL)  │ │ (REST+retry) │ │ (Playwright) │                    │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘                    │
│         │                │                │                              │
│         ▼                ▼                ▼                              │
│  External: Wiz GraphQL │ Gemini REST │ Chromium                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Backend layout

| Path | Purpose |
|------|---------|
| `app.py` | Flask entry point, blueprint registration, auth/rate-limit middleware, `/`, `/assets/<file>`, `/api/health` |
| `backend/routes/wiz.py` | Wiz API proxy (`wiz_bp`, prefix `/api/wizi`) — status, projects, subscriptions, issues, bulk-fetch, find-by-id, GraphQL passthrough, introspection |
| `backend/routes/ai.py` | Gemini proxy (`ai_bp`) — `/api/suggest`, `/api/summarize-remediation` |
| `backend/routes/reports.py` | PDF rendering (`reports_bp`) — `/api/render-pdf`, `/api/upload-html` |
| `backend/routes/files.py` | State + output file CRUD (`files_bp`) |
| `backend/routes/products.py` | Product registry CRUD + versioning (`products_bp`) |
| `backend/services/wiz_service.py` | OAuth2 client-credentials flow, GraphQL execution, auto-pagination, subscription resolution |
| `backend/services/ai_service.py` | Gemini calls with retry + model fallback (Flash → Flash 2.5 → Pro) |
| `backend/services/pdf_service.py` | Playwright Chromium → PDF with print CSS, headers/footers, page-break logic |
| `backend/graphql/queries.py` | All Wiz GraphQL query strings + `QUERY_TYPE_MAP` (10 types) |

### Frontend layout

```
static/js/
├── builder.js           # built artifact (commit it; users serve from here)
├── src/                 # source modules — concatenated by build_js.py
│   ├── core.js          # opens the shared IIFE; global state, utilities, toast
│   ├── ui.js            # theme, sidebar, tabs, modals, autocomplete
│   ├── findings.js      # findings table, detail pane, form, batch, drag-drop
│   ├── export.js        # report HTML builder, PDF/CSV/JSON export, autosave
│   ├── wizi.js          # Wizi API client, bulk import, importFnMap
│   ├── products.js      # Products grid, timeline, form, diff, saveAsVersion
│   └── init.js          # final event wiring, closes the shared IIFE
└── build_js.py          # concatenates src/*.js in FILE_ORDER → builder.js
```

`products.js` and the other modules share a single outer IIFE that `core.js` opens and `init.js` closes — no per-file IIFE wrapping. After editing any source file, run `python build_js.py` and bump the `?v=N` cache-buster on the `<script>` tag in `index.html`. Frontend files are volume-mounted in Docker, so no rebuild is needed for frontend-only changes.

### Storage layout

```
uploads/
├── states/                 # ad-hoc JSON state files (state_<id>.json)
└── products/               # product registry (one directory per product)
    └── <product-slug>/
        ├── meta.json       # {id, name, owner, ownerEmail, env, subscriptionIds, ...}
        ├── v1.0.json       # version snapshots (draft or published)
        ├── v1.1.json
        └── v2.0.json
output/                     # generated PDFs and uploaded HTML reports
```

---

## Wizi Integration

Connect to the Wiz API to pull findings directly. Requires a read-only service account.

Create a `.env` file (see `.env.example`):

```env
WIZI_CLIENT_ID=your-client-id
WIZI_CLIENT_SECRET=your-client-secret
WIZI_API_URL=https://api.il1.app.wiz.io/graphql
WIZI_AUTH_URL=https://auth.app.wiz.io/oauth/token
```

### Supported Query Types

The `/api/wizi/bulk-fetch` endpoint iterates all 10 query types defined in `QUERY_TYPE_MAP`:

| Query Type | Category | What it fetches |
|---|---|---|
| `issues` | Mixed | Cross-category security issues (the main Wiz view) |
| `configurationFindings` | CSPM | Misconfigured cloud resources (uses `result: FAIL`) |
| `vulnerabilityFindings` | VULN | CVEs with CVSS scores, exploit info, fix versions |
| `hostConfigurationRuleAssessments` | HSPM | Host-level security assessments |
| `dataFindingsV2` | DSPM | Sensitive data exposure (PII, secrets in storage) |
| `secretInstances` | SECR | Exposed credentials and certificates |
| `excessiveAccessFindings` | EAPM | Over-privileged identities — uses custom `scope.id.equals` filter |
| `networkExposures` | NEXP | Publicly exposed resources — uses plain `cloudAccount` filter |
| `inventoryFindings` | EOLM | End-of-life software and untagged resources |
| `softwareSupplyChainFinding` | SSCM | Supply chain risks |

The per-type filter shapes are non-uniform (some severity/status fields are plain lists, others are wrapped in `{equals: [...]}`, two types have no severity/status keys at all). The exact contract is locked down by `tests/test_bulk_filter.py`.

### Find by ID

The search bar accepts multiple formats and runs through 6 strategies automatically:

- `EC2-005` — rule shortId (resolves via `cloudConfigurationRules`)
- `wc-id-870` — issue control/rule ID
- `e7dba598-3065-...` — full UUID (tries multiple query types)
- `IMDSv2` — free-text fallback on issues

Results are paginated with optional subscription filtering.

### What Gets Imported

When you import a finding, fields are auto-mapped:

| Report Field | Mapped From |
|---|---|
| Title | Rule name |
| Description | Finding name or rule description |
| Impact | Severity + resource context |
| Technical | Cloud, subscription, region, resource type, rule details |
| Recommendations | `remediationInstructions` → description fallback → generic Hebrew |
| Policies | Top 4 frameworks from `securitySubCategories` (ISO 27001, NIST, CIS, etc.) |
| Owner | Subscription or project name |

Imported findings are tagged with `_wizSourceId = node.id` (stripped from exports and PDF rendering) so re-running bulk import skips duplicates.

---

## Product Registry

A versioned report repository — one timeline per product. Useful for tracking the same client's posture across multiple checks.

**Storage:** filesystem under `uploads/products/<product-slug>/` (no database).

**Workflow:**

| Action | Result |
|--------|--------|
| First save | Creates `v1.0` as **draft** |
| Re-save before publish | Overwrites the current draft (same version string) |
| Publish draft | Locks the version: `status: "published"`, `publishedAt` stamped |
| Save **minor** after publish | Increments decimal (`v1.0` → `v1.1`); rolls over at `.9` → next major |
| Save **major** after publish | Increments integer (`v1.0` → `v2.0`) |
| Delete draft | Removed; meta auto-updates to next-most-recent version |

**Risk score** is computed server-side on save:  
`Critical × 4 + High × 3 + Medium × 2 + Low × 1` — findings with `exception.active == true` are excluded.

**Hebrew product names** are auto-transliterated to ASCII slugs (e.g. `מערכת ERP` → `mrkht-erp`), used as both the directory name and the API `id`. Slugs are immutable after creation; duplicates get `-2`, `-3`, ... suffixes.

See `backend/routes/products.py` for the full API and `static/js/src/products.js` for the `ProductsPanel` UI module.

---

## Optional Features

### AI Writing Assistant

Set `GEMINI_API_KEY` to enable "✨ שפר ניסוח" buttons on free-text fields. Supports `gemini-2.0-flash`, `gemini-2.5-flash`, `gemini-2.5-pro`, with automatic fallback on rate limits (429).

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### Authentication

Set `APP_TOKEN` to require a bearer token on all endpoints (except `/api/health`):

```yaml
# docker-compose.yml
environment:
  - APP_TOKEN=your-secret-token
```

Auth check uses `hmac.compare_digest` to prevent timing attacks.

### CSV Import

Supports two formats:
- **Wiz CSV export** — auto-detected, maps `rule.shortId`, `rule.name`, `rule.severity`, `rule.remediationInstructions`, etc.
- **Generic CSV** — auto-maps common column names (`id`, `title`, `severity`, `description`, `impact`, `recommendation`)

---

## Configuration

All settings via environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Server port |
| `FLASK_DEBUG` | `0` | Flask debug mode |
| `APP_TOKEN` | _(empty)_ | Bearer token for auth (empty = open) |
| `GEMINI_API_KEY` | _(empty)_ | Gemini API key (empty = AI disabled) |
| `WIZI_CLIENT_ID` | _(empty)_ | Wiz service account ID (empty = Wizi hidden) |
| `WIZI_CLIENT_SECRET` | _(empty)_ | Wiz service account secret |
| `WIZI_API_URL` | `https://api.il1.app.wiz.io/graphql` | Wiz GraphQL endpoint |
| `WIZI_AUTH_URL` | `https://auth.app.wiz.io/oauth/token` | Wiz OAuth endpoint |
| `RATE_LIMIT_MAX` | `30` | Max POST/DELETE requests per IP per window (0 = disabled) |
| `RATE_LIMIT_WINDOW` | `60` | Rate limit window (seconds) |
| `CLEANUP_DAYS` | `30` | Auto-delete output files after N days |

Security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection`, `Referrer-Policy`, `Cache-Control: no-store` on `/api/*`) are applied automatically.

---

## UI Features

- **Dark/light theme** — toggle persisted in localStorage
- **Auto-save** — every 10 seconds + on page close, restores on reload (including in-progress form edits)
- **Keyboard shortcuts** — `J`/`K` navigate, `E` edit, `D` delete, `Ctrl+Enter` add finding, `?` help
- **Drag-and-drop** — reorder findings, drop evidence images
- **Clipboard paste** — `Ctrl+V` to attach screenshots
- **Inline editing** — click title/severity/owner in the table
- **Batch edit** — select multiple findings, change severity/priority/owner
- **Finding preview** — slide-out panel without leaving the table
- **Finding templates** — pre-built common findings for quick entry
- **Trend comparison** — import a previous JSON to see new/resolved/changed findings
- **Category badges** — visual count per category (CSPM: 5, VULN: 3, etc.)
- **Deduplication** — auto-detects duplicates during Wizi import via `_wizSourceId`
- **Exception findings (מוחרג)** — mark findings as approved exceptions; excluded from risk score

---

## Development

### Prerequisites

- Python 3.12+
- Docker (recommended for the Playwright/Chromium dependency)

### Running locally

```bash
# Docker (recommended — includes Playwright + Chromium)
docker compose up --build

# Local Python (you must install Chromium separately for PDF rendering to work)
pip install -r requirements.txt
playwright install chromium --with-deps
python app.py
```

Frontend files (`index.html`, `static/`) are volume-mounted in Docker — edit and refresh. For backend changes (anything in `app.py` or `backend/`), rebuild:

```bash
docker compose up --build -d
```

After editing any `static/js/src/*.js` file:

```bash
python build_js.py
```

Then bump the `?v=N` cache-buster on the `<script>` tag near the bottom of `index.html`.

### Running tests

The repo ships with a lean **regression test suite** — runs in under a second, designed to catch silent breakage of load-bearing logic after major changes. No Hypothesis, no Jest, no CI/CD.

```bash
python -m pytest tests/ -v
```

| Test file | Covers |
|-----------|--------|
| `tests/test_products.py` | `_slugify`, `_safe_param`, `_valid_version_str`, `_compute_risk_score`, `_next_version`, plus 8 endpoint smoke tests for the products blueprint |
| `tests/test_bulk_filter.py` | Per-query-type filter shapes returned by `build_bulk_filter` in `wiz.py` (locks down the Wiz GraphQL filter contract) |
| `tests/conftest.py` | Shared fixtures: `tmp_products_dir` (per-test products dir) and `client` (Flask test client with `products_bp` only) |

Run after any major change to `backend/routes/products.py` or `backend/routes/wiz.py`.

### Project structure

```
cspm-report-builder/
├── app.py                          # Flask entry, /, /assets, /api/health, middleware
├── build_js.py                     # Concatenates static/js/src/*.js → builder.js
├── index.html                      # Builder UI (single-page)
├── requirements.txt
├── docker-compose.yml
├── Dockerfile
│
├── backend/
│   ├── routes/                     # Flask blueprints (5 registered in app.py)
│   │   ├── wiz.py                  # /api/wizi/*
│   │   ├── ai.py                   # /api/suggest, /api/summarize-remediation
│   │   ├── reports.py              # /api/render-pdf, /api/upload-html
│   │   ├── files.py                # /api/upload-state, /api/list-states, etc.
│   │   ├── products.py             # /api/products[/<id>[/versions[/<ver>[/publish]]]]
│   │   └── health.py               # (defined but NOT registered; health lives in app.py)
│   ├── services/
│   │   ├── wiz_service.py
│   │   ├── ai_service.py
│   │   └── pdf_service.py
│   └── graphql/
│       └── queries.py              # All Wiz GraphQL strings + QUERY_TYPE_MAP
│
├── static/
│   ├── js/
│   │   ├── builder.js              # built artifact
│   │   └── src/                    # source modules (concatenated, not bundled)
│   │       ├── core.js  ui.js  findings.js  export.js
│   │       ├── wizi.js  products.js  init.js
│   └── css/
│       └── builder.css
│
├── templates/
│   └── report_template.html        # Jinja2 PDF template
│
├── assets/
│   ├── cover.png                   # Default report cover
│   └── report.css                  # Generated report stylesheet
│
├── tests/                          # Regression test suite (pytest)
│   ├── conftest.py                 # tmp_products_dir + client fixtures
│   ├── test_products.py
│   └── test_bulk_filter.py
│
├── uploads/                        # JSON state + product registry (gitignored)
│   ├── states/
│   └── products/<product-slug>/{meta.json, v*.*.json}
└── output/                         # Generated PDFs (gitignored)
```

---

## API Reference

All endpoints return JSON unless noted. When `APP_TOKEN` is set, all routes except `/api/health` require `Authorization: Bearer <token>`. POST/DELETE endpoints are subject to in-memory rate limiting (default 30 req / 60 s per IP).

### Summary

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Builder UI |
| `GET` | `/assets/<filename>` | Static report assets (CSS used by exported reports) |
| `GET` | `/api/health` | Health check + feature-flag report (always open) |
| `GET` | `/api/wizi/status` | Wiz connection status |
| `GET` | `/api/wizi/projects` | List Wiz projects |
| `GET` | `/api/wizi/subscriptions` | List Wiz cloud accounts |
| `POST` | `/api/wizi/graphql` | Read-only GraphQL passthrough (mutations blocked) |
| `GET` | `/api/wizi/discover` | Introspect Wiz schema (root fields) |
| `GET` | `/api/wizi/introspect-type` | Introspect a specific GraphQL type |
| `POST` | `/api/wizi/issues` | Single-query-type fetch with pagination + filters |
| `POST` | `/api/wizi/bulk-fetch` | Fetch all 10 query types for one subscription |
| `POST` | `/api/wizi/bulk-fetch-single` | Fetch one query type with paginated results |
| `POST` | `/api/wizi/find-by-id` | Multi-strategy search (UUID, shortId, free-text) |
| `POST` | `/api/wizi/ignore-issue` | Ignore/suppress a finding in Wiz by ID for a given query type |
| `POST` | `/api/suggest` | Gemini-based phrasing improvement |
| `POST` | `/api/summarize-remediation` | Gemini-based remediation summarization |
| `POST` | `/api/render-pdf` | Render HTML → PDF, return binary |
| `POST` | `/api/upload-html` | Save HTML report file |
| `POST` | `/api/upload-state` | Save JSON state file |
| `GET` | `/api/list-states` | List saved state files |
| `GET` | `/api/download-state/<id>` | Download state file |
| `DELETE` | `/api/delete-state/<id>` | Delete state file |
| `GET` | `/api/list-outputs` | List generated PDFs / HTML files |
| `GET` | `/api/download-output/<filename>` | Download an output file |
| `DELETE` | `/api/delete-output/<filename>` | Delete an output file |
| `GET` | `/api/products` | List products (summaries, sorted by name) |
| `POST` | `/api/products` | Create a product |
| `GET` | `/api/products/<id>` | Get a product's metadata |
| `PUT` | `/api/products/<id>` | Update a product's metadata (id/slug immutable) |
| `DELETE` | `/api/products/<id>` | Delete a product + all versions |
| `GET` | `/api/products/<id>/versions` | List versions (sorted by `savedAt` desc) |
| `POST` | `/api/products/<id>/versions` | Save a new version (`type: "major"\|"minor"\|"draft"`) |
| `GET` | `/api/products/<id>/versions/<ver>` | Download full version snapshot |
| `DELETE` | `/api/products/<id>/versions/<ver>` | Delete a version |
| `POST` | `/api/products/<id>/versions/<ver>/publish` | Lock draft → published |

### Common error codes

| Code | Meaning | Common causes |
|------|---------|---------------|
| 400 | Bad Request | Missing required fields, invalid JSON, path-traversal in body, invalid version format |
| 401 | Unauthorized | Missing/invalid Bearer token (when `APP_TOKEN` is set) |
| 403 | Forbidden | Attempted GraphQL mutation via the read-only proxy |
| 404 | Not Found | Product/version/file doesn't exist |
| 409 | Conflict | Slug namespace exhausted; publish-on-already-published; save-non-draft when a draft exists |
| 413 | Payload Too Large | Snapshot body > 50 MB |
| 429 | Rate Limited | Exceeded `RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW` |
| 500 | Internal Server Error | PDF rendering failed, storage unavailable |
| 501 | Not Implemented | Wiz or Gemini credentials not configured |
| 502 | Bad Gateway | External API error (Wiz GraphQL, Gemini) |

### Detail: `POST /api/wizi/bulk-fetch`

Request:
```json
{ "subscription": "aws-production" }
```

Response (200): `{"results": {...}, "resolvedSubscription": {...}, "errors": {...}}`

The `results` object has one key per query type with `{"nodes": [...], "totalCount": N}`. Per-query failures land in `errors[queryType]` as a string; one type failing doesn't abort the others.

### Detail: `POST /api/wizi/find-by-id`

Request:
```json
{ "id": "EC2-005", "subscription": "aws-production", "pageSize": 5, "page": 0 }
```

Tries 6 strategies in order:
1. Direct ID match (finding UUID)
2. Issues by rule ID
3. Configuration findings by rule ID
4. Host configuration by rule ID
5. Rule shortId lookup → configuration findings
6. Free-text via issues

### Detail: `POST /api/products`

Request:
```json
{
  "name": "ERP System",
  "owner": "Avi Cohen",
  "ownerEmail": "avi@company.com",
  "env": "Production",
  "subscriptionIds": ["sub-id-1", "sub-id-2"]
}
```

Response (201): the saved `meta.json` — includes the generated `id` (slug) and `createdAt` timestamp.

### Detail: `POST /api/products/<id>/versions`

Request:
```json
{
  "type": "minor",
  "notes": "Q2 regression check",
  "snapshot": { "meta": {...}, "findings": [...], "formDraft": {...} }
}
```

`type` is one of `"major"`, `"minor"`, or `"draft"`. The next version string is computed server-side using `_next_version` (see [Product Registry](#product-registry)). `riskScore` is computed from the snapshot's findings. Returns 201 with the saved version metadata.

Returns 409 if `type` is `major`/`minor` but a draft already exists (publish or delete it first), or 400 if `type` is `draft` but no draft exists yet.

### Detail: `POST /api/suggest`

Request:
```json
{
  "text": "This finding is bad and needs to be fixed",
  "field": "description",
  "model": "gemini-2.5-flash"
}
```

Response: `{"suggestion": "...", "model": "..."}`. On rate limit (429), `GeminiService` automatically falls back to the next model in the chain.

### Detail: `POST /api/render-pdf`

Request: `{"html": "<!DOCTYPE html>...", "meta": {"client": "...", ...}}`

Response: binary PDF (`Content-Type: application/pdf`). The PDF is also saved to `output/` for later retrieval via `/api/list-outputs` and `/api/download-output/<filename>`.

---

## License

MIT
