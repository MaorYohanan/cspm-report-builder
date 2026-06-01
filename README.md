# CSPM Report Builder

A self-hosted tool for building cloud security reports. Connects to Wiz, imports findings, and exports professional Hebrew PDF reports.

Built for security consultants who need to document CSPM/DSPM/KSPM findings across multiple cloud environments.

![Python](https://img.shields.io/badge/python-3.12-blue)
![Flask](https://img.shields.io/badge/flask-3.1-green)
![Docker](https://img.shields.io/badge/docker-ready-blue)

---

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [Wizi Integration](#wizi-integration)
- [Optional Features](#optional-features)
- [Configuration](#configuration)
- [UI Features](#ui-features)
- [Development](#development)
- [API Endpoints](#api-endpoints)
- [License](#license)

---

## Quick Start

```bash
git clone https://github.com/Metoraf007/cspm-report-builder.git
cd cspm-report-builder
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080).

That's it. No database, no external dependencies beyond Docker.

---

## Architecture

The application follows a layered architecture with clear separation of concerns:

### Backend Architecture

**Service Layer Pattern**
- **Services** (`backend/services/`) — encapsulate business logic and external API integrations
  - `wiz_service.py` — Wiz API authentication, GraphQL queries, finding retrieval
  - `ai_service.py` — Gemini AI integration for text improvement
  - `pdf_service.py` — PDF generation using Playwright and Jinja2 templates
  
**Flask Blueprints** (`backend/routes/`)
- Modular route handlers for clean API organization
  - `health.py` — health check endpoint
  - `wiz.py` — Wiz API proxy endpoints
  - `ai.py` — AI suggestion endpoints
  - `reports.py` — PDF rendering endpoints
  - `files.py` — file management endpoints

**GraphQL Queries** (`backend/graphql/`)
- `queries.py` — centralized GraphQL query definitions for Wiz API

### Frontend Architecture

**ES6 Module System**
- Split monolithic JavaScript into focused modules
- Two main feature domains:

**Wizi Integration** (`static/js/wizi/`)
- `api-client.js` — Wiz API HTTP client
- `bulk-actions.js` — batch operations (delete, update)
- `filters.js` — finding filtering logic
- `subscription-manager.js` — subscription/project filtering
- `ui-helpers.js` — DOM manipulation and UI updates
- `index.js` — module orchestration

**Findings Management** (`static/js/src/findings/`)
- `export-handler.js` — JSON/PDF/HTML export logic
- `filter-manager.js` — finding list filtering
- `renderer.js` — HTML table rendering
- `sort-manager.js` — sorting by severity/date/etc.
- `state-manager.js` — auto-save and state persistence
- `ui-components.js` — reusable UI components
- `index.js` — module orchestration

**Legacy Monolith**
- `static/js/builder.js` — main app logic (being progressively refactored into modules)

### Test Architecture

**Backend Tests** (`tests/backend/unit/`)
- `test_wiz_service.py` — Wiz API service tests
- `test_ai_service.py` — AI service tests
- `test_pdf_service.py` — PDF generation tests
- Fixtures in `tests/backend/fixtures/`

**Frontend Tests** (`tests/frontend/`)
- Jest-based unit tests with jsdom
- `__tests__/` — test files
- `__mocks__/` — mock implementations
- `findings/` — findings-specific test utilities

---

## How It Works

The tool has 5 tabs:

1. **Report Details** — client name, environment, date, executive summary, cover image
2. **Edit Findings** — add/edit findings with severity, category, description, impact, recommendations, evidence
3. **Export** — generate PDF or HTML reports, export/import JSON state
4. **File Manager** — manage saved states and output files on the server
5. **Wizi** — connect to Wiz API, browse/search findings, import into the report

### The Report Flow

```
Wiz API  ──┐
CSV file ──┤──→  Findings List  ──→  Hebrew PDF Report
Manual    ──┘    (edit, sort,        (cover, TOC, severity chart,
                  batch edit)         per-finding pages, evidence)
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

| Query Type | Category | What it fetches |
|---|---|---|
| Issues | Mixed | Cross-category security issues (the main Wiz view) |
| Cloud Configuration | CSPM | Misconfigured cloud resources |
| Vulnerabilities | VULN | CVEs with CVSS scores, exploit info, fix versions |
| Host Configuration | HSPM | Host-level security assessments |
| Data Findings | DSPM | Sensitive data exposure (PII, secrets in storage) |
| Secrets | SECR | Exposed credentials and certificates |
| Excessive Access | EAPM | Over-privileged identities |
| Network Exposure | NEXP | Publicly exposed resources |
| Inventory / EOL | EOLM | End-of-life software and untagged resources |

### Find by ID

The search bar accepts multiple formats and runs through 6 strategies automatically:

- `EC2-005` — rule shortId (resolves via `cloudConfigurationRules`)
- `wc-id-870` — issue control/rule ID
- `e7dba598-3065-...` — full UUID (tries all 9 query types)
- `IMDSv2` — free-text fallback on issues

Results are paginated with subscription filtering.

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

---

## Optional Features

### AI Writing Assistant

Set `GEMINI_API_KEY` to enable "✨ שפר ניסוח" buttons on free-text fields. Supports `gemini-2.0-flash`, `gemini-2.5-flash`, `gemini-2.5-pro`.

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### Authentication

Set `APP_TOKEN` to require a bearer token on all endpoints (except `/api/health`):

```yaml
# docker-compose.yml
environment:
  - APP_TOKEN=your-secret-token
```

### CSV Import

Supports two formats:
- **Wiz CSV export** — auto-detected, maps `rule.shortId`, `rule.name`, `rule.severity`, `rule.remediationInstructions`, etc.
- **Generic CSV** — auto-maps common column names (`id`, `title`, `severity`, `description`, `impact`, `recommendation`)

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Server port |
| `APP_TOKEN` | _(empty)_ | Bearer token for auth (empty = open) |
| `GEMINI_API_KEY` | _(empty)_ | Gemini API key (empty = AI disabled) |
| `WIZI_CLIENT_ID` | _(empty)_ | Wiz service account ID (empty = Wizi hidden) |
| `WIZI_CLIENT_SECRET` | _(empty)_ | Wiz service account secret |
| `WIZI_API_URL` | `https://api.il1.app.wiz.io/graphql` | Wiz GraphQL endpoint |
| `WIZI_AUTH_URL` | `https://auth.app.wiz.io/oauth/token` | Wiz OAuth endpoint |
| `RATE_LIMIT_MAX` | `30` | Max POST/DELETE requests per IP per window |
| `RATE_LIMIT_WINDOW` | `60` | Rate limit window (seconds) |
| `CLEANUP_DAYS` | `30` | Auto-delete output files after N days |

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
- **Deduplication** — auto-detects duplicates during Wizi import

---

## Development

### Getting Started

**Prerequisites**
- Python 3.12+
- Node.js 18+ (for frontend tests)
- Docker (optional, for containerized deployment)

**Backend Setup**

```bash
# Install Python dependencies
pip install -r requirements.txt

# Run tests
pytest tests/backend/

# Run specific test file
pytest tests/backend/unit/test_wiz_service.py
```

**Frontend Setup**

```bash
# Install Node dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

**Running the Application**

```bash
# Docker (recommended)
docker compose up --build

# Local development
python app.py
```

Frontend files (`index.html`, `static/`) are volume-mounted — edit and refresh.

For backend changes, rebuild:

```bash
docker compose up --build -d
```

### Project Structure

```
cspm-report-builder/
├── app.py                          # Flask application entry point
├── index.html                      # Builder UI entry point
│
├── backend/                        # Backend modules
│   ├── services/                   # Business logic layer
│   │   ├── wiz_service.py          # Wiz API integration
│   │   ├── ai_service.py           # Gemini AI integration
│   │   └── pdf_service.py          # PDF generation
│   ├── routes/                     # Flask blueprints
│   │   ├── health.py               # Health check endpoint
│   │   ├── wiz.py                  # Wiz API proxy
│   │   ├── ai.py                   # AI suggestions
│   │   ├── reports.py              # PDF rendering
│   │   └── files.py                # File management
│   └── graphql/                    # GraphQL queries
│       └── queries.py              # Wiz API queries
│
├── static/                         # Frontend assets
│   ├── js/
│   │   ├── builder.js              # Main app logic (legacy monolith)
│   │   ├── wizi/                   # Wizi integration modules
│   │   │   ├── api-client.js       # HTTP client
│   │   │   ├── bulk-actions.js     # Batch operations
│   │   │   ├── filters.js          # Filtering logic
│   │   │   ├── subscription-manager.js
│   │   │   ├── ui-helpers.js       # DOM helpers
│   │   │   └── index.js            # Module entry
│   │   └── src/                    # Core modules
│   │       └── findings/           # Findings management
│   │           ├── export-handler.js
│   │           ├── filter-manager.js
│   │           ├── renderer.js
│   │           ├── sort-manager.js
│   │           ├── state-manager.js
│   │           ├── ui-components.js
│   │           └── index.js
│   └── css/
│       └── builder.css             # Styles (dark/light themes)
│
├── tests/                          # Test suite
│   ├── backend/                    # Backend tests
│   │   ├── unit/                   # Unit tests
│   │   │   ├── test_wiz_service.py
│   │   │   ├── test_ai_service.py
│   │   │   └── test_pdf_service.py
│   │   └── fixtures/               # Test fixtures
│   └── frontend/                   # Frontend tests
│       ├── __tests__/              # Jest tests
│       ├── __mocks__/              # Mock implementations
│       └── findings/               # Findings test utils
│
├── templates/
│   └── report_template.html        # Jinja2 PDF template
│
├── assets/
│   ├── cover.png                   # Default report cover
│   └── report.css                  # Generated report stylesheet
│
├── render_pdf_playwright.py        # Standalone CLI PDF renderer
├── requirements.txt                # Python dependencies
└── package.json                    # Node.js dependencies
```

### Adding New Features

**Adding a New Service**

1. Create service file in `backend/services/`:

```python
# backend/services/my_service.py
class MyService:
    def __init__(self):
        pass
    
    def do_something(self):
        # Business logic here
        pass
```

2. Register in `backend/services/__init__.py`:

```python
from .my_service import MyService
```

3. Add unit tests in `tests/backend/unit/test_my_service.py`

**Adding a New Route**

1. Create blueprint in `backend/routes/`:

```python
# backend/routes/my_routes.py
from flask import Blueprint, jsonify

bp = Blueprint('my_routes', __name__)

@bp.route('/api/my-endpoint', methods=['GET'])
def my_endpoint():
    return jsonify({'status': 'ok'})
```

2. Register blueprint in `app.py`:

```python
from backend.routes import my_routes
app.register_blueprint(my_routes.bp)
```

3. Add integration tests

**Adding a New Frontend Module**

1. Create module in `static/js/src/` or `static/js/wizi/`:

```javascript
// static/js/src/my-feature/index.js
export class MyFeature {
    constructor() {
        // Initialization
    }
    
    doSomething() {
        // Feature logic
    }
}
```

2. Import in `static/js/builder.js`:

```javascript
import { MyFeature } from './src/my-feature/index.js';
```

3. Add Jest tests in `tests/frontend/__tests__/`

**Running Tests**

```bash
# All backend tests
pytest tests/backend/

# Specific test file
pytest tests/backend/unit/test_wiz_service.py

# With coverage
pytest --cov=backend tests/backend/

# All frontend tests
npm test

# Frontend tests in watch mode
npm run test:watch

# With coverage report
npm run test:coverage
```

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Builder UI |
| `GET` | `/api/health` | Health check (always open, no auth) |
| `POST` | `/api/render-pdf` | Render HTML → PDF |
| `POST` | `/api/suggest` | AI phrasing suggestions |
| `POST` | `/api/upload-state` | Save report state |
| `GET` | `/api/list-states` | List saved states |
| `GET` | `/api/download-state/<id>` | Download state |
| `DELETE` | `/api/delete-state/<id>` | Delete state |
| `POST` | `/api/upload-html` | Upload HTML report |
| `GET` | `/api/list-outputs` | List output files |
| `GET` | `/api/download-output/<name>` | Download output |
| `DELETE` | `/api/delete-output/<name>` | Delete output |
| `POST` | `/api/wizi/issues` | Fetch findings (all 9 query types) |
| `POST` | `/api/wizi/find-by-id` | Search by ID/shortId/rule |
| `GET` | `/api/wizi/projects` | List Wiz projects |
| `GET` | `/api/wizi/subscriptions` | List Wiz subscriptions |
| `GET` | `/api/wizi/status` | Wiz connection status |
| `POST` | `/api/wizi/graphql` | Raw GraphQL proxy (read-only) |
| `GET` | `/api/wizi/discover` | Introspect Wiz API schema |

---

## License

MIT
