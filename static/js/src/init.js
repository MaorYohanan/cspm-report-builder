      // ── Auth: show current user in sidebar ──
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

    })();
