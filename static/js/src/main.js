// Entry point — imports trigger all module-level initialization
import './state.js';
import './core.js';
import './ui.js';
import './findings.js';
import './products.js';
import './export.js';
import './wizi.js';
import './pipeline.js';
import './exceptions.js';
import { ExcludeRulesPanel } from './exclude_rules.js';
import { getLang, setLang } from './i18n.js';

ExcludeRulesPanel.init();

// Restore saved UI language on page load
setLang(getLang());

// Wire lang toggle button
var langToggleBtn = document.getElementById('btn-lang-toggle');
if (langToggleBtn) {
  langToggleBtn.addEventListener('click', function() {
    setLang(getLang() === 'he' ? 'en' : 'he');
  });
}

// Auth: show current user in sidebar
(function initUserInfo() {
  fetch('/api/me')
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data || !data.oauth_enabled || !data.authenticated) return;
      var el = document.getElementById('sidebar-user');
      var emailEl = document.getElementById('sidebar-user-email');
      if (!el || !emailEl) return;
      emailEl.textContent = data.email || '';
      emailEl.title = (data.email || '') + ' (' + (data.role || '') + ')';
      el.style.display = 'flex';
      if (data.role === 'admin') {
        var adminBtn = document.getElementById('sidebar-admin-btn');
        if (adminBtn) adminBtn.style.display = '';
      }
    })
    .catch(function() {});
})();
