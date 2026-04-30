// Auth guard + populate user info
firebase.auth().onAuthStateChanged(user => {
  if (!user) { window.location.href = 'index.html'; return; }

  const name = user.displayName || user.email.split('@')[0];

  document.getElementById('userName').textContent = name;
  document.getElementById('topbarUserName').textContent = name;

  const lastLogin = user.metadata.lastSignInTime;
  if (lastLogin) {
    const formatted = new Date(lastLogin).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    document.getElementById('userLastLogin').textContent = 'Last login: ' + formatted;
    document.getElementById('topbarUserDate').textContent = formatted;
  }

  const avatarEl = document.getElementById('userAvatar');
  const topbarAvatarEl = document.getElementById('topbarUserAvatar');
  if (user.photoURL) {
    const img = document.createElement('img');
    img.src = user.photoURL;
    img.alt = name;
    avatarEl.appendChild(img);

    const img2 = document.createElement('img');
    img2.src = user.photoURL;
    img2.alt = name;
    topbarAvatarEl.appendChild(img2);
  } else {
    const initial = name.charAt(0).toUpperCase();
    avatarEl.textContent = initial;
    topbarAvatarEl.textContent = initial;
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

  const isPictorial   = tabName === 'Pictorial';
  const comingSoon    = document.getElementById('comingSoon');
  const pictorialView = document.getElementById('pictorialView');
  const contentArea   = document.getElementById('contentArea');

  comingSoon.style.display    = isPictorial ? 'none'  : '';
  pictorialView.style.display = isPictorial ? 'flex'  : 'none';
  contentArea.classList.toggle('pictorial-active', isPictorial);

  if (isPictorial) {
    syncCanvas();
  } else {
    comingSoon.style.animation = 'none';
    comingSoon.offsetHeight;
    comingSoon.style.animation = '';
  }

  if (window.innerWidth <= 768) closeSidebar();
}

navItems.forEach(item => {
  item.addEventListener('click', () => setActiveTab(item.dataset.tab));
});

// ── Pictorial canvas ─────────────────────────────────────────────
const progressCanvas = document.getElementById('progressCanvas');
const floorPlanImg   = document.getElementById('floorPlanImg');
let isPainting = false;

function syncCanvas() {
  if (!floorPlanImg.clientWidth) return;
  progressCanvas.width  = floorPlanImg.clientWidth;
  progressCanvas.height = floorPlanImg.clientHeight;
}

function getBrushRadius() {
  return parseInt(document.getElementById('brushSize').value, 10);
}

function getPaintPos(e) {
  const rect = progressCanvas.getBoundingClientRect();
  const scaleX = progressCanvas.width  / rect.width;
  const scaleY = progressCanvas.height / rect.height;
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (cx - rect.left) * scaleX, y: (cy - rect.top) * scaleY };
}

function doPaint(e) {
  if (!isPainting) return;
  e.preventDefault();
  const ctx = progressCanvas.getContext('2d');
  const { x, y } = getPaintPos(e);
  const r = getBrushRadius();
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0,   '#22c55e');
  grad.addColorStop(0.6, '#22c55e');
  grad.addColorStop(1,   'rgba(34,197,94,0)');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
}

progressCanvas.addEventListener('mousedown',  (e) => { isPainting = true; doPaint(e); });
progressCanvas.addEventListener('mousemove',  doPaint);
progressCanvas.addEventListener('mouseup',    () => isPainting = false);
progressCanvas.addEventListener('mouseleave', () => isPainting = false);
progressCanvas.addEventListener('touchstart', (e) => { isPainting = true; doPaint(e); }, { passive: false });
progressCanvas.addEventListener('touchmove',  doPaint, { passive: false });
progressCanvas.addEventListener('touchend',   () => isPainting = false);

document.getElementById('clearCanvas').addEventListener('click', () => {
  progressCanvas.getContext('2d').clearRect(0, 0, progressCanvas.width, progressCanvas.height);
});

floorPlanImg.addEventListener('load', syncCanvas);
if (floorPlanImg.complete) syncCanvas();

window.addEventListener('resize', () => {
  if (document.getElementById('pictorialView').style.display !== 'none') syncCanvas();
});
