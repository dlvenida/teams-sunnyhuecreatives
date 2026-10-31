import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import * as pdfjsLib from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { Button } from "@/components/ui/button"
import {
  ChevronLeft, ChevronRight, Download, Loader2, Maximize, RotateCw, X, ZoomIn, ZoomOut,
} from "lucide-react"
import { cn } from "@/lib/utils"

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface PdfPreviewModalProps {
  blob: Blob | null
  filename: string
  onClose: () => void
}

/**
 * React PDF viewer (pdfjs-dist, rendered to canvas in React — replaces
 * @react-pdf-kit/viewer). Supports paging, zoom, rotate, fit-width and download.
 */
export function ReactPdfViewer({ blob, filename, onClose }: PdfPreviewModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docRef = useRef<any>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.25)
  const [rotation, setRotation] = useState(0)
  const [loading, setLoading] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!blob) { setUrl(null); return }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    setPage(1); setRotation(0); setScale(1.25); setError("")
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  useEffect(() => {
    if (!blob) return
    let cancelled = false
    setLoading(true)
    blob.arrayBuffer()
      .then((data) => pdfjsLib.getDocument({ data }).promise)
      .then((doc) => {
        if (cancelled) return
        docRef.current = doc
        setNumPages(doc.numPages)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setError("Could not open this PDF. Try downloading it instead."); setLoading(false) } })
    return () => { cancelled = true; docRef.current?.destroy?.(); docRef.current = null }
  }, [blob])

  const renderPage = useCallback(async () => {
    const doc = docRef.current
    const canvas = canvasRef.current
    if (!doc || !canvas) return
    renderTaskRef.current?.cancel()
    setRendering(true)
    try {
      const pdfPage = await doc.getPage(page)
      const viewport = pdfPage.getViewport({ scale, rotation })
      const dpr = window.devicePixelRatio || 1
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      const task = pdfPage.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      renderTaskRef.current = task
      await task.promise
    } catch {
      /* cancelled render */
    } finally {
      setRendering(false)
    }
  }, [page, scale, rotation, numPages])

  useEffect(() => { void renderPage() }, [renderPage])

  useEffect(() => {
    if (!blob) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowRight") setPage((p) => Math.min(numPages || p, p + 1))
      if (e.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [blob, numPages, onClose])

  if (!blob || !url) return null

  const download = () => {
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
  }
  const fitWidth = async () => {
    const doc = docRef.current; const container = containerRef.current
    if (!doc || !container) return
    const pdfPage = await doc.getPage(page)
    const base = pdfPage.getViewport({ scale: 1, rotation })
    setScale(Math.max(0.4, Math.min(3, (container.clientWidth - 32) / base.width)))
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 sm:p-4" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div className="flex h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:px-4">
          <h2 className="min-w-0 flex-1 truncate font-display text-sm font-semibold sm:text-base">{filename}</h2>
          <div className="flex items-center gap-1 text-xs">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} title="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="whitespace-nowrap px-1 font-medium">
              <input
                className="w-10 rounded border bg-background px-1 py-0.5 text-center"
                value={page}
                inputMode="numeric"
                onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) setPage(Math.max(1, Math.min(numPages || 1, n))) }}
              /> / {numPages || "…"}
            </span>
            <Button variant="ghost" size="sm" disabled={page >= numPages} onClick={() => setPage((p) => Math.min(numPages, p + 1))} title="Next page"><ChevronRight className="h-4 w-4" /></Button>
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
            <Button variant="ghost" size="sm" onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(2)))} title="Zoom out"><ZoomOut className="h-4 w-4" /></Button>
            <span className="w-11 text-center font-medium">{Math.round(scale * 100)}%</span>
            <Button variant="ghost" size="sm" onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))} title="Zoom in"><ZoomIn className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => void fitWidth()} title="Fit width"><Maximize className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setRotation((r) => (r + 90) % 360)} title="Rotate"><RotateCw className="h-4 w-4" /></Button>
          </div>
          <Button variant="gold" size="sm" onClick={download}><Download className="h-4 w-4" /> Download</Button>
          <Button variant="ghost" size="sm" onClick={onClose} title="Close (Esc)"><X className="h-4 w-4" /></Button>
        </div>

        <div ref={containerRef} className={cn("flex-1 overflow-auto bg-slate-200/70 p-4 dark:bg-slate-900/60")}>
          {loading ? (
            <p className="flex items-center justify-center gap-2 pt-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading PDF…</p>
          ) : error ? (
            <div className="mx-auto mt-16 max-w-sm rounded-xl border bg-card p-5 text-center text-sm">
              <p className="font-semibold">Preview unavailable</p>
              <p className="mt-1 text-muted-foreground">{error}</p>
              <Button variant="gold" size="sm" className="mt-3" onClick={download}><Download className="h-4 w-4" /> Download PDF</Button>
            </div>
          ) : (
            <div className="relative mx-auto w-fit">
              {rendering && <span className="absolute right-2 top-2 z-10 rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold text-white">Rendering…</span>}
              <canvas ref={canvasRef} className="rounded-sm bg-white shadow-xl" />
            </div>
          )}
        </div>
        <p className="border-t px-4 py-1.5 text-center text-[10px] text-muted-foreground">Use ← → to change pages · Scroll to zoom through the document · Download saves the original PDF</p>
      </div>
    </div>,
    document.body,
  )
}

// Backwards-compatible name used by Invoices / Reports / Payroll pages.
export function PdfPreviewModal(props: PdfPreviewModalProps) {
  return <ReactPdfViewer {...props} />
}
