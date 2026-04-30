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
    restoreProgress();
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
const progressCanvas  = document.getElementById('progressCanvas');
const floorPlanImg    = document.getElementById('floorPlanImg');
const uploadArea      = document.getElementById('uploadArea');
const pictorialWrap   = document.getElementById('pictorialWrap');
const pictorialToolbar = document.getElementById('pictorialToolbar');
const pictorialHint   = document.getElementById('pictorialHint');
const floorPlanInput  = document.getElementById('floorPlanInput');
let isPainting = false;

function syncCanvas() {
  if (!floorPlanImg.clientWidth) return;
  progressCanvas.width  = floorPlanImg.clientWidth;
  progressCanvas.height = floorPlanImg.clientHeight;
}

function saveProgress() {
  try { localStorage.setItem('pictorialProgress', progressCanvas.toDataURL()); } catch (e) {}
}

function restoreProgress() {
  const saved = localStorage.getItem('pictorialProgress');
  if (!saved) return;
  const img = new Image();
  img.onload = () => progressCanvas.getContext('2d').drawImage(img, 0, 0, progressCanvas.width, progressCanvas.height);
  img.src = saved;
}

function showFloorPlan() {
  uploadArea.style.display       = 'none';
  pictorialWrap.style.display    = '';
  pictorialToolbar.style.display = '';
  pictorialHint.style.display    = '';
  syncCanvas();
  restoreProgress();
}

function loadFloorPlan(src) {
  function onReady() {
    floorPlanImg.onload = null;
    showFloorPlan();
    try { localStorage.setItem('floorPlanSrc', src); } catch (e) {}
  }
  floorPlanImg.onload = onReady;
  floorPlanImg.src = src;
  if (floorPlanImg.complete && floorPlanImg.naturalWidth) onReady();
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

// Paint events
progressCanvas.addEventListener('mousedown',  (e) => { isPainting = true; doPaint(e); });
progressCanvas.addEventListener('mousemove',  doPaint);
progressCanvas.addEventListener('mouseup',    () => { isPainting = false; saveProgress(); });
progressCanvas.addEventListener('mouseleave', () => isPainting = false);
progressCanvas.addEventListener('touchstart', (e) => { isPainting = true; doPaint(e); }, { passive: false });
progressCanvas.addEventListener('touchmove',  doPaint, { passive: false });
progressCanvas.addEventListener('touchend',   () => { isPainting = false; saveProgress(); });

// Clear button
document.getElementById('clearCanvas').addEventListener('click', () => {
  progressCanvas.getContext('2d').clearRect(0, 0, progressCanvas.width, progressCanvas.height);
  localStorage.removeItem('pictorialProgress');
});

// File input change
floorPlanInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => loadFloorPlan(ev.target.result);
  reader.readAsDataURL(file);
  e.target.value = '';
});

// Change image button
document.getElementById('changeImg').addEventListener('click', () => {
  localStorage.removeItem('pictorialProgress');
  floorPlanInput.click();
});

// Drag and drop
uploadArea.addEventListener('dragover',  (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea.addEventListener('dragleave', ()  => uploadArea.classList.remove('drag-over'));
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (ev) => loadFloorPlan(ev.target.result);
    reader.readAsDataURL(file);
  }
});

// Restore saved floor plan from previous session
const savedSrc = localStorage.getItem('floorPlanSrc');
if (savedSrc) loadFloorPlan(savedSrc);

window.addEventListener('resize', () => {
  if (document.getElementById('pictorialView').style.display !== 'none' && floorPlanImg.src) syncCanvas();
});
