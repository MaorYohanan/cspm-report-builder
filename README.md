# CSPM Report Builder

A self-hosted web tool for building, managing, and exporting Cloud Security Posture Management (CSPM) reports. Built for security consultants who need to document cloud security findings and export professional Hebrew-language PDF reports.

![Python](https://img.shields.io/badge/python-3.12-blue)
![Flask](https://img.shields.io/badge/flask-3.1-green)
![Docker](https://img.shields.io/badge/docker-ready-blue)

## What it does

- **Report builder UI** — fill in client details, add findings with severity, evidence screenshots, recommendations, and policy mappings
- **PDF export** — server-side rendering via Playwright/Chromium with proper Hebrew RTL layout, headers, footers, and page breaks
- **AI writing assistant** — optional Gemini integration to improve phrasing of report fields, with a selectable model (gemini-2.0-flash, 2.5-flash, 2.5-pro)
- **State management** — save/load report configurations as JSON, both locally and on the server
- **CSV import** — bulk import findings from CSV exports (auto-maps common column names)
- **File manager** — upload, download, and manage state files and output reports on the server

## Quick Start

### Prerequisites

- Docker and Docker Compose

### Run locally

```bash
git clone <repo-url>
cd cspm-report-builder
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

### Enable authentication

Uncomment and set the `APP_TOKEN` variable in `docker-compose.yml`:

```yaml
environment:
  - APP_TOKEN=your-secret-token-here
```

When set, all requests (except `/api/health`) require either:
- `Authorization: Bearer <token>` header, or
- `?token=<token>` query parameter (for browser downloads)

### Enable AI writing assistant

Set your Gemini API key as an environment variable before starting the container:

```bash
export GEMINI_API_KEY=your-api-key-here
docker compose up -d
```

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). When enabled, "✨ שפר ניסוח" buttons appear below free-text fields, and a model selector dropdown appears in the report details section. Supported models: `gemini-2.0-flash`, `gemini-2.5-flash`, `gemini-2.5-pro`.

### Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Server port |
| `APP_TOKEN` | _(empty)_ | Bearer token for auth (empty = open access) |
| `CLEANUP_DAYS` | `30` | Auto-delete output files older than N days (0 = disabled) |
| `GEMINI_API_KEY` | _(empty)_ | Google Gemini API key for AI writing assistant (empty = disabled) |
| `FLASK_DEBUG` | `0` | Enable Flask debug mode |

## Usage

### Building a report

1. Fill in the **report details** section (client name, environment, date, executive summary)
2. Add findings using the form — each finding gets an auto-generated ID (CSPM-001, CSPM-002...)
3. For evidence, you can:
   - **Drag and drop** an image onto the drop zone
   - **Paste from clipboard** (Ctrl+V / Cmd+V) — great for screenshots
   - **Click** to browse for a file
4. Use **Ctrl+Enter** to quickly add a finding and start the next one
5. Sort findings by severity using the sort button
6. Duplicate similar findings with the "שכפל" button

### Exporting

- **PDF (server)** — renders a professional PDF with headers, footers, severity charts, and page breaks
- **HTML** — opens the report in a new tab or downloads as a file
- **JSON** — export/import the full report state for backup or sharing

### CSV Import

Click "ייבוא ממצאים מ-CSV" to bulk import findings. The importer supports two formats:

#### Wiz Cloud Configuration Findings (auto-detected)

Export from Wiz: Cloud Configuration Findings → Group by Rule → Export CSV. The importer auto-detects the Wiz format and maps:

| Wiz CSV column | → Report field |
|---|---|
| `rule.shortId` | Finding ID |
| `rule.name` | Title |
| `rule.severity` | Severity |
| `rule.description` | Description |
| `rule.risks` | Impact |
| `rule.remediationInstructions` | Recommendations |
| `rule.cloudProvider`, `serviceType`, `targetNativeType` | Technical details |
| `analytics.totalFindingCount`, `resourceCount` | Technical details (counts) |
| `rule.externalReferences` | Policies / standards |

#### Generic CSV

For other CSV sources, the importer auto-maps common column names:

| Expected columns | Mapped from |
|---|---|
| ID | `id`, `finding id`, `מזהה` |
| Title | `title`, `name`, `issue`, `כותרת` |
| Severity | `severity`, `risk`, `חומרה` |
| Description | `description`, `details`, `תיאור` |
| Impact | `impact`, `השפעה` |
| Recommendation | `recommendation`, `remediation`, `fix`, `המלצה` |

### Auto-save

Your work is automatically saved to the browser's localStorage every 10 seconds and on page close. When you reopen the page, it restores your last session.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Builder UI |
| `POST` | `/api/render-pdf` | Render HTML to PDF |
| `POST` | `/api/upload-state` | Upload JSON state |
| `GET` | `/api/download-state/<id>` | Download state file |
| `GET` | `/api/list-states` | List saved states |
| `DELETE` | `/api/delete-state/<id>` | Delete a state |
| `POST` | `/api/upload-html` | Upload HTML report |
| `GET` | `/api/download-output/<name>` | Download output file |
| `GET` | `/api/list-outputs` | List output files |
| `DELETE` | `/api/delete-output/<name>` | Delete output file |
| `GET` | `/api/health` | Health check (always open) |
| `POST` | `/api/suggest` | AI phrasing suggestions (requires `GEMINI_API_KEY`). Accepts `model` param to select Gemini model |

## Project Structure

```
.
├── app.py                      # Flask backend + PDF rendering
├── index.html                  # Builder UI (entry point)
├── static/
│   ├── css/
│   │   └── builder.css         # Builder UI styles
│   └── js/
│       └── builder.js          # Builder UI logic
├── assets/
│   └── report.css              # Generated report stylesheet
├── templates/
│   └── report_template.html    # Jinja2 report template
├── render_pdf_playwright.py    # Standalone PDF renderer (CLI)
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── README.md
```

## Development

To develop without rebuilding Docker on every HTML change, the `docker-compose.yml` mounts the HTML and assets as volumes. Just edit and refresh.

For Python changes (`app.py`), rebuild:

```bash
docker compose build && docker compose up
```

## License

MIT
