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
const progressCanvas   = document.getElementById('progressCanvas');
const floorPlanImg     = document.getElementById('floorPlanImg');
const uploadArea       = document.getElementById('uploadArea');
const pictorialWrap    = document.getElementById('pictorialWrap');
const pictorialToolbar = document.getElementById('pictorialToolbar');
const pictorialHint    = document.getElementById('pictorialHint');
const floorPlanInput   = document.getElementById('floorPlanInput');

let isPainting   = false;
let isEraser     = false;
let currentColor = '#22c55e';
const undoStack  = [];
const MAX_UNDO   = 15;

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function syncCanvas() {
  if (!floorPlanImg.clientWidth) return;
  undoStack.length = 0;
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

function pushUndo() {
  if (!progressCanvas.width) return;
  undoStack.push(progressCanvas.getContext('2d').getImageData(0, 0, progressCanvas.width, progressCanvas.height));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function undo() {
  if (!undoStack.length) return;
  progressCanvas.getContext('2d').putImageData(undoStack.pop(), 0, 0);
  saveProgress();
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
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (isEraser) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0,   'rgba(0,0,0,1)');
    g.addColorStop(0.7, 'rgba(0,0,0,1)');
    g.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = g;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  } else {
    const [r2,g2,b2] = hexToRgb(currentColor);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0,   currentColor);
    g.addColorStop(0.6, currentColor);
    g.addColorStop(1,   `rgba(${r2},${g2},${b2},0)`);
    ctx.fillStyle = g;
    ctx.fill();
  }
}

function setEraser(active) {
  isEraser = active;
  document.getElementById('eraserBtn').classList.toggle('active', active);
  progressCanvas.style.cursor = active ? 'cell' : 'crosshair';
}

// Paint events
progressCanvas.addEventListener('mousedown',  (e) => { pushUndo(); isPainting = true; doPaint(e); });
progressCanvas.addEventListener('mousemove',  doPaint);
progressCanvas.addEventListener('mouseup',    () => { isPainting = false; saveProgress(); });
progressCanvas.addEventListener('mouseleave', () => isPainting = false);
progressCanvas.addEventListener('touchstart', (e) => { pushUndo(); isPainting = true; doPaint(e); }, { passive: false });
progressCanvas.addEventListener('touchmove',  doPaint, { passive: false });
progressCanvas.addEventListener('touchend',   () => { isPainting = false; saveProgress(); });

// Colour swatches + legend
const colorLegendEl = document.getElementById('colorLegend');
const colorNames = {
  '#22c55e': 'Complete',
  '#eab308': 'In Progress',
  '#f97316': 'Partial',
  '#ef4444': 'Issue',
  '#3b82f6': 'Inspected',
};

function updateLegend(color) {
  colorLegendEl.textContent = colorNames[color] || '';
}

document.querySelectorAll('.color-swatch').forEach(swatch => {
  swatch.addEventListener('mouseenter', () => updateLegend(swatch.dataset.color));
  swatch.addEventListener('mouseleave', () => updateLegend(currentColor));
  swatch.addEventListener('click', () => {
    currentColor = swatch.dataset.color;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    updateLegend(currentColor);
    setEraser(false);
  });
});
updateLegend(currentColor);

// Eraser toggle
document.getElementById('eraserBtn').addEventListener('click', () => setEraser(!isEraser));

// Undo button + Ctrl+Z
document.getElementById('undoBtn').addEventListener('click', undo);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
});

// Clear button — show confirmation modal
const clearModal = document.getElementById('clearModal');
document.getElementById('clearCanvas').addEventListener('click', () => {
  clearModal.classList.add('show');
});
document.getElementById('cancelClearBtn').addEventListener('click', () => {
  clearModal.classList.remove('show');
});
document.getElementById('confirmClearBtn').addEventListener('click', () => {
  clearModal.classList.remove('show');
  pushUndo(); // save current state so Undo can restore it
  progressCanvas.getContext('2d').clearRect(0, 0, progressCanvas.width, progressCanvas.height);
  localStorage.removeItem('pictorialProgress');
});
clearModal.addEventListener('click', (e) => {
  if (e.target === clearModal) clearModal.classList.remove('show');
});

// File input
floorPlanInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => loadFloorPlan(ev.target.result);
  reader.readAsDataURL(file);
  e.target.value = '';
});

// Change image
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

// ── Add Section feature ──────────────────────────────────────────
let sectionCount = 1;

// Save section-1 name
document.getElementById('p-sec-name-1').addEventListener('change', function() {
  if (!this.value.trim()) this.value = 'Section 1';
  localStorage.setItem('p_sec1_name', this.value);
});
const saved1Name = localStorage.getItem('p_sec1_name');
if (saved1Name) document.getElementById('p-sec-name-1').value = saved1Name;

function createSection(sid, name, savedImg) {
  // Per-section state
  let s_painting = false, s_eraser = false, s_color = '#22c55e';
  const s_undo = [];
  const COLORS = { '#22c55e':'Complete','#eab308':'In Progress','#f97316':'Partial','#ef4444':'Issue','#3b82f6':'Inspected' };

  // Section wrapper
  const sec = document.createElement('div');
  sec.className = 'p-section'; sec.id = 'p-sec-' + sid;

  // Header
  const hdr = document.createElement('div'); hdr.className = 'p-sec-hdr';
  const nameEl = document.createElement('input'); nameEl.className = 'p-sec-name'; nameEl.value = name; nameEl.title = 'Click to rename';
  const removeEl = document.createElement('button'); removeEl.className = 'p-remove-btn'; removeEl.title = 'Remove';
  removeEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  hdr.appendChild(nameEl); hdr.appendChild(removeEl); sec.appendChild(hdr);

  // Toolbar
  const tb = document.createElement('div'); tb.className = 'pictorial-toolbar'; tb.style.display = 'none';
  const tg = document.createElement('div'); tg.className = 'toolbar-group';
  // swatches
  const swWrap = document.createElement('div'); swWrap.className = 'color-legend-wrap';
  const swRow  = document.createElement('div'); swRow.className = 'color-swatches';
  const lgnd   = document.createElement('span'); lgnd.className = 'color-legend'; lgnd.textContent = 'Complete';
  const swBtns = Object.entries(COLORS).map(([c, lbl]) => {
    const b = document.createElement('button');
    b.className = 'color-swatch' + (c === '#22c55e' ? ' active' : '');
    b.dataset.color = c; b.style.background = c; b.title = lbl;
    b.addEventListener('mouseenter', () => lgnd.textContent = lbl);
    b.addEventListener('mouseleave', () => lgnd.textContent = COLORS[s_color] || '');
    b.addEventListener('click', () => {
      s_color = c; s_eraser = false; cvs.style.cursor = 'crosshair';
      swBtns.forEach(x => x.classList.remove('active')); b.classList.add('active');
      erasEl.classList.remove('active'); lgnd.textContent = lbl;
    });
    swRow.appendChild(b); return b;
  });
  swWrap.appendChild(swRow); swWrap.appendChild(lgnd);
  // eraser
  const erasEl = document.createElement('button'); erasEl.className = 'btn-tool'; erasEl.title = 'Eraser';
  erasEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>';
  erasEl.addEventListener('click', () => { s_eraser = !s_eraser; erasEl.classList.toggle('active', s_eraser); cvs.style.cursor = s_eraser ? 'cell' : 'crosshair'; });
  // undo
  const undoEl = document.createElement('button'); undoEl.className = 'btn-tool'; undoEl.title = 'Undo';
  undoEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>';
  undoEl.addEventListener('click', doUndo);
  // brush
  const bWrap = document.createElement('div'); bWrap.className = 'pictorial-brush-wrap';
  bWrap.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  const brushEl = document.createElement('input'); brushEl.type = 'range'; brushEl.className = 'pictorial-slider'; brushEl.min = '10'; brushEl.max = '70'; brushEl.value = '30';
  bWrap.appendChild(brushEl);
  // separators
  const sep1 = document.createElement('div'); sep1.className = 'toolbar-sep';
  const sep2 = document.createElement('div'); sep2.className = 'toolbar-sep';
  tg.appendChild(swWrap); tg.appendChild(sep1); tg.appendChild(erasEl); tg.appendChild(undoEl); tg.appendChild(sep2); tg.appendChild(bWrap);
  // change + clear
  const acts = document.createElement('div'); acts.className = 'pictorial-actions';
  const chgEl = document.createElement('button'); chgEl.className = 'btn-change-img';
  chgEl.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Change';
  chgEl.addEventListener('click', () => { localStorage.removeItem('p_prog_'+sid); fi.click(); });
  const clrEl = document.createElement('button'); clrEl.className = 'btn-clear-canvas';
  clrEl.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg> Clear';
  clrEl.addEventListener('click', () => {
    if (!window.confirm('Clear all progress on this section?')) return;
    pushU(); cvs.getContext('2d').clearRect(0, 0, cvs.width, cvs.height);
    localStorage.removeItem('p_prog_'+sid);
  });
  acts.appendChild(chgEl); acts.appendChild(clrEl);
  tb.appendChild(tg); tb.appendChild(acts); sec.appendChild(tb);

  // Upload area
  const ul = document.createElement('label'); ul.className = 'pictorial-upload-area';
  ul.innerHTML = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span class="upload-title">Upload Floor Plan</span><span class="upload-sub">Tap to select &nbsp;·&nbsp; or drag &amp; drop</span>';
  const fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none';
  ul.appendChild(fi);

  // Canvas wrap
  const wrap = document.createElement('div'); wrap.className = 'pictorial-wrap'; wrap.style.display = 'none';
  const img  = document.createElement('img'); img.draggable = false;
  const cvs  = document.createElement('canvas'); cvs.className = 'p-canvas';
  wrap.appendChild(img); wrap.appendChild(cvs);

  sec.appendChild(ul); sec.appendChild(wrap);

  // Per-section functions
  function syncC() { if (!img.clientWidth) return; cvs.width = img.clientWidth; cvs.height = img.clientHeight; }
  function saveProg() { try { localStorage.setItem('p_prog_'+sid, cvs.toDataURL()); } catch(e) {} }
  function restrProg() {
    const d = localStorage.getItem('p_prog_'+sid); if (!d) return;
    const i = new Image(); i.onload = () => cvs.getContext('2d').drawImage(i, 0, 0, cvs.width, cvs.height); i.src = d;
  }
  function pushU() { if (!cvs.width) return; s_undo.push(cvs.getContext('2d').getImageData(0,0,cvs.width,cvs.height)); if (s_undo.length > 15) s_undo.shift(); }
  function doUndo() { if (!s_undo.length) return; cvs.getContext('2d').putImageData(s_undo.pop(), 0, 0); saveProg(); }
  function showWrap() { ul.style.display = 'none'; wrap.style.display = ''; tb.style.display = ''; syncC(); restrProg(); }
  function loadImg(src) {
    function ready() { img.onload = null; showWrap(); try { localStorage.setItem('p_img_'+sid, src); } catch(e) {} saveSections(); }
    img.onload = ready; img.src = src;
    if (img.complete && img.naturalWidth) ready();
  }
  function getPos(e) {
    const r = cvs.getBoundingClientRect(), sx = cvs.width/r.width, sy = cvs.height/r.height;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx-r.left)*sx, y: (cy-r.top)*sy };
  }
  function paint(e) {
    if (!s_painting) return; e.preventDefault();
    const ctx = cvs.getContext('2d'), { x, y } = getPos(e), r = parseInt(brushEl.value, 10);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
    if (s_eraser) {
      const g = ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(0.7,'rgba(0,0,0,1)'); g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = g; ctx.fill(); ctx.globalCompositeOperation = 'source-over';
    } else {
      const [r2,g2,b2] = [parseInt(s_color.slice(1,3),16), parseInt(s_color.slice(3,5),16), parseInt(s_color.slice(5,7),16)];
      const g = ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,s_color); g.addColorStop(0.6,s_color); g.addColorStop(1,`rgba(${r2},${g2},${b2},0)`);
      ctx.fillStyle = g; ctx.fill();
    }
  }

  // Events
  cvs.addEventListener('mousedown',  (e) => { pushU(); s_painting = true; paint(e); });
  cvs.addEventListener('mousemove',  paint);
  cvs.addEventListener('mouseup',    () => { s_painting = false; saveProg(); });
  cvs.addEventListener('mouseleave', () => s_painting = false);
  cvs.addEventListener('touchstart', (e) => { pushU(); s_painting = true; paint(e); }, { passive: false });
  cvs.addEventListener('touchmove',  paint, { passive: false });
  cvs.addEventListener('touchend',   () => { s_painting = false; saveProg(); });

  fi.addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = (ev) => loadImg(ev.target.result); rd.readAsDataURL(f); e.target.value = '';
  });
  ul.addEventListener('dragover',  (e) => { e.preventDefault(); ul.classList.add('drag-over'); });
  ul.addEventListener('dragleave', () => ul.classList.remove('drag-over'));
  ul.addEventListener('drop', (e) => {
    e.preventDefault(); ul.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) { const rd = new FileReader(); rd.onload = (ev) => loadImg(ev.target.result); rd.readAsDataURL(f); }
  });
  nameEl.addEventListener('change', () => { if (!nameEl.value.trim()) nameEl.value = 'Section '+sid; img.alt = nameEl.value; saveSections(); });
  removeEl.addEventListener('click', () => { localStorage.removeItem('p_img_'+sid); localStorage.removeItem('p_prog_'+sid); sec.remove(); saveSections(); });
  window.addEventListener('resize', () => { if (img.src) syncC(); });

  if (savedImg) loadImg(savedImg);
  return sec;
}

function saveSections() {
  const data = [...document.querySelectorAll('.p-section')].map(s => ({
    id: s.id.replace('p-sec-',''), name: s.querySelector('.p-sec-name').value
  }));
  localStorage.setItem('p_sections', JSON.stringify(data));
}

document.getElementById('addSectionBtn').addEventListener('click', () => {
  sectionCount++;
  document.getElementById('extraSections').appendChild(createSection(sectionCount, 'Section ' + sectionCount));
  saveSections();
});

// Restore extra sections
const savedSecs = localStorage.getItem('p_sections');
if (savedSecs) {
  try {
    JSON.parse(savedSecs).forEach(d => {
      const sid = parseInt(d.id); if (sid > sectionCount) sectionCount = sid;
      document.getElementById('extraSections').appendChild(createSection(sid, d.name, localStorage.getItem('p_img_'+sid)));
    });
  } catch(e) {}
}

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
