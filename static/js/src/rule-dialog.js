// ═══════════════════════════════════════════
// "Add filter rule" shortcut for the selected finding (footer "עוד" menu)
// Opens a small dialog pre-filled from the finding (title / category / path / title + resource)
// and creates an exclude rule (רשימת סינון) through exclude_rules.js. The rule only affects
// FUTURE imports — it does not remove the finding that is currently open.
// ═══════════════════════════════════════════

import { state } from './state.js';
import { showToast, styledConfirm } from './core.js';
import { removeFinding } from './findings.js';
import { t } from './i18n.js';
import { addExcludeRule, getActiveExcludeRules } from './exclude_rules.js';
import { getFullResources } from './resource-cap.js';

// Paths shown in the finding's technical lines: "Path: x", "File Path: x", "Affected Paths (n): a, b"
export function getFindingPaths(finding) {
  var out = [];
  ((finding && finding.technical) || []).forEach(function(line) {
    if (typeof line !== 'string') return;
    var m = /^(?:Path|File Path|Affected Paths(?: \(\d+\))?):\s*(.*)$/.exec(line);
    if (!m) return;
    m[1].split(',').forEach(function(p) {
      p = p.trim();
      if (p && out.indexOf(p) === -1) out.push(p);
    });
  });
  return out;
}

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function labelled(labelText, control) {
  var wrap = el('label', 'rule-dialog-row');
  wrap.appendChild(el('span', 'rule-dialog-label', labelText));
  wrap.appendChild(control);
  return wrap;
}

function openDialog(finding) {
  var paths = getFindingPaths(finding);
  var resources = getFullResources(finding);

  var fields = [{ value: 'title', label: t('כותרת') }, { value: 'category', label: t('קטגוריה') }];
  if (paths.length) fields.push({ value: 'title_path', label: t('כותרת + נתיב') });
  if (resources.length) fields.push({ value: 'title_resource', label: t('כותרת + משאב') });

  var overlay = el('div', 'confirm-overlay');
  var dialog = el('div', 'confirm-dialog rule-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.appendChild(el('div', 'confirm-dialog-icon', '➕'));
  dialog.appendChild(el('div', 'confirm-dialog-title', t('הוספת כלל סינון')));
  dialog.appendChild(el('div', 'confirm-dialog-message rule-dialog-finding', finding.title || ''));

  var fieldSel = el('select');
  fields.forEach(function(f) {
    var o = el('option', null, f.label);
    o.value = f.value;
    fieldSel.appendChild(o);
  });
  var opSel = el('select');
  [['startsWith', t('מתחיל ב-')], ['contains', t('מכיל')], ['regex', t('ביטוי רגולרי')]].forEach(function(p) {
    var o = el('option', null, p[1]);
    o.value = p[0];
    opSel.appendChild(o);
  });

  var patternInput = el('input');
  patternInput.type = 'text';
  patternInput.dir = 'ltr';
  patternInput.maxLength = 500;
  var resourceInput = el('input');
  resourceInput.type = 'text';
  resourceInput.dir = 'ltr';
  resourceInput.maxLength = 500;

  // Suggestions for path / resource (the value stays editable, e.g. to cut a generated suffix)
  var pathList = el('datalist');
  pathList.id = 'rule-dialog-paths';
  paths.forEach(function(p) { var o = el('option'); o.value = p; pathList.appendChild(o); });
  var resList = el('datalist');
  resList.id = 'rule-dialog-resources';
  resources.forEach(function(r) { var o = el('option'); o.value = r; resList.appendChild(o); });

  var patternRow = labelled('', patternInput);
  var resourceRow = labelled('', resourceInput);
  var hint = el('div', 'rule-dialog-hint',
    t('הכלל חל על ייבואי Wiz הבאים בלבד ואינו מסיר את הממצא הנוכחי. אפשר לקצר את התבנית (למשל להסיר מספר בסוף) ולהשתמש ב"מתחיל ב-" כתו כללי.'));

  function syncFields() {
    var f = fieldSel.value;
    patternInput.removeAttribute('list');
    resourceInput.removeAttribute('list');
    var isPair = f === 'title_resource' || f === 'title_path';
    resourceRow.hidden = !isPair;
    var labelEl = patternRow.querySelector('.rule-dialog-label');
    if (f === 'title') {
      patternInput.value = finding.title || '';
      labelEl.textContent = t('כותרת');
    } else if (f === 'category') {
      patternInput.value = finding.category || '';
      labelEl.textContent = t('קטגוריה');
    } else if (f === 'title_path') {
      patternInput.value = finding.title || '';
      labelEl.textContent = t('כותרת');
      resourceInput.value = paths[0] || '';
      resourceInput.setAttribute('list', pathList.id);
      resourceRow.querySelector('.rule-dialog-label').textContent = t('נתיב (Path)');
    } else {
      patternInput.value = finding.title || '';
      labelEl.textContent = t('כותרת');
      resourceInput.value = resources[0] || '';
      resourceInput.setAttribute('list', resList.id);
      resourceRow.querySelector('.rule-dialog-label').textContent = t('משאב');
    }
  }
  fieldSel.addEventListener('change', syncFields);

  dialog.appendChild(labelled(t('סוג כלל'), fieldSel));
  dialog.appendChild(labelled(t('אופרטור'), opSel));
  dialog.appendChild(patternRow);
  dialog.appendChild(resourceRow);
  dialog.appendChild(pathList);
  dialog.appendChild(resList);
  dialog.appendChild(hint);

  var actions = el('div', 'confirm-dialog-actions');
  var addBtn = el('button', 'btn btn-primary', t('הוסף כלל'));
  addBtn.type = 'button';
  var cancelBtn = el('button', 'btn btn-secondary', t('ביטול'));
  cancelBtn.type = 'button';
  actions.appendChild(addBtn);
  actions.appendChild(cancelBtn);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  syncFields();

  function close() {
    document.removeEventListener('keydown', onKey);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

  addBtn.addEventListener('click', function() {
    var field = fieldSel.value;
    var pattern = patternInput.value.trim();
    if (!pattern) { showToast(t('יש להזין תבנית'), 'warning'); patternInput.focus(); return; }
    if (field === 'title_resource' || field === 'title_path') {
      var second = resourceInput.value.trim();
      if (!second) {
        showToast(t(field === 'title_path' ? 'יש להזין תבנית לנתיב' : 'יש להזין תבנית למשאב'), 'warning');
        resourceInput.focus();
        return;
      }
      var pairObj = { title: pattern };
      pairObj[field === 'title_path' ? 'path' : 'resource'] = second;
      pattern = JSON.stringify(pairObj);
    }
    var operator = opSel.value;
    var dup = getActiveExcludeRules().some(function(r) {
      return r.field === field && r.operator === operator && r.pattern === pattern;
    });
    if (dup) { showToast(t('כלל זהה כבר קיים'), 'info'); return; }
    addBtn.disabled = true;
    addExcludeRule(field, operator, pattern).then(function(res) {
      if (!res.ok) { showToast(res.error || t('שגיאה'), 'error'); addBtn.disabled = false; return; }
      showToast(t('כלל סינון נוסף'), 'success');
      close();
      // The rule only affects future imports — ask whether the open finding should go too.
      styledConfirm(t('הכלל נוסף. האם למחוק גם את הממצא הנוכחי מהדו"ח?'), {
        icon: '🗑️',
        title: t('מחיקת הממצא'),
        confirmText: t('מחק ממצא'),
        cancelText: t('השאר ממצא'),
        danger: true
      }).then(function(yes) {
        if (yes) removeFinding(finding, false);
      });
    });
  });

  patternInput.focus();
  patternInput.select();
}

document.addEventListener('openAddRuleDialog', function(e) {
  var idx = e && e.detail ? e.detail.findingIndex : state.selectedFindingIndex;
  var finding = state.findings[idx];
  if (finding) openDialog(finding);
});
