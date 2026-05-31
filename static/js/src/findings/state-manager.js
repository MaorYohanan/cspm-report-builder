/**
 * State Manager Module
 * Manages finding state including selection, pagination, and editing
 */

/**
 * Pagination state manager
 */
export class PaginationState {
  constructor(pageSize = 25) {
    this.page = 0;
    this.pageSize = pageSize;
  }

  /**
   * Reset to first page
   */
  reset() {
    this.page = 0;
  }

  /**
   * Get paginated slice of items
   * @param {Array} items - Items to paginate
   * @returns {Object} {items, start, end, totalPages}
   */
  paginate(items) {
    const total = items.length;
    const totalPages = Math.ceil(total / this.pageSize);

    // Adjust page if out of bounds
    if (this.page >= totalPages && totalPages > 0) {
      this.page = totalPages - 1;
    }

    const start = this.page * this.pageSize;
    const end = Math.min(start + this.pageSize, total);
    const pagedItems = items.slice(start, end);

    return {
      items: pagedItems,
      start,
      end,
      totalPages,
      currentPage: this.page
    };
  }

  /**
   * Go to next page
   * @param {number} totalPages - Total number of pages
   */
  nextPage(totalPages) {
    if (this.page < totalPages - 1) {
      this.page++;
    }
  }

  /**
   * Go to previous page
   */
  prevPage() {
    if (this.page > 0) {
      this.page--;
    }
  }

  /**
   * Set page size
   * @param {number} size - New page size
   */
  setPageSize(size) {
    this.pageSize = size;
    this.reset();
  }
}

/**
 * Selection state manager
 */
export class SelectionState {
  constructor() {
    this.selectedIndices = new Set();
  }

  /**
   * Toggle selection for an index
   * @param {number} idx - Finding index
   */
  toggle(idx) {
    if (this.selectedIndices.has(idx)) {
      this.selectedIndices.delete(idx);
    } else {
      this.selectedIndices.add(idx);
    }
  }

  /**
   * Select all indices
   * @param {Array<number>} indices - Indices to select
   */
  selectAll(indices) {
    this.selectedIndices.clear();
    indices.forEach(idx => this.selectedIndices.add(idx));
  }

  /**
   * Clear all selections
   */
  clearAll() {
    this.selectedIndices.clear();
  }

  /**
   * Check if index is selected
   * @param {number} idx - Finding index
   * @returns {boolean}
   */
  isSelected(idx) {
    return this.selectedIndices.has(idx);
  }

  /**
   * Get all selected indices as array
   * @returns {Array<number>}
   */
  getSelected() {
    return Array.from(this.selectedIndices);
  }

  /**
   * Get count of selected items
   * @returns {number}
   */
  count() {
    return this.selectedIndices.size;
  }
}

/**
 * Edit state manager
 */
export class EditState {
  constructor() {
    this.editingIndex = null;
    this.formDraft = null;
  }

  /**
   * Start editing a finding
   * @param {number} idx - Finding index
   */
  startEdit(idx) {
    this.editingIndex = idx;
  }

  /**
   * Stop editing
   */
  stopEdit() {
    this.editingIndex = null;
    this.formDraft = null;
  }

  /**
   * Check if currently editing
   * @returns {boolean}
   */
  isEditing() {
    return this.editingIndex !== null;
  }

  /**
   * Get current editing index
   * @returns {number|null}
   */
  getEditingIndex() {
    return this.editingIndex;
  }

  /**
   * Save form draft
   * @param {Object} draft - Form data to save
   */
  saveDraft(draft) {
    this.formDraft = draft;
  }

  /**
   * Get saved draft
   * @returns {Object|null}
   */
  getDraft() {
    return this.formDraft;
  }
}

/**
 * Generate next sequential ID for a category
 * @param {Array} findings - All findings
 * @param {string} prefix - Category prefix (e.g., 'CSPM')
 * @returns {string} Next ID (e.g., 'CSPM-001')
 */
export function generateNextId(findings, prefix) {
  prefix = prefix || 'CSPM';
  var max = 0;
  findings.forEach(function(f) {
    var m = (f.id || '').match(new RegExp('^' + prefix + '-(\\d+)'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + '-' + String(max + 1).padStart(3, '0');
}

/**
 * Reorder finding IDs sequentially per category
 * @param {Array} findings - All findings (mutated)
 */
export function reorderFindingIds(findings) {
  var counters = {};
  findings.forEach(function(f) {
    var m = (f.id || '').match(/^([A-Z]+)-\d+/);
    if (!m) return;
    var prefix = m[1];
    if (!counters[prefix]) counters[prefix] = 0;
    counters[prefix]++;
    f.id = prefix + '-' + String(counters[prefix]).padStart(3, '0');
  });
}

/**
 * Check if findings have gaps in numbering
 * @param {Array} findings - All findings
 * @returns {boolean} True if gaps exist
 */
export function hasIdGaps(findings) {
  var byCategory = {};
  findings.forEach(function(f) {
    var m = (f.id || '').match(/^([A-Z]+)-(\d+)/);
    if (!m) return;
    if (!byCategory[m[1]]) byCategory[m[1]] = [];
    byCategory[m[1]].push(parseInt(m[2], 10));
  });

  var hasGap = false;
  Object.keys(byCategory).forEach(function(cat) {
    var nums = byCategory[cat].sort(function(a, b) { return a - b; });
    for (var i = 0; i < nums.length; i++) {
      if (nums[i] !== i + 1) {
        hasGap = true;
        break;
      }
    }
  });

  return hasGap;
}
