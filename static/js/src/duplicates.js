// ── Duplicate Detection Module ──
import { escapeHtml } from './core.js';
import { showToast } from './core.js';
import { state, removeFinding } from './state.js';
import { renderFindingsList } from './findings.js';

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
    var response = await fetch('/api/products/' + productId + '/findings/detect-duplicates', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error('Failed to detect duplicates: ' + response.statusText);
    }

    var data = await response.json();
    currentPairs = data.pairs || [];
    currentPairIndex = 0;

    if (currentPairs.length === 0) {
      showNoDuplicatesState();
    } else {
      renderPair(currentPairIndex);
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

// ── Show "no duplicates found" state ──
function showNoDuplicatesState() {
  modalBody.innerHTML = '<div class="duplicates-empty-state">' +
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
function renderPair(index) {
  if (index >= currentPairs.length) {
    // All pairs processed
    showToast('כל הכפילויות עובדו בהצלחה', 'success');
    closeModal();
    renderFindingsList(); // Refresh the findings list
    return;
  }

  var pair = currentPairs[index];
  var findingA = pair.finding_a;
  var findingB = pair.finding_b;
  var similarity = pair.similarity;

  var html = '<div class="duplicates-pair-container">' +
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
