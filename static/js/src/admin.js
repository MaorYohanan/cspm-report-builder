const ROLE_LABELS = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

async function loadUsers() {
  const res = await fetch('/api/users');
  if (!res.ok) { document.getElementById('users-container').innerHTML = '<div class="empty-state">שגיאה בטעינת משתמשים</div>'; return; }
  const users = await res.json();
  renderUsers(users);
}

function renderUsers(users) {
  const el = document.getElementById('users-container');
  if (!users.length) { el.innerHTML = '<div class="empty-state">אין משתמשים עדיין</div>'; return; }
  const rows = users.map(u => `
    <tr>
      <td>${escHtml(u.email)}</td>
      <td><span class="role-badge role-${u.role}">${ROLE_LABELS[u.role] || u.role}</span></td>
      <td>
        <select data-uid="${u.id}" onchange="changeRole(this)">
          ${['viewer','editor','admin'].map(r => `<option value="${r}"${r===u.role?' selected':''}>${ROLE_LABELS[r]}</option>`).join('')}
        </select>
      </td>
      <td><button class="btn btn-danger" onclick="deleteUser(${u.id})">הסר</button></td>
    </tr>
  `).join('');
  el.innerHTML = `<table><thead><tr><th>אימייל</th><th>תפקיד</th><th>שינוי תפקיד</th><th>פעולות</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function setMsg(msg, isError) {
  document.getElementById('status-msg').textContent = isError ? '' : msg;
  document.getElementById('error-msg').textContent  = isError ? msg : '';
}

async function addUser() {
  const email = document.getElementById('new-email').value.trim();
  const role  = document.getElementById('new-role').value;
  if (!email) { setMsg('נא להזין כתובת אימייל', true); return; }
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email, role})
  });
  const data = await res.json();
  if (!res.ok) { setMsg(data.error || 'שגיאה', true); return; }
  setMsg('המשתמש נוסף בהצלחה', false);
  document.getElementById('new-email').value = '';
  loadUsers();
}

async function changeRole(select) {
  const uid  = select.dataset.uid;
  const role = select.value;
  const res = await fetch(`/api/users/${uid}`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({role})
  });
  const data = await res.json();
  if (!res.ok) { setMsg(data.error || 'שגיאה', true); loadUsers(); return; }
  setMsg('התפקיד עודכן', false);
}

// deleteUser and addUser must be on window so inline onclick attributes can reach them
window.addUser = addUser;
window.changeRole = changeRole;

// DES-I-08: deleteUser exposed on window for inline onclick="deleteUser(...)" in renderUsers
window.deleteUser = async function(uid) {
  const { styledConfirm } = await import('/static/js/src/core.js');
  const yes = await styledConfirm('האם למחוק משתמש זה?', { title: 'מחיקת משתמש', danger: true, confirmText: 'מחק' });
  if (!yes) return;
  const res  = await fetch(`/api/users/${uid}`, {method: 'DELETE'});
  const data = await res.json();
  if (!res.ok) { setMsg(data.error || 'שגיאה', true); return; }
  setMsg('המשתמש הוסר', false);
  loadUsers();
};

loadUsers();
