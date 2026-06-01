# CSPM Report Builder - Architecture Documentation

## Overview

The CSPM Report Builder is a Flask-based web application for creating professional cloud security reports. It follows a modular, service-oriented architecture with clear separation of concerns between frontend, API, service logic, and external integrations.

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            BROWSER (Client)                              │
├─────────────────────────────────────────────────────────────────────────┤
│  Frontend Layer (ES6 Modules)                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │ Wizi Module  │  │   Findings   │  │  Builder UI  │                  │
│  │              │  │    Module    │  │              │                  │
│  │ • api-client │  │ • renderer   │  │ • core.js    │                  │
│  │ • filters    │  │ • filters    │  │ • ui.js      │                  │
│  │ • bulk       │  │ • state      │  │ • export.js  │                  │
│  │ • subscr.    │  │ • export     │  │ • init.js    │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         │                 │                 │                           │
│         └─────────────────┴─────────────────┘                           │
│                           │                                             │
│                      HTTP/AJAX                                          │
└───────────────────────────┼─────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       FLASK APPLICATION (app.py)                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Middleware & Security                                                  │
│  • Authentication (Bearer Token)                                        │
│  • Rate Limiting                                                        │
│  • Security Headers                                                     │
│  • Auto-Cleanup                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  API Layer (Flask Blueprints)                                           │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐           │
│  │ Wiz BP    │  │  AI BP    │  │ Reports   │  │  Files    │           │
│  │ /api/wizi │  │ /api/     │  │    BP     │  │    BP     │           │
│  │           │  │           │  │ /api/     │  │ /api/     │           │
│  │ • status  │  │ • suggest │  │ • render  │  │ • upload  │           │
│  │ • issues  │  │ • summar. │  │ • pdf     │  │ • list    │           │
│  │ • bulk    │  │           │  │           │  │ • download│           │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘           │
│        │              │              │              │                   │
│        ▼              ▼              ▼              ▼                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Service Layer (Business Logic)                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │
│  │  WizService     │  │  GeminiService  │  │   PDFService    │        │
│  │                 │  │                 │  │                 │        │
│  │ • OAuth Token   │  │ • Text Improve  │  │ • HTML → PDF    │        │
│  │ • GraphQL       │  │ • Summarization │  │ • Page Layout   │        │
│  │ • Pagination    │  │ • Model Fallbk  │  │ • Header/Footer │        │
│  │ • Subscr. Res.  │  │                 │  │ • Page Breaks   │        │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘        │
│           │                    │                     │                  │
│           ▼                    ▼                     ▼                  │
├─────────────────────────────────────────────────────────────────────────┤
│  External Integrations                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │
│  │  Wiz API        │  │  Gemini API     │  │  Playwright     │        │
│  │  (GraphQL)      │  │  (REST)         │  │  (Chromium)     │        │
│  │                 │  │                 │  │                 │        │
│  │ • Auth OAuth2   │  │ • AI Models     │  │ • Browser       │        │
│  │ • Findings API  │  │ • Flash/Pro     │  │ • PDF Engine    │        │
│  │ • Projects      │  │ • Fallback      │  │                 │        │
│  │ • Subscriptions │  │                 │  │                 │        │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Layer-by-Layer Documentation

### 1. Frontend Layer (ES6 Modules)

The frontend is organized into modular ES6 JavaScript, split by feature domain.

#### **A. Wizi Integration Module** (`static/js/wizi/`)
Handles all Wiz platform integration functionality.

**Files:**
- `index.js` - Main orchestrator, exports public API
- `api-client.js` - HTTP client for backend Wiz endpoints
- `subscription-manager.js` - Subscription resolution and caching
- `filters.js` - Filter UI and state management
- `bulk-actions.js` - Bulk import/export operations
- `ui-helpers.js` - DOM utilities, HTML escaping, severity mapping

**Responsibilities:**
- Fetch findings from Wiz via backend proxy
- Manage subscription autocomplete
- Handle bulk import workflows
- Map Wiz data to report format
- Filter and display findings

#### **B. Findings Management Module** (`static/js/src/findings/`)
Core findings list and table management.

**Files:**
- `index.js` - Main findings orchestrator class
- `renderer.js` - Render findings table, cards
- `filter-manager.js` - Client-side filtering logic
- `sort-manager.js` - Column sorting
- `state-manager.js` - Pagination, selection, edit state
- `export-handler.js` - HTML report generation
- `ui-components.js` - Reusable UI components

**Responsibilities:**
- Display findings in table/card view
- Client-side filtering and sorting
- Pagination and selection state
- Export findings to HTML/PDF
- Evidence upload handling

#### **C. Builder Core** (`static/js/src/`)
General report builder functionality.

**Files:**
- `core.js` - App state, findings CRUD operations
- `ui.js` - UI interactions, modals, autocomplete
- `export.js` - Export report (HTML, PDF, JSON state)
- `init.js` - App initialization, event binding

**Responsibilities:**
- Global state management
- Form handling (add/edit findings)
- Report metadata management
- Cover image handling
- State persistence (upload/download)

---

### 2. API Layer (Flask Blueprints)

Flask blueprints provide modular routing with clean separation of concerns.

#### **A. Wiz Blueprint** (`backend/routes/wiz.py`)
**Prefix:** `/api/wizi`

**Endpoints:**
- `GET /status` - Check Wiz connectivity
- `GET /projects` - List available projects
- `GET /subscriptions` - List cloud accounts
- `POST /issues` - Fetch findings with filters
- `POST /bulk-fetch` - Fetch all finding types for a subscription
- `POST /find-by-id` - Search findings by ID or rule short ID
- `POST /graphql` - Raw GraphQL proxy (read-only)
- `GET /discover` - Introspect Wiz schema

**Responsibilities:**
- Proxy requests to WizService
- Parameter validation
- Subscription resolution
- Filter mapping for different query types

#### **B. AI Blueprint** (`backend/routes/ai.py`)
**Prefix:** `/api`

**Endpoints:**
- `POST /suggest` - Improve text phrasing with AI
- `POST /summarize-remediation` - Generate remediation summary

**Responsibilities:**
- Validate AI requests
- Call GeminiService
- Model selection and fallback handling

#### **C. Reports Blueprint** (`backend/routes/reports.py`)
**Prefix:** `/api`

**Endpoints:**
- `POST /render-pdf` - Convert HTML report to PDF
- `POST /upload-html` - Upload raw HTML report

**Responsibilities:**
- Accept report state/HTML
- Call PDFService
- Return PDF bytes or success confirmation

#### **D. Files Blueprint** (`backend/routes/files.py`)
**Prefix:** `/api`

**Endpoints:**
- `POST /upload-state` - Save JSON state file
- `GET /download-state/<id>` - Retrieve saved state
- `GET /list-states` - List all saved states
- `GET /download-output/<filename>` - Download generated PDFs
- `GET /list-outputs` - List output files

**Responsibilities:**
- File storage management
- State persistence
- Download orchestration

---

### 3. Service Layer (Business Logic)

Services encapsulate domain logic and external API interactions. They are framework-agnostic and reusable.

#### **A. WizService** (`backend/services/wiz_service.py`)

**Purpose:** Interact with Wiz security platform API.

**Key Methods:**
- `_get_token()` - OAuth2 token management with caching
- `_graphql(query, variables)` - Execute GraphQL queries
- `resolve_subscription(name)` - Resolve subscription name to IDs
- `fetch_all_findings_paginated(query_type, filters)` - Auto-pagination
- `fetch_projects()` - Get available projects
- `fetch_cloud_accounts(search)` - Get cloud accounts
- `find_by_rule_short_id(short_id, subscription)` - Search by rule ID
- `introspect_schema()` - Discover GraphQL schema

**Design Patterns:**
- **Singleton Pattern:** Token caching across requests
- **Strategy Pattern:** Different query types via `QUERY_TYPE_MAP`
- **Template Method:** Common pagination logic for all query types

**Dependencies:**
- Wiz GraphQL API (HTTPS/OAuth2)
- `backend/graphql/queries.py` (query definitions)

#### **B. GeminiService** (`backend/services/ai_service.py`)

**Purpose:** AI-powered text improvement and summarization.

**Key Methods:**
- `improve_text(text, field_context, model)` - Improve phrasing
- `summarize_remediation(title, description, remediation, model)` - Generate summary
- `_call_gemini(prompt, system_prompt, model, enable_fallback)` - Core API call with retry

**Design Patterns:**
- **Chain of Responsibility:** Model fallback on rate limiting (429)
- **Retry Pattern:** Exponential backoff for transient errors
- **Template Method:** System prompts as templates

**Features:**
- Automatic model fallback (Flash → Flash 2.5 → Pro)
- Rate limit handling (429 errors)
- Content safety filtering
- Custom system prompts for different use cases

**Dependencies:**
- Google Gemini API (REST/HTTPS)

#### **C. PDFService** (`backend/services/pdf_service.py`)

**Purpose:** Render HTML reports to PDF with professional layout.

**Key Methods:**
- `render_pdf(html_content, meta)` - Convert HTML to PDF
- `render_html(report_data, meta)` - Pass-through for HTML export
- `_build_header(meta)` - Generate PDF header template
- `_build_footer(meta)` - Generate PDF footer template

**Design Patterns:**
- **Builder Pattern:** Header/footer construction
- **Template Method:** Print CSS as a template
- **Decorator Pattern:** Page-break logic via JavaScript injection

**Features:**
- Custom header/footer with metadata
- Automatic page splitting for long findings
- Print-optimized CSS
- A4 layout with margins
- Continuation headers for multi-page findings

**Dependencies:**
- Playwright (Chromium browser automation)

---

### 4. External APIs

#### **Wiz GraphQL API**
- **Protocol:** HTTPS, OAuth2 (client credentials)
- **Format:** GraphQL
- **Queries:** Issues, Configuration Findings, Vulnerabilities, Host Config, Data Findings, Secrets, Excessive Access, Network Exposure, Inventory
- **Features:** Pagination, filtering, search, introspection

#### **Gemini AI API**
- **Protocol:** REST/HTTPS
- **Format:** JSON
- **Models:** gemini-2.0-flash, gemini-2.5-flash, gemini-2.5-pro
- **Features:** Text generation, system instructions, temperature control, max tokens

#### **Playwright (Chromium)**
- **Purpose:** Headless browser for PDF rendering
- **Features:** HTML → PDF conversion, print CSS, custom headers/footers, JavaScript execution for layout

---

## Design Patterns

### 1. **Service Layer Pattern**
Encapsulates business logic in dedicated service classes, separating it from HTTP routing logic.

**Benefits:**
- Reusable across different endpoints
- Easier to test
- Clear separation of concerns

**Example:**
```python
# Routes call services, not business logic directly
@wiz_bp.route("/issues", methods=["POST"])
def api_wizi_issues():
    wiz = get_wiz_service()  # Get singleton service
    result = wiz.fetch_all_findings_paginated(query_type, filters)
    return jsonify(result)
```

### 2. **Blueprint Pattern (Flask)**
Modular routing with namespaced endpoints.

**Benefits:**
- Clear API organization
- Easier to maintain large codebases
- Supports team scaling (one blueprint per team)

**Example:**
```python
# app.py
app.register_blueprint(wiz_bp)   # /api/wizi/*
app.register_blueprint(ai_bp)    # /api/*
app.register_blueprint(reports_bp)
app.register_blueprint(files_bp)
```

### 3. **Module Pattern (ES6)**
Frontend code organized as ES6 modules with explicit exports.

**Benefits:**
- Namespace isolation
- Clear dependencies
- Tree-shaking support
- Better code splitting

**Example:**
```javascript
// wizi/index.js
import * as ApiClient from './api-client.js';
import * as Filters from './filters.js';

export function initWizi(context, isCloud) {
  // Orchestrate sub-modules
}
```

### 4. **Dependency Injection**
Services are initialized once and injected where needed.

**Benefits:**
- Reduces coupling
- Easier testing (mock injection)
- Centralized configuration

**Example:**
```python
# Lazy initialization
_wiz_service = None

def get_wiz_service() -> WizService:
    global _wiz_service
    if _wiz_service is None:
        _wiz_service = WizService(
            client_id=WIZI_CLIENT_ID,
            client_secret=WIZI_CLIENT_SECRET
        )
    return _wiz_service
```

### 5. **Repository Pattern** (Implicit)
File operations abstracted through Files Blueprint.

**Benefits:**
- Centralized file storage logic
- Easy to swap storage backends (local → S3)

---

## Key Data Flows

### Flow 1: Wiz Data Import

```
1. User selects subscription in UI
   │
   ▼
2. Frontend: wizi/api-client.js → POST /api/wizi/issues
   │
   ▼
3. Blueprint: backend/routes/wiz.py
   • Validate request
   • Resolve subscription name → IDs via WizService.resolve_subscription()
   │
   ▼
4. Service: WizService.fetch_all_findings_paginated()
   • Get OAuth token (_get_token)
   • Execute GraphQL query (_graphql)
   • Auto-paginate results
   │
   ▼
5. External: Wiz GraphQL API
   │
   ▼
6. Service returns nodes to Blueprint
   │
   ▼
7. Blueprint returns JSON to Frontend
   │
   ▼
8. Frontend: wizi/bulk-actions.js
   • Render findings in UI
   • User selects findings to import
   │
   ▼
9. Frontend: findings/state-manager.js
   • Add selected findings to report state
   • Update UI
```

### Flow 2: PDF Generation

```
1. User clicks "Generate PDF"
   │
   ▼
2. Frontend: export.js
   • Gather report state (findings, metadata)
   • POST /api/render-pdf with JSON payload
   │
   ▼
3. Blueprint: backend/routes/reports.py
   • Validate request
   • Extract metadata and findings
   • Build HTML content
   │
   ▼
4. Service: PDFService.render_pdf(html_content, meta)
   • Write HTML to temp file
   • Launch Chromium via Playwright
   • Apply print CSS
   • Execute page-splitting JavaScript
   • Generate PDF with headers/footers
   │
   ▼
5. External: Playwright → Chromium
   │
   ▼
6. Service returns PDF bytes to Blueprint
   │
   ▼
7. Blueprint saves PDF to output/ directory
   • Returns download URL
   │
   ▼
8. Frontend: Triggers download
```

### Flow 3: AI Enrichment

```
1. User types finding description, clicks "Improve"
   │
   ▼
2. Frontend: ui.js → POST /api/suggest
   • Send text + field context + model preference
   │
   ▼
3. Blueprint: backend/routes/ai.py
   • Validate text length
   • Validate model name
   │
   ▼
4. Service: GeminiService.improve_text(text, field_context, model)
   • Build user prompt with field hint
   • Call _call_gemini() with system prompt
   • Try default model
   • On 429 error → fallback to next model
   • Retry on transient errors (exponential backoff)
   │
   ▼
5. External: Gemini API
   │
   ▼
6. Service returns improved text + model used
   │
   ▼
7. Blueprint returns JSON to Frontend
   │
   ▼
8. Frontend: ui.js
   • Display improved text in modal
   • User accepts/rejects suggestion
```

---

## Security & Middleware

### Authentication
- **Optional Bearer Token:** Set `APP_TOKEN` env var to enable
- Checked via `@app.before_request` hook
- Supports Authorization header and query param (for downloads)

### Rate Limiting
- **In-memory rate limiter:** Tracks requests per client IP
- Default: 30 requests per 60 seconds
- Applies only to POST/DELETE endpoints
- Auto-cleanup of stale entries

### Security Headers
- **X-Content-Type-Options:** nosniff
- **X-Frame-Options:** SAMEORIGIN
- **X-XSS-Protection:** 1; mode=block
- **Referrer-Policy:** strict-origin-when-cross-origin
- **Cache-Control:** no-store (for API endpoints)

### Auto-Cleanup
- Removes output files older than `CLEANUP_DAYS` (default 30)
- Runs on app startup
- Prevents disk space exhaustion

---

## Directory Structure

```
cspm-report-builder/
├── app.py                      # Flask app entry point
├── backend/
│   ├── routes/                 # Flask blueprints
│   │   ├── wiz.py              # Wiz API routes
│   │   ├── ai.py               # AI routes
│   │   ├── reports.py          # Report generation routes
│   │   └── files.py            # File management routes
│   ├── services/               # Business logic services
│   │   ├── wiz_service.py      # Wiz API client
│   │   ├── ai_service.py       # Gemini AI client
│   │   └── pdf_service.py      # PDF rendering
│   └── graphql/
│       └── queries.py          # Wiz GraphQL query definitions
├── static/
│   └── js/
│       ├── wizi/               # Wiz integration module
│       │   ├── index.js        # Main orchestrator
│       │   ├── api-client.js   # Backend API client
│       │   ├── subscription-manager.js
│       │   ├── filters.js
│       │   ├── bulk-actions.js
│       │   └── ui-helpers.js
│       └── src/
│           ├── findings/       # Findings module
│           │   ├── index.js
│           │   ├── renderer.js
│           │   ├── filter-manager.js
│           │   ├── sort-manager.js
│           │   ├── state-manager.js
│           │   ├── export-handler.js
│           │   └── ui-components.js
│           ├── core.js         # App state
│           ├── ui.js           # UI interactions
│           ├── export.js       # Export logic
│           └── init.js         # Initialization
├── templates/
│   └── index.html              # Main SPA template
├── uploads/                    # Uploaded state files
├── output/                     # Generated PDFs
└── tests/                      # Unit tests
    └── backend/
        └── unit/
            ├── test_wiz_service.py
            ├── test_ai_service.py
            └── test_pdf_service.py
```

---

## Technology Stack

### Backend
- **Framework:** Flask 3.x
- **Language:** Python 3.9+
- **HTTP Client:** urllib (standard library)
- **PDF Engine:** Playwright (Chromium)
- **Authentication:** Bearer Token (optional)
- **GraphQL Client:** Custom implementation (urllib-based)

### Frontend
- **Language:** JavaScript ES6+ (Modules)
- **HTTP Client:** Fetch API
- **DOM Manipulation:** Vanilla JS
- **Styling:** CSS3, Tailwind-inspired utilities
- **Module System:** Native ES6 imports

### External Integrations
- **Wiz API:** GraphQL over HTTPS (OAuth2)
- **Gemini API:** REST over HTTPS (API Key)
- **Playwright:** Chromium browser automation

### Development
- **Testing:** pytest (backend), manual (frontend)
- **Linting:** black, flake8 (backend)
- **Version Control:** Git

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Flask app port | `8080` |
| `FLASK_DEBUG` | Enable Flask debug mode | `0` |
| `APP_TOKEN` | Optional Bearer token for auth | _(empty)_ |
| `RATE_LIMIT_WINDOW` | Rate limit window (seconds) | `60` |
| `RATE_LIMIT_MAX` | Max requests per window | `30` |
| `CLEANUP_DAYS` | Auto-delete files older than N days | `30` |
| `WIZI_CLIENT_ID` | Wiz OAuth client ID | _(empty)_ |
| `WIZI_CLIENT_SECRET` | Wiz OAuth secret | _(empty)_ |
| `WIZI_API_URL` | Wiz GraphQL endpoint | `https://api.il1.app.wiz.io/graphql` |
| `WIZI_AUTH_URL` | Wiz OAuth endpoint | `https://auth.app.wiz.io/oauth/token` |
| `GEMINI_API_KEY` | Google Gemini API key | _(empty)_ |

---

## Testing Strategy

### Unit Tests
- **Location:** `tests/backend/unit/`
- **Framework:** pytest
- **Coverage:** Service layer (WizService, GeminiService, PDFService)
- **Mocking:** HTTP responses, Playwright browser

### Integration Tests
- Manual testing via Docker deployment
- End-to-end flows: Import → Edit → Export → PDF

### Future Improvements
- Frontend unit tests (Jest/Vitest)
- E2E tests (Playwright for frontend)
- CI/CD pipeline (GitHub Actions)

---

## Deployment

### Docker
```dockerfile
# Multi-stage build
FROM python:3.9-slim AS base
RUN apt-get update && apt-get install -y \
    libnss3 libxss1 libasound2 fonts-liberation \
    && playwright install chromium --with-deps

FROM base AS app
COPY . /app
WORKDIR /app
RUN pip install -r requirements.txt
CMD ["python", "app.py"]
```

### Environment
- **Recommended:** Docker with environment file
- **Port:** 8080 (configurable)
- **Volume Mounts:** `./uploads`, `./output` (for persistence)

---

## Future Architecture Enhancements

1. **Database Layer**
   - Replace file-based state with PostgreSQL/SQLite
   - Add ORM (SQLAlchemy)

2. **Cache Layer**
   - Redis for token caching, rate limiting
   - Response caching for expensive queries

3. **Message Queue**
   - Celery for async PDF generation
   - Background job processing

4. **API Gateway**
   - Kong/Nginx for rate limiting, auth
   - Load balancing for horizontal scaling

5. **Frontend Framework**
   - Migrate to React/Vue for better state management
   - TypeScript for type safety

6. **Testing**
   - Automated E2E tests
   - Performance testing (load testing)

7. **Monitoring**
   - Prometheus metrics
   - Logging aggregation (ELK stack)

---

## Glossary

- **Blueprint:** Flask's modular routing system
- **Service Layer:** Encapsulated business logic
- **CSPM:** Cloud Security Posture Management
- **Wiz:** Third-party cloud security platform
- **Gemini:** Google's generative AI platform
- **Playwright:** Browser automation framework
- **GraphQL:** Query language for APIs
- **OAuth2:** Authorization framework (client credentials grant)

---

## References

- [Flask Documentation](https://flask.palletsprojects.com/)
- [Playwright Python](https://playwright.dev/python/)
- [Google Gemini API](https://ai.google.dev/docs)
- [Wiz API Documentation](https://docs.wiz.io/api-reference)
- [MDN ES6 Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
