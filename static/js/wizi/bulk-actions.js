/**
 * Bulk Actions Module
 * Handles bulk fetch and export functionality
 */

import { getNodeSubscriptionName } from './subscription-manager.js';
import { escapeHtml } from './ui-helpers.js';

/**
 * Query type labels
 */
export const queryTypeLabels = {
  'issues': 'Issues (כללי)',
  'configurationFindings': 'CSPM — Cloud Configuration',
  'vulnerabilityFindings': 'VULN — Vulnerabilities',
  'hostConfigurationRuleAssessments': 'HSPM — Host Configuration',
  'dataFindingsV2': 'DSPM — Data Findings',
  'secretInstances': 'SECR — Secrets',
  'excessiveAccessFindings': 'EAPM — Excessive Access',
  'networkExposures': 'NEXP — Network Exposure',
  'inventoryFindings': 'EOLM — Inventory / EOL'
};

/**
 * Get sort value for bulk table sorting
 * @param {Object} node - Finding node
 * @param {string} queryType - Query type
 * @param {string} col - Column name
 * @returns {string|number}
 */
function getBulkSortValue(node, queryType, col, severityMap, getWiziItemTitle) {
  const sevOrder = { critical: 1, high: 2, medium: 3, low: 4, info: 5 };
  if (col === 'severity') return sevOrder[mapWiziSeverity(node.severity)] || 9;
  if (col === 'title') return (getWiziItemTitle(node, queryType) || '').toLowerCase();
  if (col === 'subscription') return (getNodeSubscriptionName(node, queryType) || '').toLowerCase();
  if (col === 'resource') {
    if (queryType === 'vulnerabilityFindings') return ((node.vulnerableAsset || {}).name || '').toLowerCase();
    if (queryType === 'secretInstances') return ((node.resource || {}).name || '').toLowerCase();
    return '';
  }
  if (col === 'resourceType') return ((node.vulnerableAsset || {}).type || '').toLowerCase();
  if (col === 'type') return queryType;
  return '';
}

function mapWiziSeverity(sev) {
  const m = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INFORMATIONAL: 'info', INFO: 'info', NONE: 'info' };
  return m[(sev || '').toUpperCase()] || 'medium';
}

/**
 * Render bulk import results
 * @param {Object} data - Bulk fetch response data
 * @param {Object} options - Rendering options
 */
export function renderBulkResults(data, options) {
  const {
    progressDiv,
    resultsDiv,
    actionsDiv,
    updateSelectedCount,
    severityMap,
    getWiziItemTitle,
    showToast
  } = options;

  const resolved = data.resolvedSubscription || {};
  const results = data.results || {};
  const errors = data.errors || {};

  // Warning toast if subscription not resolved
  if ((!resolved.ids || !resolved.ids.length) && (!resolved.externalIds || !resolved.externalIds.length)) {
    showToast('לא נמצא Subscription תואם — התוצאות עשויות להיות חלקיות', 'warning');
  }

  // Show per-query-type errors
  const errorKeys = Object.keys(errors);
  let progressHtml = '';
  if (errorKeys.length) {
    errorKeys.forEach(qt => {
      const label = queryTypeLabels[qt] || qt;
      progressHtml += '<div style="color:var(--warning,#f59e0b);">⚠ ' + escapeHtml(label) + ': ' + escapeHtml(errors[qt]) + '</div>';
    });
  }

  // Store results and compute counts
  const bulkImportResults = {};
  let totalCount = 0;
  const breakdownParts = [];
  const queryTypes = Object.keys(queryTypeLabels);

  // Get the subscription search term for client-side filtering (EAPM)
  const bulkSubSearch = (document.getElementById('bulk-import-sub').value || '').trim().toLowerCase();

  queryTypes.forEach(qt => {
    const r = results[qt] || {};
    let nodes = r.nodes || [];

    // Client-side subscription filter for excessiveAccessFindings (no server-side filter)
    if (qt === 'excessiveAccessFindings' && nodes.length && bulkSubSearch) {
      nodes = nodes.filter(n => {
        const p = n.principal || {};
        const pca = p.cloudAccount || {};
        const subName = (pca.name || '').toLowerCase();
        const subExtId = (pca.externalId || '').toLowerCase();
        return subName.indexOf(bulkSubSearch) >= 0 || subExtId.indexOf(bulkSubSearch) >= 0;
      });
    }

    if (nodes.length) {
      bulkImportResults[qt] = nodes;
      totalCount += nodes.length;

      // Count severities and unique items for better display
      const sevCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      const uniqueKeys = new Set();

      nodes.forEach(node => {
        const sev = mapWiziSeverity(node.severity);
        sevCounts[sev] = (sevCounts[sev] || 0) + 1;

        // Get unique key for consolidation preview (CVE name for vulns, rule ID for others)
        let uniqueKey = null;
        if (qt === 'vulnerabilityFindings') {
          uniqueKey = node.name || node.detailedName;
        } else if (qt === 'configurationFindings' || qt === 'hostConfigurationRuleAssessments') {
          const rule = node.rule || {};
          uniqueKey = rule.id || rule.shortId || rule.name;
        } else if (qt === 'issues') {
          const rules = node.sourceRules || [];
          uniqueKey = rules.length ? rules[0].id : null;
        }
        if (uniqueKey) uniqueKeys.add(uniqueKey);
      });

      // Build severity breakdown string
      const sevParts = [];
      if (sevCounts.critical) sevParts.push(`${sevCounts.critical} קריטי`);
      if (sevCounts.high) sevParts.push(`${sevCounts.high} גבוה`);
      if (sevCounts.medium) sevParts.push(`${sevCounts.medium} בינוני`);
      if (sevCounts.low) sevParts.push(`${sevCounts.low} נמוך`);

      let breakdownText = (queryTypeLabels[qt]) + ': ' + nodes.length;
      if (sevParts.length) {
        breakdownText += ' (' + sevParts.join(', ') + ')';
      }

      // Show unique count if consolidation will happen
      if (uniqueKeys.size > 0 && uniqueKeys.size < nodes.length) {
        breakdownText += ` → ${uniqueKeys.size} ייחודיים`;
      }

      breakdownParts.push(breakdownText);
    }
  });

  // Empty state
  if (totalCount === 0 && errorKeys.length === 0) {
    progressDiv.innerHTML = 'לא נמצאו ממצאים עבור Subscription זה';
    resultsDiv.innerHTML = '';
    return { bulkImportResults: null, bulkPageState: null };
  }

  // Progress summary
  progressHtml += '<div><strong>סה"כ: ' + totalCount + ' ממצאים</strong></div>';
  if (breakdownParts.length) {
    progressHtml += '<div>' + breakdownParts.join(' · ') + '</div>';
  }
  progressDiv.innerHTML = progressHtml;

  // Build results table
  let html = '';
  const bulkPageState = {};
  const defaultPageSize = 20;

  queryTypes.forEach(qt => {
    const nodes = bulkImportResults[qt];
    if (!nodes || !nodes.length) return;
    const label = queryTypeLabels[qt];
    bulkPageState[qt] = { page: 0, pageSize: defaultPageSize };

    const icons = {
      vulnerabilityFindings: '🛡️',
      configurationFindings: '⚙️',
      secretInstances: '🔑',
      excessiveAccessFindings: '👤',
      networkExposures: '🌐',
      hostConfigurationRuleAssessments: '🖥️',
      dataFindingsV2: '💾',
      inventoryFindings: '📦'
    };
    const icon = icons[qt] || '📋';

    html += '<details class="bulk-section-card" data-qt="' + qt + '">';
    html += '<summary class="bulk-section-summary"><span class="bulk-section-icon">' + icon + '</span><span class="bulk-section-label">' + escapeHtml(label) + '</span><span class="bulk-section-count">' + nodes.length + '</span></summary>';
    html += '<div class="bulk-section-body" id="bulk-body-' + qt + '"></div>';
    html += '</details>';
  });

  resultsDiv.innerHTML = html;
  actionsDiv.style.display = '';

  // Render pages for each section
  Object.keys(bulkPageState).forEach(qt => {
    renderBulkPage(qt, bulkImportResults, bulkPageState, { updateSelectedCount, severityMap, getWiziItemTitle });
  });

  updateSelectedCount();

  return { bulkImportResults, bulkPageState };
}

/**
 * Render a single bulk page for a query type
 * @param {string} qt - Query type
 * @param {Object} bulkImportResults - Results by query type
 * @param {Object} bulkPageState - Page state by query type
 * @param {Object} options - Rendering options
 */
export function renderBulkPage(qt, bulkImportResults, bulkPageState, options) {
  const { updateSelectedCount, severityMap, getWiziItemTitle } = options;

  let nodes = bulkImportResults[qt];
  if (!nodes) return;

  const state = bulkPageState[qt];
  const start = state.page * state.pageSize;
  const end = Math.min(start + state.pageSize, nodes.length);
  const totalPages = Math.ceil(nodes.length / state.pageSize);
  const label = queryTypeLabels[qt];

  // Sort nodes if sort is active
  if (state.sortCol) {
    const dir = state.sortDir || 'asc';
    nodes = nodes.slice().sort((a, b) => {
      const va = getBulkSortValue(a, qt, state.sortCol, severityMap, getWiziItemTitle);
      const vb = getBulkSortValue(b, qt, state.sortCol, severityMap, getWiziItemTitle);
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    bulkImportResults[qt] = nodes;
  }

  const bodyEl = document.getElementById('bulk-body-' + qt);
  if (!bodyEl) return;

  function sortIndicator(col) {
    if (state.sortCol !== col) return ' <span class="sort-arrow">⇅</span>';
    return state.sortDir === 'asc' ? ' <span class="sort-arrow active">↑</span>' : ' <span class="sort-arrow active">↓</span>';
  }

  let h = '';

  // Pagination controls top
  h += '<div class="bulk-pagination-top">';
  h += '<span class="bulk-pagination-info">' + (start + 1) + '–' + end + ' מתוך ' + nodes.length + '</span>';
  h += '<select class="bulk-page-size" data-qt="' + qt + '">';
  [20, 50, 100, 200].forEach(s => {
    h += '<option value="' + s + '"' + (s === state.pageSize ? ' selected' : '') + '>' + s + '</option>';
  });
  h += '</select>';
  h += '</div>';

  // Table with sortable headers
  h += '<table class="findings-table" style="width:100%;font-size:12px;"><thead><tr>';
  h += '<th style="width:30px;"><input type="checkbox" class="bulk-section-check" data-query-type="' + qt + '" checked></th>';
  h += '<th class="sortable-th" data-sort-col="type" data-qt="' + qt + '">סוג' + sortIndicator('type') + '</th>';
  h += '<th class="sortable-th" data-sort-col="severity" data-qt="' + qt + '">חומרה' + sortIndicator('severity') + '</th>';
  h += '<th class="sortable-th" data-sort-col="title" data-qt="' + qt + '">כותרת' + sortIndicator('title') + '</th>';
  if (qt === 'vulnerabilityFindings') {
    h += '<th class="sortable-th" data-sort-col="resource" data-qt="' + qt + '">משאב' + sortIndicator('resource') + '</th>';
    h += '<th class="sortable-th" data-sort-col="resourceType" data-qt="' + qt + '">סוג משאב' + sortIndicator('resourceType') + '</th>';
  }
  if (qt === 'secretInstances') {
    h += '<th class="sortable-th" data-sort-col="resource" data-qt="' + qt + '">משאב' + sortIndicator('resource') + '</th>';
  }
  h += '<th class="sortable-th" data-sort-col="subscription" data-qt="' + qt + '">Subscription' + sortIndicator('subscription') + '</th>';
  h += '</tr></thead><tbody>';

  for (let i = start; i < end; i++) {
    const node = nodes[i];
    const sev = mapWiziSeverity(node.severity);
    const sevInfo = severityMap[sev] || severityMap.medium;
    const title = getWiziItemTitle(node, qt);
    const subName = getNodeSubscriptionName(node, qt);

    h += '<tr>';
    h += '<td><input type="checkbox" class="bulk-check" data-query-type="' + qt + '" data-node-index="' + i + '" checked></td>';
    h += '<td><span class="tag-inline">' + escapeHtml(label) + '</span></td>';
    h += '<td><span class="severity-chip ' + sevInfo.class + '">' + sevInfo.text + '</span></td>';
    h += '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</td>';
    if (qt === 'vulnerabilityFindings') {
      const asset = node.vulnerableAsset || {};
      h += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(asset.name || '') + '">' + escapeHtml(asset.name || '—') + '</td>';
      h += '<td>' + escapeHtml(asset.type || '—') + '</td>';
    }
    if (qt === 'secretInstances') {
      const res = node.resource || {};
      h += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(res.name || '') + '">' + escapeHtml(res.name || '—') + '</td>';
    }
    h += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(subName) + '">' + escapeHtml(subName || '—') + '</td>';
    h += '</tr>';
  }

  h += '</tbody></table>';

  // Pagination controls below table
  if (totalPages > 1) {
    h += '<div class="bulk-pagination-bottom">';
    h += '<button class="btn btn-secondary btn-sm bulk-page-btn" data-qt="' + qt + '" data-dir="prev"' + (state.page === 0 ? ' disabled' : '') + '>▶</button>';
    h += '<span class="bulk-pagination-page">' + (state.page + 1) + ' / ' + totalPages + '</span>';
    h += '<button class="btn btn-secondary btn-sm bulk-page-btn" data-qt="' + qt + '" data-dir="next"' + (state.page >= totalPages - 1 ? ' disabled' : '') + '>◀</button>';
    h += '</div>';
  }

  bodyEl.innerHTML = h;

  // Wire pagination events
  bodyEl.querySelectorAll('.bulk-page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = btn.getAttribute('data-dir');
      if (dir === 'next') bulkPageState[qt].page++;
      else bulkPageState[qt].page--;
      renderBulkPage(qt, bulkImportResults, bulkPageState, options);
      updateSelectedCount();
    });
  });

  const pageSizeSelect = bodyEl.querySelector('.bulk-page-size');
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', function() {
      bulkPageState[qt].pageSize = parseInt(this.value);
      bulkPageState[qt].page = 0;
      renderBulkPage(qt, bulkImportResults, bulkPageState, options);
      updateSelectedCount();
    });
  }

  // Wire section checkbox
  const sectionCheck = bodyEl.querySelector('.bulk-section-check');
  if (sectionCheck) {
    sectionCheck.addEventListener('change', function() {
      const checked = sectionCheck.checked;
      bodyEl.querySelectorAll('.bulk-check').forEach(cb => { cb.checked = checked; });
      updateSelectedCount();
    });
  }

  // Wire individual checkboxes
  bodyEl.querySelectorAll('.bulk-check').forEach(cb => {
    cb.addEventListener('change', updateSelectedCount);
  });

  // Wire sortable headers
  bodyEl.querySelectorAll('.sortable-th').forEach(th => {
    th.addEventListener('click', function() {
      const col = th.getAttribute('data-sort-col');
      const sortQt = th.getAttribute('data-qt');
      const st = bulkPageState[sortQt];
      if (st.sortCol === col) {
        st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        st.sortCol = col;
        st.sortDir = 'asc';
      }
      st.page = 0;
      renderBulkPage(sortQt, bulkImportResults, bulkPageState, options);
      updateSelectedCount();
    });
  });
}

/**
 * Update bulk selected count display
 */
export function updateBulkSelectedCount() {
  const total = document.querySelectorAll('.bulk-check').length;
  const checked = document.querySelectorAll('.bulk-check:checked').length;
  const countEl = document.getElementById('bulk-selected-count');
  if (countEl) countEl.textContent = checked + ' / ' + total + ' נבחרו';
}
