/**
 * UI Components Module
 * Reusable UI components (badges, cards, modals)
 */

/**
 * Severity mapping configuration
 */
export const severityMap = {
  critical: { text: 'קריטי', class: 'sev-critical', color: '#b91c1c' },
  high: { text: 'גבוה', class: 'sev-high', color: '#ef4444' },
  medium: { text: 'בינוני', class: 'sev-medium', color: '#f97316' },
  low: { text: 'נמוך', class: 'sev-low', color: '#22c55e' },
  info: { text: 'מידע', class: 'sev-info', color: '#6b7280' }
};

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Toast type ('success', 'error', 'warning', 'info')
 */
export function showToast(message, type = 'info') {
  // This function should integrate with existing toast system
  // Implementation depends on the toast library/system in use
  const statusMsg = document.getElementById('status-msg');
  if (statusMsg) {
    statusMsg.textContent = message;
    statusMsg.className = 'toast toast-' + type;
  }
}

/**
 * Styled confirm dialog
 * @param {string} message - Confirmation message
 * @param {Object} options - Dialog options
 * @returns {Promise<boolean>} True if confirmed
 */
export function styledConfirm(message, options = {}) {
  const {
    icon = '❓',
    title = 'אישור',
    confirmText = 'אישור',
    cancelText = 'ביטול',
    danger = false
  } = options;

  return new Promise((resolve) => {
    // Simple implementation - can be enhanced with custom modal
    const confirmed = window.confirm(message);
    resolve(confirmed);
  });
}

/**
 * Create severity chip HTML
 * @param {string} severity - Severity level
 * @returns {string} HTML for severity chip
 */
export function createSeverityChip(severity) {
  const sev = severityMap[severity] || severityMap.medium;
  return `<span class="severity-chip ${sev.class}">${sev.text}</span>`;
}

/**
 * Create category badge HTML
 * @param {string} category - Category code
 * @param {string} label - Category label (optional)
 * @returns {string} HTML for category badge
 */
export function createCategoryBadge(category, label) {
  const displayLabel = label || category;
  return `<span class="tag-inline">${displayLabel}</span>`;
}

/**
 * Create action button HTML
 * @param {string} action - Action type
 * @param {number} idx - Finding index
 * @param {string} icon - Button icon
 * @param {string} title - Button title
 * @returns {string} HTML for action button
 */
export function createActionButton(action, idx, icon, title) {
  return `<button class="btn-icon-sm" data-action="${action}" data-idx="${idx}" title="${title}">${icon}</button>`;
}

/**
 * Create inline editable cell
 * @param {number} idx - Finding index
 * @param {string} field - Field name
 * @param {string} value - Current value
 * @returns {string} HTML for editable cell
 */
export function createEditableCell(idx, field, value) {
  return `<td class="inline-editable" data-idx="${idx}" data-field="${field}">${value}</td>`;
}

/**
 * Setup drag handle for row
 * @param {HTMLElement} row - Table row element
 * @returns {string} HTML for drag handle
 */
export function createDragHandle() {
  return '<span class="drag-handle" title="גרור לשינוי סדר">⋮⋮</span>';
}

/**
 * Create pagination controls HTML
 * @param {Object} pageState - Pagination state
 * @param {number} totalPages - Total pages
 * @returns {string} HTML for pagination controls
 */
export function createPaginationControls(pageState, totalPages) {
  if (totalPages <= 1) return '';

  const prevDisabled = pageState.page === 0 ? ' disabled' : '';
  const nextDisabled = pageState.page >= totalPages - 1 ? ' disabled' : '';

  return `
    <div class="bulk-pagination-bottom">
      <button class="btn btn-secondary btn-sm bulk-page-btn" id="findings-page-prev"${prevDisabled}>▶</button>
      <span class="bulk-pagination-page">${pageState.page + 1} / ${totalPages}</span>
      <button class="btn btn-secondary btn-sm bulk-page-btn" id="findings-page-next"${nextDisabled}>◀</button>
    </div>
  `;
}

/**
 * Create empty state HTML
 * @param {string} message - Empty state message
 * @param {Array} actions - Array of action button configs
 * @returns {string} HTML for empty state
 */
export function createEmptyState(message, actions = []) {
  let actionsHtml = '';
  if (actions.length) {
    actionsHtml = '<div class="empty-state-actions">';
    actions.forEach(action => {
      actionsHtml += `<button class="btn ${action.type || 'btn-secondary'} btn-sm" onclick="${action.onclick}">${action.label}</button>`;
    });
    actionsHtml += '</div>';
  }

  return `
    <div class="empty-state">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-text">${message}</div>
      ${actionsHtml}
    </div>
  `;
}

/**
 * Evidence thumbnail component
 * @param {string} dataUrl - Image data URL
 * @param {number} idx - Image index
 * @returns {string} HTML for evidence thumbnail
 */
export function createEvidenceThumbnail(dataUrl, idx) {
  return `
    <span class="evidence-thumb" style="display:inline-block;position:relative;margin-left:8px;margin-bottom:6px;">
      <img src="${dataUrl}" alt="הוכחה ${idx + 1}" style="max-width:120px;max-height:80px;border-radius:6px;border:1px solid var(--border);vertical-align:middle;">
      <span class="clear-btn" data-evidence-idx="${idx}" style="position:absolute;top:-4px;right:-4px;background:var(--danger);color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;line-height:18px;text-align:center;cursor:pointer;">✕</span>
    </span>
  `;
}

/**
 * Loading spinner component
 * @param {string} message - Loading message
 * @returns {string} HTML for loading spinner
 */
export function createLoadingSpinner(message = 'טוען...') {
  return `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <div class="loading-message">${message}</div>
    </div>
  `;
}

/**
 * Create dropdown menu HTML
 * @param {Array} items - Menu items [{label, action, icon?, danger?}]
 * @returns {string} HTML for dropdown menu
 */
export function createDropdownMenu(items) {
  let html = '<div class="actions-dropdown" style="display:none;">';
  items.forEach(item => {
    const dangerClass = item.danger ? ' actions-dropdown-danger' : '';
    const icon = item.icon ? item.icon + ' ' : '';
    html += `<button class="actions-dropdown-item${dangerClass}" data-action="${item.action}">${icon}${item.label}</button>`;
  });
  html += '</div>';
  return html;
}

/**
 * Format date as DD/MM/YYYY
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date
 */
export function formatDateDDMMYYYY(date) {
  if (!date) return '';
  if (typeof date === 'string') return date; // Already formatted
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Get today's date as DD/MM/YYYY
 * @returns {string} Today's date
 */
export function getTodayDDMMYYYY() {
  return formatDateDDMMYYYY(new Date());
}
