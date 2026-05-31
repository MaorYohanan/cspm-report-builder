/**
 * Sort Manager Module
 * Handles sorting logic for findings
 */

/**
 * Severity order for sorting
 */
const SEVERITY_ORDER = { critical: 1, high: 2, medium: 3, low: 4, info: 5 };

/**
 * Sort findings by column
 * @param {Array} findings - Filtered findings with indices
 * @param {Object} sortState - Current sort state
 * @param {string} sortState.col - Column to sort by
 * @param {string} sortState.dir - Sort direction ('asc' or 'desc')
 * @returns {Array} Sorted findings
 */
export function sortFindings(findings, sortState) {
  if (!sortState.col) return findings;

  const sorted = [...findings];

  sorted.sort(function(a, b) {
    var va, vb;
    var col = sortState.col;

    switch (col) {
      case 'id':
        va = a.f.id || '';
        vb = b.f.id || '';
        break;
      case 'category':
        va = a.f.category || '';
        vb = b.f.category || '';
        break;
      case 'title':
        va = (a.f.title || '').toLowerCase();
        vb = (b.f.title || '').toLowerCase();
        break;
      case 'severity':
        va = SEVERITY_ORDER[a.f.severity] || 9;
        vb = SEVERITY_ORDER[b.f.severity] || 9;
        break;
      case 'owner':
        va = (a.f.owner || '').toLowerCase();
        vb = (b.f.owner || '').toLowerCase();
        break;
      default:
        va = '';
        vb = '';
    }

    if (va < vb) return sortState.dir === 'asc' ? -1 : 1;
    if (va > vb) return sortState.dir === 'asc' ? 1 : -1;
    return 0;
  });

  return sorted;
}

/**
 * Toggle sort direction or set new column
 * @param {Object} sortState - Current sort state (mutated)
 * @param {string} column - Column to sort by
 */
export function toggleSort(sortState, column) {
  if (sortState.col === column) {
    sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.col = column;
    sortState.dir = 'asc';
  }
}

/**
 * Get sort indicator HTML
 * @param {Object} sortState - Current sort state
 * @param {string} column - Column to check
 * @returns {string} HTML for sort arrow
 */
export function getSortIndicator(sortState, column) {
  if (sortState.col !== column) {
    return ' <span class="sort-arrow">⇅</span>';
  }
  return sortState.dir === 'asc'
    ? ' <span class="sort-arrow active">↑</span>'
    : ' <span class="sort-arrow active">↓</span>';
}

/**
 * Setup sortable column headers
 * @param {HTMLElement} container - Table container
 * @param {Object} sortState - Sort state object
 * @param {Function} renderCallback - Callback to re-render table
 */
export function setupSortableHeaders(container, sortState, renderCallback) {
  if (!container) return;

  container.querySelectorAll('.sortable-th[data-findings-sort]').forEach(function(th) {
    th.addEventListener('click', function() {
      var col = th.getAttribute('data-findings-sort');
      toggleSort(sortState, col);
      renderCallback();
    });
  });
}
