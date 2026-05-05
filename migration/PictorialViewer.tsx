"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../app/lib/supabase';

interface Page {
  id: string;
  name: string;
  floor_plan_url?: string | null;
  canvas_data?: string | null;
  status: string;
}

const COLORS = [
  { hex: '#22c55e', label: 'Complete' },
  { hex: '#eab308', label: 'In Progress' },
  { hex: '#f97316', label: 'Partial' },
  { hex: '#ef4444', label: 'Issue' },
  { hex: '#3b82f6', label: 'Inspected' },
];

const PictorialViewer: React.FC<{ projectId: string; zoneId?: string }> = ({ projectId, zoneId }) => {
  const [pages, setPages] = useState<Page[]>([]);
  const [deletedPages, setDeletedPages] = useState<Page[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showTrash, setShowTrash] = useState(false);

  // Toolbar display state (refs hold the real values; state drives re-renders)
  const [colorDisplay, setColorDisplay] = useState('#22c55e');
  const [eraserDisplay, setEraserDisplay] = useState(false);
  const [brushDisplay, setBrushDisplay] = useState(30);
  const [legendLabel, setLegendLabel] = useState('Complete');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPageName, setNewPageName] = useState('');
  const [showClearModal, setShowClearModal] = useState(false);
  const [deleteModalId, setDeleteModalId] = useState<string | null>(null);
  const [renameModalId, setRenameModalId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');

  // Paint state in refs — never trigger re-renders
  const isPainting = useRef(false);
  const colorRef = useRef('#22c55e');
  const eraserRef = useRef(false);
  const brushRef = useRef(30);

  // Per-page DOM element maps
  const canvasMap = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const imgMap = useRef<Map<string, HTMLImageElement>>(new Map());
  const undoMap = useRef<Map<string, ImageData[]>>(new Map());
  const saveTimerMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const wiredSet = useRef<Set<HTMLCanvasElement>>(new Set());

  // Always-fresh pages ref (assigned synchronously during render)
  const pagesRef = useRef<Page[]>(pages);
  pagesRef.current = pages;

  // Auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
  }, []);

  // Fetch all pages for this project/zone
  const fetchPages = useCallback(async () => {
    if (!projectId) return;
    let q = supabase
      .from('pictorial_pages')
      .select('id, name, floor_plan_url, canvas_data, status')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });
    if (zoneId) q = q.eq('zone_id', zoneId);
    const { data } = await q;
    if (!data) { setLoading(false); return; }
    const active = data.filter((p: Page) => p.status === 'active');
    const deleted = data.filter((p: Page) => p.status === 'deleted');
    setPages(active);
    setDeletedPages(deleted);
    setActivePageId(prev => prev ?? (active[0]?.id ?? null));
    setLoading(false);
  }, [projectId, zoneId]);

  useEffect(() => { fetchPages(); }, [fetchPages]);

  // Resize canvas to match image, restore saved paint if reset
  const syncAndRestore = useCallback((pageId: string) => {
    const canvas = canvasMap.current.get(pageId);
    const img = imgMap.current.get(pageId);
    if (!canvas || !img || !img.clientWidth) return;
    if (canvas.width === img.clientWidth && canvas.height === img.clientHeight) return;
    undoMap.current.delete(pageId);
    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;
    const page = pagesRef.current.find(p => p.id === pageId);
    if (page?.canvas_data) {
      const overlay = new Image();
      overlay.onload = () => canvas.getContext('2d')?.drawImage(overlay, 0, 0, canvas.width, canvas.height);
      overlay.src = page.canvas_data;
    }
  }, []);

  // When active page changes, sync canvas
  useEffect(() => {
    if (!activePageId) return;
    requestAnimationFrame(() => syncAndRestore(activePageId));
  }, [activePageId, syncAndRestore]);

  // Resize handler
  useEffect(() => {
    const h = () => { if (activePageId) requestAnimationFrame(() => syncAndRestore(activePageId)); };
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, [activePageId, syncAndRestore]);

  // Debounced save to pictorial_pages.canvas_data
  const scheduleSave = useCallback((pageId: string) => {
    const t = saveTimerMap.current.get(pageId);
    if (t) clearTimeout(t);
    saveTimerMap.current.set(pageId, setTimeout(async () => {
      const canvas = canvasMap.current.get(pageId);
      if (!canvas || !canvas.width) return;
      const canvas_data = canvas.toDataURL();
      await supabase.from('pictorial_pages').update({ canvas_data }).eq('id', pageId);
    }, 1500));
  }, []);

  // Push ImageData to undo stack (max 15)
  const pushUndo = (pageId: string) => {
    const canvas = canvasMap.current.get(pageId);
    if (!canvas || !canvas.width) return;
    if (!undoMap.current.has(pageId)) undoMap.current.set(pageId, []);
    const stack = undoMap.current.get(pageId)!;
    stack.push(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height));
    if (stack.length > 15) stack.shift();
  };

  // Paint position (works for mouse and touch)
  const getPaintPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const touch = (e as TouchEvent).touches?.[0];
    const cx = touch ? touch.clientX : (e as MouseEvent).clientX;
    const cy = touch ? touch.clientY : (e as MouseEvent).clientY;
    return { x: (cx - rect.left) * scaleX, y: (cy - rect.top) * scaleY };
  };

  // Radial gradient paint / eraser
  const doPaint = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    if (!isPainting.current) return;
    e.preventDefault();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPaintPos(e, canvas);
    const r = brushRef.current;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (eraserRef.current) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.7, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = g;
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else {
      const hex = colorRef.current;
      const r2 = parseInt(hex.slice(1, 3), 16);
      const g2 = parseInt(hex.slice(3, 5), 16);
      const b2 = parseInt(hex.slice(5, 7), 16);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, hex);
      gr.addColorStop(0.6, hex);
      gr.addColorStop(1, `rgba(${r2},${g2},${b2},0)`);
      ctx.fillStyle = gr;
      ctx.fill();
    }
  };

  // Wire canvas mouse + touch events imperatively (passive:false required for touch preventDefault)
  const wireCanvas = useCallback((pageId: string, canvas: HTMLCanvasElement) => {
    const onMouseDown = (e: MouseEvent) => { pushUndo(pageId); isPainting.current = true; doPaint(e, canvas); };
    const onMouseMove = (e: MouseEvent) => { if (isPainting.current) doPaint(e, canvas); };
    const onMouseUp = () => { isPainting.current = false; scheduleSave(pageId); };
    const onMouseLeave = () => { isPainting.current = false; };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) return;
      canvas.style.touchAction = 'none';
      pushUndo(pageId); isPainting.current = true; doPaint(e, canvas);
    };
    const onTouchMove = (e: TouchEvent) => { if (isPainting.current) doPaint(e, canvas); };
    const onTouchEnd = () => { isPainting.current = false; canvas.style.touchAction = ''; scheduleSave(pageId); };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);
  }, [scheduleSave]);

  // Ref callbacks for canvas and img elements
  const canvasRefCb = useCallback((pageId: string) => (el: HTMLCanvasElement | null) => {
    if (el && !wiredSet.current.has(el)) {
      canvasMap.current.set(pageId, el);
      wiredSet.current.add(el);
      wireCanvas(pageId, el);
    } else if (!el) {
      canvasMap.current.delete(pageId);
    }
  }, [wireCanvas]);

  const imgRefCb = useCallback((pageId: string) => (el: HTMLImageElement | null) => {
    if (el) imgMap.current.set(pageId, el);
    else imgMap.current.delete(pageId);
  }, []);

  // Undo
  const undo = useCallback(() => {
    if (!activePageId) return;
    const canvas = canvasMap.current.get(activePageId);
    const stack = undoMap.current.get(activePageId);
    if (!canvas || !stack?.length) return;
    canvas.getContext('2d')?.putImageData(stack.pop()!, 0, 0);
    scheduleSave(activePageId);
  }, [activePageId, scheduleSave]);

  // Ctrl+Z
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [undo]);

  // Clear active canvas
  const clearCanvas = () => {
    if (!activePageId) return;
    const canvas = canvasMap.current.get(activePageId);
    if (!canvas) return;
    pushUndo(activePageId);
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    scheduleSave(activePageId);
    setShowClearModal(false);
  };

  // Add new section with floor plan image
  const handleAddPage = async (file: File) => {
    if (!user) return;
    setUploading(true);
    try {
      const path = `${projectId}/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, '_')}`;
      await supabase.storage.from('floor-plans').upload(path, file, { upsert: true });
      const { data: { publicUrl } } = supabase.storage.from('floor-plans').getPublicUrl(path);
      const { data, error } = await supabase.from('pictorial_pages').insert({
        project_id: projectId,
        zone_id: zoneId || null,
        name: newPageName.trim() || `Section ${pages.length + 1}`,
        floor_plan_url: publicUrl,
        created_by: user.id,
        status: 'active',
      }).select().single();
      if (error) throw error;
      setPages(prev => [...prev, data]);
      setActivePageId(data.id);
      setShowAddModal(false);
      setNewPageName('');
    } catch (err) {
      console.error('Error adding page:', err);
    } finally {
      setUploading(false);
    }
  };

  // Change/upload image for existing page
  const handleChangeImage = async (pageId: string, file: File) => {
    const path = `${projectId}/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, '_')}`;
    await supabase.storage.from('floor-plans').upload(path, file, { upsert: true });
    const { data: { publicUrl } } = supabase.storage.from('floor-plans').getPublicUrl(path);
    await supabase.from('pictorial_pages').update({ floor_plan_url: publicUrl, canvas_data: null }).eq('id', pageId);
    const canvas = canvasMap.current.get(pageId);
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    undoMap.current.delete(pageId);
    setPages(prev => prev.map(p => p.id === pageId ? { ...p, floor_plan_url: publicUrl, canvas_data: null } : p));
  };

  // Rename
  const handleRename = async () => {
    if (!renameModalId || !renameName.trim()) return;
    const name = renameName.trim();
    await supabase.from('pictorial_pages').update({ name }).eq('id', renameModalId);
    setPages(prev => prev.map(p => p.id === renameModalId ? { ...p, name } : p));
    setRenameModalId(null);
  };

  // Soft delete → trash
  const handleSoftDelete = async (pageId: string) => {
    await supabase.from('pictorial_pages').update({ status: 'deleted' }).eq('id', pageId);
    const page = pages.find(p => p.id === pageId);
    const remaining = pages.filter(p => p.id !== pageId);
    setPages(remaining);
    if (page) setDeletedPages(prev => [...prev, { ...page, status: 'deleted' }]);
    if (activePageId === pageId) setActivePageId(remaining[0]?.id ?? null);
    setDeleteModalId(null);
  };

  // Restore from trash
  const handleRestore = async (pageId: string) => {
    await supabase.from('pictorial_pages').update({ status: 'active' }).eq('id', pageId);
    const page = deletedPages.find(p => p.id === pageId);
    setDeletedPages(prev => prev.filter(p => p.id !== pageId));
    if (page) { setPages(prev => [...prev, { ...page, status: 'active' }]); setActivePageId(pageId); }
  };

  // Permanent delete
  const handlePermDelete = async (pageId: string) => {
    await supabase.from('pictorial_pages').delete().eq('id', pageId);
    setDeletedPages(prev => prev.filter(p => p.id !== pageId));
  };

  // PDF export using live canvas content
  const exportPDF = async () => {
    const pagesWithImg = pages.filter(p => p.floor_plan_url);
    if (!pagesWithImg.length) { alert('No floor plans. Upload an image first.'); return; }
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = 297, H = 210, m = 10, tH = 12;
    const maxW = W - m * 2, maxH = H - m - tH - 12;
    const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

    for (let i = 0; i < pagesWithImg.length; i++) {
      const pg = pagesWithImg[i];
      if (i > 0) doc.addPage();
      doc.setFillColor(15, 23, 42); doc.rect(0, 0, W, tH, 'F');
      doc.setFontSize(9); doc.setTextColor(148, 163, 184);
      doc.text('RealTimePlanners  •  Pictorial Progress Report', m, 7.5);
      doc.text(dateStr, W - m, 7.5, { align: 'right' });
      doc.setFontSize(13); doc.setTextColor(15, 23, 42);
      doc.text(pg.name, m, tH + 7);
      doc.setFontSize(8); doc.setTextColor(100, 116, 139);
      doc.text(`${i + 1} / ${pagesWithImg.length}`, W / 2, H - 3, { align: 'center' });

      const off = document.createElement('canvas');
      const ctx = off.getContext('2d')!;
      await new Promise<void>(res => {
        const base = new Image();
        base.crossOrigin = 'anonymous';
        base.onload = () => {
          off.width = base.naturalWidth; off.height = base.naturalHeight;
          ctx.drawImage(base, 0, 0);
          const canvasEl = canvasMap.current.get(pg.id);
          if (canvasEl && canvasEl.width) {
            ctx.globalAlpha = 0.5;
            ctx.drawImage(canvasEl, 0, 0, off.width, off.height);
            ctx.globalAlpha = 1;
          }
          res();
        };
        base.onerror = () => res();
        base.src = pg.floor_plan_url!;
      });
      if (off.width) {
        const asp = off.width / off.height;
        let w = maxW, h = maxW / asp;
        if (h > maxH) { h = maxH; w = maxH * asp; }
        doc.addImage(off.toDataURL('image/jpeg', 0.92), 'JPEG', (W - w) / 2, tH + 10, w, h);
      }
    }
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    doc.save(`pictorial_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.pdf`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Color swatches + legend */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              {COLORS.map(({ hex, label }) => (
                <button
                  key={hex}
                  onClick={() => { colorRef.current = hex; eraserRef.current = false; setColorDisplay(hex); setEraserDisplay(false); setLegendLabel(label); }}
                  title={label}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${colorDisplay === hex && !eraserDisplay ? 'border-white shadow-md scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-400" style={{ minHeight: '1rem' }}>
              {eraserDisplay ? 'Eraser' : legendLabel}
            </span>
          </div>

          <div className="w-px h-8 bg-gray-200 dark:bg-gray-600" />

          {/* Eraser */}
          <button
            onClick={() => { eraserRef.current = !eraserDisplay; setEraserDisplay(!eraserDisplay); }}
            title="Eraser"
            className={`p-1.5 rounded border transition-colors ${eraserDisplay ? 'bg-purple-900/30 border-purple-400 text-purple-400' : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>
              <path d="M22 21H7"/><path d="m5 11 9 9"/>
            </svg>
          </button>

          {/* Undo */}
          <button
            onClick={undo}
            title="Undo (Ctrl+Z)"
            className="p-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
            </svg>
          </button>

          <div className="w-px h-8 bg-gray-200 dark:bg-gray-600" />

          {/* Brush size */}
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/>
            </svg>
            <input
              type="range" min="10" max="70" value={brushDisplay}
              onChange={e => { const v = Number(e.target.value); brushRef.current = v; setBrushDisplay(v); }}
              className="w-20 accent-purple-500"
            />
            <span className="text-xs w-5">{brushDisplay}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-purple-400/40 bg-purple-900/10 text-purple-400 hover:bg-purple-900/25 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export PDF
          </button>
          <button
            onClick={() => setShowClearModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-red-400/30 bg-red-900/10 text-red-400 hover:bg-red-900/20 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            </svg>
            Clear
          </button>
        </div>
      </div>

      {/* ── Page tabs ── */}
      <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center gap-2 flex-wrap">
        {pages.map(page => (
          <div key={page.id} className="flex items-center group">
            <button
              onClick={() => setActivePageId(page.id)}
              className={`px-3 py-1 text-sm rounded-l transition-colors ${activePageId === page.id ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >
              {page.name}
            </button>
            <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => { setRenameModalId(page.id); setRenameName(page.name); }}
                title="Rename"
                className="px-1.5 py-1 bg-gray-100 dark:bg-gray-700 text-gray-400 hover:text-purple-500 transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button
                onClick={() => setDeleteModalId(page.id)}
                title="Delete"
                className="px-1.5 py-1 rounded-r bg-gray-100 dark:bg-gray-700 text-gray-400 hover:text-red-400 transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={() => setShowAddModal(true)}
          className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          + Add Section
        </button>
      </div>

      {/* ── Page content ── */}
      <div className="p-4">
        {pages.length === 0 ? (
          <div className="text-center py-16 text-gray-500 dark:text-gray-400">
            <p className="mb-4">No sections yet. Create your first section to start tracking progress.</p>
            <button onClick={() => setShowAddModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Create Section
            </button>
          </div>
        ) : (
          pages.map(page => (
            <div key={page.id} style={{ display: activePageId === page.id ? 'block' : 'none' }}>
              {page.floor_plan_url ? (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer transition-colors">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                      Change image
                      <input type="file" accept="image/*" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleChangeImage(page.id, f); e.target.value = ''; }} />
                    </label>
                    <span className="text-xs text-gray-400 dark:text-gray-500">Swipe over areas to mark progress</span>
                  </div>
                  <div className="relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 shadow" style={{ lineHeight: 0 }}>
                    <img
                      ref={imgRefCb(page.id)}
                      src={page.floor_plan_url}
                      alt={page.name}
                      draggable={false}
                      onLoad={() => requestAnimationFrame(() => syncAndRestore(page.id))}
                      className="block w-full h-auto"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    />
                    <canvas
                      ref={canvasRefCb(page.id)}
                      className="absolute inset-0 w-full h-full cursor-crosshair"
                      style={{ opacity: 0.5, touchAction: 'pan-y pinch-zoom' }}
                    />
                  </div>
                </>
              ) : (
                <label className="flex flex-col items-center justify-center gap-3 w-full min-h-64 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer text-purple-400 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-colors p-8 text-center">
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                  </svg>
                  <span className="text-base font-semibold text-gray-900 dark:text-white">Upload Floor Plan</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">Tap to select an image · or drag & drop</span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleChangeImage(page.id, f); e.target.value = ''; }} />
                </label>
              )}
            </div>
          ))
        )}

        {/* ── Trash ── */}
        {deletedPages.length > 0 && (
          <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
            <button
              onClick={() => setShowTrash(!showTrash)}
              className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
              </svg>
              Deleted Items
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-red-100 dark:bg-red-900/30 text-red-500 font-bold">{deletedPages.length}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${showTrash ? '' : '-rotate-90'}`}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {showTrash && (
              <div className="mt-2 flex flex-col gap-1">
                {deletedPages.map(page => (
                  <div key={page.id} className="flex items-center gap-2 px-3 py-1.5 rounded bg-gray-50 dark:bg-gray-700/50">
                    <span className="flex-1 text-sm text-gray-400 dark:text-gray-500">{page.name}</span>
                    <button onClick={() => handleRestore(page.id)} title="Restore" className="p-1 rounded text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
                      </svg>
                    </button>
                    <button onClick={() => handlePermDelete(page.id)} title="Delete permanently" className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                        <path d="M10 11v6"/><path d="M14 11v6"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Add Section Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) { setShowAddModal(false); setNewPageName(''); } }}>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Add Section</h3>
            <input
              type="text" placeholder="Section name (optional)"
              value={newPageName} onChange={e => setNewPageName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-4 text-sm"
            />
            <label className="flex flex-col items-center justify-center gap-2 w-full py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors text-gray-500 dark:text-gray-400">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span className="text-sm font-medium">{uploading ? 'Uploading...' : 'Select floor plan image'}</span>
              <input type="file" accept="image/*" className="hidden" disabled={uploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleAddPage(f); e.target.value = ''; }} />
            </label>
            <button onClick={() => { setShowAddModal(false); setNewPageName(''); }} className="mt-4 w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Clear Modal ── */}
      {showClearModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setShowClearModal(false); }}>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm shadow-2xl text-center">
            <svg className="mx-auto mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-2">Clear all progress?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">All painted areas will be removed. Use Undo immediately after to recover.</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => setShowClearModal(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
              <button onClick={clearCanvas} className="px-4 py-2 rounded-lg bg-red-500/20 border border-red-400/40 text-red-400 text-sm font-semibold hover:bg-red-500/30">Yes, clear all</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Modal ── */}
      {deleteModalId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setDeleteModalId(null); }}>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm shadow-2xl text-center">
            <svg className="mx-auto mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-2">Delete "{pages.find(p => p.id === deleteModalId)?.name}"?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Moved to Deleted Items. You can restore it anytime.</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => setDeleteModalId(null)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
              <button onClick={() => handleSoftDelete(deleteModalId)} className="px-4 py-2 rounded-lg bg-red-500/20 border border-red-400/40 text-red-400 text-sm font-semibold hover:bg-red-500/30">Move to Trash</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rename Modal ── */}
      {renameModalId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) setRenameModalId(null); }}>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-4">Rename Section</h3>
            <input
              type="text" value={renameName} onChange={e => setRenameName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenameModalId(null); }}
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm mb-4"
            />
            <div className="flex gap-2">
              <button onClick={() => setRenameModalId(null)} className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
              <button onClick={handleRename} className="flex-1 px-4 py-2 rounded-lg bg-purple-600/20 border border-purple-400/40 text-purple-400 text-sm font-semibold hover:bg-purple-600/30">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PictorialViewer;
