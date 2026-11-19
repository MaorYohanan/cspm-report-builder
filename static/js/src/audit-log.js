// audit-log.js — Admin Audit Log view (UI only: rendering, filters, pagination controls, row expand).
// No fetch and no business logic here. Developer wires the list endpoint:
//
//   import { onAuditFilterChange, renderAuditLog, setAuditLogLoading, setAuditLogError } from './audit-log.js';
//   onAuditFilterChange(async (filters) => {
//     setAuditLogLoading(true);
//     try { renderAuditLog(await (await fetch(url(filters))).json()); }
//     catch (e) { setAuditLogError(); }
//   });
//
// All event data is written with textContent / createElement — never innerHTML.

import { t, tFormat, getLang, LANG_CHANGE_EVENT } from './i18n.js';

const FILTER_FIELDS = [
  ['actor', 'audit-filter-actor'],
  ['action', 'audit-filter-action'],
  ['from', 'audit-filter-from'],
  ['to', 'audit-filter-to'],
  ['entity_type', 'audit-filter-entity-type'],
  ['entity_id', 'audit-filter-entity-id'],
  ['product_id', 'audit-filter-product-id'],
  ['source_ip', 'audit-filter-source-ip'],
];

// Action key -> Hebrew i18n key (English comes from i18n.js). Unknown keys render raw.
const ACTION_LABELS = {
  'version.publish': 'פרסום גרסה',
  'version.delete': 'מחיקת גרסה',
  'product.delete': 'מחיקת מוצר',
  'finding.delete': 'מחיקת ממצא',
  'exception.add': 'הוספת חריגה',
  'exception.temporary': 'חריגה זמנית',
  'exception.acknowledge': 'אישור חריגה',
  'exception.remove': 'הסרת חריגה',
  'exception.temporary_consumed': 'חריגה זמנית נצרכה/הוסרה אוטומטית',
  'exclude_rule.create': 'יצירת כלל החרגה',
  'exclude_rule.update': 'עדכון כלל החרגה',
  'exclude_rule.toggle': 'הפעלה/השבתה של כלל החרגה',
  'exclude_rule.delete': 'מחיקת כלל החרגה',
  'user.role_change': 'שינוי תפקיד משתמש',
  'system.backup': 'גיבוי מערכת',
  'system.restore': 'שחזור מערכת',
};

function actionLabel(key) {
  if (key === null || key === undefined || key === '') return '';
  const k = String(key);
  return Object.prototype.hasOwnProperty.call(ACTION_LABELS, k) ? t(ACTION_LABELS[k]) : k;
}

let filterCallback = null;
let currentPage = 1;
let lastResponse = null;
let firstLoadRequested = false;
let loading = false;

function el(id) { return document.getElementById(id); }

/** Register the function called on every filter or page change. Replaces any earlier callback. */
export function onAuditFilterChange(cb) {
  filterCallback = typeof cb === 'function' ? cb : null;
  // If the tab was already opened before wiring, request the first page now.
  if (filterCallback && firstLoadRequested && !lastResponse && !loading) emit();
}

/** Current filter values: {actor, action, from, to, entity_type, entity_id, product_id, source_ip, page}. Dates are 'YYYY-MM-DD'. */
export function getAuditFilters() {
  const f = {};
  FILTER_FIELDS.forEach(([key, id]) => {
    const input = el(id);
    f[key] = input ? input.value.trim() : '';
  });
  f.page = currentPage;
  return f;
}

function emit() {
  const filters = getAuditFilters();
  if (filterCallback) filterCallback(filters);
  document.dispatchEvent(new CustomEvent('audit-filter-change', { detail: filters }));
}

function showFilterError(msg) { el('audit-filter-error').textContent = msg || ''; }

function applyFilters(page) {
  const f = getAuditFilters();
  if (f.from && f.to && f.from > f.to) {
    showFilterError(t('תאריך ההתחלה מאוחר מתאריך הסיום'));
    return;
  }
  showFilterError('');
  currentPage = page;
  emit();
}

// ── States ──────────────────────────────────────────────────────────────────

function setView(mode) {
  // mode: 'loading' | 'empty' | 'error' | 'data'
  const state = el('audit-state');
  const wrap = el('audit-table-wrap');
  const pag = el('audit-pagination');
  state.className = 'audit-state' + (mode === 'error' ? ' audit-state-error' : '');
  state.setAttribute('role', mode === 'error' ? 'alert' : 'status');
  state.hidden = mode === 'data';
  wrap.hidden = mode !== 'data';
  pag.hidden = mode === 'loading' || mode === 'error' || mode === 'empty';
}

/** Show or clear the loading state. While loading, pagination buttons are disabled. */
export function setAuditLogLoading(isLoading) {
  loading = !!isLoading;
  if (loading) {
    el('audit-state').textContent = t('טוען...');
    setView('loading');
    el('audit-prev').disabled = true;
    el('audit-next').disabled = true;
  } else if (lastResponse) {
    renderAuditLog(lastResponse);
  }
}

/** Show the error state with a retry button. message is optional (a generic text is used otherwise). */
export function setAuditLogError(message) {
  loading = false;
  const state = el('audit-state');
  state.textContent = '';
  const msg = document.createElement('div');
  msg.textContent = message ? String(message) : t('שגיאה בטעינת יומן הביקורת');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn-secondary audit-retry';
  retry.id = 'audit-retry';
  retry.textContent = t('נסה שוב');
  retry.addEventListener('click', () => emit());
  state.append(msg, retry);
  setView('error');
}

// ── Rendering ───────────────────────────────────────────────────────────────

function formatTimestamp(ts) {
  if (ts === null || ts === undefined || ts === '') return '—';
  let raw = String(ts);
  // Naive ISO strings (no Z / offset) are treated as UTC, then shown in the viewer's local time.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw)) raw = raw.replace(' ', 'T') + 'Z';
  const d = new Date(typeof ts === 'number' ? ts : raw);
  if (isNaN(d.getTime())) return String(ts);
  const locale = getLang() === 'he' ? 'he-IL' : 'en-GB';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(d);
}

function formatDetails(details) {
  if (details === null || details === undefined || details === '') return '—';
  if (typeof details === 'string') return details;
  try { return JSON.stringify(details, null, 2); } catch (e) { return String(details); }
}

function textCell(value, ltr) {
  const td = document.createElement('td');
  const v = value === null || value === undefined || value === '' ? '—' : String(value);
  if (ltr && v !== '—') {
    const span = document.createElement('span');
    span.className = 'audit-ltr';
    span.dir = 'ltr';
    span.textContent = v;
    td.appendChild(span);
  } else {
    td.textContent = v;
  }
  return td;
}

function toggleRow(row) {
  const btn = row.querySelector('.audit-expand-btn');
  const detail = row.nextElementSibling;
  if (!btn || !detail || !detail.classList.contains('audit-detail-row')) return;
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', open ? t('הסתר פרטים') : t('הצג פרטים'));
  detail.hidden = !open;
  row.classList.toggle('audit-row-open', open);
}

// Source IP is expanded-row only: an 8th column overflowed the table wrap (703px > 682px) in the admin layout.
// Labelled "label: value" line for the expanded row; value is LTR technical text, '—' when null/empty.
function metaLine(labelText, value) {
  const line = document.createElement('div');
  line.className = 'audit-detail-key audit-detail-meta';
  const lbl = document.createElement('span');
  lbl.className = 'audit-detail-label';
  lbl.textContent = labelText + ': ';
  const val = document.createElement('span');
  const empty = value === null || value === undefined || value === '';
  if (empty) {
    val.textContent = '—';
  } else {
    val.className = 'audit-ltr';
    val.dir = 'ltr';
    val.textContent = String(value);
  }
  line.append(lbl, val);
  return line;
}

function buildRows(items) {
  const frag = document.createDocumentFragment();
  items.forEach((item, i) => {
    const row = document.createElement('tr');
    row.className = 'audit-row';

    const toggleTd = document.createElement('td');
    toggleTd.className = 'audit-col-toggle';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'audit-expand-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', t('הצג פרטים'));
    const detailId = 'audit-detail-' + i;
    btn.setAttribute('aria-controls', detailId);
    toggleTd.appendChild(btn);
    row.appendChild(toggleTd);

    const timeTd = document.createElement('td');
    const time = document.createElement('span');
    time.className = 'audit-ltr audit-time';
    time.dir = 'ltr';
    time.textContent = formatTimestamp(item.timestamp);
    if (item.timestamp !== null && item.timestamp !== undefined) time.title = String(item.timestamp);
    timeTd.appendChild(time);
    row.appendChild(timeTd);

    row.appendChild(textCell(item.actor, true));
    const actionTd = textCell(actionLabel(item.action), false);
    if (item.action) actionTd.title = String(item.action);
    row.appendChild(actionTd);
    row.appendChild(textCell(item.entity_type, false));
    const entityTd = textCell(item.entity_id, true);
    entityTd.classList.add('audit-col-id');
    row.appendChild(entityTd);
    const productTd = textCell(item.product_id, true);
    productTd.classList.add('audit-col-id');
    row.appendChild(productTd);

    const detailRow = document.createElement('tr');
    detailRow.className = 'audit-detail-row';
    detailRow.id = detailId;
    detailRow.hidden = true;
    const detailTd = document.createElement('td');
    detailTd.colSpan = 7;
    const label = document.createElement('div');
    label.className = 'audit-detail-label';
    label.textContent = t('פרטים');
    const pre = document.createElement('pre');
    pre.className = 'audit-detail-pre';
    pre.dir = 'ltr'; // JSON / technical values are LTR by nature
    pre.textContent = formatDetails(item.details);
    const keyLine = document.createElement('div');
    keyLine.className = 'audit-detail-key';
    const keyLabel = document.createElement('span');
    keyLabel.className = 'audit-detail-label';
    keyLabel.textContent = t('מפתח פעולה') + ': ';
    const keyVal = document.createElement('span');
    keyVal.className = 'audit-ltr';
    keyVal.dir = 'ltr';
    keyVal.textContent = item.action === null || item.action === undefined || item.action === '' ? '—' : String(item.action);
    keyLine.append(keyLabel, keyVal);
    detailTd.append(keyLine, metaLine(t('כתובת IP'), item.source_ip), metaLine(t('דפדפן / User-Agent'), item.user_agent), label, pre);
    detailRow.appendChild(detailTd);

    frag.append(row, detailRow);
  });
  return frag;
}

/** Render a list response: {items, page, page_size, total}. Replaces the table; shows the empty state when no items. */
export function renderAuditLog(response) {
  loading = false;
  lastResponse = response || { items: [], page: 1, page_size: 1, total: 0 };
  const r = lastResponse;
  const items = Array.isArray(r.items) ? r.items : [];
  const total = Number.isFinite(Number(r.total)) ? Number(r.total) : items.length;
  const pageSize = Number(r.page_size) > 0 ? Number(r.page_size) : Math.max(items.length, 1);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Number(r.page) || 1), pages);
  currentPage = page;

  const tbody = el('audit-tbody');
  tbody.textContent = '';

  if (!items.length || total === 0) {
    el('audit-state').textContent = t('לא נמצאו רשומות ביומן');
    setView('empty');
    return;
  }

  tbody.appendChild(buildRows(items));
  el('audit-total').textContent = tFormat('סה"כ {n} רשומות', { n: total });
  el('audit-page-indicator').textContent = tFormat('עמוד {page} מתוך {pages}', { page, pages });
  el('audit-prev').disabled = page <= 1;
  el('audit-next').disabled = page >= pages;
  setView('data');
}

// ── Panel language (the admin page itself stays Hebrew; only this panel follows ui-lang) ──

function applyPanelLang() {
  const panel = el('tab-audit');
  if (!panel) return;
  panel.dir = getLang() === 'he' ? 'rtl' : 'ltr';
  panel.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.getAttribute('data-i18n')); });
  panel.querySelectorAll('[data-audit-ph]').forEach((n) => { n.placeholder = n.getAttribute('data-audit-ph'); });
  const tab = el('audit-tab-btn');
  if (tab) tab.textContent = t('יומן ביקורת');
}

// ── Init ────────────────────────────────────────────────────────────────────

function init() {
  if (!el('tab-audit')) return;
  applyPanelLang();

  el('audit-filter-form').addEventListener('submit', (e) => { e.preventDefault(); applyFilters(1); });
  el('audit-filter-reset').addEventListener('click', () => {
    FILTER_FIELDS.forEach(([, id]) => { el(id).value = ''; });
    applyFilters(1);
  });
  el('audit-prev').addEventListener('click', () => { if (!el('audit-prev').disabled) applyFilters(currentPage - 1); });
  el('audit-next').addEventListener('click', () => { if (!el('audit-next').disabled) applyFilters(currentPage + 1); });

  // Row expand: toggle button or anywhere on the summary row (delegated; no per-row listeners).
  el('audit-tbody').addEventListener('click', (e) => {
    const row = e.target.closest('tr.audit-row');
    if (row) toggleRow(row);
  });

  // First time the tab is opened, ask for page 1 (admin.js handles the tab switching itself).
  el('audit-tab-btn').addEventListener('click', () => {
    if (firstLoadRequested) return;
    firstLoadRequested = true;
    if (filterCallback) emit();
  });

  document.addEventListener(LANG_CHANGE_EVENT, () => {
    applyPanelLang();
    if (lastResponse && !loading) renderAuditLog(lastResponse);
  });

  setAuditLogLoading(true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

// Global handle so non-module code and manual testing can drive the view.
window.auditLog = { renderAuditLog, setAuditLogLoading, setAuditLogError, onAuditFilterChange, getAuditFilters };
