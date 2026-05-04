const ADMIN_EMAIL = 'guntaarunkumar@gmail.com';
const db   = firebase.firestore();
const auth = firebase.auth();

let allUsers    = [];
let unsubscribe = null;
let deletingEmail = null;

// ── Auth state ────────────────────────────────────────────────────────
auth.onAuthStateChanged(user => {
  hide('authScreen'); hide('accessDenied'); hide('adminPanel');

  if (!user) { show('authScreen'); return; }

  if (user.email !== ADMIN_EMAIL) {
    show('accessDenied'); return;
  }

  document.getElementById('adminEmail').textContent = user.email;
  show('adminPanel');
  loadUsers();
});

// ── Sign in / out ─────────────────────────────────────────────────────
document.getElementById('googleSignInBtn').addEventListener('click', () => {
  auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
    .catch(err => alert('Sign in failed: ' + err.message));
});

document.getElementById('adminSignOutBtn').addEventListener('click', () => auth.signOut());
document.getElementById('signOutDeniedBtn').addEventListener('click', () => auth.signOut());

// ── Load users (real-time) ────────────────────────────────────────────
function loadUsers() {
  if (unsubscribe) unsubscribe();

  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Loading…</td></tr>`;

  unsubscribe = db.collection('users').onSnapshot(
    snap => {
      allUsers = snap.docs.map(d => ({ email: d.id, ...d.data() }));
      // Sort newest first client-side (avoids needing a Firestore index)
      allUsers.sort((a, b) => {
        const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return bt - at;
      });
      updateStats();
      renderTable(allUsers);
    },
    err => {
      console.error('Firestore error:', err);
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color:#f87171">
        Error: ${err.message}<br><small>Check Firestore rules and ensure the database is enabled.</small>
      </td></tr>`;
    }
  );
}

function updateStats() {
  document.getElementById('statTotal').textContent   = allUsers.length;
  document.getElementById('statActive').textContent  = allUsers.filter(u => !u.blocked).length;
  document.getElementById('statBlocked').textContent = allUsers.filter(u => u.blocked).length;
}

// ── Render table ──────────────────────────────────────────────────────
function renderTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No users yet. Click <strong>Add User</strong> to give someone access.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map(u => `
    <tr class="${u.blocked ? 'row-blocked' : ''}">
      <td class="td-email"><span class="email-text">${esc(u.email)}</span></td>
      <td class="td-toggle">${tog(u.email, 'planning',  u.planning)}</td>
      <td class="td-toggle">${tog(u.email, 'pictorial', u.pictorial)}</td>
      <td class="td-toggle">${tog(u.email, 'billing',   u.billing)}</td>
      <td class="td-toggle">${tog(u.email, 'exportPdf', u.exportPdf)}</td>
      <td class="td-toggle">
        <button class="btn-status ${u.blocked ? 'status-blocked' : 'status-active'}"
                onclick="toggleBlock('${esc(u.email)}', ${!!u.blocked})">
          ${u.blocked ? 'Blocked' : 'Active'}
        </button>
      </td>
      <td class="td-date">${u.lastLogin ? fmtDate(u.lastLogin) : '—'}</td>
      <td>
        <button class="btn-delete" onclick="openDeleteModal('${esc(u.email)}')" title="Remove user">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
        </button>
      </td>
    </tr>
  `).join('');
}

function tog(email, field, value) {
  const id = `tog_${email}_${field}`.replace(/[^a-zA-Z0-9_]/g, '_');
  return `<label class="toggle-switch" title="${field}">
    <input type="checkbox" id="${id}" ${value ? 'checked' : ''}
           onchange="updatePerm('${esc(email)}','${field}',this.checked)">
    <span class="toggle-slider"></span>
  </label>`;
}

function fmtDate(ts) {
  const d = ts && ts.toDate ? ts.toDate() : new Date(ts);
  return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function esc(s) { return String(s).replace(/'/g, "\\'"); }

// ── Update permission ─────────────────────────────────────────────────
async function updatePerm(email, field, value) {
  try {
    await db.collection('users').doc(email).update({ [field]: value });
  } catch (err) {
    alert('Update failed: ' + err.message);
  }
}

// ── Toggle block ──────────────────────────────────────────────────────
async function toggleBlock(email, currentlyBlocked) {
  try {
    await db.collection('users').doc(email).update({ blocked: !currentlyBlocked });
  } catch (err) {
    alert('Failed to update status: ' + err.message);
  }
}

// ── Add user modal ────────────────────────────────────────────────────
const addModal = document.getElementById('addUserModal');

document.getElementById('addUserBtn').addEventListener('click', () => {
  document.getElementById('newUserEmail').value = '';
  document.getElementById('np-planning').checked  = true;
  document.getElementById('np-pictorial').checked = true;
  document.getElementById('np-billing').checked   = false;
  document.getElementById('np-export').checked    = false;
  addModal.classList.add('show');
  setTimeout(() => document.getElementById('newUserEmail').focus(), 50);
});

document.getElementById('cancelAddBtn').addEventListener('click', () => addModal.classList.remove('show'));
addModal.addEventListener('click', e => { if (e.target === addModal) addModal.classList.remove('show'); });

document.getElementById('newUserEmail').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('confirmAddBtn').click();
  if (e.key === 'Escape') addModal.classList.remove('show');
});

document.getElementById('confirmAddBtn').addEventListener('click', async () => {
  const email = document.getElementById('newUserEmail').value.trim().toLowerCase();
  if (!email || !email.includes('@') || !email.includes('.')) {
    document.getElementById('newUserEmail').focus();
    return;
  }

  const btn = document.getElementById('confirmAddBtn');
  btn.textContent = 'Adding…'; btn.disabled = true;

  try {
    await db.collection('users').doc(email).set({
      email,
      planning:  document.getElementById('np-planning').checked,
      pictorial: document.getElementById('np-pictorial').checked,
      billing:   document.getElementById('np-billing').checked,
      exportPdf: document.getElementById('np-export').checked,
      blocked:   false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastLogin: null,
    });
    addModal.classList.remove('show');
  } catch (err) {
    console.error('Add user error:', err);
    alert('Failed to add user.\n\nError: ' + err.message + '\n\nCheck that Firestore rules are published and your email matches the admin email exactly.');
  } finally {
    btn.textContent = 'Add User'; btn.disabled = false;
  }
});

// ── Delete user modal ─────────────────────────────────────────────────
const deleteModal = document.getElementById('deleteUserModal');

function openDeleteModal(email) {
  deletingEmail = email;
  document.getElementById('deletingEmail').textContent = email;
  deleteModal.classList.add('show');
}

document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
  deleteModal.classList.remove('show'); deletingEmail = null;
});
deleteModal.addEventListener('click', e => {
  if (e.target === deleteModal) { deleteModal.classList.remove('show'); deletingEmail = null; }
});

document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
  if (!deletingEmail) return;
  const btn = document.getElementById('confirmDeleteBtn');
  btn.textContent = 'Removing…'; btn.disabled = true;
  try {
    await db.collection('users').doc(deletingEmail).delete();
    deleteModal.classList.remove('show'); deletingEmail = null;
  } catch (err) {
    alert('Failed to remove user: ' + err.message);
  } finally {
    btn.textContent = 'Remove'; btn.disabled = false;
  }
});

// ── Search ────────────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  renderTable(q ? allUsers.filter(u => u.email.toLowerCase().includes(q)) : allUsers);
});

// ── Helpers ───────────────────────────────────────────────────────────
function show(id) { document.getElementById(id).style.display = ''; }
function hide(id) { document.getElementById(id).style.display = 'none'; }
