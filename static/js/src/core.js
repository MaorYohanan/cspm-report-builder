import { state } from './state.js';
import { t } from './i18n.js';

// ── HTML escaping ──
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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
var TOAST_DURATION_MS = 30000;
var TOAST_MAX_VISIBLE = 5;
export function showToast(message, type) {
  if (!toastContainer) return;
  type = type || 'info';
  var duration = TOAST_DURATION_MS;
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.style.display = 'flex';
  el.style.alignItems = 'flex-start';
  el.style.gap = '8px';
  var text = document.createElement('span');
  text.style.flex = '1';
  text.textContent = message;
  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', t('סגור'));
  closeBtn.style.cssText = 'background:none;border:none;color:inherit;cursor:pointer;font-size:20px;line-height:1;padding:0 4px;opacity:0.8;flex-shrink:0;';
  function remove() { if (el.parentNode) el.parentNode.removeChild(el); }
  closeBtn.addEventListener('click', remove);
  el.appendChild(text);
  el.appendChild(closeBtn);
  toastContainer.appendChild(el);
  // Long-lived toasts stack up, so keep only the newest few visible.
  while (toastContainer.children.length > TOAST_MAX_VISIBLE) toastContainer.removeChild(toastContainer.firstChild);
  setTimeout(function() { el.classList.add('toast-leaving'); }, duration - 300);
  setTimeout(remove, duration);
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

    var iconEl = document.createElement('div');
    iconEl.className = 'confirm-dialog-icon';
    iconEl.textContent = icon;
    dialog.appendChild(iconEl);

    if (title) {
      var titleEl = document.createElement('div');
      titleEl.className = 'confirm-dialog-title';
      titleEl.textContent = title;
      dialog.appendChild(titleEl);
    }

    var msgEl = document.createElement('div');
    msgEl.className = 'confirm-dialog-message';
    msgEl.textContent = message;
    dialog.appendChild(msgEl);

    var actionsEl = document.createElement('div');
    actionsEl.className = 'confirm-dialog-actions';
    var yesBtn = document.createElement('button');
    yesBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    yesBtn.id = 'confirm-yes';
    yesBtn.textContent = confirmText;
    var noBtn = document.createElement('button');
    noBtn.className = 'btn btn-secondary';
    noBtn.id = 'confirm-no';
    noBtn.textContent = cancelText;
    actionsEl.appendChild(yesBtn);
    actionsEl.appendChild(noBtn);
    dialog.appendChild(actionsEl);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function cleanup(result) {
      document.removeEventListener('keydown', handler);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(result);
    }

    dialog.querySelector('#confirm-yes').addEventListener('click', function() { cleanup(true); });
    dialog.querySelector('#confirm-no').addEventListener('click', function() { cleanup(false); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) cleanup(false); });
    var handler = function(e) {
      if (e.key === 'Escape') { cleanup(false); }
      if (e.key === 'Enter') { if (!danger) { cleanup(true); } }
    };
    document.addEventListener('keydown', handler);

    dialog.querySelector('#confirm-yes').focus();
  });
}
