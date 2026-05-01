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
    img.src = user.photoURL; img.alt = name;
    avatarEl.appendChild(img);
    const img2 = document.createElement('img');
    img2.src = user.photoURL; img2.alt = name;
    topbarAvatarEl.appendChild(img2);
  } else {
    const initial = name.charAt(0).toUpperCase();
    avatarEl.textContent = initial;
    topbarAvatarEl.textContent = initial;
  }
});

document.getElementById('signOutBtn').addEventListener('click', () => {
  firebase.auth().signOut().catch(() => {}).finally(() => { window.location.href = 'index.html'; });
});

// ── Sidebar ──────────────────────────────────────────────────────────
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const burger  = document.getElementById('burger');

function openSidebar()  { sidebar.classList.add('open'); overlay.classList.add('show'); burger.classList.add('open'); }
function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('show'); burger.classList.remove('open'); }

burger.addEventListener('click', () => sidebar.classList.contains('open') ? closeSidebar() : openSidebar());
overlay.addEventListener('click', closeSidebar);

// ── Group expand / collapse ──────────────────────────────────────────
document.querySelectorAll('.nav-group-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const group    = btn.dataset.group;
    const children = document.getElementById('children-' + group);
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    children.classList.toggle('collapsed', expanded);
  });
});

// ── Non-pictorial nav items ──────────────────────────────────────────
const comingSoon         = document.getElementById('comingSoon');
const pictorialContainer = document.getElementById('pictorialContainer');
const pageTitleEl        = document.getElementById('pageTitle');
const csTitleEl          = document.getElementById('csTitle');

function setActiveNonPictorial(tabName) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${CSS.escape(tabName)}"]`)?.classList.add('active');

  pictorialContainer.style.display = 'none';

  comingSoon.style.display = '';
  comingSoon.style.animation = 'none';
  comingSoon.offsetHeight;
  comingSoon.style.animation = '';

  pageTitleEl.textContent = tabName;
  csTitleEl.textContent   = tabName;

  document.getElementById('contentArea').classList.remove('pictorial-active');
  if (window.innerWidth <= 768) closeSidebar();
}

document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
  item.addEventListener('click', () => setActiveNonPictorial(item.dataset.tab));
});

// ── Pictorial — multi-page canvas ────────────────────────────────────
let isPainting   = false;
let isEraser     = false;
let currentColor = '#22c55e';
let activeCanvas = null;
let activePageId = null;
const undoStacks = new Map();
const MAX_UNDO   = 15;

let renamingPageId    = null;
let deletingPageId    = null;
let clearTargetPageId = null;
let deletedPages      = [];

// pictorialPages: [{id, name}]
let pictorialPages = [];

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function getPaintPos(e, canvas) {
  const rect   = canvas.getBoundingClientRect();
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
  const r = parseInt(document.getElementById('brushSize').value, 10);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (isEraser) {
    const g = ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(0.7,'rgba(0,0,0,1)'); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = g; ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  } else {
    const [r2,g2,b2] = hexToRgb(currentColor);
    const g = ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0, currentColor); g.addColorStop(0.6, currentColor);
    g.addColorStop(1, `rgba(${r2},${g2},${b2},0)`);
    ctx.fillStyle = g; ctx.fill();
  }
}

function setEraser(active) {
  isEraser = active;
  document.getElementById('eraserBtn').classList.toggle('active', active);
}

function pushUndo(canvas) {
  canvas = canvas || activeCanvas;
  if (!canvas || !canvas.width) return;
  if (!undoStacks.has(canvas)) undoStacks.set(canvas, []);
  const stack = undoStacks.get(canvas);
  stack.push(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
  if (stack.length > MAX_UNDO) stack.shift();
}

function undo() {
  if (!activeCanvas) return;
  const stack = undoStacks.get(activeCanvas);
  if (!stack || !stack.length) return;
  activeCanvas.getContext('2d').putImageData(stack.pop(), 0, 0);
  if (activePageId) savePageProgress(activePageId);
}

function syncPageCanvas(pageId) {
  const img    = document.getElementById(`p-img-${pageId}`);
  const canvas = document.getElementById(`p-cvs-${pageId}`);
  if (!img || !canvas || !img.clientWidth) return false;
  // Only reset canvas dimensions when they have actually changed (avoids clearing painted content)
  if (canvas.width === img.clientWidth && canvas.height === img.clientHeight) return false;
  undoStacks.delete(canvas);
  canvas.width  = img.clientWidth;
  canvas.height = img.clientHeight;
  return true; // signals that canvas was reset and progress should be restored
}

function savePageProgress(pageId) {
  const canvas = document.getElementById(`p-cvs-${pageId}`);
  if (!canvas || !canvas.width) return;
  try { localStorage.setItem(`pp_${pageId}`, canvas.toDataURL()); } catch(e) {}
}

function restorePageProgress(pageId) {
  const saved  = localStorage.getItem(`pp_${pageId}`);
  const canvas = document.getElementById(`p-cvs-${pageId}`);
  if (!saved || !canvas) return;
  const img = new Image();
  img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  img.src = saved;
}

function loadPageImage(pageId, src) {
  const img    = document.getElementById(`p-img-${pageId}`);
  const wrap   = document.getElementById(`p-wrap-${pageId}`);
  const upload = document.getElementById(`p-up-${pageId}`);
  const hint   = document.getElementById('pictorialHint');
  if (!img) return;
  function onReady() {
    img.onload = null;
    upload.style.display = 'none';
    wrap.style.display   = '';
    if (hint) hint.style.display = '';
    const actions = document.querySelector(`#pict-page-${pageId} .page-img-actions`);
    if (actions) actions.style.display = 'flex';
    try { localStorage.setItem(`pp_img_${pageId}`, src); } catch(e) {}
    // If the page is already visible, sync + restore now (new upload while viewing).
    // If hidden, setActivePage will sync + restore when the user navigates to it.
    const pageEl = document.getElementById(`pict-page-${pageId}`);
    if (pageEl && pageEl.style.display !== 'none') {
      requestAnimationFrame(() => {
        if (syncPageCanvas(pageId)) restorePageProgress(pageId);
        activeCanvas = document.getElementById(`p-cvs-${pageId}`);
      });
    }
  }
  img.onload = onReady;
  img.src = src;
  if (img.complete && img.naturalWidth) onReady();
}

function buildPageHTML(pageId, pageName) {
  return `
<div class="pict-page" id="pict-page-${pageId}" style="display:none">
  <div class="page-img-actions">
    <button class="btn-change-img btn-page-change" data-pid="${pageId}" title="Change image">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      Change image
    </button>
    <input type="file" class="page-file-input" id="p-fi-${pageId}" data-pid="${pageId}" accept="image/*" style="display:none" />
  </div>
  <label class="pictorial-upload-area" id="p-up-${pageId}">
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
    </svg>
    <span class="upload-title">Upload Floor Plan</span>
    <span class="upload-sub">Tap to select an image &nbsp;·&nbsp; or drag &amp; drop</span>
    <input type="file" class="page-file-input-label" data-pid="${pageId}" accept="image/*" style="display:none" />
  </label>
  <div class="pictorial-wrap" id="p-wrap-${pageId}" style="display:none">
    <img id="p-img-${pageId}" alt="${pageName}" draggable="false" />
    <canvas id="p-cvs-${pageId}" class="p-canvas" data-pid="${pageId}"></canvas>
  </div>
</div>`;
}

function wirePageEvents(pageId) {
  const canvas   = document.getElementById(`p-cvs-${pageId}`);
  const upload   = document.getElementById(`p-up-${pageId}`);
  const fi       = document.getElementById(`p-fi-${pageId}`);
  const labelFi  = upload.querySelector('.page-file-input-label');

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => loadPageImage(pageId, ev.target.result);
    reader.readAsDataURL(file);
  }

  // Label click → file input
  upload.addEventListener('click', () => labelFi.click());
  labelFi.addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });

  // Change button
  document.querySelector(`.btn-page-change[data-pid="${pageId}"]`).addEventListener('click', () => {
    localStorage.removeItem(`pp_${pageId}`);
    fi.click();
  });
  fi.addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });

  // Drag & drop
  upload.addEventListener('dragover',  e => { e.preventDefault(); upload.classList.add('drag-over'); });
  upload.addEventListener('dragleave', ()  => upload.classList.remove('drag-over'));
  upload.addEventListener('drop', e => {
    e.preventDefault(); upload.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });

  // Paint events
  canvas.addEventListener('mousedown',  e => { activeCanvas = canvas; pushUndo(canvas); isPainting = true; doPaint(e, canvas); });
  canvas.addEventListener('mousemove',  e => { if (isPainting && activeCanvas === canvas) doPaint(e, canvas); });
  canvas.addEventListener('mouseup',    ()  => { isPainting = false; savePageProgress(pageId); });
  canvas.addEventListener('mouseleave', ()  => { isPainting = false; });
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length > 1) return; // let 2-finger pinch-zoom through
    canvas.style.touchAction = 'none';
    activeCanvas = canvas; pushUndo(canvas); isPainting = true; doPaint(e, canvas);
  }, { passive: false });
  canvas.addEventListener('touchmove',  e => {
    if (!isPainting || activeCanvas !== canvas) return;
    doPaint(e, canvas);
  }, { passive: false });
  canvas.addEventListener('touchend', () => {
    isPainting = false;
    canvas.style.touchAction = '';   // restore browser zoom/scroll
    savePageProgress(pageId);
  });
  canvas.addEventListener('touchcancel', () => {
    isPainting = false;
    canvas.style.touchAction = '';
  });
}

function buildNavItemHTML(pageId, pageName) {
  return `
<div class="nav-item-wrap" id="nav-wrap-${pageId}">
  <button class="nav-item" data-page="${pageId}">
    <span class="nav-dot"></span>
    <span class="nav-page-label" id="nav-label-${pageId}">${pageName}</span>
  </button>
  <button class="btn-nav-rename-page" data-page="${pageId}" title="Rename">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  </button>
  <button class="btn-nav-remove-page" data-page="${pageId}" title="Delete">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  </button>
</div>`;
}

function wireNavItemEvents(pageId) {
  const navBtn    = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  const renameBtn = document.querySelector(`.btn-nav-rename-page[data-page="${pageId}"]`);
  const removeBtn = document.querySelector(`.btn-nav-remove-page[data-page="${pageId}"]`);

  navBtn.addEventListener('click', () => setActivePage(pageId));

  renameBtn.addEventListener('click', e => {
    e.stopPropagation();
    const page  = pictorialPages.find(p => p.id === pageId);
    const input = document.getElementById('renamePageInput');
    input.value  = page ? page.name : '';
    renamingPageId = pageId;
    document.getElementById('renamePageModal').classList.add('show');
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });

  removeBtn.addEventListener('click', e => {
    e.stopPropagation();
    const page = pictorialPages.find(p => p.id === pageId);
    document.getElementById('deletingPageName').textContent = page ? page.name : 'Section';
    deletingPageId = pageId;
    document.getElementById('deletePageModal').classList.add('show');
  });
}

function savePageList() {
  try {
    localStorage.setItem('pict_pages', JSON.stringify(pictorialPages.map(p => ({ id: p.id, name: p.name }))));
  } catch(e) {}
}

function saveDeletedList() {
  try { localStorage.setItem('pict_deleted', JSON.stringify(deletedPages.map(p => ({ id: p.id, name: p.name })))); } catch(e) {}
}

function buildDeletedItemHTML(page) {
  return `
<div class="nav-item-wrap nav-deleted-item" id="del-wrap-${page.id}">
  <span class="nav-item nav-deleted-label">
    <span class="nav-dot"></span>
    <span class="nav-page-label">${page.name}</span>
  </span>
  <button class="btn-nav-restore" data-delid="${page.id}" title="Restore">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
    </svg>
  </button>
  <button class="btn-nav-perma-delete" data-delid="${page.id}" title="Delete permanently">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/>
    </svg>
  </button>
</div>`;
}

function renderDeletedSection() {
  const existing = document.getElementById('deleted-items-section');
  if (existing) existing.remove();
  if (!deletedPages.length) return;

  document.getElementById('children-pictorial').insertAdjacentHTML('beforeend', `
<div id="deleted-items-section" style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px">
  <button class="nav-trash-toggle" id="trashToggleBtn" aria-expanded="false">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/>
    </svg>
    <span style="flex:1;text-align:left;font-size:0.8rem">Deleted Items</span>
    <span class="trash-badge">${deletedPages.length}</span>
    <span class="trash-chevron">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </span>
  </button>
  <div class="nav-children collapsed" id="children-deleted">
    ${deletedPages.map(p => buildDeletedItemHTML(p)).join('')}
  </div>
</div>`);

  document.getElementById('trashToggleBtn').addEventListener('click', () => {
    const btn = document.getElementById('trashToggleBtn');
    const ch  = document.getElementById('children-deleted');
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    ch.classList.toggle('collapsed', expanded);
  });

  deletedPages.forEach(p => wireDeletedItemEvents(p.id));
}

function wireDeletedItemEvents(pageId) {
  const restoreBtn = document.querySelector(`.btn-nav-restore[data-delid="${pageId}"]`);
  const permaBtn   = document.querySelector(`.btn-nav-perma-delete[data-delid="${pageId}"]`);

  restoreBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const idx = deletedPages.findIndex(p => p.id === pageId);
    if (idx === -1) return;
    const page = deletedPages.splice(idx, 1)[0];
    saveDeletedList();

    pictorialPages.push(page);
    savePageList();

    document.getElementById('pictorialPageContent').insertAdjacentHTML('beforeend', buildPageHTML(page.id, page.name));
    wirePageEvents(page.id);

    // Insert nav item before deleted section
    const delSection = document.getElementById('deleted-items-section');
    if (delSection) {
      delSection.insertAdjacentHTML('beforebegin', buildNavItemHTML(page.id, page.name));
    } else {
      document.getElementById('children-pictorial').insertAdjacentHTML('beforeend', buildNavItemHTML(page.id, page.name));
    }
    wireNavItemEvents(page.id);

    const src = localStorage.getItem(`pp_img_${page.id}`);
    if (src) loadPageImage(page.id, src);

    renderDeletedSection();
    setActivePage(page.id);
  });

  permaBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const idx = deletedPages.findIndex(p => p.id === pageId);
    if (idx === -1) return;
    deletedPages.splice(idx, 1);
    saveDeletedList();
    localStorage.removeItem(`pp_img_${pageId}`);
    localStorage.removeItem(`pp_${pageId}`);
    renderDeletedSection();
  });
}

function setActivePage(pageId, keepSidebar) {
  activePageId = pageId;
  activeCanvas = null;

  comingSoon.style.display = 'none';
  pictorialContainer.style.display = 'flex';
  document.getElementById('contentArea').classList.add('pictorial-active');

  const page = pictorialPages.find(p => p.id === pageId);
  pageTitleEl.textContent = page ? page.name : 'Pictorial';

  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${pageId}"]`)?.classList.add('active');

  document.querySelectorAll('.pict-page').forEach(el => el.style.display = 'none');
  const pageEl = document.getElementById(`pict-page-${pageId}`);
  if (pageEl) pageEl.style.display = '';

  // After the page is visible, sync canvas dimensions and restore painted progress.
  // Use RAF so the browser has reflowed and img.clientWidth is accurate.
  const canvas = document.getElementById(`p-cvs-${pageId}`);
  const wrap   = document.getElementById(`p-wrap-${pageId}`);
  if (canvas && wrap && wrap.style.display !== 'none') {
    requestAnimationFrame(() => {
      if (syncPageCanvas(pageId)) restorePageProgress(pageId);
      activeCanvas = canvas;
    });
  }

  if (!keepSidebar && window.innerWidth <= 768) closeSidebar();
}

function addPage(pageId, pageName, restore) {
  const maxId = pictorialPages.reduce((m, p) => Math.max(m, p.id), 0);
  pageId   = pageId   || maxId + 1;
  pageName = pageName || `Section ${pageId}`;
  pictorialPages.push({ id: pageId, name: pageName });

  const delSection = document.getElementById('deleted-items-section');
  if (delSection) {
    delSection.insertAdjacentHTML('beforebegin', buildNavItemHTML(pageId, pageName));
  } else {
    document.getElementById('children-pictorial').insertAdjacentHTML('beforeend', buildNavItemHTML(pageId, pageName));
  }
  wireNavItemEvents(pageId);

  document.getElementById('pictorialPageContent').insertAdjacentHTML('beforeend', buildPageHTML(pageId, pageName));
  wirePageEvents(pageId);

  if (restore) {
    const src = localStorage.getItem(`pp_img_${pageId}`);
    if (src) loadPageImage(pageId, src);
  } else {
    savePageList();
  }

  return pageId;
}

// ── Toolbar ───────────────────────────────────────────────────────────
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
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); } });

// Fit / reset-zoom button
document.getElementById('fitBtn').addEventListener('click', () => {
  // Scroll pictorial content back to top
  document.getElementById('pictorialPageContent').scrollTop = 0;
  // Reset native browser zoom via viewport meta trick
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) {
    const orig = meta.getAttribute('content');
    meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
    setTimeout(() => meta.setAttribute('content', orig), 300);
  }
  // Re-sync canvas after zoom reset
  if (activePageId) requestAnimationFrame(() => syncPageCanvas(activePageId));
});

// Periodic auto-save every 4 seconds (backup in case touch events are missed)
setInterval(() => {
  if (activePageId && activeCanvas && activeCanvas.width) savePageProgress(activePageId);
}, 4000);

// ── Clear modal ──────────────────────────────────────────────────────
const clearModal = document.getElementById('clearModal');
document.getElementById('clearCanvas').addEventListener('click', () => {
  if (!activePageId) return;
  const canvas = document.getElementById(`p-cvs-${activePageId}`);
  if (!canvas || !canvas.width) return;
  clearTargetPageId = activePageId;
  clearModal.classList.add('show');
});
document.getElementById('cancelClearBtn').addEventListener('click', () => {
  clearModal.classList.remove('show');
  clearTargetPageId = null;
});
document.getElementById('confirmClearBtn').addEventListener('click', () => {
  clearModal.classList.remove('show');
  if (!clearTargetPageId) return;
  const canvas = document.getElementById(`p-cvs-${clearTargetPageId}`);
  if (canvas) {
    pushUndo(canvas);
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    localStorage.removeItem(`pp_${clearTargetPageId}`);
  }
  clearTargetPageId = null;
});
clearModal.addEventListener('click', e => {
  if (e.target === clearModal) { clearModal.classList.remove('show'); clearTargetPageId = null; }
});

// ── Rename modal ──────────────────────────────────────────────────────
const renameModal = document.getElementById('renamePageModal');
document.getElementById('cancelRenameBtn').addEventListener('click', () => {
  renameModal.classList.remove('show'); renamingPageId = null;
});
document.getElementById('confirmRenameBtn').addEventListener('click', () => {
  if (!renamingPageId) { renameModal.classList.remove('show'); return; }
  const newName = document.getElementById('renamePageInput').value.trim() || 'Untitled';
  const page    = pictorialPages.find(p => p.id === renamingPageId);
  if (page) {
    page.name = newName;
    const labelEl = document.getElementById(`nav-label-${renamingPageId}`);
    if (labelEl) labelEl.textContent = newName;
    if (activePageId === renamingPageId) pageTitleEl.textContent = newName;
    savePageList();
  }
  renameModal.classList.remove('show'); renamingPageId = null;
});
document.getElementById('renamePageInput').addEventListener('keydown', e => {
  if (e.key === 'Enter')  document.getElementById('confirmRenameBtn').click();
  if (e.key === 'Escape') document.getElementById('cancelRenameBtn').click();
});
renameModal.addEventListener('click', e => {
  if (e.target === renameModal) { renameModal.classList.remove('show'); renamingPageId = null; }
});

// ── Delete-to-trash modal ─────────────────────────────────────────────
const deletePageModal = document.getElementById('deletePageModal');
document.getElementById('cancelDeletePageBtn').addEventListener('click', () => {
  deletePageModal.classList.remove('show'); deletingPageId = null;
});
document.getElementById('confirmDeletePageBtn').addEventListener('click', () => {
  if (!deletingPageId) { deletePageModal.classList.remove('show'); return; }
  const pageId = deletingPageId;
  deletePageModal.classList.remove('show'); deletingPageId = null;

  const idx = pictorialPages.findIndex(p => p.id === pageId);
  if (idx === -1) return;
  const page = pictorialPages.splice(idx, 1)[0];
  savePageList();
  deletedPages.push(page);
  saveDeletedList();

  document.getElementById(`nav-wrap-${pageId}`)?.remove();
  document.getElementById(`pict-page-${pageId}`)?.remove();

  renderDeletedSection();

  if (activePageId === pageId) {
    activeCanvas  = null;
    activePageId  = null;
    if (pictorialPages.length) {
      setActivePage(pictorialPages[0].id);
    } else {
      pictorialContainer.style.display = 'none';
      comingSoon.style.display = '';
      pageTitleEl.textContent  = 'Pictorial';
    }
  }
});
deletePageModal.addEventListener('click', e => {
  if (e.target === deletePageModal) { deletePageModal.classList.remove('show'); deletingPageId = null; }
});

// ── Add page button (sidebar + button) ──────────────────────────────
document.getElementById('addPictorialPageBtn').addEventListener('click', e => {
  e.stopPropagation();
  const newId = addPage();
  setActivePage(newId, true); // keep sidebar open so user sees the new page
  const groupBtn = document.querySelector('.nav-group-btn[data-group="pictorial"]');
  if (groupBtn && groupBtn.getAttribute('aria-expanded') === 'false') groupBtn.click();
});

// ── Migrate old localStorage format ──────────────────────────────────
(function migrateOldData() {
  const oldImg = localStorage.getItem('floorPlanSrc');
  if (!oldImg) return;

  // Only migrate if the new-format image for page 1 isn't already stored
  if (!localStorage.getItem('pp_img_1')) {
    localStorage.setItem('pp_img_1', oldImg);
  }
  localStorage.removeItem('floorPlanSrc');

  const prog1 = localStorage.getItem('pictorialProgress');
  if (prog1) { localStorage.setItem('pp_1', prog1); localStorage.removeItem('pictorialProgress'); }

  // Rebuild page list starting with Section 1
  const pages = [{ id: 1, name: localStorage.getItem('p_sec1_name') || 'Section 1' }];

  // Migrate any extra sections added via the old Add Section button
  let sid = 2;
  while (localStorage.getItem('p_img_' + sid)) {
    const secName = localStorage.getItem('p_sec' + sid + '_name') || ('Section ' + sid);
    pages.push({ id: sid, name: secName });
    localStorage.setItem('pp_img_' + sid, localStorage.getItem('p_img_' + sid));
    const sp = localStorage.getItem('p_prog_' + sid);
    if (sp) { localStorage.setItem('pp_' + sid, sp); localStorage.removeItem('p_prog_' + sid); }
    localStorage.removeItem('p_img_' + sid);
    sid++;
  }

  // Overwrite pict_pages with migrated data
  localStorage.setItem('pict_pages', JSON.stringify(pages));
})();

// ── Restore from localStorage ─────────────────────────────────────────
const savedPages = localStorage.getItem('pict_pages');
let firstPageId = null;
if (savedPages) {
  try {
    const parsed = JSON.parse(savedPages);
    if (parsed.length) {
      parsed.forEach(p => { const id = addPage(p.id, p.name, true); if (firstPageId === null) firstPageId = id; });
    } else {
      firstPageId = addPage();
    }
  } catch(e) { firstPageId = addPage(); }
} else {
  firstPageId = addPage();
}

// Restore deleted pages list and render trash section
const savedDeleted = localStorage.getItem('pict_deleted');
if (savedDeleted) {
  try { deletedPages = JSON.parse(savedDeleted); } catch(e) { deletedPages = []; }
}
renderDeletedSection();

// Start on Schedules (not pictorial)
document.querySelector('.nav-item[data-tab="Schedules"]')?.classList.add('active');

window.addEventListener('resize', () => {
  if (activePageId && pictorialContainer.style.display !== 'none') {
    requestAnimationFrame(() => {
      if (syncPageCanvas(activePageId)) restorePageProgress(activePageId);
    });
  }
});

// ── Sidebar collapse (desktop) ───────────────────────────────────────
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

if (localStorage.getItem('sidebarCollapsed') && window.innerWidth > 768) {
  sidebar.classList.add('desktop-collapsed');
  mainEl.classList.add('desktop-collapsed');
  expandSidebarBtn.style.display = 'flex';
}
