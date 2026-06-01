# CSPM Report Builder - API Documentation

Version: 1.0.0  
Base URL: `http://localhost:5000`

## Table of Contents

- [System Endpoints](#system-endpoints) (3 endpoints)
- [Wiz Integration API](#wiz-integration-api) (8 endpoints)
- [AI Services API](#ai-services-api) (2 endpoints)
- [Reports API](#reports-api) (2 endpoints)
- [File Management API](#file-management-api) (7 endpoints)

**Total: 22 HTTP endpoints**

---

## System Endpoints

### 1. Health Check

**Endpoint:** `GET /api/health`

**Description:** Check if the Flask application is running and healthy.

**Request Parameters:** None

**Response (200 OK):**
```json
{
  "status": "healthy"
}
```

**cURL Example:**
```bash
curl http://localhost:5000/api/health
```

---

### 2. Serve Builder UI

**Endpoint:** `GET /`

**Description:** Serves the main CSPM Report Builder web interface.

**Request Parameters:** None

**Response:** HTML page (index.html)

---

### 3. Serve Static Assets

**Endpoint:** `GET /assets/<path:filename>`

**Description:** Serves static files (CSS, JS, images) from the `static/` directory.

**Request Parameters:**
- `filename` (path parameter): Path to the static file

**Example:**
```
GET /assets/css/style.css
GET /assets/js/core.js
GET /assets/images/logo.png
```

**Response:** Static file content with appropriate MIME type

---

## Wiz Integration API

Base path: `/api/wizi`

### 1. Check Wiz Status

**Endpoint:** `GET /api/wizi/status`

**Description:** Check if Wiz integration is configured and reachable.

**Request Parameters:** None

**Response (200 OK):**
```json
{
  "enabled": true,
  "totalIssues": 1234
}
```

**Response (200 OK - Not Configured):**
```json
{
  "enabled": false
}
```

**Response (200 OK - Error):**
```json
{
  "enabled": false,
  "error": "Connection timeout"
}
```

**cURL Example:**
```bash
curl http://localhost:5000/api/wizi/status
```

---

### 2. List Projects

**Endpoint:** `GET /api/wizi/projects`

**Description:** Fetch available projects from Wiz.

**Request Parameters:** None

**Response (200 OK):**
```json
{
  "projects": [
    {
      "id": "project-uuid-1",
      "name": "Production Environment",
      "slug": "prod-env"
    },
    {
      "id": "project-uuid-2",
      "name": "Development Environment",
      "slug": "dev-env"
    }
  ]
}
```

**Error Responses:**

- **501 Not Implemented:**
```json
{
  "error": "Wizi integration not configured"
}
```

- **502 Bad Gateway:**
```json
{
  "error": "Connection failed"
}
```

**cURL Example:**
```bash
curl http://localhost:5000/api/wizi/projects
```

---

### 3. List Subscriptions

**Endpoint:** `GET /api/wizi/subscriptions`

**Description:** Fetch available subscriptions (cloud accounts) from Wiz.

**Request Parameters:** None

**Response (200 OK):**
```json
{
  "subscriptions": [
    {
      "id": "subscription-uuid-1",
      "name": "aws-production",
      "externalId": "123456789012",
      "cloudProvider": "AWS"
    },
    {
      "id": "subscription-uuid-2",
      "name": "azure-development",
      "externalId": "sub-abc-123",
      "cloudProvider": "AZURE"
    }
  ]
}
```

**Error Responses:**

- **501 Not Implemented:**
```json
{
  "error": "Wizi integration not configured"
}
```

- **502 Bad Gateway:**
```json
{
  "error": "API connection failed"
}
```

**cURL Example:**
```bash
curl http://localhost:5000/api/wizi/subscriptions
```

---

### 4. GraphQL Proxy

**Endpoint:** `POST /api/wizi/graphql`

**Description:** Raw GraphQL proxy for debugging. Read-only - mutations are blocked.

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "query": "query { issues(first: 10) { totalCount nodes { id title } } }",
  "variables": {
    "first": 10
  }
}
```

**Response (200 OK):**
```json
{
  "data": {
    "issues": {
      "totalCount": 42,
      "nodes": [
        {
          "id": "issue-1",
          "title": "Security group allows unrestricted access"
        }
      ]
    }
  }
}
```

**Error Responses:**

- **400 Bad Request:**
```json
{
  "error": "No query provided"
}
```

- **403 Forbidden:**
```json
{
  "error": "Mutations are not allowed"
}
```

- **400 Bad Request:**
```json
{
  "error": "Query too large (max 10000 chars)"
}
```

- **501 Not Implemented:**
```json
{
  "error": "Wizi integration not configured"
}
```

- **502 Bad Gateway:**
```json
{
  "error": "Wizi API error: 400",
  "details": "GraphQL syntax error"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/wizi/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { issues(first: 5) { totalCount } }",
    "variables": {}
  }'
```

---

### 5. Discover Schema

**Endpoint:** `GET /api/wizi/discover`

**Description:** Discover available root query fields via GraphQL introspection.

**Request Parameters:** None

**Response (200 OK):**
```json
{
  "fields": [
    {
      "name": "issues",
      "type": "IssueConnection",
      "description": "Query security issues"
    },
    {
      "name": "configurationFindings",
      "type": "ConfigurationFindingConnection",
      "description": "Query configuration findings"
    }
  ]
}
```

**Error Responses:**

- **501 Not Implemented:**
```json
{
  "error": "Wizi integration not configured"
}
```

- **502 Bad Gateway:**
```json
{
  "error": "Introspection failed"
}
```

**cURL Example:**
```bash
curl http://localhost:5000/api/wizi/discover
```

---

### 6. Fetch Issues/Findings

**Endpoint:** `POST /api/wizi/issues`

**Description:** Fetch findings from Wiz with optional filters and pagination. Supports multiple query types.

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "queryType": "issues",
  "first": 100,
  "after": "cursor-string-optional",
  "severity": ["CRITICAL", "HIGH"],
  "status": ["OPEN", "IN_PROGRESS"],
  "project": "project-uuid",
  "subscription": "aws-production"
}
```

**Query Types:**
- `issues` (default)
- `configurationFindings`
- `vulnerabilityFindings`
- `hostConfigurationRuleAssessments`
- `dataFindingsV2`
- `secretInstances`
- `excessiveAccessFindings`
- `networkExposures`
- `inventoryFindings`

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| queryType | string | No | Type of findings to fetch (default: "issues") |
| first | number | No | Number of results (max 500, default 100) |
| after | string | No | Pagination cursor |
| severity | string/array | No | Filter by severity (CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL) |
| status | string/array | No | Filter by status (OPEN, IN_PROGRESS, RESOLVED, REJECTED) |
| project | string/array | No | Filter by project ID(s) |
| subscription | string | No | Filter by subscription name (fuzzy match) |

**Response (200 OK):**
```json
{
  "queryType": "issues",
  "issues": {
    "totalCount": 42,
    "pageInfo": {
      "hasNextPage": true,
      "endCursor": "next-cursor-string"
    },
    "nodes": [
      {
        "id": "issue-uuid-1",
        "title": "Security group allows unrestricted SSH access",
        "severity": "CRITICAL",
        "status": "OPEN",
        "createdAt": "2026-05-15T10:30:00Z",
        "entitySnapshot": {
          "id": "resource-uuid",
          "name": "sg-production",
          "type": "SECURITY_GROUP",
          "subscriptionName": "aws-production"
        },
        "sourceRule": {
          "id": "rule-uuid",
          "name": "SSH accessible from internet",
          "shortId": "EC2-005"
        }
      }
    ]
  }
}
```

**Response (200 OK - With Warning):**
```json
{
  "queryType": "issues",
  "issues": { ... },
  "warning": "Subscription 'unknown-sub' not found in cloud accounts. Results may be unfiltered."
}
```

**Error Responses:**

- **501 Not Implemented:**
```json
{
  "error": "Wizi integration not configured"
}
```

- **502 Bad Gateway:**
```json
{
  "error": "GraphQL error",
  "details": [ ... ]
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/wizi/issues \
  -H "Content-Type: application/json" \
  -d '{
    "queryType": "issues",
    "first": 50,
    "severity": ["CRITICAL", "HIGH"],
    "status": ["OPEN"],
    "subscription": "aws-production"
  }'
```

---

### 7. Bulk Fetch Findings

**Endpoint:** `POST /api/wizi/bulk-fetch`

**Description:** Fetch findings across all 9 query types for a subscription. Returns HIGH/CRITICAL severity, OPEN/IN_PROGRESS status findings.

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "subscription": "aws-production"
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| subscription | string | Yes | Subscription name to filter by |

**Response (200 OK):**
```json
{
  "results": {
    "issues": {
      "nodes": [ ... ],
      "totalCount": 42
    },
    "configurationFindings": {
      "nodes": [ ... ],
      "totalCount": 128
    },
    "vulnerabilityFindings": {
      "nodes": [ ... ],
      "totalCount": 56
    },
    "hostConfigurationRuleAssessments": {
      "nodes": [ ... ],
      "totalCount": 34
    },
    "dataFindingsV2": {
      "nodes": [ ... ],
      "totalCount": 12
    },
    "secretInstances": {
      "nodes": [ ... ],
      "totalCount": 8
    },
    "excessiveAccessFindings": {
      "nodes": [ ... ],
      "totalCount": 45
    },
    "networkExposures": {
      "nodes": [ ... ],
      "totalCount": 23
    },
    "inventoryFindings": {
      "nodes": [ ... ],
      "totalCount": 67
    }
  },
  "resolvedSubscription": {
    "ids": ["subscription-uuid-1"],
    "externalIds": ["123456789012"],
    "names": ["aws-production"]
  },
  "errors": {}
}
```

**Response (200 OK - With Errors):**
```json
{
  "results": { ... },
  "resolvedSubscription": { ... },
  "errors": {
    "vulnerabilityFindings": "Timeout error"
  }
}
```

**Error Responses:**

- **400 Bad Request:**
```json
{
  "error": "יש להזין שם Subscription"
}
```

- **501 Not Implemented:**
```json
{
  "error": "Wizi integration not configured"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/wizi/bulk-fetch \
  -H "Content-Type: application/json" \
  -d '{
    "subscription": "aws-production"
  }'
```

---

### 8. Find by ID

**Endpoint:** `POST /api/wizi/find-by-id`

**Description:** Fetch findings from Wiz by ID or rule ID. Returns paginated results for user selection. Supports multiple search strategies.

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "id": "finding-uuid-or-rule-id",
  "subscription": "aws-production",
  "pageSize": 5,
  "page": 0
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string | Yes | Finding UUID, rule UUID, or rule shortId (e.g., "EC2-005") |
| subscription | string | No | Filter results by subscription name |
| pageSize | number | No | Results per page (default: 5) |
| page | number | No | Page number (zero-indexed, default: 0) |

**Response (200 OK):**
```json
{
  "queryType": "configurationFindings",
  "nodes": [
    {
      "id": "finding-uuid-1",
      "result": "FAIL",
      "severity": "HIGH",
      "analyzedAt": "2026-05-30T14:22:00Z",
      "resource": {
        "id": "resource-uuid",
        "name": "sg-production",
        "type": "SECURITY_GROUP",
        "subscription": {
          "id": "sub-uuid",
          "name": "aws-production"
        }
      },
      "rule": {
        "id": "rule-uuid",
        "name": "Security group allows unrestricted access",
        "shortId": "EC2-005"
      }
    }
  ],
  "total": 12,
  "page": 0,
  "pageSize": 5,
  "hasMore": true
}
```

**Search Strategies (in order):**
1. Direct ID match (exact finding UUID)
2. Issues by rule ID (sourceRule filter)
3. Configuration findings by rule ID
4. Host configuration by rule ID
5. Rule shortId lookup (e.g., "EC2-005") → configuration findings
6. Free-text search via issues

**Error Responses:**

- **400 Bad Request:**
```json
{
  "error": "No finding ID provided"
}
```

- **404 Not Found:**
```json
{
  "error": "Finding not found",
  "id": "unknown-id"
}
```

- **501 Not Implemented:**
```json
{
  "error": "Wizi integration not configured"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/wizi/find-by-id \
  -H "Content-Type: application/json" \
  -d '{
    "id": "EC2-005",
    "subscription": "aws-production",
    "pageSize": 10,
    "page": 0
  }'
```

---

## AI Services API

### 1. Improve Text

**Endpoint:** `POST /api/suggest`

**Description:** Send text to Gemini for phrasing improvement and professional rewriting.

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "text": "This finding is very bad and needs to be fixed urgently",
  "field": "description",
  "model": "gemini-2.5-flash"
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| text | string | Yes | Text to improve |
| field | string | No | Field context hint (e.g., "description", "title", "remediation") |
| model | string | No | Gemini model to use (default: "gemini-2.0-flash") |

**Available Models:**
- `gemini-2.0-flash` (default)
- `gemini-2.5-flash`
- `gemini-2.5-pro`

**Response (200 OK):**
```json
{
  "suggestion": "This critical security finding requires immediate remediation to prevent potential data exposure and unauthorized access.",
  "model": "gemini-2.5-flash"
}
```

**Error Responses:**

- **400 Bad Request:**
```json
{
  "error": "No text provided"
}
```

- **400 Bad Request:**
```json
{
  "error": "Invalid model specified"
}
```

- **501 Not Implemented:**
```json
{
  "error": "AI assist not configured (GEMINI_API_KEY not set)"
}
```

- **502 Bad Gateway:**
```json
{
  "error": "Gemini API error: Rate limit exceeded"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/suggest \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Fix the security issue immediately",
    "field": "remediation",
    "model": "gemini-2.5-flash"
  }'
```

---

### 2. Summarize Remediation

**Endpoint:** `POST /api/summarize-remediation`

**Description:** Summarize remediation instructions using AI. Condenses long remediation steps into concise, actionable summaries.

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "title": "Security group allows unrestricted SSH access",
  "description": "The security group sg-production allows SSH access from 0.0.0.0/0",
  "text": "1. Navigate to AWS Console\n2. Go to EC2 > Security Groups\n3. Find sg-production\n4. Edit inbound rules\n5. Remove rule allowing 0.0.0.0/0 on port 22\n6. Add specific IP ranges\n7. Save changes",
  "model": "gemini-2.5-flash"
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| text | string | Conditional | Remediation instructions to summarize |
| title | string | Conditional | Finding title (required if text is empty) |
| description | string | No | Finding description for context |
| model | string | No | Gemini model to use (default: "gemini-2.0-flash") |

**Response (200 OK):**
```json
{
  "summary": "Restrict SSH access in sg-production by removing the 0.0.0.0/0 rule on port 22 and replacing it with specific IP ranges through the AWS EC2 Security Groups console.",
  "model": "gemini-2.5-flash"
}
```

**Error Responses:**

- **400 Bad Request:**
```json
{
  "error": "No text provided"
}
```

- **501 Not Implemented:**
```json
{
  "error": "AI not configured"
}
```

- **502 Bad Gateway:**
```json
{
  "error": "Request timeout"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/summarize-remediation \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Unencrypted S3 bucket",
    "description": "S3 bucket data-prod is not encrypted at rest",
    "text": "Step 1: Log into AWS Console. Step 2: Navigate to S3. Step 3: Select data-prod bucket. Step 4: Go to Properties tab. Step 5: Enable Default Encryption. Step 6: Choose AES-256 or AWS-KMS. Step 7: Save configuration.",
    "model": "gemini-2.5-pro"
  }'
```

---

## Reports API

### 1. Render PDF

**Endpoint:** `POST /api/render-pdf`

**Description:** Accept full HTML report content and render it as a PDF file. The PDF is saved to the output directory and returned for download.

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "html": "<!DOCTYPE html><html><head><title>CSPM Report</title></head><body><h1>Security Report</h1>...</body></html>",
  "meta": {
    "client": "Acme Corp",
    "reportDate": "2026-06-01",
    "author": "Security Team"
  }
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| html | string | Yes | Complete HTML document to render as PDF |
| meta | object | No | Metadata about the report (for logging/tracking) |

**Response (200 OK):**

Binary PDF file download with headers:
```
Content-Type: application/pdf
Content-Disposition: attachment; filename="cspm_report.pdf"
```

**Error Responses:**

- **400 Bad Request:**
```json
{
  "error": "Missing 'html' field"
}
```

- **500 Internal Server Error:**
```json
{
  "error": "PDF rendering failed: Chrome browser not found"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/render-pdf \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<!DOCTYPE html><html><body><h1>Test Report</h1></body></html>",
    "meta": {"client": "Test Co"}
  }' \
  -o report.pdf
```

---

### 2. Upload HTML Report

**Endpoint:** `POST /api/upload-html`

**Description:** Upload an HTML report file to the output folder for archival or later PDF conversion.

**Request (Multipart Form):**
```
Content-Type: multipart/form-data
```

Form field: `file` (HTML file)

**Request (Raw Body):**
```
Content-Type: text/html
```

Raw HTML content in request body.

**Response (201 Created):**
```json
{
  "filename": "report_a3f2b9c1.html"
}
```

**File Naming:**
- Original filename stem is preserved
- UUID suffix is added for uniqueness (e.g., `report_a3f2b9c1.html`)
- Only `.html` extension is allowed for security

**cURL Example (File Upload):**
```bash
curl -X POST http://localhost:5000/api/upload-html \
  -F "file=@/path/to/report.html"
```

**cURL Example (Raw HTML):**
```bash
curl -X POST http://localhost:5000/api/upload-html \
  -H "Content-Type: text/html" \
  --data-binary @report.html
```

---

## File Management API

### 1. Upload State

**Endpoint:** `POST /api/upload-state`

**Description:** Upload a JSON state file containing report data, findings, and metadata. Accepts multipart file upload or raw JSON body.

**Request (Multipart Form):**
```
Content-Type: multipart/form-data
```

Form field: `file` (JSON file)

**Request (Raw JSON):**
```json
{
  "meta": {
    "client": "Acme Corp",
    "reportDate": "2026-06-01",
    "author": "Security Team"
  },
  "findings": [
    {
      "id": "finding-1",
      "title": "Unrestricted SSH access",
      "severity": "CRITICAL"
    }
  ]
}
```

**Response (201 Created):**
```json
{
  "id": "a3f2b9c14e5a",
  "filename": "state_a3f2b9c14e5a.json"
}
```

**Error Responses:**

- **400 Bad Request:**
```json
{
  "error": "Invalid JSON"
}
```

**cURL Example (File Upload):**
```bash
curl -X POST http://localhost:5000/api/upload-state \
  -F "file=@/path/to/state.json"
```

**cURL Example (Raw JSON):**
```bash
curl -X POST http://localhost:5000/api/upload-state \
  -H "Content-Type: application/json" \
  -d '{"meta": {"client": "Test"}, "findings": []}'
```

---

### 2. Download State

**Endpoint:** `GET /api/download-state/<state_id>`

**Description:** Download a previously uploaded state file by its ID.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| state_id | string | State ID returned from upload (e.g., "a3f2b9c14e5a") |

**Response (200 OK):**

Binary JSON file download with headers:
```
Content-Type: application/json
Content-Disposition: attachment; filename="cspm_report_state.json"
```

**Error Responses:**

- **404 Not Found:**
```json
{
  "error": "State not found"
}
```

**cURL Example:**
```bash
curl http://localhost:5000/api/download-state/a3f2b9c14e5a \
  -o state.json
```

---

### 3. List States

**Endpoint:** `GET /api/list-states`

**Description:** List all uploaded state files with metadata.

**Request Parameters:** None

**Response (200 OK):**
```json
[
  {
    "id": "a3f2b9c14e5a",
    "filename": "state_a3f2b9c14e5a.json",
    "client": "Acme Corp",
    "reportDate": "2026-06-01",
    "size": 45678
  },
  {
    "id": "b4e3c8d25f6b",
    "filename": "state_b4e3c8d25f6b.json",
    "client": "Beta Inc",
    "reportDate": "2026-05-28",
    "size": 32145
  }
]
```

**cURL Example:**
```bash
curl http://localhost:5000/api/list-states
```

---

### 4. Delete State

**Endpoint:** `DELETE /api/delete-state/<state_id>`

**Description:** Delete a state file by its ID.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| state_id | string | State ID to delete |

**Response (200 OK):**
```json
{
  "deleted": true
}
```

**Error Responses:**

- **404 Not Found:**
```json
{
  "error": "State not found"
}
```

**cURL Example:**
```bash
curl -X DELETE http://localhost:5000/api/delete-state/a3f2b9c14e5a
```

---

### 5. Download Output File

**Endpoint:** `GET /api/download-output/<filename>`

**Description:** Download a file from the output directory (PDFs, HTML reports).

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| filename | string | Name of the file to download |

**Response (200 OK):**

Binary file download with appropriate Content-Type and Content-Disposition headers.

**Error Responses:**

- **404 Not Found:**
```json
{
  "error": "File not found"
}
```

**Security Note:** Path traversal is prevented - only filenames (not paths) are accepted.

**cURL Example:**
```bash
curl http://localhost:5000/api/download-output/cspm_report_a3f2b9c1.pdf \
  -o downloaded_report.pdf
```

---

### 6. List Output Files

**Endpoint:** `GET /api/list-outputs`

**Description:** List all files in the output directory.

**Request Parameters:** None

**Response (200 OK):**
```json
[
  {
    "filename": "cspm_report_a3f2b9c1.pdf",
    "size": 234567,
    "type": "pdf"
  },
  {
    "filename": "report_b4e3c8d2.html",
    "size": 45678,
    "type": "html"
  }
]
```

**cURL Example:**
```bash
curl http://localhost:5000/api/list-outputs
```

---

### 7. Delete Output File

**Endpoint:** `DELETE /api/delete-output/<filename>`

**Description:** Delete a file from the output directory.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| filename | string | Name of the file to delete |

**Response (200 OK):**
```json
{
  "deleted": true
}
```

**Error Responses:**

- **404 Not Found:**
```json
{
  "error": "File not found"
}
```

**Security Note:** Path traversal is prevented - only filenames (not paths) are accepted.

**cURL Example:**
```bash
curl -X DELETE http://localhost:5000/api/delete-output/old_report.pdf
```


**Description:** Initialize the directory paths used by the files blueprint. Called during application startup.

---

## Common Error Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 400 | Bad Request | Missing required fields, invalid JSON, invalid parameters |
| 403 | Forbidden | Attempted mutation via GraphQL proxy |
| 404 | Not Found | Requested resource/file/state does not exist |
| 500 | Internal Server Error | PDF rendering failed, unexpected server error |
| 501 | Not Implemented | Required API credentials not configured (Wiz, Gemini) |
| 502 | Bad Gateway | External API error (Wiz GraphQL, Gemini API) |

---

## Environment Variables

Required environment variables for full functionality:

### Wiz Integration
```bash
WIZI_CLIENT_ID=your-client-id
WIZI_CLIENT_SECRET=your-client-secret
WIZI_AUTH_URL=https://auth.app.wiz.io/oauth/token
WIZI_API_URL=https://api.il1.app.wiz.io/graphql
```

### AI Services
```bash
GEMINI_API_KEY=your-gemini-api-key
```

---

## Rate Limiting & Quotas

- **Wiz GraphQL Proxy:** Query size limited to 10,000 characters
- **Wiz Issues Fetch:** Maximum 500 results per request
- **Wiz Bulk Fetch:** Fixed at 500 results per query type
- **Find by ID:** Default page size is 5, configurable up to 50

---

## Authentication

Currently, the API does not require authentication for local development. For production deployment:

1. Configure reverse proxy (nginx/Apache) with authentication
2. Use API gateway with OAuth2/JWT
3. Add Flask middleware for API key validation

---

## Versioning

API Version: 1.0.0

No versioning prefix in URLs currently. For future versions, consider:
- Path-based: `/api/v2/wizi/status`
- Header-based: `Accept: application/vnd.cspm.v2+json`

---

## WebSocket Support

Not currently implemented. Future consideration for:
- Real-time finding updates
- Long-running bulk fetch progress
- PDF rendering progress

---

## CORS Configuration

Cross-Origin Resource Sharing (CORS) should be configured in production:

```python
from flask_cors import CORS
CORS(app, origins=["https://your-frontend-domain.com"])
```

---

## Health Check

Use the Wiz status endpoint as a basic health check:

```bash
curl http://localhost:5000/api/wizi/status
```

Returns `200 OK` if the application is running (even if Wiz is not configured).

---

## Support & Issues

For API support, bug reports, or feature requests, please contact the development team or file an issue in the project repository.
