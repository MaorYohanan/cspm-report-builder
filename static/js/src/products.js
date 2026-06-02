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

var ProductsPanel = {
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
    var tabBtn = document.getElementById('tab-products');
    if (tabBtn) {
      tabBtn.addEventListener('click', function() {
        self.showGrid();
      });
    }
    // Export panel shortcut
    var saveBtn = document.getElementById('btn-save-as-version');
    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        self._exportShortcutFlow();
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
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<h2 style="margin:0;">📦 מוצרים</h2>';
    html += '<button class="btn btn-primary" id="btn-products-new">+ מוצר חדש</button>';
    html += '</div>';

    if (!products || products.length === 0) {
      html += '<p class="muted" style="text-align:center;padding:40px 0;">אין מוצרים רשומים. לחץ על "+ מוצר חדש" להוספה.</p>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">';
      products.forEach(function(p) {
        var riskClass = 'badge-success';
        var rs = p.latestRiskScore || 0;
        if (rs > 30) riskClass = 'badge-danger';
        else if (rs > 10) riskClass = 'badge-warning';
        html += '<div class="export-card" style="position:relative;">';
        html += '<div class="export-card-header" style="font-size:15px;">' + _esc(p.name || '') + '</div>';
        html += '<div class="export-card-body" style="font-size:13px;">';
        html += '<div><span class="muted">בעלים:</span> ' + _esc(p.owner || '—') + '</div>';
        html += '<div><span class="badge badge-secondary">' + _esc(p.env || '') + '</span></div>';
        if (p.latestVersion) {
          html += '<div style="margin-top:6px;"><span class="badge badge-primary">v' + _esc(p.latestVersion) + '</span> ';
          html += '<span class="badge ' + riskClass + '">סיכון: ' + rs + '</span></div>';
        } else {
          html += '<div style="margin-top:6px;"><span class="muted small-text">אין גרסאות</span></div>';
        }
        if (p.lastChecked) {
          html += '<div class="muted small-text" style="margin-top:4px;">עדכון אחרון: ' + _esc(p.lastChecked.slice(0,10)) + '</div>';
        }
        html += '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">';
        html += '<button class="btn btn-secondary btn-sm" data-action="timeline" data-id="' + _esc(p.id) + '">פתח היסטוריה</button>';
        html += '<button class="btn btn-secondary btn-sm" data-action="edit" data-id="' + _esc(p.id) + '">ערוך</button>';
        html += '<button class="btn btn-danger btn-sm" data-action="delete" data-id="' + _esc(p.id) + '" data-name="' + _esc(p.name || '') + '">מחק</button>';
        html += '</div>';
        html += '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;

    var newBtn = document.getElementById('btn-products-new');
    if (newBtn) newBtn.addEventListener('click', function() { self.showForm(null); });

    container.querySelectorAll('[data-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = btn.getAttribute('data-action');
        var id = btn.getAttribute('data-id');
        var product = (products || []).find(function(p){ return p.id === id; });
        if (action === 'timeline') { self._loadTimeline(id); }
        else if (action === 'edit') { self._loadProductAndEdit(id); }
        else if (action === 'delete') {
          var name = btn.getAttribute('data-name');
          styledConfirm('מחיקת מוצר', 'האם למחוק את המוצר "' + name + '"?', function() {
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
      .then(function(r){ return r.json(); })
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
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">';
    html += '<button class="btn btn-secondary btn-sm" id="btn-products-back">← חזור</button>';
    html += '<h2 style="margin:0;">📦 ' + _esc(product.name || '') + ' — היסטוריה</h2>';
    html += '</div>';

    // New check button
    html += '<div style="margin-bottom:12px;display:flex;gap:8px;">';
    html += '<button class="btn btn-secondary btn-sm" id="btn-products-new-check">🔍 בדיקה חדשה</button>';
    html += '</div>';

    // Inline save form (hidden initially)
    html += '<div id="products-save-form" style="display:none;background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px;">';
    html += '<div style="margin-bottom:8px;font-weight:600;" id="products-save-form-title">שמור גרסה</div>';
    html += '<textarea id="products-save-notes" maxlength="500" rows="2" placeholder="הערות גרסה..." style="width:100%;box-sizing:border-box;"></textarea>';
    html += '<div style="margin-top:8px;display:flex;gap:6px;">';
    html += '<button class="btn btn-primary btn-sm" id="btn-products-save-confirm">שמור</button>';
    html += '<button class="btn btn-secondary btn-sm" id="btn-products-save-cancel">ביטול</button>';
    html += '</div></div>';

    // Save buttons
    html += '<div style="margin-bottom:16px;display:flex;gap:8px;">';
    html += '<button class="btn btn-primary btn-sm" id="btn-products-save-major">שמור גרסה חדשה (Major)</button>';
    html += '<button class="btn btn-secondary btn-sm" id="btn-products-save-minor">שמור תיקון קטן (Minor)</button>';
    html += '</div>';

    if (!versions || versions.length === 0) {
      html += '<p class="muted">אין גרסאות שמורות.</p>';
    } else {
      html += '<div id="products-diff-panel" style="display:none;"></div>';
      html += '<div style="display:flex;flex-direction:column;gap:10px;" id="products-version-list">';
      versions.forEach(function(v) {
        var statusBadge = v.status === 'published'
          ? '<span class="badge badge-success">PUBLISHED</span>'
          : '<span class="badge badge-warning">DRAFT</span>';
        html += '<div class="export-card" style="padding:10px 14px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">';
        html += '<div style="font-weight:600;">v' + _esc(v.version || '') + ' ' + statusBadge + '</div>';
        html += '<div class="muted small-text">' + _esc((v.savedAt||'').slice(0,10)) + '</div>';
        html += '</div>';
        if (v.versionNotes) html += '<div style="margin-top:4px;font-size:13px;">' + _esc(v.versionNotes) + '</div>';
        html += '<div style="margin-top:4px;" class="muted small-text">סיכון: ' + (v.riskScore||0) + '</div>';
        html += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">';
        html += '<button class="btn btn-secondary btn-sm" data-action="load" data-ver="' + _esc(v.version) + '">טען לעורך</button>';
        html += '<button class="btn btn-secondary btn-sm" data-action="compare" data-ver="' + _esc(v.version) + '">השוואה</button>';
        html += '<button class="btn btn-secondary btn-sm" data-action="download" data-ver="' + _esc(v.version) + '">הורד</button>';
        if (v.status === 'draft') {
          html += '<button class="btn btn-primary btn-sm" data-action="publish" data-ver="' + _esc(v.version) + '">פרסם</button>';
          html += '<button class="btn btn-danger btn-sm" data-action="delver" data-ver="' + _esc(v.version) + '">מחק</button>';
        }
        html += '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;

    // Back button
    document.getElementById('btn-products-back').addEventListener('click', function(){ self.showGrid(); });

    // New check (Wiz pre-fill)
    document.getElementById('btn-products-new-check').addEventListener('click', function(){
      self._newCheckWithPrefill(product);
    });

    // Inline save toggle
    var saveForm = document.getElementById('products-save-form');
    var savePendingType = null;
    document.getElementById('btn-products-save-major').addEventListener('click', function(){
      savePendingType = 'major';
      document.getElementById('products-save-form-title').textContent = 'שמור גרסה חדשה (Major)';
      saveForm.style.display = '';
    });
    document.getElementById('btn-products-save-minor').addEventListener('click', function(){
      savePendingType = 'minor';
      document.getElementById('products-save-form-title').textContent = 'שמור תיקון קטן (Minor)';
      saveForm.style.display = '';
    });
    document.getElementById('btn-products-save-cancel').addEventListener('click', function(){
      saveForm.style.display = 'none';
      savePendingType = null;
    });
    document.getElementById('btn-products-save-confirm').addEventListener('click', function(){
      var notes = document.getElementById('products-save-notes').value;
      saveAsVersion(product.id, savePendingType, notes).then(function(){
        saveForm.style.display = 'none';
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
            try { applySnapshot(data); showToast('גרסה ' + ver + ' נטענה לעורך', 'success'); }
            catch(e){ showToast('שגיאה בטעינת הגרסה', 'error'); }
          }).catch(function(err){ showToast(err.message, 'error'); });
        } else if (action === 'compare') {
          self._compareFlow(versions, ver);
        } else if (action === 'download') {
          self._downloadVersion(product.id, ver);
        } else if (action === 'publish') {
          styledConfirm('פרסום גרסה', 'לפרסם את גרסה v' + ver + '? לא ניתן לבטל.', function(){
            fetch('/api/products/' + encodeURIComponent(product.id) + '/versions/' + encodeURIComponent(ver) + '/publish', { method: 'POST' })
              .then(function(r){ if (!r.ok) return r.json().then(function(b){ throw new Error(b.error||'שגיאה'); }); return r.json(); })
              .then(function(){ self.showTimeline(product); })
              .catch(function(err){ showToast(err.message, 'error'); });
          });
        } else if (action === 'delver') {
          styledConfirm('מחיקת גרסה', 'למחוק גרסה v' + ver + '?', function(){
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

    var html = '<div class="export-card" style="padding:12px;margin-bottom:14px;">';
    html += '<h3 style="margin-top:0;">השוואה: v' + _esc(baseline.version||'') + ' → v' + _esc(target.version||'') + '</h3>';

    // Risk delta
    var bScore = (typeof baseline.riskScore === 'number') ? baseline.riskScore : 'N/A';
    var tScore = (typeof target.riskScore === 'number') ? target.riskScore : 'N/A';
    var deltaStr = delta !== null ? (delta >= 0 ? '+' + delta : '' + delta) : 'N/A';
    html += '<div style="margin-bottom:10px;font-weight:600;">סיכון: ' + bScore + ' → ' + tScore + ', ' + deltaStr + '</div>';

    if (diff.added.length === 0 && diff.resolved.length === 0 && diff.changed.length === 0) {
      html += '<p class="muted">לא נמצאו שינויים בממצאים.</p>';
    } else {
      diff.added.forEach(function(f){
        html += '<div style="border-right:3px solid #4caf50;padding:4px 8px;margin-bottom:4px;">'
          + '<span class="badge badge-success">חדש</span> ' + _esc(f.id||'') + ' — ' + _esc(f.title||'') + '</div>';
      });
      diff.resolved.forEach(function(f){
        html += '<div style="border-right:3px solid #f44336;padding:4px 8px;margin-bottom:4px;">'
          + '<span class="badge badge-danger">נסגר</span> ' + _esc(f.id||'') + ' — ' + _esc(f.title||'') + '</div>';
      });
      diff.changed.forEach(function(c){
        html += '<div style="border-right:3px solid #ff9800;padding:4px 8px;margin-bottom:4px;">'
          + '<span class="badge badge-warning">שינוי</span> ' + _esc(c.after.id||'') + ' — '
          + _esc(c.before.severity||'') + ' → ' + _esc(c.after.severity||'') + '</div>';
      });
    }
    html += '</div>';

    var diffPanel = document.getElementById('products-diff-panel');
    if (diffPanel) { diffPanel.style.display = ''; diffPanel.innerHTML = html; }
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
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">';
    html += '<button class="btn btn-secondary btn-sm" id="btn-form-back">← חזור</button>';
    html += '<h2 style="margin:0;">' + (isEdit ? 'עריכת מוצר' : 'מוצר חדש') + '</h2>';
    html += '</div>';
    html += '<div style="max-width:520px;display:flex;flex-direction:column;gap:12px;">';

    // Name
    html += '<div class="form-field"><label for="pf-name">שם מוצר *</label>';
    html += '<input type="text" id="pf-name" maxlength="100" value="' + _esc(p.name||'') + '" placeholder="לדוגמה: ERP System">';
    html += '<span class="muted small-text" id="pf-name-err" style="color:var(--danger-color);display:none;"></span></div>';

    // Owner
    html += '<div class="form-field"><label for="pf-owner">איש קשר</label>';
    html += '<input type="text" id="pf-owner" maxlength="100" value="' + _esc(p.owner||'') + '"></div>';

    // Email
    html += '<div class="form-field"><label for="pf-email">אימייל</label>';
    html += '<input type="text" id="pf-email" maxlength="254" value="' + _esc(p.ownerEmail||'') + '">';
    html += '<span class="muted small-text" id="pf-email-err" style="color:var(--danger-color);display:none;"></span></div>';

    // Env
    html += '<div class="form-field"><label for="pf-env">סביבה</label>';
    html += '<input type="text" id="pf-env" maxlength="100" value="' + _esc(p.env||'') + '"></div>';

    // Subscription IDs
    var subsVal = (p.subscriptionIds || []).join(', ');
    html += '<div class="form-field"><label for="pf-subs">Subscription IDs (מופרדים בפסיק)</label>';
    html += '<input type="text" id="pf-subs" value="' + _esc(subsVal) + '" placeholder="sub-001, sub-002"></div>';

    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn btn-primary" id="btn-pf-save">שמור מוצר</button>';
    html += '<button class="btn btn-secondary" id="btn-pf-cancel">ביטול</button>';
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
    modal.innerHTML = '<div style="background:var(--card-bg);border-radius:10px;padding:24px;min-width:320px;">'
      + '<h3 style="margin-top:0;">שמור כגרסת מוצר</h3>'
      + '<div style="margin-bottom:10px;"><label>מוצר:</label><select id="picker-product" style="width:100%;margin-top:4px;"><option value="">-- בחר מוצר --</option>' + opts + '</select></div>'
      + '<div style="margin-bottom:10px;"><label>סוג גרסה:</label><select id="picker-type" style="width:100%;margin-top:4px;"><option value="minor">תיקון קטן (Minor)</option><option value="major">גרסה חדשה (Major)</option></select></div>'
      + '<div style="margin-bottom:12px;"><label>הערות:</label><textarea id="picker-notes" rows="2" maxlength="500" style="width:100%;box-sizing:border-box;margin-top:4px;"></textarea></div>'
      + '<div style="display:flex;gap:8px;">'
      + '<button class="btn btn-primary btn-sm" id="btn-picker-confirm" disabled>שמור</button>'
      + '<button class="btn btn-secondary btn-sm" id="btn-picker-cancel">ביטול</button>'
      + '</div></div>';
    document.body.appendChild(modal);

    var confirmBtn = document.getElementById('btn-picker-confirm');
    document.getElementById('picker-product').addEventListener('change', function(){
      confirmBtn.disabled = !this.value;
    });
    document.getElementById('btn-picker-cancel').addEventListener('click', function(){ document.body.removeChild(modal); });
    confirmBtn.addEventListener('click', function(){
      var productId = document.getElementById('picker-product').value;
      var versionType = document.getElementById('picker-type').value;
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

async function saveAsVersion(productId, versionType, notes) {
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
