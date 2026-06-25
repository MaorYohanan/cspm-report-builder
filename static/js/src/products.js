import { showToast, styledConfirm } from './core.js';
import { buildSnapshot, applySnapshot, switchToTab } from './findings.js';

// ═══════════════════════════════════════════
// Product Registry — products.js
// Part of the shared IIFE (no self-wrapping).
// Exposes: ProductsPanel, saveAsVersion
// ═══════════════════════════════════════════

// ---------------------------------------------------------------------------
// Pure helpers (also used by tests)
// ---------------------------------------------------------------------------

function computeDiff(baseline, target) {
  // Returns { added, resolved, changed, unchanged }
  var baseById = {};
  (baseline || []).forEach(function(f) { if (f && f.id) baseById[f.id] = f; });
  var targetById = {};
  (target || []).forEach(function(f) { if (f && f.id) targetById[f.id] = f; });

  var added = [], resolved = [], changed = [], unchanged = [];

  Object.keys(targetById).forEach(function(id) {
    if (!baseById[id]) {
      added.push(targetById[id]);
    } else if ((baseById[id].severity || '').toLowerCase() !== (targetById[id].severity || '').toLowerCase()) {
      changed.push({ before: baseById[id], after: targetById[id] });
    } else {
      unchanged.push(targetById[id]);
    }
  });

  Object.keys(baseById).forEach(function(id) {
    if (!targetById[id]) resolved.push(baseById[id]);
  });

  return { added: added, resolved: resolved, changed: changed, unchanged: unchanged };
}

function computeRiskDelta(baselineVer, targetVer) {
  var b = (baselineVer && typeof baselineVer.riskScore === 'number') ? baselineVer.riskScore : null;
  var t = (targetVer && typeof targetVer.riskScore === 'number') ? targetVer.riskScore : null;
  if (b === null || t === null) return null;
  return t - b;
}

// ---------------------------------------------------------------------------
// ProductsPanel — main UI object
// ---------------------------------------------------------------------------

export var ProductsPanel = {
  currentView: 'grid',   // 'grid' | 'timeline' | 'form'
  selectedProduct: null, // product metadata object

  // ── API helpers ──────────────────────────────────────────────────────────

  fetchProducts: async function() {
    var resp = await fetch('/api/products');
    if (!resp.ok) { var b = await resp.json().catch(function(){return {};}); throw new Error(b.error || 'שגיאה'); }
    return resp.json();
  },

  fetchVersions: async function(productId) {
    var resp = await fetch('/api/products/' + encodeURIComponent(productId) + '/versions');
    if (!resp.ok) { var b = await resp.json().catch(function(){return {};}); throw new Error(b.error || 'שגיאה'); }
    return resp.json();
  },

  fetchVersion: async function(productId, ver) {
    var resp = await fetch('/api/products/' + encodeURIComponent(productId) + '/versions/' + encodeURIComponent(ver));
    if (!resp.ok) { var b = await resp.json().catch(function(){return {};}); throw new Error(b.error || 'שגיאה'); }
    return resp.json();
  },

  // ── Initialisation ───────────────────────────────────────────────────────

  init: function() {
    var self = this;
    // Initialise global risk score tooltip (body-level, never clipped)
    _initRiskTooltip();
    // Wire export panel shortcut
    var saveBtn = document.getElementById('btn-save-as-version');
    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        self._exportShortcutFlow();
      });
    }
    // Wire report-details panel shortcut (same flow)
    var saveBtn2 = document.getElementById('btn-save-as-version-details');
    if (saveBtn2) {
      saveBtn2.addEventListener('click', function() {
        self._exportShortcutFlow();
      });
    }
    // Wire tab button — load grid on first click
    var tabBtn = document.getElementById('tab-products');
    if (tabBtn) {
      tabBtn.addEventListener('click', function() {
        self.showGrid();
      });
    }
  },

  // ── Grid View ────────────────────────────────────────────────────────────

  showGrid: function() {
    this.currentView = 'grid';
    this.selectedProduct = null;
    var container = document.getElementById('products-panel-content');
    if (!container) return;
    container.innerHTML = '<div class="section-body"><p class="muted">טוען...</p></div>';
    var self = this;
    this.fetchProducts().then(function(products) {
      self.renderGrid(products);
    }).catch(function(err) {
      showToast(err.message || 'שגיאת רשת', 'error');
      container.innerHTML = '<div class="section-body"><p class="muted">שגיאה בטעינת המוצרים</p></div>';
    });
  },

  renderGrid: function(products) {
    var self = this;
    var container = document.getElementById('products-panel-content');
    if (!container) return;

    var html = '<div class="section-body">';
    html += '<div class="products-header">';
    html += '<h2>📦 מוצרים</h2>';
    html += '<button class="btn btn-primary btn-sm" id="btn-products-new" style="margin-top:0;">+ מוצר חדש</button>';
    html += '</div>';

    if (!products || products.length === 0) {
      html += '<div class="products-empty">';
      html += '<div class="products-empty-icon">📦</div>';
      html += '<div class="products-empty-text">אין מוצרים רשומים עדיין.<br>לחץ על "+ מוצר חדש" כדי להתחיל.</div>';
      html += '<button class="btn btn-primary" id="btn-products-new-empty" style="margin-top:0;">+ מוצר חדש</button>';
      html += '</div>';
    } else {
      html += '<div class="products-grid">';
      products.forEach(function(p) {
        var rs = p.latestRiskScore || 0;
        var riskClass = rs > 30 ? 'risk-high' : rs > 10 ? 'risk-medium' : p.latestVersion ? 'risk-low' : 'risk-none';
        html += '<div class="product-card">';
        html += '<div class="product-card-accent ' + riskClass + '"></div>';
        html += '<div class="product-card-body">';
        html += '<div class="product-card-name" title="' + _esc(p.name || '') + '">' + _esc(p.name || '') + '</div>';
        html += '<div class="product-card-meta">';
        html += '<span>' + _esc(p.owner || '—') + '</span>';
        if (p.env) html += '<span>·</span><span class="env-badge">' + _esc(p.env) + '</span>';
        html += '</div>';
        html += '<div class="product-card-stats">';
        if (p.latestVersion) {
          html += '<span class="product-stat-chip version">v' + _esc(p.latestVersion) + '</span>';
          html += _riskInfoTooltip() + '<span class="product-stat-chip ' + riskClass + '">סיכון ' + rs + '</span>';
        } else {
          html += '<span class="product-stat-chip no-version">אין גרסאות</span>';
        }
        if (p.lastChecked) {
          html += '<span class="product-stat-chip no-version" style="margin-right:auto;">' + _esc(p.lastChecked.slice(0,10)) + '</span>';
        }
        html += '</div>';
        html += '</div>';
        html += '<div class="product-card-footer">';
        html += '<button class="btn btn-secondary" data-action="timeline" data-id="' + _esc(p.id) + '">📋 היסטוריה</button>';
        html += '<button class="btn btn-secondary" data-action="edit" data-id="' + _esc(p.id) + '">✏️ ערוך</button>';
        html += '<button class="btn btn-danger" data-action="delete" data-id="' + _esc(p.id) + '" data-name="' + _esc(p.name || '') + '">🗑</button>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;

    var newBtn = document.getElementById('btn-products-new');
    if (newBtn) newBtn.addEventListener('click', function() { self.showForm(null); });
    var newBtnEmpty = document.getElementById('btn-products-new-empty');
    if (newBtnEmpty) newBtnEmpty.addEventListener('click', function() { self.showForm(null); });

    container.querySelectorAll('[data-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = btn.getAttribute('data-action');
        var id = btn.getAttribute('data-id');
        if (action === 'timeline') { self._loadTimeline(id); }
        else if (action === 'edit') { self._loadProductAndEdit(id); }
        else if (action === 'delete') {
          var name = btn.getAttribute('data-name');
          styledConfirm('האם למחוק את המוצר "' + name + '" וכל גרסאותיו?', { title: 'מחיקת מוצר', danger: true, confirmText: 'מחק' }).then(function(confirmed) {
            if (!confirmed) return;
            fetch('/api/products/' + encodeURIComponent(id), { method: 'DELETE' })
              .then(function(r) {
                if (!r.ok) return r.json().then(function(b){ throw new Error(b.error||'שגיאה'); });
                self.showGrid();
              }).catch(function(err){ showToast(err.message, 'error'); });
          });
        }
      });
    });
  },

  _loadTimeline: function(productId) {
    var self = this;
    fetch('/api/products/' + encodeURIComponent(productId))
      .then(function(r){ if (!r.ok) throw new Error('Product not found'); return r.json(); })
      .then(function(product){ self.showTimeline(product); })
      .catch(function(err){ showToast(err.message || 'שגיאת רשת', 'error'); });
  },

  _loadProductAndEdit: function(productId) {
    var self = this;
    fetch('/api/products/' + encodeURIComponent(productId))
      .then(function(r){ return r.json(); })
      .then(function(product){ self.showForm(product); })
      .catch(function(err){ showToast(err.message || 'שגיאת רשת', 'error'); });
  },

  // ── Timeline View ─────────────────────────────────────────────────────────

  showTimeline: function(product) {
    this.currentView = 'timeline';
    this.selectedProduct = product;
    var container = document.getElementById('products-panel-content');
    if (!container) return;
    container.innerHTML = '<div class="section-body"><p class="muted">טוען גרסאות...</p></div>';
    var self = this;
    this.fetchVersions(product.id).then(function(versions) {
      self.renderTimeline(versions);
    }).catch(function(err) {
      showToast(err.message || 'שגיאת רשת', 'error');
    });
  },

  renderTimeline: function(versions) {
    var self = this;
    var product = this.selectedProduct;
    var container = document.getElementById('products-panel-content');
    if (!container) return;

    var html = '<div class="section-body">';

    // Header
    html += '<div class="timeline-header">';
    html += '<button class="btn btn-secondary btn-sm" id="btn-products-back" style="margin-top:0;">← חזור</button>';
    html += '<h2>📦 ' + _esc(product.name || '') + '</h2>';
    html += '</div>';

    // Action bar
    html += '<div class="timeline-actions">';
    html += '<button class="btn btn-primary btn-sm" id="btn-products-save-major" style="margin-top:0;">⬆ Major</button>';
    html += '<button class="btn btn-secondary btn-sm" id="btn-products-save-minor" style="margin-top:0;">↑ Minor</button>';
    html += '<button class="btn btn-secondary btn-sm" id="btn-products-new-check" style="margin-top:0;">🔍 בדיקה חדשה</button>';
    html += '</div>';

    // Inline save form
    html += '<div class="timeline-save-form" id="products-save-form">';
    html += '<div class="timeline-save-form-title" id="products-save-form-title">שמור גרסה</div>';
    html += '<textarea id="products-save-notes" maxlength="500" rows="2" placeholder="הערות גרסה (אופציונלי)..."></textarea>';
    html += '<div class="product-form-actions" style="margin-top:8px;">';
    html += '<button class="btn btn-primary btn-sm" id="btn-products-save-confirm" style="margin-top:0;">שמור</button>';
    html += '<button class="btn btn-secondary btn-sm" id="btn-products-save-cancel" style="margin-top:0;">ביטול</button>';
    html += '</div></div>';

    // Diff panel placeholder
    html += '<div id="products-diff-panel"></div>';

    // Version list
    if (!versions || versions.length === 0) {
      html += '<div class="products-empty" style="padding:40px 0;">';
      html += '<div class="products-empty-icon" style="font-size:36px;">📄</div>';
      html += '<div class="products-empty-text">אין גרסאות שמורות עדיין.<br>לחץ על "Major" או "Minor" כדי לשמור גרסה.</div>';
      html += '</div>';
    } else {
      html += '<div class="timeline-list">';
      versions.forEach(function(v) {
        var isDraft = v.status === 'draft';
        var statusClass = isDraft ? 'draft' : 'published';
        var statusLabel = isDraft ? 'DRAFT' : 'PUBLISHED';
        var rs = v.riskScore || 0;
        var riskClass = rs > 30 ? 'risk-high' : rs > 10 ? 'risk-medium' : 'risk-low';

        html += '<div class="version-row">';
        html += '<div class="version-row-strip ' + statusClass + '"></div>';
        html += '<div class="version-row-body">';
        html += '<div class="version-row-info">';
        html += '<div class="version-row-top">';
        html += '<span class="version-number">v' + _esc(v.version || '') + '</span>';
        html += '<span class="badge badge-' + statusClass + '">' + statusLabel + '</span>';
        html += _riskInfoTooltip() + '<span class="product-stat-chip ' + riskClass + '" style="font-size:10px;">סיכון ' + rs + '</span>';
        html += '</div>';
        if (v.versionNotes) html += '<div class="version-notes">' + _esc(v.versionNotes) + '</div>';
        html += '<div class="version-date">' + _esc((v.savedAt || '').replace('T', ' ').slice(0, 16)) + '</div>';
        html += '</div>';
        html += '<div class="version-row-actions">';
        html += '<button class="btn btn-secondary btn-sm" data-action="load" data-ver="' + _esc(v.version) + '" style="margin-top:0;" title="טען לעורך">טען</button>';
        html += '<button class="btn btn-secondary btn-sm" data-action="compare" data-ver="' + _esc(v.version) + '" style="margin-top:0;" title="השוואה">⇄</button>';
        html += '<button class="btn btn-secondary btn-sm" data-action="download" data-ver="' + _esc(v.version) + '" style="margin-top:0;" title="הורד JSON">⬇</button>';
        if (isDraft) {
          html += '<button class="btn btn-primary btn-sm" data-action="publish" data-ver="' + _esc(v.version) + '" style="margin-top:0;">פרסם</button>';
        }
        html += '<button class="btn btn-danger btn-sm" data-action="delver" data-ver="' + _esc(v.version) + '" style="margin-top:0;" title="מחק גרסה">🗑</button>';
        html += '</div>';
        html += '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;

    // Back button
    document.getElementById('btn-products-back').addEventListener('click', function(){ self.showGrid(); });

    // New check
    document.getElementById('btn-products-new-check').addEventListener('click', function(){
      self._newCheckWithPrefill(product);
    });

    // Inline save toggle
    var saveForm = document.getElementById('products-save-form');
    var savePendingType = null;
    document.getElementById('btn-products-save-major').addEventListener('click', function(){
      savePendingType = 'major';
      document.getElementById('products-save-form-title').textContent = '⬆ שמור גרסה ראשית (Major)';
      saveForm.classList.add('visible');
    });
    document.getElementById('btn-products-save-minor').addEventListener('click', function(){
      savePendingType = 'minor';
      document.getElementById('products-save-form-title').textContent = '↑ שמור תיקון קטן (Minor)';
      saveForm.classList.add('visible');
    });
    document.getElementById('btn-products-save-cancel').addEventListener('click', function(){
      saveForm.classList.remove('visible');
      savePendingType = null;
    });
    document.getElementById('btn-products-save-confirm').addEventListener('click', function(){
      var notes = document.getElementById('products-save-notes').value;
      saveAsVersion(product.id, savePendingType, notes).then(function(){
        saveForm.classList.remove('visible');
        self.showTimeline(product);
      }).catch(function(err){ showToast(err.message || 'שגיאת שמירה', 'error'); });
    });

    // Version row actions
    container.querySelectorAll('[data-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = btn.getAttribute('data-action');
        var ver = btn.getAttribute('data-ver');
        if (action === 'load') {
          self.fetchVersion(product.id, ver).then(function(data){
            try { applySnapshot(data); showToast('גרסה v' + ver + ' נטענה לעורך', 'success'); }
            catch(e){ showToast('שגיאה בטעינת הגרסה', 'error'); }
          }).catch(function(err){ showToast(err.message, 'error'); });
        } else if (action === 'compare') {
          self._compareFlow(versions, ver);
        } else if (action === 'download') {
          self._downloadVersion(product.id, ver);
        } else if (action === 'publish') {
          styledConfirm('לפרסם את גרסה v' + ver + '? לא ניתן לבטל.', { title: 'פרסום גרסה', confirmText: 'פרסם' }).then(function(confirmed) {
            if (!confirmed) return;
            fetch('/api/products/' + encodeURIComponent(product.id) + '/versions/' + encodeURIComponent(ver) + '/publish', { method: 'POST' })
              .then(function(r){ if (!r.ok) return r.json().then(function(b){ throw new Error(b.error||'שגיאה'); }); return r.json(); })
              .then(function(){ self.showTimeline(product); })
              .catch(function(err){ showToast(err.message, 'error'); });
          });
        } else if (action === 'delver') {
          styledConfirm('למחוק גרסה v' + ver + '?', { title: 'מחיקת גרסה', danger: true, confirmText: 'מחק' }).then(function(confirmed) {
            if (!confirmed) return;
            fetch('/api/products/' + encodeURIComponent(product.id) + '/versions/' + encodeURIComponent(ver), { method: 'DELETE' })
              .then(function(r){ if (!r.ok) return r.json().then(function(b){ throw new Error(b.error||'שגיאה'); }); return r.json(); })
              .then(function(){ self.showTimeline(product); })
              .catch(function(err){ showToast(err.message, 'error'); });
          });
        }
      });
    });
  },

  _downloadVersion: function(productId, ver) {
    var url = '/api/products/' + encodeURIComponent(productId) + '/versions/' + encodeURIComponent(ver);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'v' + ver + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  _newCheckWithPrefill: function(product) {
    var subs = product.subscriptionIds || [];
    if (subs.length > 0) {
      var el = document.getElementById('bulk-import-sub');
      if (el) el.value = subs[0];
    } else {
      showToast('אין Subscription IDs מוגדרים למוצר זה', 'warning');
    }
    try { switchToTab('tab-wizi'); }
    catch(e) { showToast('שגיאה במעבר לטאב Wiz Import', 'error'); }
  },

  // ── Diff ──────────────────────────────────────────────────────────────────

  _compareFlow: function(versions, baseVer) {
    var self = this;
    var container = document.getElementById('products-panel-content');
    // Build version picker
    var otherVersions = versions.filter(function(v){ return v.version !== baseVer; });
    if (otherVersions.length === 0) {
      showToast('אין גרסאות אחרות להשוואה', 'warning');
      return;
    }
    var opts = otherVersions.map(function(v){
      return '<option value="' + _esc(v.version) + '">v' + _esc(v.version) + ' (' + _esc(v.status) + ')</option>';
    }).join('');
    var picker = document.createElement('div');
    picker.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    picker.innerHTML = '<div style="background:var(--card-bg);border-radius:10px;padding:24px;min-width:300px;">'
      + '<h3 style="margin-top:0;">השוואה: v' + _esc(baseVer) + ' מול...</h3>'
      + '<select id="compare-target-select" style="width:100%;margin-bottom:12px;">' + opts + '</select>'
      + '<div style="display:flex;gap:8px;">'
      + '<button class="btn btn-primary btn-sm" id="btn-compare-confirm">השווה</button>'
      + '<button class="btn btn-secondary btn-sm" id="btn-compare-cancel">ביטול</button>'
      + '</div></div>';
    document.body.appendChild(picker);
    document.getElementById('btn-compare-cancel').addEventListener('click', function(){ document.body.removeChild(picker); });
    document.getElementById('btn-compare-confirm').addEventListener('click', function(){
      var targetVer = document.getElementById('compare-target-select').value;
      document.body.removeChild(picker);
      if (targetVer === baseVer) {
        var diffPanel = document.getElementById('products-diff-panel');
        if (diffPanel) { diffPanel.style.display = ''; diffPanel.innerHTML = '<div class="export-card" style="padding:12px;"><p>הגרסאות זהות.</p></div>'; }
        return;
      }
      Promise.all([
        self.fetchVersion(self.selectedProduct.id, baseVer),
        self.fetchVersion(self.selectedProduct.id, targetVer)
      ]).then(function(results){ self.renderDiff(results[0], results[1]); })
        .catch(function(err){ showToast(err.message || 'שגיאה בטעינת גרסאות', 'error'); });
    });
  },

  renderDiff: function(baseline, target) {
    var diff = computeDiff(baseline.findings || [], target.findings || []);
    var delta = computeRiskDelta(baseline, target);

    var bScore = (typeof baseline.riskScore === 'number') ? baseline.riskScore : 'N/A';
    var tScore = (typeof target.riskScore === 'number') ? target.riskScore : 'N/A';
    var deltaStr = delta !== null ? (delta > 0 ? '+' + delta : '' + delta) : 'N/A';
    var deltaColor = delta === null ? '' : delta > 0 ? 'color:oklch(0.58 0.22 15)' : delta < 0 ? 'color:oklch(0.62 0.17 155)' : '';

    var html = '<div class="diff-panel">';
    html += '<div class="diff-summary">';
    html += '<div class="diff-summary-title">⇄ השוואה: v' + _esc(baseline.version||'') + ' → v' + _esc(target.version||'') + '</div>';
    html += _riskInfoTooltip() + '<div class="diff-risk-delta" style="' + deltaColor + '">סיכון: ' + bScore + ' → ' + tScore + ' (' + deltaStr + ')</div>';
    html += '</div>';

    if (diff.added.length === 0 && diff.resolved.length === 0 && diff.changed.length === 0) {
      html += '<div class="muted" style="text-align:center;padding:12px 0;">לא נמצאו שינויים בממצאים</div>';
    } else {
      diff.added.forEach(function(f){
        html += '<div class="diff-row added"><span class="diff-badge added">חדש</span><span>' + _esc(f.id||'') + '</span><span class="muted" style="flex:1;">— ' + _esc(f.title||'') + '</span></div>';
      });
      diff.resolved.forEach(function(f){
        html += '<div class="diff-row resolved"><span class="diff-badge resolved">נסגר</span><span>' + _esc(f.id||'') + '</span><span class="muted" style="flex:1;">— ' + _esc(f.title||'') + '</span></div>';
      });
      diff.changed.forEach(function(c){
        html += '<div class="diff-row changed"><span class="diff-badge changed">שינוי</span><span>' + _esc(c.after.id||'') + '</span><span class="muted" style="flex:1;">— ' + _esc(c.before.severity||'') + ' → ' + _esc(c.after.severity||'') + '</span></div>';
      });
    }
    html += '</div>';

    var diffPanel = document.getElementById('products-diff-panel');
    if (diffPanel) { diffPanel.innerHTML = html; }
  },

  // ── Create / Edit Form ───────────────────────────────────────────────────

  showForm: function(product) {
    this.currentView = 'form';
    var self = this;
    var container = document.getElementById('products-panel-content');
    if (!container) return;

    var isEdit = !!(product && product.id);
    var p = product || {};

    var html = '<div class="section-body">';
    html += '<div class="timeline-header">';
    html += '<button class="btn btn-secondary btn-sm" id="btn-form-back" style="margin-top:0;">← חזור</button>';
    html += '<h2>' + (isEdit ? '✏️ עריכת מוצר' : '📦 מוצר חדש') + '</h2>';
    html += '</div>';

    html += '<div style="max-width:560px;">';
    html += '<div class="product-form-grid">';

    html += '<div class="form-field"><label for="pf-name">שם מוצר *</label>';
    html += '<input type="text" id="pf-name" maxlength="100" value="' + _esc(p.name||'') + '" placeholder="לדוגמה: ERP System">';
    html += '<span id="pf-name-err" style="font-size:11px;color:var(--danger);display:none;"></span></div>';

    html += '<div class="form-field"><label for="pf-owner">איש קשר</label>';
    html += '<input type="text" id="pf-owner" maxlength="100" value="' + _esc(p.owner||'') + '" placeholder="שם הבעלים"></div>';

    html += '<div class="form-field"><label for="pf-email">אימייל</label>';
    html += '<input type="text" id="pf-email" maxlength="254" value="' + _esc(p.ownerEmail||'') + '" placeholder="owner@example.com">';
    html += '<span id="pf-email-err" style="font-size:11px;color:var(--danger);display:none;"></span></div>';

    html += '<div class="form-field"><label for="pf-env">סביבה</label>';
    html += '<input type="text" id="pf-env" maxlength="100" value="' + _esc(p.env||'') + '" placeholder="AWS Production"></div>';

    var subsVal = (p.subscriptionIds || []).join(', ');
    html += '<div class="form-field product-form-grid-wide"><label for="pf-subs">Subscription IDs <span class="muted" style="font-weight:400;">(מופרדים בפסיק)</span></label>';
    html += '<input type="text" id="pf-subs" value="' + _esc(subsVal) + '" placeholder="sub-001, sub-002"></div>';

    html += '</div>';
    html += '<div class="product-form-actions">';
    html += '<button class="btn btn-primary" id="btn-pf-save" style="margin-top:0;">שמור מוצר</button>';
    html += '<button class="btn btn-secondary" id="btn-pf-cancel" style="margin-top:0;">ביטול</button>';
    html += '</div>';
    html += '</div></div>';
    container.innerHTML = html;

    document.getElementById('btn-form-back').addEventListener('click', function(){ self.showGrid(); });
    document.getElementById('btn-pf-cancel').addEventListener('click', function(){ self.showGrid(); });

    document.getElementById('btn-pf-save').addEventListener('click', function(){
      var name = document.getElementById('pf-name').value.trim();
      var email = document.getElementById('pf-email').value.trim();
      var nameErr = document.getElementById('pf-name-err');
      var emailErr = document.getElementById('pf-email-err');
      nameErr.style.display = 'none';
      emailErr.style.display = 'none';

      if (!name) {
        nameErr.textContent = 'שם המוצר הוא שדה חובה';
        nameErr.style.display = '';
        return;
      }
      if (email && !email.includes('@')) {
        emailErr.textContent = 'כתובת אימייל אינה תקינה';
        emailErr.style.display = '';
        return;
      }

      var subsRaw = document.getElementById('pf-subs').value;
      var subs = subsRaw.split(',').map(function(s){ return s.trim(); }).filter(Boolean);

      var payload = {
        name: name,
        owner: document.getElementById('pf-owner').value.trim(),
        ownerEmail: email,
        env: document.getElementById('pf-env').value.trim(),
        subscriptionIds: subs.length ? subs : ['']
      };

      var url = isEdit ? '/api/products/' + encodeURIComponent(p.id) : '/api/products';
      var method = isEdit ? 'PUT' : 'POST';

      fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function(r){
          if (!r.ok) return r.json().then(function(b){ throw new Error(b.error||'שגיאה'); });
          return r.json();
        })
        .then(function(){ self.showGrid(); })
        .catch(function(err){ showToast(err.message, 'error'); });
    });
  },

  // ── Export panel shortcut ────────────────────────────────────────────────

  _exportShortcutFlow: function() {
    var self = this;
    fetch('/api/products')
      .then(function(r){ return r.json(); })
      .then(function(products){
        if (!products || products.length === 0) {
          showToast('אין מוצרים רשומים', 'error');
          return;
        }
        self._showProductPicker(products);
      })
      .catch(function(){ showToast('שגיאה בטעינת המוצרים', 'error'); });
  },

  _showProductPicker: function(products) {
    var self = this;
    var opts = products.map(function(p){
      return '<option value="' + _esc(p.id) + '">' + _esc(p.name||p.id) + '</option>';
    }).join('');

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = '<div style="background:var(--card-bg);border-radius:10px;padding:24px;min-width:340px;max-width:420px;">'
      + '<h3 style="margin-top:0;">שמור כגרסת מוצר</h3>'
      + '<div style="margin-bottom:10px;"><label>מוצר:</label><select id="picker-product" style="width:100%;margin-top:4px;"><option value="">-- בחר מוצר --</option>' + opts + '</select></div>'
      + '<div id="picker-type-area" style="margin-bottom:10px;"><p class="muted" style="margin:6px 0 0;">בחר מוצר כדי להמשיך…</p></div>'
      + '<div style="margin-bottom:12px;"><label>הערות:</label><textarea id="picker-notes" rows="2" maxlength="500" style="width:100%;box-sizing:border-box;margin-top:4px;"></textarea></div>'
      + '<div style="display:flex;gap:8px;">'
      + '<button class="btn btn-primary btn-sm" id="btn-picker-confirm" disabled>שמור</button>'
      + '<button class="btn btn-secondary btn-sm" id="btn-picker-cancel">ביטול</button>'
      + '</div></div>';
    document.body.appendChild(modal);

    var confirmBtn = document.getElementById('btn-picker-confirm');
    var typeArea = document.getElementById('picker-type-area');

    function renderTypeArea(latestVer, status) {
      var html = '';
      if (!latestVer) {
        html += '<label>סוג גרסה:</label>';
        html += '<select id="picker-type" style="width:100%;margin-top:4px;">'
              + '<option value="minor">תיקון קטן (Minor)</option>'
              + '<option value="major">גרסה חדשה (Major)</option>'
              + '</select>';
        html += '<p class="muted" style="margin:6px 0 0;font-size:0.85em;">מוצר חדש — תיווצר גרסה v1.0</p>';
      } else if (status === 'draft') {
        html += '<label>סוג גרסה:</label>';
        html += '<select id="picker-type" style="width:100%;margin-top:4px;">'
              + '<option value="draft" selected>עדכן טיוטה (v' + _esc(latestVer) + ')</option>'
              + '</select>';
        html += '<p class="muted" style="margin:6px 0 0;font-size:0.85em;">טיוטה קיימת — שמירה תעדכן אותה. ליצירת גרסה חדשה יש לפרסם תחילה.</p>';
      } else {
        html += '<label>סוג גרסה:</label>';
        html += '<select id="picker-type" style="width:100%;margin-top:4px;">'
              + '<option value="minor">תיקון קטן (Minor)</option>'
              + '<option value="major">גרסה חדשה (Major)</option>'
              + '</select>';
        html += '<p class="muted" style="margin:6px 0 0;font-size:0.85em;">גרסה אחרונה: v' + _esc(latestVer) + ' (פורסם)</p>';
      }
      typeArea.innerHTML = html;
    }

    document.getElementById('picker-product').addEventListener('change', function(){
      var productId = this.value;
      if (!productId) {
        confirmBtn.disabled = true;
        typeArea.innerHTML = '<p class="muted" style="margin:6px 0 0;">בחר מוצר כדי להמשיך…</p>';
        return;
      }
      confirmBtn.disabled = true;
      typeArea.innerHTML = '<p class="muted" style="margin:6px 0 0;">טוען גרסאות…</p>';
      self.fetchVersions(productId).then(function(versions){
        // versions are sorted savedAt-desc by the server; pick the highest by (major,minor)
        var latest = null;
        (versions || []).forEach(function(v){
          if (!v || !v.version) return;
          var parts = String(v.version).split('.');
          if (parts.length !== 2) return;
          var key = [parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0];
          if (!latest || key[0] > latest._k[0] || (key[0] === latest._k[0] && key[1] > latest._k[1])) {
            latest = { version: v.version, status: v.status, _k: key };
          }
        });
        renderTypeArea(latest && latest.version, latest && latest.status);
        confirmBtn.disabled = false;
      }).catch(function(){
        // Fail-soft: fall back to minor/major picker so the modal isn't blocked
        renderTypeArea(null, null);
        confirmBtn.disabled = false;
      });
    });
    document.getElementById('btn-picker-cancel').addEventListener('click', function(){ document.body.removeChild(modal); });
    confirmBtn.addEventListener('click', function(){
      var productId = document.getElementById('picker-product').value;
      var typeEl = document.getElementById('picker-type');
      var versionType = typeEl ? typeEl.value : 'minor';
      var notes = document.getElementById('picker-notes').value;
      saveAsVersion(productId, versionType, notes)
        .then(function(){ document.body.removeChild(modal); })
        .catch(function(err){ showToast(err.message || 'שגיאת שמירה', 'error'); });
    });
  }

}; // end ProductsPanel

// ---------------------------------------------------------------------------
// saveAsVersion — exposed to IIFE scope (called by export shortcut)
// ---------------------------------------------------------------------------

export async function saveAsVersion(productId, versionType, notes) {
  var snapshot;
  try {
    snapshot = buildSnapshot();
  } catch(e) {
    showToast('שגיאה ביצירת ה-Snapshot', 'error');
    throw e;
  }
  if (!snapshot) {
    showToast('לא ניתן ליצור Snapshot', 'error');
    throw new Error('snapshot is null');
  }

  var resp = await fetch('/api/products/' + encodeURIComponent(productId) + '/versions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: versionType || 'minor', notes: notes || '', snapshot: snapshot })
  });

  if (!resp.ok) {
    var b = await resp.json().catch(function(){ return {}; });
    var msg = b.error || 'שגיאה בשמירת הגרסה';
    showToast(msg, 'error');
    throw new Error(msg);
  }

  var result = await resp.json();
  showToast('גרסה v' + result.version + ' נשמרה בהצלחה', 'success');
  return result;
}

// Helper: escape HTML
function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Helper: risk score info tooltip HTML — renders a single ⓘ button;
// the actual tooltip is shown/hidden via _initRiskTooltip() which
// appends a single global element to document.body (never clipped).
function _riskInfoTooltip() {
  return '<i class="risk-info-btn" data-risk-info="1">ⓘ</i>';
}

// Single global tooltip element — created once, positioned on demand.
var _riskTooltipEl = null;
function _initRiskTooltip() {
  if (_riskTooltipEl) return;
  _riskTooltipEl = document.createElement('div');
  _riskTooltipEl.id = 'risk-info-tooltip-global';
  _riskTooltipEl.innerHTML =
    '<div class="risk-info-tooltip-title">🔢 חישוב ציון סיכון</div>'
    + '<div class="risk-info-tooltip-formula">'
    + 'קריטי 1 = 4 נק׳<br>גבוה 1 &nbsp;&nbsp;&nbsp;= 3 נק׳<br>בינוני 1 = 2 נק׳<br>נמוך 1 &nbsp;&nbsp;&nbsp;= 1 נק׳'
    + '</div>'
    + '<div class="risk-info-tooltip-levels">'
    + '<div class="risk-info-level"><span class="risk-info-dot" style="background:oklch(0.62 0.17 155);"></span>0 – 10 &nbsp;&nbsp;סיכון נמוך</div>'
    + '<div class="risk-info-level"><span class="risk-info-dot" style="background:oklch(0.72 0.16 60);"></span>11 – 30 &nbsp;סיכון בינוני</div>'
    + '<div class="risk-info-level"><span class="risk-info-dot" style="background:oklch(0.58 0.22 15);"></span>31+ &nbsp;&nbsp;&nbsp;&nbsp;סיכון גבוה</div>'
    + '</div>'
    + '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);font-size:10px;color:var(--text-dim);">ממצאים מוחרגים אינם נספרים בציון.</div>';
  document.body.appendChild(_riskTooltipEl);

  document.addEventListener('mouseover', function(e) {
    var btn = e.target.closest('[data-risk-info]');
    if (!btn) return;
    var rect = btn.getBoundingClientRect();
    var tip = _riskTooltipEl;
    tip.style.display = 'block';
    // Position above the button; flip below if not enough space
    var tipH = tip.offsetHeight || 160;
    var top = rect.top - tipH - 8;
    if (top < 8) top = rect.bottom + 8; // flip below
    var right = window.innerWidth - rect.right;
    // Don't go off left edge
    var left = rect.right - 220;
    if (left < 8) left = 8;
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
    tip.style.right = 'auto';
  });

  document.addEventListener('mouseout', function(e) {
    if (e.target.closest('[data-risk-info]') && !e.relatedTarget?.closest('[data-risk-info]')) {
      _riskTooltipEl.style.display = 'none';
    }
  });

  // Also hide when mouse moves away completely
  document.addEventListener('mousemove', function(e) {
    if (!e.target.closest('[data-risk-info]') && _riskTooltipEl.style.display === 'block') {
      _riskTooltipEl.style.display = 'none';
    }
  });
}

// Wire up ProductsPanel on load
ProductsPanel.init();
