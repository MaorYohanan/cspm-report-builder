# CSPM Report Builder — Production Deployment Guide

> **Keep this file up to date.** Any infrastructure change (new env var, new service dependency, schema change, new GCS feature) must be reflected here before merging to `main`.

---

## Architecture Overview

| Component | Dev (local) | Production (GCP) |
|-----------|-------------|------------------|
| **Runtime** | `python app.py` or Docker | Cloud Run |
| **Database** | SQLite (`instance/app.db`) | Cloud SQL — PostgreSQL |
| **File storage** | Local disk (`uploads/`) | Google Cloud Storage (GCS) |
| **PDF rendering** | Playwright (local Chromium) | Playwright inside the container |
| **Auth** | Static `APP_TOKEN` bearer | Google OAuth + RBAC *(Milestone 1.4 — not yet)* |

---

## First Deploy — Step-by-Step

### Prerequisites
- GCP project created
- Cloud Run API enabled
- Cloud SQL (PostgreSQL) instance created and accessible
- Artifact Registry repository for the Docker image
- Service account for Cloud Run with these roles:
  - `Cloud SQL Client`
  - `Storage Object Creator` / `Storage Object Viewer` (when GCS is enabled, Milestone 1.3)

---

### 1. Build and push the Docker image

```bash
# From the project root
gcloud builds submit --tag gcr.io/YOUR_PROJECT/cspm-report-builder:latest
# or with Artifact Registry:
docker build -t REGION-docker.pkg.dev/YOUR_PROJECT/REPO/cspm-report-builder:latest .
docker push REGION-docker.pkg.dev/YOUR_PROJECT/REPO/cspm-report-builder:latest
```

---

### 2. Create the PostgreSQL database and user

Connect to your Cloud SQL instance and run:

```sql
CREATE DATABASE cspm;
CREATE USER cspm_user WITH PASSWORD 'your-strong-password';
GRANT ALL PRIVILEGES ON DATABASE cspm TO cspm_user;
```

---

### 3. Create the database tables (first deploy only)

Tables are NOT auto-created in production (by design). Run this once against your Cloud SQL instance:

```bash
DATABASE_URL="postgresql+psycopg2://cspm_user:password@/cspm?host=/cloudsql/PROJECT:REGION:INSTANCE" \
python -c "
from app import app
from backend.database import db
import backend.models
with app.app_context():
    db.create_all()
print('Tables created.')
"
```

> **Note:** After Milestone 1.1 you can run this locally with the Cloud SQL Auth Proxy, or from a Cloud Run job.

---

### 4. (Optional) Set up Google OAuth

If you want login authentication instead of (or in addition to) the `APP_TOKEN` bearer:

1. Go to **GCP Console → APIs & Services → Credentials**
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Add the Authorized redirect URI: `https://YOUR_CLOUD_RUN_URL/auth/callback`
4. Copy the Client ID and Client Secret
5. Generate a `SECRET_KEY`: `python -c "import secrets; print(secrets.token_hex(32))"`
6. Add `INITIAL_ADMIN_EMAIL=your@email.com` so the first login auto-creates your Admin account

Add all three to Cloud Run env vars in step 5.

---

### 5. Deploy to Cloud Run

```bash
gcloud run deploy cspm-report-builder \
  --image REGION-docker.pkg.dev/YOUR_PROJECT/REPO/cspm-report-builder:latest \
  --platform managed \
  --region REGION \
  --allow-unauthenticated \
  --add-cloudsql-instances PROJECT:REGION:INSTANCE \
  --set-env-vars "
    DATABASE_URL=postgresql+psycopg2://cspm_user:password@/cspm?host=/cloudsql/PROJECT:REGION:INSTANCE,
    SECRET_KEY=your-generated-secret-key,
    GEMINI_API_KEY=your-gemini-key,
    WIZI_CLIENT_ID=your-wiz-client-id,
    WIZI_CLIENT_SECRET=your-wiz-client-secret,
    WIZI_AUTH_URL=https://auth.app.wiz.io/oauth/token,
    WIZI_API_URL=https://api.il1.app.wiz.io/graphql,
    APP_TOKEN=your-strong-random-token,
    GOOGLE_CLIENT_ID=your-google-client-id,
    GOOGLE_CLIENT_SECRET=your-google-client-secret,
    ALLOWED_DOMAIN=yourcompany.com,
    INITIAL_ADMIN_EMAIL=your@email.com,
    RATE_LIMIT_MAX=30,
    RATE_LIMIT_WINDOW=60
  "
```

> **Security:** Store secrets in Secret Manager and reference them with `--set-secrets` instead of plain `--set-env-vars` for production.

---

### 6. Migrate existing data (if upgrading from JSON-file storage)

If you have existing products in `uploads/products/` from the old version, migrate them once:

```bash
# Option A: run locally against Cloud SQL via Auth Proxy
cloud-sql-proxy PROJECT:REGION:INSTANCE &
DATABASE_URL="postgresql+psycopg2://cspm_user:password@127.0.0.1:5432/cspm" \
python -m backend.migration.migrate_json_to_db

# Option B: copy the uploads/ dir into the container and run the script there
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (prod) | PostgreSQL connection string. Leave empty for SQLite dev. |
| `SECRET_KEY` | Yes (prod) | Flask session signing key. Generate: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `GEMINI_API_KEY` | No | Enables AI executive summary features. |
| `WIZI_CLIENT_ID` | No | Wiz service account client ID. |
| `WIZI_CLIENT_SECRET` | No | Wiz service account secret. |
| `WIZI_AUTH_URL` | No | Wiz OAuth token URL. |
| `WIZI_API_URL` | No | Wiz GraphQL API URL. |
| `APP_TOKEN` | Recommended | Bearer token protecting all API endpoints (also grants script/CI admin access in OAuth mode). |
| `RATE_LIMIT_MAX` | No | Max POST/DELETE/PATCH requests per window per IP (default 30). |
| `RATE_LIMIT_WINDOW` | No | Rate limit window in seconds (default 60). |
| `CLEANUP_DAYS` | No | Delete output files older than N days (default 30). |
| `FLASK_DEBUG` | No | Set to `1` for human-readable logs in dev (default: JSON). |
| `GUNICORN_WORKERS` | No | Number of Gunicorn worker processes (default 1). |
| `GUNICORN_THREADS` | No | Threads per worker (default 4). |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID. If set, enables OAuth login gate. |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret. |
| `ALLOWED_DOMAIN` | No | Restrict OAuth login to this email domain (e.g. `company.com`). Empty = any Google account. |
| `INITIAL_ADMIN_EMAIL` | No | Email auto-granted Admin role on first login when Users table is empty. |
| `GCS_BUCKET_NAME` | No | Reserved — not yet used (evidence stored as base64 in DB). |

---

## Schema Changes (after first deploy)

The app **never** auto-migrates in production. After any model change:

1. Write an Alembic migration (or write raw `ALTER TABLE` SQL manually)
2. Apply it to Cloud SQL before deploying the new image
3. Deploy the new image

*(Alembic integration is planned for a later milestone.)*

---

## Rollback

To roll back to the previous image:

```bash
gcloud run deploy cspm-report-builder --image PREVIOUS_IMAGE_TAG --region REGION
```

Database schema changes that added columns are generally safe to leave in place during a rollback. Destructive changes (dropping columns/tables) should be applied only after the new code is confirmed stable.
