// ═══════════════════════════════════════════
// Exclude Rules Panel — exclude_rules.js
// Manages /api/wizi/exclude-rules CRUD and
// exposes getActiveExcludeRules() + isExcludedByRules()
// for use by the Wiz import paths in wizi.js.
// ═══════════════════════════════════════════

import { escapeHtml, showToast, styledConfirm } from './core.js';
import { switchToTab } from './findings.js';
import { t } from './i18n.js';

// ── Module-level rule cache ──────────────────────────────────────────────────
var _rules = [];        // full list, refreshed after every mutation
var _loaded = false;    // true once the first successful fetch completes
var _editingId = null;  // id of the rule loaded into the form for editing (null = adding a new rule)

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
// itemPaths    — (optional) file / secret paths of the item, see getWiziItemPaths();
//                a 'title_path' rule needs its title pattern AND any path pattern match; a legacy
//                'path' rule excludes the item when ANY of its paths matches
// itemResource — (optional) the item's resource name (extractResourceName() in wizi.js);
//                a 'title_resource' rule needs BOTH its title and resource patterns to match
//
// Callers run this on RAW Wiz items, before they are consolidated into findings, so a rule
// removes individual items (and their resources / paths) from the aggregation.
export function isExcludedByRules(itemTitle, itemCategory, itemPaths, itemResource) {
  var active = getActiveExcludeRules();
  if (!active.length) return false;
  return active.some(function(rule) {
    return _matchesRule(rule, itemTitle, itemCategory, itemPaths, itemResource);
  });
}

// title_resource / title_path rules keep their two patterns as JSON in `pattern`:
// {"title":…,"resource":…} / {"title":…,"path":…}. Returns {title, second} or null.
function _parsePair(pattern, key) {
  try {
    var p = JSON.parse(pattern);
    if (p && typeof p.title === 'string' && typeof p[key] === 'string' && p.title && p[key]) {
      return { title: p.title, second: p[key] };
    }
  } catch (e) { /* not JSON */ }
  return null;
}

var _PAIR_KEYS = { title_resource: 'resource', title_path: 'path' };

export function parseRulePair(rule) {
  var key = _PAIR_KEYS[rule && rule.field];
  return key ? _parsePair(rule.pattern, key) : null;
}

// Paths a raw Wiz node carries: secret instances (path), host configuration (filePath),
// malware (fileDetails.path). These are what end up in the finding's Path / Affected Paths line.
export function getWiziItemPaths(item) {
  if (!item) return [];
  return [item.path, item.filePath, (item.fileDetails || {}).path].filter(function(p) {
    return typeof p === 'string' && p;
  });
}

function _matchValue(rule, value, rawPattern) {
  value = (value || '').toLowerCase();
  rawPattern = rawPattern != null ? rawPattern : (rule.pattern || '');
  var pattern = rawPattern.toLowerCase();
  if (rule.operator === 'startsWith') return value.startsWith(pattern);
  if (rule.operator === 'contains')   return value.includes(pattern);
  if (rule.operator === 'regex') {
    try {
      return new RegExp(rawPattern, 'i').test(value);
    } catch (e) {
      console.warn('Invalid exclude rule regex:', rawPattern, e);
      return false;
    }
  }
  return false;
}

function _matchesRule(rule, itemTitle, itemCategory, itemPaths, itemResource) {
  if (rule.field === 'title_resource') {
    var tr = parseRulePair(rule);
    if (!tr || !itemResource) return false;
    return _matchValue(rule, itemTitle, tr.title) && _matchValue(rule, itemResource, tr.second);
  }
  if (rule.field === 'title_path') {
    var tp = parseRulePair(rule);
    if (!tp || !_matchValue(rule, itemTitle, tp.title)) return false;
    return (itemPaths || []).some(function(p) { return _matchValue(rule, p, tp.second); });
  }
  if (rule.field === 'path') {
    return (itemPaths || []).some(function(p) { return _matchValue(rule, p); });
  }
  return _matchValue(rule, rule.field === 'title' ? itemTitle : itemCategory);
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

// An existing rule (active OR disabled) with the same field + operator + pattern, ignoring case —
// matching is case-insensitive, so 'Dynatrace' and 'dynatrace' are the same rule.
export function findDuplicateRule(field, operator, pattern, excludeId) {
  var wanted = String(pattern || '').trim().toLowerCase();
  for (var i = 0; i < _rules.length; i++) {
    var r = _rules[i];
    if (excludeId != null && r.id === excludeId) continue;
    if (r.field === field && r.operator === operator && String(r.pattern || '').trim().toLowerCase() === wanted) return r;
  }
  return null;
}

// Switch a disabled rule back on and refresh the cache. Resolves {ok, error}.
export function enableExcludeRule(ruleId) {
  return _apiFetch(_BASE + '/' + ruleId, { method: 'PUT', body: JSON.stringify({ active: true }) })
    .then(function(r) {
      return r.json().then(function(data) { return { ok: r.ok, error: data && data.error }; });
    })
    .then(function(res) {
      if (res.ok) return _loadRules().then(function() { return res; });
      return res;
    })
    .catch(function() { return { ok: false, error: 'שגיאת רשת' }; });
}

// Create a rule from elsewhere in the UI (e.g. the finding "add filter rule" shortcut) and refresh
// the cache so it applies to the very next import. Resolves {ok, error} or, when an identical
// rule already exists (found locally or reported by the server with 409), {ok:false, duplicate: rule}.
export function addExcludeRule(field, operator, pattern) {
  var local = findDuplicateRule(field, operator, pattern);
  if (local) return Promise.resolve({ ok: false, duplicate: local });
  return _apiFetch(_BASE, {
    method: 'POST',
    body: JSON.stringify({ field: field, operator: operator, pattern: pattern, active: true }),
  })
    .then(function(r) {
      return r.json().then(function(data) {
        if (r.status === 409 && data && data.rule) return { ok: false, duplicate: data.rule };
        return { ok: r.ok, error: data && data.error };
      });
    })
    .then(function(res) {
      if (res.ok || res.duplicate) return _loadRules().then(function() { return res; });
      return res;
    })
    .catch(function() { return { ok: false, error: 'שגיאת רשת' }; });
}

// ── Render the rules table ───────────────────────────────────────────────────
var _FIELD_LABELS = { title: 'כותרת', category: 'קטגוריה', path: 'נתיב', title_resource: 'כותרת + משאב', title_path: 'כותרת + נתיב' };
var _OP_LABELS    = { startsWith: 'מתחיל ב-', contains: 'מכיל', regex: 'Regex' };

function _render() {
  var tbody = _el('exclude-rules-tbody');
  if (!tbody) return;

  if (!_rules.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:16px;">אין כללי סינון</td></tr>';
    return;
  }

  var html = '';
  _rules.forEach(function(rule) {
    var isActive = !!rule.active;
    var toggleLabel = isActive ? 'השבת' : 'הפעל';
    var rowClass = (isActive ? '' : 'exclude-rule-inactive') + (rule.id === _editingId ? ' exclude-rule-editing' : '');
    html += '<tr class="' + rowClass + '" data-rule-id="' + rule.id + '">';
    var _tr = parseRulePair(rule);
    html += '<td><code dir="ltr">' + (_tr
      ? escapeHtml(_tr.title) + '</code> <span class="muted">+</span> <code dir="ltr">' + escapeHtml(_tr.second)
      : escapeHtml(rule.pattern)) + '</code></td>';
    html += '<td>' + escapeHtml(_FIELD_LABELS[rule.field] || rule.field) + '</td>';
    html += '<td>' + escapeHtml(_OP_LABELS[rule.operator] || rule.operator) + '</td>';
    html += '<td>';
    html +=   '<button class="btn btn-sm exclude-rule-toggle-btn" data-rule-id="' + rule.id + '" data-active="' + isActive + '">';
    html +=     escapeHtml(toggleLabel);
    html +=   '</button>';
    html += '</td>';
    html += '<td>';
    html +=   '<button class="btn btn-sm exclude-rule-edit-btn" data-rule-id="' + rule.id + '">' + escapeHtml(t('ערוך')) + '</button>';
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

// An identical rule already exists: say so, and offer to switch it on if it is disabled.
function _handleDuplicate(rule) {
  if (rule.active) {
    _setStatus('כלל זהה כבר קיים', true);
    return;
  }
  styledConfirm('קיים כלל זהה אך הוא מושבת. להפעיל אותו?', {
    icon: '♻️', title: 'כלל זהה קיים', confirmText: 'הפעל', cancelText: 'ביטול',
  }).then(function(yes) {
    if (!yes) return;
    enableExcludeRule(rule.id).then(function(res) {
      if (res.ok) showToast('הכלל הופעל', 'success');
      else _setStatus(res.error || 'שגיאה', true);
    });
  });
}

// ── Edit mode: the add-rule form is reused to change an existing rule ────────
function _setAddButtonLabel(editing) {
  var btn = _el('btn-add-exclude-rule');
  if (!btn) return;
  // data-i18n: a later language switch re-translates from this key
  btn.setAttribute('data-i18n', editing ? 'שמור שינויים' : 'הוסף כלל');
  btn.textContent = editing ? t('שמור שינויים') : t('הוסף כלל');
}

function _handleEdit(ruleId) {
  var rule = null;
  for (var i = 0; i < _rules.length; i++) if (_rules[i].id === ruleId) rule = _rules[i];
  if (!rule) return;

  var fieldEl = _el('exclude-rule-field');
  var opEl = _el('exclude-rule-operator');
  var patternEl = _el('exclude-rule-pattern');
  var resourceEl = _el('exclude-rule-pattern-resource');
  var activeEl = _el('exclude-rule-active');
  if (!fieldEl || !opEl || !patternEl) return;

  // A legacy plain-path rule has no option in the select any more: add a temporary one
  if (!Array.prototype.some.call(fieldEl.options, function(o) { return o.value === rule.field; })) {
    var legacy = document.createElement('option');
    legacy.value = rule.field;
    legacy.textContent = _FIELD_LABELS[rule.field] || rule.field;
    legacy.setAttribute('data-legacy', '1');
    fieldEl.appendChild(legacy);
  }
  fieldEl.value = rule.field;
  fieldEl.dispatchEvent(new Event('change'));   // shows / hides the second input
  opEl.value = rule.operator;
  var pair = parseRulePair(rule);
  patternEl.value = pair ? pair.title : rule.pattern;
  if (resourceEl) resourceEl.value = pair ? pair.second : '';
  if (activeEl) activeEl.checked = !!rule.active;

  _editingId = ruleId;
  _setAddButtonLabel(true);
  var cancelBtn = _el('btn-cancel-edit-exclude-rule');
  if (cancelBtn) cancelBtn.hidden = false;
  _setStatus('');
  _render();
  patternEl.focus();
  if (patternEl.scrollIntoView) patternEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function _exitEditMode() {
  _editingId = null;
  var fieldEl = _el('exclude-rule-field');
  if (fieldEl) {
    Array.prototype.slice.call(fieldEl.options).forEach(function(o) {
      if (o.getAttribute('data-legacy')) fieldEl.removeChild(o);
    });
    fieldEl.value = 'title';
    fieldEl.dispatchEvent(new Event('change'));
  }
  var patternEl = _el('exclude-rule-pattern');
  var resourceEl = _el('exclude-rule-pattern-resource');
  if (patternEl) patternEl.value = '';
  if (resourceEl) resourceEl.value = '';
  var activeEl = _el('exclude-rule-active');
  if (activeEl) activeEl.checked = true;
  _setAddButtonLabel(false);
  var cancelBtn = _el('btn-cancel-edit-exclude-rule');
  if (cancelBtn) cancelBtn.hidden = true;
  _render();
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
  var resourceEl = _el('exclude-rule-pattern-resource');

  if (!pattern) {
    _setStatus('יש להזין תבנית', true);
    if (patternEl) patternEl.focus();
    return;
  }
  if (_PAIR_KEYS[field]) {
    var secondPattern = resourceEl ? resourceEl.value.trim() : '';
    if (!secondPattern) {
      _setStatus(field === 'title_path' ? 'יש להזין תבנית לנתיב' : 'יש להזין תבנית למשאב', true);
      if (resourceEl) resourceEl.focus();
      return;
    }
    var pairObj = { title: pattern };
    pairObj[_PAIR_KEYS[field]] = secondPattern;
    pattern = JSON.stringify(pairObj);
  }

  var editingId = _editingId;
  var dup = findDuplicateRule(field, operator, pattern, editingId);
  if (dup) {
    if (editingId !== null) _setStatus('כלל זהה כבר קיים', true);   // editing: never merge into another rule
    else _handleDuplicate(dup);
    return;
  }

  var addBtn = _el('btn-add-exclude-rule');
  if (addBtn) addBtn.disabled = true;
  _setStatus('');

  var body = JSON.stringify({ field: field, operator: operator, pattern: pattern, active: active });
  _apiFetch(editingId !== null ? _BASE + '/' + editingId : _BASE, {
    method: editingId !== null ? 'PUT' : 'POST',
    body: body,
  })
    .then(function(r) {
      return r.json().then(function(data) { return { ok: r.ok, status: r.status, data: data }; });
    })
    .then(function(res) {
      if (res.status === 409 && res.data && res.data.rule) {
        if (editingId !== null) _setStatus('כלל זהה כבר קיים', true);
        else _handleDuplicate(res.data.rule);
        return _loadRules();
      }
      if (!res.ok) {
        _setStatus(res.data.error || 'שגיאה', true);
        return;
      }
      if (patternEl) patternEl.value = '';
      if (resourceEl) resourceEl.value = '';
      if (editingId !== null) {
        _exitEditMode();
        _setStatus('הכלל עודכן בהצלחה');
        showToast('כלל סינון עודכן', 'success');
      } else {
        _setStatus('הכלל נוסף בהצלחה');
        showToast('כלל סינון נוסף', 'success');
      }
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
        if (_editingId === ruleId) _exitEditMode();
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
  var cancelEditBtn = _el('btn-cancel-edit-exclude-rule');
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', _exitEditMode);
  }

  // Second pattern input (resource / path) only for the title + … rules
  var fieldSel = _el('exclude-rule-field');
  var resourceInput = _el('exclude-rule-pattern-resource');
  if (fieldSel && resourceInput) {
    var syncResourceInput = function() {
      resourceInput.hidden = !_PAIR_KEYS[fieldSel.value];
      resourceInput.placeholder = fieldSel.value === 'title_path' ? 'תבנית נתיב...' : 'תבנית משאב...';
    };
    fieldSel.addEventListener('change', syncResourceInput);
    syncResourceInput();
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
      var editBtn = e.target.closest('.exclude-rule-edit-btn');
      if (editBtn) {
        _handleEdit(parseInt(editBtn.getAttribute('data-rule-id'), 10));
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
