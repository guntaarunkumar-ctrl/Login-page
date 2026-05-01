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
    floorList.forEach(f => { syncFloorCanvas(f.id); restoreFloorProgress(f.id); });
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

// ── Pictorial — multi-floor canvas ───────────────────────────────
let isPainting   = false;
let isEraser     = false;
let currentColor = '#22c55e';
let activeCanvas = null;
let activeFloorId = null;
let floorList    = [];            // [{id, name}]
const undoStacks = new Map();     // canvas el → ImageData[]
const MAX_UNDO   = 15;

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function syncFloorCanvas(id) {
  const img    = document.getElementById(`floor-img-${id}`);
  const canvas = document.getElementById(`floor-canvas-${id}`);
  if (!img || !canvas || !img.clientWidth) return;
  undoStacks.delete(canvas);
  canvas.width  = img.clientWidth;
  canvas.height = img.clientHeight;
}

function saveFloorProgress(id) {
  const canvas = document.getElementById(`floor-canvas-${id}`);
  if (!canvas || !canvas.width) return;
  try { localStorage.setItem(`pictorial_progress_${id}`, canvas.toDataURL()); } catch(e) {}
}

function restoreFloorProgress(id) {
  const saved  = localStorage.getItem(`pictorial_progress_${id}`);
  const canvas = document.getElementById(`floor-canvas-${id}`);
  if (!saved || !canvas) return;
  const img = new Image();
  img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  img.src = saved;
}

function saveFloorList() {
  try { localStorage.setItem('pictorial_floors', JSON.stringify(floorList)); } catch(e) {}
}

function pushUndo() {
  if (!activeCanvas || !activeCanvas.width) return;
  if (!undoStacks.has(activeCanvas)) undoStacks.set(activeCanvas, []);
  const stack = undoStacks.get(activeCanvas);
  stack.push(activeCanvas.getContext('2d').getImageData(0, 0, activeCanvas.width, activeCanvas.height));
  if (stack.length > MAX_UNDO) stack.shift();
}

function undo() {
  if (!activeCanvas) return;
  const stack = undoStacks.get(activeCanvas);
  if (!stack || !stack.length) return;
  activeCanvas.getContext('2d').putImageData(stack.pop(), 0, 0);
  if (activeFloorId) saveFloorProgress(activeFloorId);
}

function getBrushRadius() {
  return parseInt(document.getElementById('brushSize').value, 10);
}

function getPaintPos(e, canvas) {
  const rect  = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (cx - rect.left) * scaleX, y: (cy - rect.top) * scaleY };
}

function doPaint(e, canvas) {
  if (!isPainting) return;
  e.preventDefault();
  const ctx = canvas.getContext('2d');
  const { x, y } = getPaintPos(e, canvas);
  const r = getBrushRadius();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (isEraser) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.7, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = g; ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  } else {
    const [r2,g2,b2] = hexToRgb(currentColor);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, currentColor); g.addColorStop(0.6, currentColor); g.addColorStop(1, `rgba(${r2},${g2},${b2},0)`);
    ctx.fillStyle = g; ctx.fill();
  }
}

function setEraser(active) {
  isEraser = active;
  document.getElementById('eraserBtn').classList.toggle('active', active);
}

// ── Floor management ──────────────────────────────────────────────
function loadFloorImage(id, src) {
  const img    = document.getElementById(`floor-img-${id}`);
  const wrap   = document.getElementById(`floor-wrap-${id}`);
  const upload = document.getElementById(`floor-upload-${id}`);
  if (!img) return;
  function onReady() {
    img.onload = null;
    upload.style.display = 'none';
    wrap.style.display   = '';
    document.getElementById('pictorialToolbar').style.display = '';
    document.getElementById('pictorialHint').style.display    = '';
    syncFloorCanvas(id);
    restoreFloorProgress(id);
    activeCanvas  = document.getElementById(`floor-canvas-${id}`);
    activeFloorId = id;
    try { localStorage.setItem(`pictorial_img_${id}`, src); } catch(e) {}
  }
  img.onload = onReady;
  img.src = src;
  if (img.complete && img.naturalWidth) onReady();
}

function buildFloorHTML(id, name) {
  return `
<div class="floor-section" id="floor-section-${id}">
  <div class="floor-header">
    <div class="floor-title-row">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="17" width="18" height="4" rx="1"/>
      </svg>
      <input class="floor-title" value="${name}" data-id="${id}" title="Click to rename" />
    </div>
    <div class="floor-btns">
      <button class="btn-tool btn-floor-change" data-id="${id}" title="Change image">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </button>
      <button class="btn-tool btn-floor-remove" data-id="${id}" title="Remove floor">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>
  <label class="pictorial-upload-area" id="floor-upload-${id}">
    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
    </svg>
    <span class="upload-title">Upload Floor Plan</span>
    <span class="upload-sub">Tap to select &nbsp;·&nbsp; or drag &amp; drop</span>
    <input type="file" class="floor-file-input" data-id="${id}" accept="image/*" />
  </label>
  <div class="pictorial-wrap" id="floor-wrap-${id}" style="display:none">
    <img id="floor-img-${id}" alt="${name}" draggable="false" />
    <canvas id="floor-canvas-${id}" class="floor-canvas" data-id="${id}"></canvas>
  </div>
</div>`;
}

function wireFloorEvents(id) {
  const canvas   = document.getElementById(`floor-canvas-${id}`);
  const upload   = document.getElementById(`floor-upload-${id}`);
  const fileInput = upload.querySelector('.floor-file-input');

  // Paint
  canvas.addEventListener('mousedown',  (e) => { activeCanvas = canvas; activeFloorId = id; pushUndo(); isPainting = true; doPaint(e, canvas); });
  canvas.addEventListener('mousemove',  (e) => { if (isPainting && activeCanvas === canvas) doPaint(e, canvas); });
  canvas.addEventListener('mouseup',    ()  => { isPainting = false; saveFloorProgress(id); });
  canvas.addEventListener('mouseleave', ()  => { isPainting = false; });
  canvas.addEventListener('touchstart', (e) => { activeCanvas = canvas; activeFloorId = id; pushUndo(); isPainting = true; doPaint(e, canvas); }, { passive: false });
  canvas.addEventListener('touchmove',  (e) => { if (isPainting && activeCanvas === canvas) doPaint(e, canvas); }, { passive: false });
  canvas.addEventListener('touchend',   ()  => { isPainting = false; saveFloorProgress(id); });

  // File input
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => loadFloorImage(id, ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  // Drag & drop
  upload.addEventListener('dragover',  (e) => { e.preventDefault(); upload.classList.add('drag-over'); });
  upload.addEventListener('dragleave', ()  => upload.classList.remove('drag-over'));
  upload.addEventListener('drop', (e) => {
    e.preventDefault(); upload.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => loadFloorImage(id, ev.target.result);
      reader.readAsDataURL(file);
    }
  });

  // Editable title
  const titleInput = document.querySelector(`.floor-title[data-id="${id}"]`);
  titleInput.addEventListener('change', () => {
    const f = floorList.find(f => f.id === id);
    if (f) { f.name = titleInput.value.trim() || `Section ${id}`; titleInput.value = f.name; saveFloorList(); }
  });

  // Change button
  document.querySelector(`.btn-floor-change[data-id="${id}"]`).addEventListener('click', () => {
    localStorage.removeItem(`pictorial_progress_${id}`);
    fileInput.click();
  });

  // Remove button
  document.querySelector(`.btn-floor-remove[data-id="${id}"]`).addEventListener('click', () => {
    if (floorList.length <= 1) return;
    document.getElementById(`floor-section-${id}`).remove();
    floorList = floorList.filter(f => f.id !== id);
    localStorage.removeItem(`pictorial_img_${id}`);
    localStorage.removeItem(`pictorial_progress_${id}`);
    if (activeFloorId === id) { activeCanvas = null; activeFloorId = null; }
    saveFloorList();
  });
}

function addFloor(id, name, restoreData) {
  const maxId = floorList.reduce((m, f) => Math.max(m, f.id), 0);
  id   = id   || maxId + 1;
  name = name || `Section ${id}`;
  floorList.push({ id, name });
  document.getElementById('floorsContainer').insertAdjacentHTML('beforeend', buildFloorHTML(id, name));
  wireFloorEvents(id);
  if (restoreData) {
    const src = localStorage.getItem(`pictorial_img_${id}`);
    if (src) loadFloorImage(id, src);
  } else {
    saveFloorList();
  }
}

// ── Toolbar ───────────────────────────────────────────────────────
const colorLegendEl = document.getElementById('colorLegend');
const colorNames = { '#22c55e':'Complete', '#eab308':'In Progress', '#f97316':'Partial', '#ef4444':'Issue', '#3b82f6':'Inspected' };
function updateLegend(c) { colorLegendEl.textContent = colorNames[c] || ''; }

document.querySelectorAll('.color-swatch').forEach(s => {
  s.addEventListener('mouseenter', () => updateLegend(s.dataset.color));
  s.addEventListener('mouseleave', () => updateLegend(currentColor));
  s.addEventListener('click', () => {
    currentColor = s.dataset.color;
    document.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('active'));
    s.classList.add('active'); updateLegend(currentColor); setEraser(false);
  });
});
updateLegend(currentColor);

document.getElementById('eraserBtn').addEventListener('click', () => setEraser(!isEraser));
document.getElementById('undoBtn').addEventListener('click', undo);
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); } });

// Clear modal
const clearModal = document.getElementById('clearModal');
document.getElementById('clearCanvas').addEventListener('click', () => { if (activeCanvas) clearModal.classList.add('show'); });
document.getElementById('cancelClearBtn').addEventListener('click', () => clearModal.classList.remove('show'));
document.getElementById('confirmClearBtn').addEventListener('click', () => {
  clearModal.classList.remove('show');
  if (!activeCanvas) return;
  pushUndo();
  activeCanvas.getContext('2d').clearRect(0, 0, activeCanvas.width, activeCanvas.height);
  if (activeFloorId) localStorage.removeItem(`pictorial_progress_${activeFloorId}`);
});
clearModal.addEventListener('click', (e) => { if (e.target === clearModal) clearModal.classList.remove('show'); });

// Add floor button
document.getElementById('addFloorBtn').addEventListener('click', () => addFloor());

// ── Restore from localStorage ─────────────────────────────────────
const savedFloors = localStorage.getItem('pictorial_floors');
if (savedFloors) {
  try { JSON.parse(savedFloors).forEach(f => addFloor(f.id, f.name, true)); } catch(e) { addFloor(); }
} else {
  addFloor();
}

window.addEventListener('resize', () => {
  if (document.getElementById('pictorialView').style.display !== 'none')
    floorList.forEach(f => syncFloorCanvas(f.id));
});

// ── Sidebar collapse (desktop) ───────────────────────────────────
const expandSidebarBtn = document.getElementById('expandSidebarBtn');
const mainEl = document.getElementById('main');

function collapseSidebar() {
  sidebar.classList.add('desktop-collapsed');
  mainEl.classList.add('desktop-collapsed');
  expandSidebarBtn.style.display = 'flex';
  localStorage.setItem('sidebarCollapsed', '1');
}

function expandSidebar() {
  sidebar.classList.remove('desktop-collapsed');
  mainEl.classList.remove('desktop-collapsed');
  expandSidebarBtn.style.display = 'none';
  localStorage.removeItem('sidebarCollapsed');
}

document.getElementById('collapseSidebarBtn').addEventListener('click', collapseSidebar);
expandSidebarBtn.addEventListener('click', expandSidebar);

// Restore sidebar state from previous session (desktop only)
if (localStorage.getItem('sidebarCollapsed') && window.innerWidth > 768) {
  sidebar.classList.add('desktop-collapsed');
  mainEl.classList.add('desktop-collapsed');
  expandSidebarBtn.style.display = 'flex';
}
