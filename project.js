// Auth guard + populate user info
firebase.auth().onAuthStateChanged(user => {
  if (!user) { window.location.href = 'index.html'; return; }

  const name = user.displayName || user.email.split('@')[0];

  document.getElementById('userName').textContent = name;

  const lastLogin = user.metadata.lastSignInTime;
  if (lastLogin) {
    document.getElementById('userLastLogin').textContent =
      'Last login: ' + new Date(lastLogin).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  const avatarEl = document.getElementById('userAvatar');
  if (user.photoURL) {
    const img = document.createElement('img');
    img.src = user.photoURL;
    img.alt = name;
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = name.charAt(0).toUpperCase();
  }
});

document.getElementById('signOutBtn').addEventListener('click', () => {
  firebase.auth().signOut()
    .catch(() => {})
    .finally(() => { window.location.href = 'index.html'; });
});

const sidebar   = document.getElementById('sidebar');
const overlay   = document.getElementById('overlay');
const burger    = document.getElementById('burger');
const csTitle   = document.getElementById('csTitle');
const navItems  = document.querySelectorAll('.nav-item');
const groupBtns = document.querySelectorAll('.nav-group-btn');

// ── Sidebar toggle (mobile) ──────────────────────────────────────
function openSidebar() {
  sidebar.classList.add('open');
  overlay.classList.add('show');
  burger.classList.add('open');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  overlay.classList.remove('show');
  burger.classList.remove('open');
}

burger.addEventListener('click', () =>
  sidebar.classList.contains('open') ? closeSidebar() : openSidebar()
);
overlay.addEventListener('click', closeSidebar);

// ── Group expand / collapse ──────────────────────────────────────
groupBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const group    = btn.dataset.group;
    const children = document.getElementById('children-' + group);
    const expanded = btn.getAttribute('aria-expanded') === 'true';

    btn.setAttribute('aria-expanded', String(!expanded));
    children.classList.toggle('collapsed', expanded);
  });
});

// ── Nav item selection ───────────────────────────────────────────
function setActiveTab(tabName) {
  navItems.forEach(item => item.classList.toggle('active', item.dataset.tab === tabName));
  csTitle.textContent = tabName;
  document.getElementById('pageTitle').textContent = tabName;

  // Re-trigger fade animation
  const cs = document.querySelector('.coming-soon');
  cs.style.animation = 'none';
  cs.offsetHeight;                    // reflow
  cs.style.animation = '';

  // On mobile close sidebar after selection
  if (window.innerWidth <= 768) closeSidebar();
}

navItems.forEach(item => {
  item.addEventListener('click', () => setActiveTab(item.dataset.tab));
});
