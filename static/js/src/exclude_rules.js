// ═══════════════════════════════════════════
// Exclude Rules Panel — exclude_rules.js
// Manages /api/wizi/exclude-rules CRUD and
// exposes getActiveExcludeRules() + isExcludedByRules()
// for use by the Wiz import paths in wizi.js.
// ═══════════════════════════════════════════

import { escapeHtml, showToast, styledConfirm } from './core.js';
import { switchToTab } from './findings.js';

// ── Module-level rule cache ──────────────────────────────────────────────────
var _rules = [];        // full list, refreshed after every mutation
var _loaded = false;    // true once the first successful fetch completes

// ── DOM refs (resolved lazily on first use) ──────────────────────────────────
function _el(id) { return document.getElementById(id); }

// ── API helpers ──────────────────────────────────────────────────────────────
var _BASE = '/api/wizi/exclude-rules';

function _apiFetch(path, opts) {
  return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
}

// ── Public: return currently cached active rules (synchronous) ───────────────
export function getActiveExcludeRules() {
  return _rules.filter(function(r) { return r.active; });
}

// ── Public: test a single Wiz item against the cached active rule list ────────
//
// itemTitle    — result of getWiziItemTitle(item, qt)
// itemCategory — the CSPM category the item would be assigned (CSPM, VULN, …)
//
export function isExcludedByRules(itemTitle, itemCategory) {
  var active = getActiveExcludeRules();
  if (!active.length) return false;
  return active.some(function(rule) {
    return _matchesRule(rule, itemTitle, itemCategory);
  });
}

function _matchesRule(rule, itemTitle, itemCategory) {
  var value = (rule.field === 'title' ? itemTitle : itemCategory) || '';
  value = value.toLowerCase();
  var pattern = (rule.pattern || '').toLowerCase();
  if (rule.operator === 'startsWith') return value.startsWith(pattern);
  if (rule.operator === 'contains')   return value.includes(pattern);
  if (rule.operator === 'regex') {
    try {
      return new RegExp(rule.pattern, 'i').test(value);
    } catch (e) {
      console.warn('Invalid exclude rule regex:', rule.pattern, e);
      return false;
    }
  }
  return false;
}

// ── Fetch rules from server and refresh cache ────────────────────────────────
function _loadRules() {
  return _apiFetch(_BASE)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _rules = data.rules || [];
      _loaded = true;
      _render();
      _updateActiveCount();
    })
    .catch(function(e) {
      console.error('exclude_rules: fetch failed', e);
      _loaded = false;
    });
}

// ── Render the rules table ───────────────────────────────────────────────────
var _FIELD_LABELS = { title: 'כותרת', category: 'קטגוריה' };
var _OP_LABELS    = { startsWith: 'מתחיל ב-', contains: 'מכיל', regex: 'Regex' };

function _render() {
  var tbody = _el('exclude-rules-tbody');
  if (!tbody) return;

  if (!_rules.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:16px;">אין כללי סינון</td></tr>';
    return;
  }

  var html = '';
  _rules.forEach(function(rule) {
    var isActive = !!rule.active;
    var toggleLabel = isActive ? 'השבת' : 'הפעל';
    var rowClass = isActive ? '' : 'exclude-rule-inactive';
    html += '<tr class="' + rowClass + '" data-rule-id="' + rule.id + '">';
    html += '<td><code>' + escapeHtml(rule.pattern) + '</code></td>';
    html += '<td>' + escapeHtml(_FIELD_LABELS[rule.field] || rule.field) + '</td>';
    html += '<td>' + escapeHtml(_OP_LABELS[rule.operator] || rule.operator) + '</td>';
    html += '<td>';
    html +=   '<button class="btn btn-sm exclude-rule-toggle-btn" data-rule-id="' + rule.id + '" data-active="' + isActive + '">';
    html +=     escapeHtml(toggleLabel);
    html +=   '</button>';
    html += '</td>';
    html += '<td>';
    html +=   '<button class="btn btn-sm btn-danger exclude-rule-delete-btn" data-rule-id="' + rule.id + '">';
    html +=     'מחק';
    html +=   '</button>';
    html += '</td>';
    html += '</tr>';
  });
  tbody.innerHTML = html;
}

// ── Update the active count badge in the Wiz sub-panel ──────────────────────
function _updateActiveCount() {
  var countEl = _el('exclude-rules-active-count');
  if (!countEl) return;
  var n = _rules.filter(function(r) { return r.active; }).length;
  countEl.textContent = String(n);
}

// ── Status message helper ────────────────────────────────────────────────────
function _setStatus(msg, isError) {
  var el = _el('exclude-rules-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger, #d9534f)' : 'var(--success, #28a745)';
  if (msg) {
    setTimeout(function() {
      if (el.textContent === msg) el.textContent = '';
    }, 4000);
  }
}

// ── Add-rule handler ─────────────────────────────────────────────────────────
function _handleAdd() {
  var fieldEl    = _el('exclude-rule-field');
  var opEl       = _el('exclude-rule-operator');
  var patternEl  = _el('exclude-rule-pattern');
  var activeEl   = _el('exclude-rule-active');

  var field    = fieldEl    ? fieldEl.value.trim()   : '';
  var operator = opEl       ? opEl.value.trim()       : '';
  var pattern  = patternEl  ? patternEl.value.trim()  : '';
  var active   = activeEl   ? activeEl.checked         : true;

  if (!pattern) {
    _setStatus('יש להזין תבנית', true);
    if (patternEl) patternEl.focus();
    return;
  }

  var addBtn = _el('btn-add-exclude-rule');
  if (addBtn) addBtn.disabled = true;
  _setStatus('');

  _apiFetch(_BASE, {
    method: 'POST',
    body: JSON.stringify({ field: field, operator: operator, pattern: pattern, active: active }),
  })
    .then(function(r) {
      return r.json().then(function(data) { return { ok: r.ok, status: r.status, data: data }; });
    })
    .then(function(res) {
      if (!res.ok) {
        _setStatus(res.data.error || 'שגיאה', true);
        return;
      }
      if (patternEl) patternEl.value = '';
      _setStatus('הכלל נוסף בהצלחה');
      showToast('כלל סינון נוסף', 'success');
      return _loadRules();
    })
    .catch(function(e) {
      _setStatus('שגיאת רשת', true);
      console.error('exclude_rules: add failed', e);
    })
    .finally(function() {
      if (addBtn) addBtn.disabled = false;
    });
}

// ── Toggle-active handler ────────────────────────────────────────────────────
function _handleToggle(ruleId, currentActive) {
  var newActive = !currentActive;
  _apiFetch(_BASE + '/' + ruleId, {
    method: 'PUT',
    body: JSON.stringify({ active: newActive }),
  })
    .then(function(r) {
      return r.json().then(function(data) { return { ok: r.ok, data: data }; });
    })
    .then(function(res) {
      if (!res.ok) {
        showToast(res.data.error || 'שגיאה בעדכון', 'error');
        return;
      }
      return _loadRules();
    })
    .catch(function(e) {
      showToast('שגיאת רשת', 'error');
      console.error('exclude_rules: toggle failed', e);
    });
}

// ── Delete handler ───────────────────────────────────────────────────────────
function _handleDelete(ruleId) {
  styledConfirm('האם למחוק כלל סינון זה?', {
    icon: '🗑️',
    title: 'מחיקת כלל סינון',
    confirmText: 'מחק',
    cancelText: 'ביטול',
  }).then(function(confirmed) {
    if (!confirmed) return;
    _apiFetch(_BASE + '/' + ruleId, { method: 'DELETE' })
      .then(function(r) {
        return r.json().then(function(data) { return { ok: r.ok, data: data }; });
      })
      .then(function(res) {
        if (!res.ok) {
          showToast(res.data.error || 'שגיאה במחיקה', 'error');
          return;
        }
        showToast('הכלל נמחק', 'success');
        return _loadRules();
      })
      .catch(function(e) {
        showToast('שגיאת רשת', 'error');
        console.error('exclude_rules: delete failed', e);
      });
  });
}

// ── Wire event listeners ─────────────────────────────────────────────────────
function _wireEvents() {
  // Add-rule form
  var addBtn = _el('btn-add-exclude-rule');
  if (addBtn) {
    addBtn.addEventListener('click', _handleAdd);
  }

  // Table row buttons — delegated to tbody
  var tbody = _el('exclude-rules-tbody');
  if (tbody) {
    tbody.addEventListener('click', function(e) {
      var toggleBtn = e.target.closest('.exclude-rule-toggle-btn');
      if (toggleBtn) {
        var rid     = parseInt(toggleBtn.getAttribute('data-rule-id'), 10);
        var curAct  = toggleBtn.getAttribute('data-active') === 'true';
        _handleToggle(rid, curAct);
        return;
      }
      var deleteBtn = e.target.closest('.exclude-rule-delete-btn');
      if (deleteBtn) {
        var delRid = parseInt(deleteBtn.getAttribute('data-rule-id'), 10);
        _handleDelete(delRid);
      }
    });
  }

  // Navigation button in Wiz sub-panel
  var goBtn = _el('btn-go-to-exclude-rules');
  if (goBtn) {
    goBtn.addEventListener('click', function() {
      switchToTab('tab-exclude-rules');
    });
  }
}

// ── Public init ──────────────────────────────────────────────────────────────
export var ExcludeRulesPanel = {
  init: function() {
    // Lazy-load rules when the tab is first activated
    var tabBtn = _el('tab-exclude-rules');
    if (tabBtn) {
      tabBtn.addEventListener('click', function() {
        if (!_loaded) {
          _loadRules();
        } else {
          // Re-render from cache (e.g. panel revisited)
          _render();
        }
      });
    }

    _wireEvents();

    // Pre-load once so getActiveExcludeRules() is ready before first import
    _loadRules();
  },
};
