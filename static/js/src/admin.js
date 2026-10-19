document.addEventListener('DOMContentLoaded', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Constants
  // ──────────────────────────────────────────────────────────────────────────

  const ROLE_LABELS = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

  const CATEGORY_LABELS = {
    CSPM: 'CSPM', KSPM: 'KSPM', DSPM: 'DSPM', VULN: 'VULN',
    NEXP: 'NEXP', EAPM: 'EAPM', HSPM: 'HSPM', SECR: 'SECR', EOLM: 'EOLM'
  };

  const SEVERITY_LABELS = {
    critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low'
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Helper Functions
  // ──────────────────────────────────────────────────────────────────────────

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function setMsg(msg, isError) {
    document.getElementById('status-msg').textContent = isError ? '' : msg;
    document.getElementById('error-msg').textContent  = isError ? msg : '';
  }

  function setTplMsg(msg, isError) {
    document.getElementById('tpl-status-msg').textContent = isError ? '' : msg;
    document.getElementById('tpl-error-msg').textContent  = isError ? msg : '';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // User Management
  // ──────────────────────────────────────────────────────────────────────────

  async function loadUsers() {
    const res = await fetch('/api/users');
    if (!res.ok) {
      document.getElementById('users-container').innerHTML = '<div class="empty-state">שגיאה בטעינת משתמשים</div>';
      return;
    }
    const users = await res.json();
    renderUsers(users);
  }

  function renderUsers(users) {
    const el = document.getElementById('users-container');
    if (!users.length) {
      el.innerHTML = '<div class="empty-state">אין משתמשים עדיין</div>';
      return;
    }
    const rows = users.map(u => `
      <tr>
        <td>${escHtml(u.email)}</td>
        <td><span class="role-badge role-${u.role}">${ROLE_LABELS[u.role] || u.role}</span></td>
        <td>
          <select data-action="change-role" data-id="${u.id}">
            ${['viewer','editor','admin'].map(r => `<option value="${r}"${r===u.role?' selected':''}>${ROLE_LABELS[r]}</option>`).join('')}
          </select>
        </td>
        <td><button class="btn btn-danger" data-action="delete-user" data-id="${u.id}">הסר</button></td>
      </tr>
    `).join('');
    el.innerHTML = `<table><thead><tr><th>אימייל</th><th>תפקיד</th><th>שינוי תפקיד</th><th>פעולות</th></tr></thead><tbody id="users-tbody">${rows}</tbody></table>`;
  }

  async function addUser() {
    const email = document.getElementById('new-email').value.trim();
    const role  = document.getElementById('new-role').value;
    if (!email) {
      setMsg('נא להזין כתובת אימייל', true);
      return;
    }
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email, role})
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || 'שגיאה', true);
      return;
    }
    setMsg('המשתמש נוסף בהצלחה', false);
    document.getElementById('new-email').value = '';
    loadUsers();
  }

  async function changeRole(userId, newRole) {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({role: newRole})
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || 'שגיאה', true);
      loadUsers();
      return;
    }
    setMsg('התפקיד עודכן', false);
  }

  async function deleteUser(uid) {
    const { styledConfirm } = await import('/static/js/src/core.js');
    const yes = await styledConfirm('האם למחוק משתמש זה?', {
      title: 'מחיקת משתמש',
      danger: true,
      confirmText: 'מחק'
    });
    if (!yes) return;

    const res  = await fetch(`/api/users/${uid}`, {method: 'DELETE'});
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || 'שגיאה', true);
      return;
    }
    setMsg('המשתמש הוסר', false);
    loadUsers();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Template Management
  // ──────────────────────────────────────────────────────────────────────────

  let editingTemplateId = null;
  let originalTemplateData = null;

  async function loadTemplates() {
    const res = await fetch('/api/admin/templates');
    if (!res.ok) {
      document.getElementById('templates-container').innerHTML = '<div class="empty-state">שגיאה בטעינת תבניות</div>';
      return;
    }
    const templates = await res.json();
    renderTemplates(templates);
  }

  function renderTemplates(templates) {
    const el = document.getElementById('templates-container');
    if (!templates.length) {
      el.innerHTML = '<div class="empty-state">אין תבניות עדיין</div>';
      return;
    }
    const rows = templates.map(t => `
      <tr data-tid="${t.id}">
        <td>${escHtml(t.name)}</td>
        <td><span class="category-badge cat-${t.category}">${CATEGORY_LABELS[t.category] || t.category}</span></td>
        <td><span class="status-badge status-${t.active ? 'active' : 'inactive'}">${t.active ? 'פעיל' : 'לא פעיל'}</span></td>
        <td>
          <button class="btn btn-secondary" data-action="edit-template" data-id="${t.id}">ערוך</button>
          <button class="btn btn-secondary" data-action="toggle-template" data-id="${t.id}" data-active="${t.active}">${t.active ? 'השבת' : 'הפעל'}</button>
          <button class="btn btn-danger" data-action="delete-template" data-id="${t.id}">מחק</button>
        </td>
      </tr>
    `).join('');
    el.innerHTML = `<table><thead><tr><th>שם</th><th>קטגוריה</th><th>סטטוס</th><th>פעולות</th></tr></thead><tbody id="templates-tbody">${rows}</tbody></table>`;
  }

  async function addTemplate() {
    const name        = document.getElementById('tpl-name').value.trim();
    const category    = document.getElementById('tpl-category').value;
    const severity    = document.getElementById('tpl-severity').value;
    const title       = document.getElementById('tpl-title').value.trim();
    const description = document.getElementById('tpl-description').value.trim();
    const impact      = document.getElementById('tpl-impact').value.trim();
    const recs        = document.getElementById('tpl-recs').value.trim();

    if (!name || !title || !description) {
      setTplMsg('נא למלא שם, כותרת ותיאור לפחות', true);
      return;
    }

    const res = await fetch('/api/admin/templates', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, category, severity, title, description, impact, recommendations: recs })
    });
    const data = await res.json();
    if (!res.ok) {
      setTplMsg(data.error || 'שגיאה', true);
      return;
    }

    setTplMsg('התבנית נוספה בהצלחה', false);
    document.getElementById('tpl-name').value = '';
    document.getElementById('tpl-title').value = '';
    document.getElementById('tpl-description').value = '';
    document.getElementById('tpl-impact').value = '';
    document.getElementById('tpl-recs').value = '';
    loadTemplates();
  }

  async function toggleTemplateActive(tid, currentActive) {
    const res = await fetch(`/api/admin/templates/${tid}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ active: !currentActive })
    });
    const data = await res.json();
    if (!res.ok) {
      setTplMsg(data.error || 'שגיאה', true);
      return;
    }
    setTplMsg('הסטטוס עודכן', false);
    loadTemplates();
  }

  async function deleteTemplate(tid) {
    const { styledConfirm } = await import('/static/js/src/core.js');
    const yes = await styledConfirm('האם למחוק תבנית זו?', {
      title: 'מחיקת תבנית',
      danger: true,
      confirmText: 'מחק'
    });
    if (!yes) return;

    const res  = await fetch(`/api/admin/templates/${tid}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setTplMsg(data.error || 'שגיאה', true);
      return;
    }
    setTplMsg('התבנית נמחקה', false);
    loadTemplates();
  }

  function enterEditMode(tid) {
    if (editingTemplateId) {
      setTplMsg('סיים עריכה קודמת לפני התחלת עריכה חדשה', true);
      return;
    }

    fetch(`/api/admin/templates/${tid}`)
      .then(res => res.json())
      .then(tpl => {
        editingTemplateId = tid;
        originalTemplateData = tpl;

        const row = document.querySelector(`tr[data-tid="${tid}"]`);
        row.classList.add('edit-mode');
        row.innerHTML = `
          <td colspan="4">
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <div class="form-group" style="flex: 2; min-width: 180px;">
                  <label>שם תבנית</label>
                  <input type="text" id="edit-name" value="${escHtml(tpl.name)}" autocomplete="off">
                </div>
                <div class="form-group" style="flex: 1; min-width: 120px;">
                  <label>קטגוריה</label>
                  <select id="edit-category">
                    ${Object.keys(CATEGORY_LABELS).map(c => `<option value="${c}"${c===tpl.category?' selected':''}>${CATEGORY_LABELS[c]}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group" style="flex: 1; min-width: 110px;">
                  <label>חומרה</label>
                  <select id="edit-severity">
                    ${Object.keys(SEVERITY_LABELS).map(s => `<option value="${s}"${s===tpl.severity?' selected':''}>${SEVERITY_LABELS[s]}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label>כותרת</label>
                <input type="text" id="edit-title" value="${escHtml(tpl.title)}" autocomplete="off">
              </div>
              <div class="form-group">
                <label>תיאור</label>
                <textarea id="edit-description">${escHtml(tpl.description)}</textarea>
              </div>
              <div class="form-group">
                <label>השפעה</label>
                <textarea id="edit-impact">${escHtml(tpl.impact || '')}</textarea>
              </div>
              <div class="form-group">
                <label>המלצות</label>
                <textarea id="edit-recs">${escHtml(tpl.recommendations || '')}</textarea>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-success" data-action="save-edit" data-id="${tid}">שמור</button>
                <button class="btn btn-secondary" data-action="cancel-edit">בטל</button>
              </div>
            </div>
          </td>
        `;
      })
      .catch(() => {
        setTplMsg('שגיאה בטעינת תבנית לעריכה', true);
      });
  }

  async function saveEdit() {
    const name        = document.getElementById('edit-name').value.trim();
    const category    = document.getElementById('edit-category').value;
    const severity    = document.getElementById('edit-severity').value;
    const title       = document.getElementById('edit-title').value.trim();
    const description = document.getElementById('edit-description').value.trim();
    const impact      = document.getElementById('edit-impact').value.trim();
    const recs        = document.getElementById('edit-recs').value.trim();

    if (!name || !title || !description) {
      setTplMsg('נא למלא שם, כותרת ותיאור לפחות', true);
      return;
    }

    const res = await fetch(`/api/admin/templates/${editingTemplateId}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, category, severity, title, description, impact, recommendations: recs })
    });
    const data = await res.json();
    if (!res.ok) {
      setTplMsg(data.error || 'שגיאה', true);
      return;
    }

    setTplMsg('התבנית עודכנה בהצלחה', false);
    editingTemplateId = null;
    originalTemplateData = null;
    loadTemplates();
  }

  function cancelEdit() {
    editingTemplateId = null;
    originalTemplateData = null;
    loadTemplates();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Event Delegation
  // ──────────────────────────────────────────────────────────────────────────

  // User table event delegation
  document.getElementById('users-container').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'delete-user') {
      await deleteUser(id);
    }
  });

  // Handle role change in user table
  document.getElementById('users-container').addEventListener('change', async (e) => {
    const select = e.target.closest('select[data-action="change-role"]');
    if (!select) return;

    const userId = select.dataset.id;
    const newRole = select.value;
    await changeRole(userId, newRole);
  });

  // Template table event delegation
  document.getElementById('templates-container').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'edit-template') {
      enterEditMode(id);
    } else if (action === 'toggle-template') {
      const currentActive = btn.dataset.active === 'true';
      await toggleTemplateActive(id, currentActive);
    } else if (action === 'delete-template') {
      await deleteTemplate(id);
    } else if (action === 'save-edit') {
      await saveEdit();
    } else if (action === 'cancel-edit') {
      cancelEdit();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Tab Switching
  // ──────────────────────────────────────────────────────────────────────────

  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;

      document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${targetTab}`).classList.add('active');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Static Button Handlers
  // ──────────────────────────────────────────────────────────────────────────

  document.getElementById('btn-add-user').addEventListener('click', addUser);
  document.getElementById('btn-add-template').addEventListener('click', addTemplate);

  // ──────────────────────────────────────────────────────────────────────────
  // Initial Load
  // ──────────────────────────────────────────────────────────────────────────

  loadUsers();
  loadTemplates();
});
