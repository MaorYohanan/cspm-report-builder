/**
 * Filter Manager Module
 * Handles severity, status, category, and search filtering
 */

/**
 * Apply filters to findings array
 * @param {Array} findings - All findings
 * @param {Object} filters - Filter criteria
 * @param {string} filters.searchText - Search query
 * @param {string} filters.category - Category filter
 * @param {string} filters.severity - Severity filter
 * @returns {Array} Filtered findings with original indices
 */
export function applyFilters(findings, filters) {
  const { searchText = '', category = '', severity = '' } = filters;
  const searchLower = searchText.toLowerCase();

  var filtered = [];
  findings.forEach(function(f, idx) {
    // Search filter
    if (searchLower) {
      const titleMatch = (f.title || '').toLowerCase().indexOf(searchLower) >= 0;
      const idMatch = (f.id || '').toLowerCase().indexOf(searchLower) >= 0;
      if (!titleMatch && !idMatch) return;
    }

    // Category filter
    if (category && f.category !== category) return;

    // Severity filter
    if (severity && f.severity !== severity) return;

    filtered.push({ f: f, idx: idx });
  });

  return filtered;
}

/**
 * Setup filter event listeners
 * @param {Object} elements - DOM elements
 * @param {Function} renderCallback - Callback to re-render table
 */
export function setupFilterListeners(elements, renderCallback) {
  const { searchInput, categoryFilter, severityFilter } = elements;

  if (searchInput) {
    searchInput.addEventListener('input', renderCallback);
  }

  if (categoryFilter) {
    categoryFilter.addEventListener('change', renderCallback);
  }

  if (severityFilter) {
    severityFilter.addEventListener('change', renderCallback);
  }
}

/**
 * Get current filter values from DOM
 * @param {Object} elements - DOM elements
 * @returns {Object} Current filter values
 */
export function getCurrentFilters(elements) {
  const { searchInput, categoryFilter, severityFilter } = elements;

  return {
    searchText: searchInput ? (searchInput.value || '').trim() : '',
    category: categoryFilter ? categoryFilter.value : '',
    severity: severityFilter ? severityFilter.value : ''
  };
}

/**
 * Clear all filters
 * @param {Object} elements - DOM elements
 * @param {Function} renderCallback - Callback to re-render table
 */
export function clearAllFilters(elements, renderCallback) {
  const { searchInput, categoryFilter, severityFilter } = elements;

  if (searchInput) searchInput.value = '';
  if (categoryFilter) categoryFilter.value = '';
  if (severityFilter) severityFilter.value = '';

  if (renderCallback) renderCallback();
}
