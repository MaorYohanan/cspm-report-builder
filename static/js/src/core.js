import { state } from './state.js';

// ── Security: Data URL validation ──
export function isValidDataUrl(url) {
  if (!url || typeof url !== 'string') return false;
  // Only allow image data URLs (png, jpg, jpeg, gif, webp, svg)
  const validImagePattern = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
  return validImagePattern.test(url);
}

export function sanitizeDataUrl(url) {
  return isValidDataUrl(url) ? url : '';
}

// ── Toast notifications ──
var toastContainer = document.getElementById('toast-container');
export function showToast(message, type) {
  type = type || 'info';
  var duration = type === 'error' ? 10000 : 3200;
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.style.display = 'flex';
  el.style.alignItems = 'flex-start';
  el.style.gap = '8px';
  var text = document.createElement('span');
  text.style.flex = '1';
  text.textContent = message;
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'background:none;border:none;color:inherit;cursor:pointer;font-size:16px;line-height:1;padding:0;opacity:0.8;flex-shrink:0;';
  closeBtn.addEventListener('click', function() { if (el.parentNode) el.parentNode.removeChild(el); });
  el.appendChild(text);
  el.appendChild(closeBtn);
  toastContainer.appendChild(el);
  setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, duration);
}

export function styledConfirm(message, opts) {
  opts = opts || {};
  var icon = opts.icon || '⚠️';
  var title = opts.title || '';
  var confirmText = opts.confirmText || 'אישור';
  var cancelText = opts.cancelText || 'ביטול';
  var danger = opts.danger || false;

  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';

    var dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';

    dialog.innerHTML =
      '<div class="confirm-dialog-icon">' + icon + '</div>' +
      (title ? '<div class="confirm-dialog-title">' + title + '</div>' : '') +
      '<div class="confirm-dialog-message">' + message + '</div>' +
      '<div class="confirm-dialog-actions">' +
        '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" id="confirm-yes">' + confirmText + '</button>' +
        '<button class="btn btn-secondary" id="confirm-no">' + cancelText + '</button>' +
      '</div>';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function cleanup(result) {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(result);
    }

    dialog.querySelector('#confirm-yes').addEventListener('click', function() { cleanup(true); });
    dialog.querySelector('#confirm-no').addEventListener('click', function() { cleanup(false); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) cleanup(false); });
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', handler); cleanup(false); }
      if (e.key === 'Enter') { document.removeEventListener('keydown', handler); cleanup(true); }
    });

    dialog.querySelector('#confirm-yes').focus();
  });
}
