/**
 * Wizi API Client Module
 * Handles all API calls to /api/wizi/* endpoints
 */

/**
 * Check if Wizi is enabled
 * @returns {Promise<{enabled: boolean, totalIssues?: number}>}
 */
export function checkWiziStatus() {
  return fetch('/api/wizi/status')
    .then(r => r.json());
}

/**
 * Fetch subscriptions for autocomplete
 * @returns {Promise<{subscriptions: Array}>}
 */
export function fetchSubscriptions() {
  return fetch('/api/wizi/subscriptions')
    .then(r => r.json());
}

/**
 * Fetch issues/findings from Wizi
 * @param {Object} params - Query parameters
 * @param {string} params.queryType - Type of query (issues, configurationFindings, etc.)
 * @param {number} params.first - Number of items to fetch
 * @param {Array<string>} params.severity - Severity filters
 * @param {Array<string>} params.status - Status filters
 * @param {string} [params.subscription] - Subscription filter
 * @param {string} [params.after] - Pagination cursor
 * @returns {Promise<Object>}
 */
export function fetchIssues(params) {
  return fetch('/api/wizi/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  }).then(r => r.json());
}

/**
 * Find finding by ID
 * @param {Object} params - Search parameters
 * @param {string} params.id - Finding ID
 * @param {number} [params.page] - Page number
 * @param {number} [params.pageSize] - Page size
 * @param {string} [params.subscription] - Subscription filter
 * @returns {Promise<Object>}
 */
export function findById(params) {
  return fetch('/api/wizi/find-by-id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  }).then(r => r.json());
}

/**
 * Bulk fetch all finding types for a subscription
 * @param {string} subscription - Subscription name/ID
 * @returns {Promise<Object>}
 */
export function bulkFetch(subscription) {
  return fetch('/api/wizi/bulk-fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription })
  }).then(r => r.json());
}

/**
 * Summarize remediation using AI
 * @param {Object} params - Remediation details
 * @param {string} params.title - Finding title
 * @param {string} params.description - Finding description
 * @param {string} params.text - Remediation text
 * @returns {Promise<{summary: string}>}
 */
export function summarizeRemediation(params) {
  return fetch('/api/summarize-remediation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  }).then(r => r.json());
}
