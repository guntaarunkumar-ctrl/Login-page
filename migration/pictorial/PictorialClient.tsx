// Drop this file into: apps/admin/src/app/pictorial/PictorialClient.tsx
// Also copy pictorial.module.css into the same folder.
//
// Requires:
//   - apps/admin/src/app/lib/supabase.ts  (already exists in your project)
//   - Supabase table: pictorial_sections   (run migration/pictorial-schema.sql)
//   - Supabase Storage bucket: pictorial-images (created by the SQL above)
//   - npm install jspdf  (for PDF export)
//
// How project ID is resolved (in priority order):
//   1. URL query param:  /pictorial?project=<uuid>
//   2. localStorage key: currentProjectId

'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import styles from './pictorial.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Section {
  id: string
  project_id: string
  name: string
  sort_order: number
  floor_plan_url: string | null
  canvas_data: string | null
  deleted_at: string | null
}

type PaintColor = '#22c55e' | '#eab308' | '#f97316' | '#ef4444' | '#3b82f6'

const COLORS: { hex: PaintColor; label: string }[] = [
  { hex: '#22c55e', label: 'Complete' },
  { hex: '#eab308', label: 'In Progress' },
  { hex: '#f97316', label: 'Partial' },
  { hex: '#ef4444', label: 'Issue' },
  { hex: '#3b82f6', label: 'Inspected' },
]

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PictorialClient() {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [deletedSections, setDeletedSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(true)

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [showPictorial, setShowPictorial] = useState(false)
  const [activeTab, setActiveTab] = useState('Schedules')

  const [currentColor, setCurrentColor] = useState<PaintColor>('#22c55e')
  const [isEraser, setIsEraser] = useState(false)
  const [brushSize, setBrushSize] = useState(30)
  const [colorLabel, setColorLabel] = useState('Complete')

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [planningOpen, setPlanningOpen] = useState(true)
  const [pictorialOpen, setPictorialOpen] = useState(true)
  const [qsOpen, setQsOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)

  const [showClearModal, setShowClearModal] = useState(false)
  const [renameModal, setRenameModal] = useState<{ id: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteModal, setDeleteModal] = useState<{ id: string; name: string } | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

  // Canvas state in refs — avoids triggering re-renders during painting
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const imgRefs = useRef<Map<string, HTMLImageElement>>(new Map())
  const undoStacks = useRef<Map<string, ImageData[]>>(new Map())
  const activeCanvas = useRef<HTMLCanvasElement | null>(null)
  const isPainting = useRef(false)
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Keep mutable tool values in refs so canvas handlers always read the latest
  const colorRef = useRef<PaintColor>('#22c55e')
  const eraserRef = useRef(false)
  const brushRef = useRef(30)
  useEffect(() => { colorRef.current = currentColor }, [currentColor])
  useEffect(() => { eraserRef.current = isEraser }, [isEraser])
  useEffect(() => { brushRef.current = brushSize }, [brushSize])

  // ── Load project ID from URL or localStorage ────────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const pid = params.get('project') || localStorage.getItem('currentProjectId')
    setProjectId(pid)
    if (!pid) setLoading(false)
  }, [])

  // ── Fetch sections from Supabase ────────────────────────────────────────────

  useEffect(() => {
    if (!projectId) return
    let mounted = true

    async function load() {
      setLoading(true)
      const [{ data: active }, { data: deleted }] = await Promise.all([
        supabase
          .from('pictorial_sections')
          .select('*')
          .eq('project_id', projectId)
          .is('deleted_at', null)
          .order('sort_order'),
        supabase
          .from('pictorial_sections')
          .select('*')
          .eq('project_id', projectId)
          .not('deleted_at', 'is', null)
          .order('deleted_at', { ascending: false }),
      ])
      if (!mounted) return
      setSections(active ?? [])
      setDeletedSections(deleted ?? [])
      if (active?.length) {
        setActiveSectionId(active[0].id)
        setShowPictorial(true)
      }
      setLoading(false)
    }

    load()
    return () => { mounted = false }
  }, [projectId])

  // ── Sidebar collapsed state (persisted) ────────────────────────────────────

  useEffect(() => {
    if (localStorage.getItem('sidebarCollapsed') && window.innerWidth > 768) {
      setSidebarCollapsed(true)
    }
  }, [])

  function toggleSidebarCollapse() {
    setSidebarCollapsed(prev => {
      if (!prev) localStorage.setItem('sidebarCollapsed', '1')
      else localStorage.removeItem('sidebarCollapsed')
      return !prev
    })
  }

  // ── Canvas helpers ──────────────────────────────────────────────────────────

  function getPaintPos(e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const src = (e as TouchEvent).touches
      ? (e as TouchEvent).touches[0]
      : (e as MouseEvent)
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY,
    }
  }

  function doPaint(e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) {
    if (!isPainting.current) return
    const ctx = canvas.getContext('2d')!
    const { x, y } = getPaintPos(e, canvas)
    const r = brushRef.current
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)

    if (eraserRef.current) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(0.7, 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = g
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    } else {
      const [r2, g2, b2] = hexToRgb(colorRef.current)
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, colorRef.current)
      g.addColorStop(0.6, colorRef.current)
      g.addColorStop(1, `rgba(${r2},${g2},${b2},0)`)
      ctx.fillStyle = g
      ctx.fill()
    }
  }

  function pushUndo(canvas: HTMLCanvasElement) {
    if (!canvas.width || !canvas.dataset.sid) return
    const stack = undoStacks.current.get(canvas.dataset.sid) ?? []
    stack.push(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height))
    if (stack.length > 15) stack.shift()
    undoStacks.current.set(canvas.dataset.sid, stack)
  }

  const undo = useCallback(() => {
    const canvas = activeCanvas.current
    if (!canvas?.dataset.sid) return
    const stack = undoStacks.current.get(canvas.dataset.sid)
    if (!stack?.length) return
    canvas.getContext('2d')!.putImageData(stack.pop()!, 0, 0)
    scheduleSave(canvas.dataset.sid)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function syncCanvas(sectionId: string): boolean {
    const canvas = canvasRefs.current.get(sectionId)
    const img = imgRefs.current.get(sectionId)
    if (!canvas || !img || !img.clientWidth) return false
    if (canvas.width === img.clientWidth && canvas.height === img.clientHeight) return false
    undoStacks.current.delete(sectionId)
    canvas.width = img.clientWidth
    canvas.height = img.clientHeight
    return true
  }

  function restoreCanvasData(sectionId: string, canvasData: string | null) {
    if (!canvasData) return
    const canvas = canvasRefs.current.get(sectionId)
    if (!canvas) return
    const overlay = new Image()
    overlay.onload = () =>
      canvas.getContext('2d')!.drawImage(overlay, 0, 0, canvas.width, canvas.height)
    overlay.src = canvasData
  }

  function scheduleSave(sectionId: string) {
    const existing = saveTimers.current.get(sectionId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(async () => {
      const canvas = canvasRefs.current.get(sectionId)
      if (!canvas || !canvas.width) return
      const data = canvas.toDataURL()
      await supabase
        .from('pictorial_sections')
        .update({ canvas_data: data })
        .eq('id', sectionId)
      saveTimers.current.delete(sectionId)
      setSections(prev =>
        prev.map(s => (s.id === sectionId ? { ...s, canvas_data: data } : s))
      )
    }, 1500)
    saveTimers.current.set(sectionId, timer)
  }

  // ── Keyboard undo ───────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  // ── Auto-save every 4 s ─────────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => {
      if (activeSectionId && activeCanvas.current?.width) scheduleSave(activeSectionId)
    }, 4000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSectionId])

  // ── Resize: re-sync canvas ──────────────────────────────────────────────────

  useEffect(() => {
    function onResize() {
      if (!activeSectionId || !showPictorial) return
      requestAnimationFrame(() => {
        const section = sections.find(s => s.id === activeSectionId)
        if (syncCanvas(activeSectionId))
          restoreCanvasData(activeSectionId, section?.canvas_data ?? null)
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSectionId, showPictorial, sections])

  // ── Navigation ──────────────────────────────────────────────────────────────

  function openSection(id: string) {
    setActiveSectionId(id)
    setShowPictorial(true)
    setActiveTab('')
    if (window.innerWidth <= 768) setSidebarOpen(false)
    requestAnimationFrame(() => {
      const section = sections.find(s => s.id === id)
      const canvas = canvasRefs.current.get(id)
      const img = imgRefs.current.get(id)
      if (canvas && img && img.clientWidth) {
        if (syncCanvas(id)) restoreCanvasData(id, section?.canvas_data ?? null)
        activeCanvas.current = canvas
      }
    })
  }

  function openTab(tab: string) {
    setActiveTab(tab)
    setShowPictorial(false)
    setActiveSectionId(null)
    if (window.innerWidth <= 768) setSidebarOpen(false)
  }

  // ── Section CRUD ────────────────────────────────────────────────────────────

  async function addSection() {
    if (!projectId) return
    const { data: { user } } = await supabase.auth.getUser()
    const name = `Section ${sections.length + 1}`
    const { data, error } = await supabase
      .from('pictorial_sections')
      .insert({ project_id: projectId, name, sort_order: sections.length, created_by: user?.id })
      .select()
      .single()
    if (error || !data) return
    setSections(prev => [...prev, data])
    openSection(data.id)
  }

  async function renameSection(id: string, name: string) {
    const trimmed = name.trim() || 'Untitled'
    await supabase.from('pictorial_sections').update({ name: trimmed }).eq('id', id)
    setSections(prev => prev.map(s => (s.id === id ? { ...s, name: trimmed } : s)))
  }

  async function softDelete(id: string) {
    const now = new Date().toISOString()
    await supabase.from('pictorial_sections').update({ deleted_at: now }).eq('id', id)
    const section = sections.find(s => s.id === id)!
    setSections(prev => prev.filter(s => s.id !== id))
    setDeletedSections(prev => [{ ...section, deleted_at: now }, ...prev])
    if (activeSectionId === id) {
      const remaining = sections.filter(s => s.id !== id)
      if (remaining.length) openSection(remaining[0].id)
      else { setActiveSectionId(null); setShowPictorial(false) }
    }
  }

  async function restoreSection(id: string) {
    await supabase.from('pictorial_sections').update({ deleted_at: null }).eq('id', id)
    const section = deletedSections.find(s => s.id === id)!
    setDeletedSections(prev => prev.filter(s => s.id !== id))
    setSections(prev => [...prev, { ...section, deleted_at: null }])
    openSection(id)
  }

  async function permanentDelete(id: string) {
    const section = deletedSections.find(s => s.id === id)
    await supabase.from('pictorial_sections').delete().eq('id', id)
    if (section?.floor_plan_url) {
      await supabase.storage.from('pictorial-images').remove([`${projectId}/${id}`])
    }
    setDeletedSections(prev => prev.filter(s => s.id !== id))
  }

  function clearCanvas(id: string) {
    const canvas = canvasRefs.current.get(id)
    if (!canvas || !canvas.width) return
    pushUndo(canvas)
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    scheduleSave(id)
  }

  // ── Image upload ────────────────────────────────────────────────────────────

  async function handleUpload(sectionId: string, file: File) {
    if (!file.type.startsWith('image/')) return
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `${projectId}/${sectionId}.${ext}`

    const { data, error } = await supabase.storage
      .from('pictorial-images')
      .upload(path, file, { upsert: true })

    const url = error
      ? URL.createObjectURL(file)
      : supabase.storage.from('pictorial-images').getPublicUrl(data.path).data.publicUrl

    await supabase
      .from('pictorial_sections')
      .update({ floor_plan_url: url, canvas_data: null })
      .eq('id', sectionId)

    setSections(prev =>
      prev.map(s => (s.id === sectionId ? { ...s, floor_plan_url: url, canvas_data: null } : s))
    )
  }

  function onImgLoad(sectionId: string, canvasData: string | null) {
    if (syncCanvas(sectionId)) restoreCanvasData(sectionId, canvasData)
    if (activeSectionId === sectionId)
      activeCanvas.current = canvasRefs.current.get(sectionId) ?? null
  }

  // ── PDF export ──────────────────────────────────────────────────────────────

  async function exportPdf() {
    const withImages = sections.filter(s => s.floor_plan_url)
    if (!withImages.length) {
      alert('Upload a floor plan image to at least one section first.')
      return
    }
    if (activeSectionId) scheduleSave(activeSectionId)
    setPdfLoading(true)
    try {
      const jspdf = await import('jspdf')
      const { jsPDF } = jspdf.default ?? jspdf
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pw = 297, ph = 210, mg = 10, th = 12
      const mw = pw - mg * 2, mh = ph - mg - th - 12
      const now = new Date()
      const dateStr = now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      const pad = (n: number) => String(n).padStart(2, '0')
      const filename = `pictorial-progress_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.pdf`

      for (let i = 0; i < withImages.length; i++) {
        const section = withImages[i]
        if (i > 0) doc.addPage()

        doc.setFillColor(15, 23, 42)
        doc.rect(0, 0, pw, th, 'F')
        doc.setFontSize(9).setTextColor(148, 163, 184)
        doc.text('Pictorial Progress Report', mg, 7.5)
        doc.text(dateStr, pw - mg, 7.5, { align: 'right' })
        doc.setFontSize(13).setTextColor(15, 23, 42)
        doc.text(section.name, mg, th + 7)
        doc.setFontSize(8).setTextColor(100, 116, 139)
        doc.text(`${i + 1} / ${withImages.length}`, pw / 2, ph - 3, { align: 'center' })

        const off = document.createElement('canvas')
        const ctx = off.getContext('2d')!
        await new Promise<void>(resolve => {
          const base = new Image()
          base.crossOrigin = 'anonymous'
          base.onload = () => {
            off.width = base.naturalWidth
            off.height = base.naturalHeight
            ctx.drawImage(base, 0, 0)
            const canvas = canvasRefs.current.get(section.id)
            const paintSrc = canvas?.width ? canvas.toDataURL() : section.canvas_data
            if (paintSrc) {
              const ov = new Image()
              ov.onload = () => {
                ctx.globalAlpha = 0.5
                ctx.drawImage(ov, 0, 0, off.width, off.height)
                ctx.globalAlpha = 1
                resolve()
              }
              ov.onerror = () => resolve()
              ov.src = paintSrc
            } else resolve()
          }
          base.onerror = () => resolve()
          base.src = section.floor_plan_url!
        })
        if (off.width && off.height) {
          const aspect = off.width / off.height
          let w = mw, h = mw / aspect
          if (h > mh) { h = mh; w = mh * aspect }
          doc.addImage(off.toDataURL('image/jpeg', 0.92), 'JPEG', (pw - w) / 2, th + 10, w, h)
        }
      }
      doc.save(filename)
    } catch {
      alert('PDF export failed. Please try again.')
    } finally {
      setPdfLoading(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingSpinner} />
      </div>
    )
  }

  if (!projectId) {
    return (
      <div className={styles.loadingScreen}>
        <p style={{ color: '#8b8b9a' }}>No project selected. Go to Projects and select one first.</p>
      </div>
    )
  }

  const activeSection = sections.find(s => s.id === activeSectionId)

  return (
    <div className={styles.root}>
      {/* ── Mobile topbar ─────────────────────────────────────────── */}
      <header className={styles.topbar}>
        <button
          className={`${styles.burger} ${sidebarOpen ? styles.burgerOpen : ''}`}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        >
          <span /><span /><span />
        </button>
        <div className={styles.topbarBrand}>
          <div className={styles.brandIcon}>✦</div>
          <span>Project Hub</span>
        </div>
      </header>

      {/* ── Mobile overlay ────────────────────────────────────────── */}
      {sidebarOpen && (
        <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <aside
        className={[
          styles.sidebar,
          sidebarOpen ? styles.sidebarOpen : '',
          sidebarCollapsed ? styles.sidebarCollapsed : '',
        ].join(' ')}
      >
        <div className={styles.sidebarHeader}>
          <div className={styles.brandIcon}>✦</div>
          <span className={styles.sidebarTitle}>Project Hub</span>
          <button
            className={styles.btnCollapse}
            onClick={toggleSidebarCollapse}
            title="Collapse sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>

        <nav className={styles.nav}>
          {/* Planning */}
          <div className={styles.navGroup}>
            <button className={styles.navGroupBtn} onClick={() => setPlanningOpen(v => !v)}>
              <span className={styles.navIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </span>
              <span className={styles.navLabel}>Planning</span>
              <span className={`${styles.chevron} ${planningOpen ? styles.chevronOpen : ''}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>
            <div className={`${styles.navChildren} ${!planningOpen ? styles.navChildrenHidden : ''}`}>
              {['Schedules', 'Planning Reports'].map(tab => (
                <button
                  key={tab}
                  className={`${styles.navItem} ${activeTab === tab && !showPictorial ? styles.navItemActive : ''}`}
                  onClick={() => openTab(tab)}
                >
                  <span className={styles.navDot} />{tab}
                </button>
              ))}
            </div>
          </div>

          {/* Pictorial */}
          <div className={styles.navGroup}>
            <div className={styles.navGroupHeader}>
              <button className={styles.navGroupBtn} style={{ flex: 1 }} onClick={() => setPictorialOpen(v => !v)}>
                <span className={styles.navIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                    <path d="M13 13l6 6" />
                  </svg>
                </span>
                <span className={styles.navLabel}>Pictorial</span>
                <span className={`${styles.chevron} ${pictorialOpen ? styles.chevronOpen : ''}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </button>
              <button className={styles.btnNavAdd} onClick={addSection} title="Add section">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>

            {pictorialOpen && (
              <div className={styles.navChildren}>
                {sections.map(s => (
                  <div key={s.id} className={styles.navItemWrap}>
                    <button
                      className={`${styles.navItem} ${activeSectionId === s.id && showPictorial ? styles.navItemActive : ''}`}
                      onClick={() => openSection(s.id)}
                    >
                      <span className={styles.navDot} />
                      <span className={styles.navPageLabel}>{s.name}</span>
                    </button>
                    <button
                      className={styles.btnNavRename}
                      title="Rename"
                      onClick={e => {
                        e.stopPropagation()
                        setRenameModal({ id: s.id, name: s.name })
                        setRenameValue(s.name)
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      className={styles.btnNavRemove}
                      title="Delete"
                      onClick={e => {
                        e.stopPropagation()
                        setDeleteModal({ id: s.id, name: s.name })
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}

                {deletedSections.length > 0 && (
                  <div className={styles.trashSection}>
                    <button className={styles.trashToggle} onClick={() => setTrashOpen(v => !v)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6" /><path d="M14 11v6" />
                      </svg>
                      <span>Deleted Items</span>
                      <span className={styles.trashBadge}>{deletedSections.length}</span>
                      <span className={`${styles.chevron} ${trashOpen ? styles.chevronOpen : ''}`} style={{ marginLeft: 'auto' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </span>
                    </button>
                    {trashOpen && (
                      <div className={styles.navChildren}>
                        {deletedSections.map(s => (
                          <div key={s.id} className={`${styles.navItemWrap} ${styles.deletedItem}`}>
                            <span className={styles.deletedLabel}>
                              <span className={styles.navDot} />
                              <span className={styles.navPageLabel}>{s.name}</span>
                            </span>
                            <button className={styles.btnRestore} title="Restore" onClick={() => restoreSection(s.id)}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                              </svg>
                            </button>
                            <button className={styles.btnPermaDelete} title="Delete permanently" onClick={() => permanentDelete(s.id)}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
                                <path d="M10 11v6" /><path d="M14 11v6" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* QS & Billing */}
          <div className={styles.navGroup}>
            <button className={styles.navGroupBtn} onClick={() => setQsOpen(v => !v)}>
              <span className={styles.navIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </span>
              <span className={styles.navLabel}>QS &amp; Billing</span>
              <span className={`${styles.chevron} ${qsOpen ? styles.chevronOpen : ''}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>
            {qsOpen && (
              <div className={styles.navChildren}>
                {['BOQs', 'NT Items', 'Billing'].map(tab => (
                  <button
                    key={tab}
                    className={`${styles.navItem} ${activeTab === tab ? styles.navItemActive : ''}`}
                    onClick={() => openTab(tab)}
                  >
                    <span className={styles.navDot} />{tab}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>

        <div className={styles.sidebarFooter}>
          <button
            className={styles.btnLogout}
            onClick={async () => {
              await supabase.auth.signOut()
              window.location.href = '/'
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className={styles.logoutLabel}>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────── */}
      <main className={`${styles.main} ${sidebarCollapsed ? styles.mainCollapsed : ''}`}>
        <header className={styles.mainHeader}>
          <span className={styles.mainTitle}>
            {showPictorial && activeSection ? activeSection.name : activeTab || 'Pictorial'}
          </span>
        </header>

        <div className={`${styles.contentArea} ${showPictorial ? styles.pictorialActive : ''}`}>

          {/* Coming soon placeholder */}
          {!showPictorial && (
            <div className={styles.comingSoon}>
              <div className={styles.csIcon}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <h2 className={styles.csTitle}>{activeTab || 'Select a section'}</h2>
              <p className={styles.csText}>This section is coming soon.</p>
              <span className={styles.csBadge}>In Development</span>
            </div>
          )}

          {/* Pictorial canvas UI */}
          {showPictorial && (
            <div className={styles.pictorialContainer}>
              {/* Toolbar */}
              <div className={styles.toolbar}>
                <div className={styles.toolbarLeft}>
                  <div className={styles.colorLegendWrap}>
                    <div className={styles.colorSwatches}>
                      {COLORS.map(c => (
                        <button
                          key={c.hex}
                          className={`${styles.colorSwatch} ${currentColor === c.hex ? styles.colorSwatchActive : ''}`}
                          style={{ background: c.hex }}
                          title={c.label}
                          onMouseEnter={() => setColorLabel(c.label)}
                          onMouseLeave={() =>
                            setColorLabel(COLORS.find(x => x.hex === currentColor)?.label ?? '')
                          }
                          onClick={() => {
                            setCurrentColor(c.hex)
                            setIsEraser(false)
                            setColorLabel(c.label)
                          }}
                        />
                      ))}
                    </div>
                    <span className={styles.colorLegend}>{colorLabel}</span>
                  </div>

                  <div className={styles.toolbarSep} />

                  <button
                    className={`${styles.btnTool} ${isEraser ? styles.btnToolActive : ''}`}
                    title="Eraser"
                    onClick={() => setIsEraser(!isEraser)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
                      <path d="M22 21H7" /><path d="m5 11 9 9" />
                    </svg>
                  </button>

                  <button className={styles.btnTool} title="Undo (Ctrl+Z)" onClick={undo}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7v6h6" />
                      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                    </svg>
                  </button>

                  <div className={styles.toolbarSep} />

                  <div className={styles.brushWrap}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <input
                      type="range"
                      className={styles.brushSlider}
                      min="10" max="70"
                      value={brushSize}
                      onChange={e => setBrushSize(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className={styles.toolbarRight}>
                  <button
                    className={styles.btnExportPdf}
                    onClick={exportPdf}
                    disabled={pdfLoading}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    {pdfLoading ? 'Generating…' : 'Export PDF'}
                  </button>
                  <button
                    className={styles.btnClear}
                    onClick={() => activeSectionId && setShowClearModal(true)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6" /><path d="M14 11v6" />
                    </svg>
                    Clear
                  </button>
                </div>
              </div>

              {/* Section pages */}
              <div className={styles.pagesArea}>
                {sections.map(section => (
                  <div
                    key={section.id}
                    className={styles.pictPage}
                    style={{ display: activeSectionId === section.id ? '' : 'none' }}
                  >
                    {section.floor_plan_url ? (
                      <>
                        <div className={styles.imgActions}>
                          <label className={styles.btnChangeImg}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            Change image
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={e => {
                                const f = e.target.files?.[0]
                                if (f) handleUpload(section.id, f)
                                e.target.value = ''
                              }}
                            />
                          </label>
                        </div>
                        <div className={styles.canvasWrap}>
                          <img
                            ref={el => { if (el) imgRefs.current.set(section.id, el) }}
                            src={section.floor_plan_url}
                            alt={section.name}
                            draggable={false}
                            onLoad={() => onImgLoad(section.id, section.canvas_data)}
                          />
                          <canvas
                            ref={el => {
                              if (el) {
                                el.dataset.sid = section.id
                                canvasRefs.current.set(section.id, el)
                              }
                            }}
                            className={styles.paintCanvas}
                            onMouseDown={e => {
                              const c = canvasRefs.current.get(section.id)!
                              activeCanvas.current = c
                              pushUndo(c)
                              isPainting.current = true
                              doPaint(e.nativeEvent, c)
                            }}
                            onMouseMove={e => {
                              const c = canvasRefs.current.get(section.id)!
                              if (isPainting.current && activeCanvas.current === c)
                                doPaint(e.nativeEvent, c)
                            }}
                            onMouseUp={() => { isPainting.current = false; scheduleSave(section.id) }}
                            onMouseLeave={() => { isPainting.current = false }}
                            onTouchStart={e => {
                              if (e.touches.length > 1) return
                              const c = canvasRefs.current.get(section.id)!
                              activeCanvas.current = c
                              pushUndo(c)
                              isPainting.current = true
                              doPaint(e.nativeEvent, c)
                            }}
                            onTouchMove={e => {
                              const c = canvasRefs.current.get(section.id)!
                              if (isPainting.current && activeCanvas.current === c)
                                doPaint(e.nativeEvent, c)
                            }}
                            onTouchEnd={() => { isPainting.current = false; scheduleSave(section.id) }}
                            onTouchCancel={() => { isPainting.current = false }}
                          />
                        </div>
                        <p className={styles.hint}>Swipe over any room or area to mark it as complete</p>
                      </>
                    ) : (
                      <label className={styles.uploadArea}>
                        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                        <span className={styles.uploadTitle}>Upload Floor Plan</span>
                        <span className={styles.uploadSub}>Tap to select an image · or drag &amp; drop</span>
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={e => {
                            const f = e.target.files?.[0]
                            if (f) handleUpload(section.id, f)
                            e.target.value = ''
                          }}
                        />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Clear modal ─────────────────────────────────────────── */}
      {showClearModal && (
        <div
          className={styles.modalOverlay}
          onClick={e => { if (e.target === e.currentTarget) setShowClearModal(false) }}
        >
          <div className={styles.modal}>
            <div className={styles.modalIcon}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h3 className={styles.modalTitle}>Clear all progress?</h3>
            <p className={styles.modalBody}>
              All painted areas will be removed. You can recover with <strong>Undo</strong> immediately after.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.btnCancel} onClick={() => setShowClearModal(false)}>Cancel</button>
              <button
                className={styles.btnDanger}
                onClick={() => { if (activeSectionId) clearCanvas(activeSectionId); setShowClearModal(false) }}
              >
                Yes, clear all
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rename modal ─────────────────────────────────────────── */}
      {renameModal && (
        <div
          className={styles.modalOverlay}
          onClick={e => { if (e.target === e.currentTarget) setRenameModal(null) }}
        >
          <div className={styles.modal}>
            <h3 className={styles.modalTitle} style={{ marginBottom: '1rem' }}>Rename Section</h3>
            <input
              className={styles.renameInput}
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { renameSection(renameModal.id, renameValue); setRenameModal(null) }
                if (e.key === 'Escape') setRenameModal(null)
              }}
              autoFocus
            />
            <div className={styles.modalActions} style={{ marginTop: '1rem' }}>
              <button className={styles.btnCancel} onClick={() => setRenameModal(null)}>Cancel</button>
              <button
                className={styles.btnConfirm}
                onClick={() => { renameSection(renameModal.id, renameValue); setRenameModal(null) }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete modal ─────────────────────────────────────────── */}
      {deleteModal && (
        <div
          className={styles.modalOverlay}
          onClick={e => { if (e.target === e.currentTarget) setDeleteModal(null) }}
        >
          <div className={styles.modal}>
            <div className={styles.modalIcon}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
              </svg>
            </div>
            <h3 className={styles.modalTitle}>Delete &ldquo;{deleteModal.name}&rdquo;?</h3>
            <p className={styles.modalBody}>
              The floor plan and all painted progress will be moved to <strong>Deleted Items</strong>. You can restore it from there.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.btnCancel} onClick={() => setDeleteModal(null)}>Cancel</button>
              <button
                className={styles.btnDanger}
                onClick={() => { softDelete(deleteModal.id); setDeleteModal(null) }}
              >
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
