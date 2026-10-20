// ── Duplicate Detection Module ──
import { escapeHtml } from './core.js';
import { showToast, styledConfirm } from './core.js';
import { state, removeFinding } from './state.js';
import { renderFindingsTable } from './findings.js';
import { ProductsPanel } from './products.js';

var modal = null;
var modalBody = null;
var modalCloseBtn = null;
var currentPairs = [];
var currentPairIndex = 0;
var activeProductId = null;

// ── Initialize module ──
export function initDuplicates() {
  modal = document.getElementById('duplicates-modal');
  modalBody = document.getElementById('duplicates-modal-body');
  modalCloseBtn = modal?.querySelector('.duplicates-modal-close');

  if (!modal || !modalBody || !modalCloseBtn) {
    console.error('Duplicates modal elements not found');
    return;
  }

  // Close button handler
  modalCloseBtn.addEventListener('click', closeModal);

  // Overlay click to close
  var overlay = modal.querySelector('.duplicates-modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', closeModal);
  }

  // Escape key to close
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
      closeModal();
    }
  });

  // Initial button state check
  updateDuplicatesButtonState();
}

// ── Update button enabled/disabled state ──
export function updateDuplicatesButtonState() {
  var btn = document.getElementById('btn-detect-duplicates');
  if (!btn) return;

  // Enable button only when:
  // 1. Product is selected
  // 2. Snapshot is loaded (draft or published)
  // 3. At least 2 findings exist
  var hasProduct = ProductsPanel.selectedProduct && ProductsPanel.selectedProduct.id;
  var hasSnapshot = state.loadedVersionStatus; // 'draft' or 'published'
  var hasEnoughFindings = state.findings.length >= 2;

  btn.disabled = !(hasProduct && hasSnapshot && hasEnoughFindings);
}

// ── Open modal and start detection ──
export async function detectDuplicates(productId) {
  if (!productId) {
    showToast('לא נבחר מוצר פעיל', 'error');
    return;
  }

  activeProductId = productId;

  // Show loading state
  openModal();
  showLoadingState();

  try {
    // Step 1: Initial API call
    var response = await fetch('/api/products/' + productId + '/findings/detect-duplicates', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Failed to detect duplicates: ' + response.statusText);
    }

    var data = await response.json();

    // Step 2: Check if confirmation is required for large products
    if (data.requiresConfirmation) {
      // Close loading modal temporarily
      closeModal();

      // Show confirmation modal
      var userConfirmed = await showLargeProductConfirmation(data);
      if (!userConfirmed) {
        return; // User cancelled
      }

      // User confirmed - call API again with confirmed=true
      openModal();
      showLoadingState();

      response = await fetch('/api/products/' + productId + '/findings/detect-duplicates?confirmed=true', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Failed to detect duplicates: ' + response.statusText);
      }

      data = await response.json();
    }

    // Step 3: Process results
    currentPairs = data.pairs || [];
    currentPairIndex = 0;

    if (currentPairs.length === 0) {
      showNoDuplicatesState(data.warnings);
    } else {
      renderPair(currentPairIndex, data.warnings);
    }
  } catch (error) {
    console.error('Error detecting duplicates:', error);
    showToast('שגיאה בזיהוי כפילויות: ' + error.message, 'error');
    closeModal();
  }
}

// ── Show loading state ──
function showLoadingState() {
  modalBody.innerHTML = '<div class="duplicates-loading">' +
    '<div class="duplicates-spinner"></div>' +
    '<p>מזהה כפילויות...</p>' +
    '</div>';
}

// ── Show confirmation modal for large products ──
async function showLargeProductConfirmation(data) {
  // Build message with category counts
  var message = data.message || 'המוצר מכיל מספר רב של ממצאים. האם להמשיך?';

  if (data.categoriesOverLimit && data.categoriesOverLimit.length > 0) {
    message += '\n\nקטגוריות שחורגות מהמגבלה:';
    data.categoriesOverLimit.forEach(function(cat) {
      message += '\n• ' + cat.category + ': ' + cat.count + ' ממצאים';
    });
  }

  return await styledConfirm(message, {
    icon: '⚠️',
    title: 'אישור ניתוח מוצר גדול',
    confirmText: 'כן, המשך',
    cancelText: 'ביטול',
    danger: false
  });
}

// ── Show "no duplicates found" state ──
function showNoDuplicatesState(warnings) {
  var warningsHtml = renderWarnings(warnings);

  modalBody.innerHTML = warningsHtml +
    '<div class="duplicates-empty-state">' +
    '<div class="duplicates-empty-icon">✓</div>' +
    '<h3>לא נמצאו כפילויות</h3>' +
    '<p>כל הממצאים במוצר זה ייחודיים (סף דמיון: 85%).</p>' +
    '<button class="btn btn-secondary" id="duplicates-close-empty">סגור</button>' +
    '</div>';

  var closeBtn = document.getElementById('duplicates-close-empty');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }
}

// ── Render a single pair ──
function renderPair(index, warnings) {
  if (index >= currentPairs.length) {
    // All pairs processed
    showToast('כל הכפילויות עובדו בהצלחה', 'success');
    closeModal();
    renderFindingsTable(); // Refresh the findings list
    return;
  }

  var pair = currentPairs[index];
  var findingA = pair.finding_a;
  var findingB = pair.finding_b;
  var similarity = pair.similarity;

  var warningsHtml = renderWarnings(warnings);

  var html = warningsHtml +
    '<div class="duplicates-pair-container">' +
    '<div class="duplicates-pair-header">' +
    '<h3>זוג #' + (index + 1) + ' מתוך ' + currentPairs.length + '</h3>' +
    '<div class="duplicates-similarity-badge">' +
    '<span class="duplicates-similarity-label">דמיון:</span> ' +
    '<span class="duplicates-similarity-value">' + Math.round(similarity * 100) + '%</span>' +
    '</div>' +
    '</div>' +
    '<div class="duplicates-comparison">' +
    renderFindingCard(findingA, 'A') +
    renderFindingCard(findingB, 'B') +
    '</div>' +
    '<div class="duplicates-actions">' +
    '<button class="btn btn-primary" data-action="keep" data-side="A">שמור ממצא A</button>' +
    '<button class="btn btn-secondary" data-action="skip">דלג</button>' +
    '<button class="btn btn-primary" data-action="keep" data-side="B">שמור ממצא B</button>' +
    '</div>' +
    '</div>';

  modalBody.innerHTML = html;

  // Attach event listeners
  var actionButtons = modalBody.querySelectorAll('[data-action]');
  actionButtons.forEach(function(btn) {
    btn.addEventListener('click', handleAction);
  });
}

// ── Render warnings box ──
function renderWarnings(warnings) {
  if (!warnings || !Array.isArray(warnings) || warnings.length === 0) {
    return '';
  }

  var html = '<div class="duplicates-warnings" style="background:#fff3cd;color:#856404;padding:12px;border-radius:6px;margin-bottom:16px;text-align:right;">';
  html += '<strong>⚠️ אזהרות:</strong>';
  html += '<ul style="margin:8px 0 0;padding-right:20px;">';
  warnings.forEach(function(warning) {
    html += '<li>' + escapeHtml(warning) + '</li>';
  });
  html += '</ul>';
  html += '</div>';

  return html;
}

// ── Render a finding card for comparison ──
function renderFindingCard(finding, label) {
  var severityClass = 'severity-' + finding.severity;

  return '<div class="duplicates-finding-card">' +
    '<div class="duplicates-finding-header">' +
    '<h4>ממצא ' + escapeHtml(label) + '</h4>' +
    '<span class="severity-chip ' + severityClass + '">' + escapeHtml(finding.severity) + '</span>' +
    '</div>' +
    '<div class="duplicates-finding-field">' +
    '<strong>מזהה:</strong> ' + escapeHtml(finding.id) +
    '</div>' +
    '<div class="duplicates-finding-field">' +
    '<strong>כותרת:</strong> ' + escapeHtml(finding.title || '') +
    '</div>' +
    '<div class="duplicates-finding-field">' +
    '<strong>קטגוריה:</strong> ' + escapeHtml(finding.category || '') +
    '</div>' +
    '<div class="duplicates-finding-field">' +
    '<strong>תיאור:</strong> ' + escapeHtml((finding.description || '').substring(0, 150)) +
    (finding.description && finding.description.length > 150 ? '...' : '') +
    '</div>' +
    '<div class="duplicates-finding-field">' +
    '<strong>השפעה:</strong> ' + escapeHtml((finding.impact || '').substring(0, 100)) +
    (finding.impact && finding.impact.length > 100 ? '...' : '') +
    '</div>' +
    '</div>';
}

// ── Handle user action (keep/skip) ──
async function handleAction(e) {
  var action = e.target.getAttribute('data-action');
  var side = e.target.getAttribute('data-side');

  if (action === 'skip') {
    // Move to next pair without deleting
    currentPairIndex++;
    renderPair(currentPairIndex);
    return;
  }

  if (action === 'keep') {
    // Determine which finding to keep and which to delete
    var pair = currentPairs[currentPairIndex];
    var keepFinding = side === 'A' ? pair.finding_a : pair.finding_b;
    var deleteFinding = side === 'A' ? pair.finding_b : pair.finding_a;

    // Delete the non-kept finding from state
    removeFinding(deleteFinding.id);

    // Show toast
    showToast('ממצא ' + escapeHtml(deleteFinding.id) + ' נמחק, ממצא ' + escapeHtml(keepFinding.id) + ' נשמר', 'success');

    // Move to next pair
    currentPairIndex++;
    renderPair(currentPairIndex);
  }
}

// ── Open modal ──
function openModal() {
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Prevent background scroll
  }
}

// ── Close modal ──
function closeModal() {
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = ''; // Restore scroll
    modalBody.innerHTML = '';
    currentPairs = [];
    currentPairIndex = 0;
    activeProductId = null;
  }
}
