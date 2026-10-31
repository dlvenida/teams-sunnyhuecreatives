import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { apiFetch, apiFetchBlob } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { PdfPreviewModal } from "@/components/pdf-viewer/PdfPreviewModal"
import { ChevronLeft, ChevronRight, Download, FileText, Film, Image as ImageIcon } from "lucide-react"

interface Att {
  id: string
  filename: string
  content_type: string
}

const EMPTY: Att[] = []

function isImageType(ctype: string) {
  return (ctype || "").toLowerCase().startsWith("image/")
}
function isVideoType(ctype: string) {
  return (ctype || "").toLowerCase().startsWith("video/")
}
function isPdf(att: Att) {
  const c = (att.content_type || "").toLowerCase()
  const name = (att.filename || "").toLowerCase()
  return c.includes("pdf") || name.endsWith(".pdf")
}
function canEmbed(ctype: string) {
  const c = (ctype || "").toLowerCase()
  return c.startsWith("text/") || c.includes("json") || c.includes("xml") || c === "image/svg+xml"
}

export function LogAttachmentsViewer({ logId, onClose }: { logId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["log-atts", logId],
    queryFn: () => apiFetch<Att[]>(`/work-logs/${logId}/attachments`),
  })
  const atts = data ?? EMPTY
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [blobs, setBlobs] = useState<Record<string, Blob>>({})
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null)
  const [active, setActive] = useState<Att | null>(null)
  const [pdf, setPdf] = useState<Att | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)

  const images = useMemo(() => atts.filter((a) => isImageType(a.content_type)), [atts])
  const attKey = atts.map((a) => a.id).join(",")

  useEffect(() => {
    let cancelled = false
    const created: string[] = []
    const load = async () => {
      const nextUrls: Record<string, string> = {}
      const nextBlobs: Record<string, Blob> = {}
      for (const a of atts) {
        try {
          const blob = await apiFetchBlob(`/work-logs/attachments/${a.id}/content`)
          if (!blob || cancelled) continue
          const url = URL.createObjectURL(blob)
          created.push(url)
          nextUrls[a.id] = url
          nextBlobs[a.id] = blob
        } catch {
          /* skip broken attachment */
        }
      }
      if (cancelled) {
        created.forEach((u) => URL.revokeObjectURL(u))
        return
      }
      setUrls(nextUrls)
      setBlobs(nextBlobs)
    }
    if (atts.length) void load()
    else {
      setUrls({})
      setBlobs({})
    }
    return () => {
      cancelled = true
      created.forEach((u) => URL.revokeObjectURL(u))
    }
    // attKey tracks the attachment set; atts is the list for that key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attKey])

  useEffect(() => {
    if (galleryIndex == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGalleryIndex(null)
      if (e.key === "ArrowRight") setGalleryIndex((i) => (i == null ? i : Math.min(images.length - 1, i + 1)))
      if (e.key === "ArrowLeft") setGalleryIndex((i) => (i == null ? i : Math.max(0, i - 1)))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [galleryIndex, images.length])

  const openAttachment = (a: Att) => {
    setPreviewFailed(false)
    if (isImageType(a.content_type)) {
      const idx = images.findIndex((img) => img.id === a.id)
      setGalleryIndex(idx >= 0 ? idx : 0)
      setActive(null)
      setPdf(null)
      return
    }
    if (isPdf(a)) {
      setPdf(a)
      setGalleryIndex(null)
      setActive(null)
      return
    }
    setActive(a)
    setGalleryIndex(null)
    setPdf(null)
  }

  const galleryAtt = galleryIndex != null ? images[galleryIndex] : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Attachments</h2>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && atts.length === 0 && <p className="text-xs text-muted-foreground">No files attached.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {atts.map((a) => {
            const image = isImageType(a.content_type)
            const video = isVideoType(a.content_type)
            return (
              <button
                key={a.id}
                type="button"
                className="overflow-hidden rounded-xl border text-left transition hover:ring-2 hover:ring-primary/30"
                onClick={() => openAttachment(a)}
              >
                {image && urls[a.id] ? (
                  <img src={urls[a.id]} alt={a.filename} className="max-h-64 w-full object-contain bg-muted/30" />
                ) : video && urls[a.id] ? (
                  <div className="relative flex h-40 items-center justify-center bg-slate-900">
                    <video src={urls[a.id]} className="absolute inset-0 h-full w-full object-cover opacity-70" muted />
                    <Film className="relative z-10 h-8 w-8 text-white" />
                  </div>
                ) : (
                  <div className="flex h-28 flex-col items-center justify-center gap-2 bg-muted/30 px-3 text-center text-xs text-muted-foreground">
                    {image ? <ImageIcon className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
                    <span className="line-clamp-2 font-medium text-foreground">{a.filename}</span>
                    <span>{a.content_type || "file"}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
                  <p className="truncate text-[11px] text-muted-foreground">{a.filename}</p>
                  <span className="text-[10px] font-semibold text-primary">Preview</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {galleryAtt && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          onClick={(e) => { e.stopPropagation(); setGalleryIndex(null) }}
        >
          <div className="relative flex w-full max-w-5xl items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0 bg-white"
              disabled={galleryIndex === 0}
              aria-label="Previous image"
              onClick={() => setGalleryIndex((i) => (i == null ? i : Math.max(0, i - 1)))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center justify-between gap-2 text-white">
                <p className="truncate text-sm font-semibold">
                  {galleryAtt.filename}
                  <span className="ml-2 font-normal text-white/70">{(galleryIndex ?? 0) + 1} / {images.length}</span>
                </p>
                <div className="flex gap-2">
                  {urls[galleryAtt.id] && (
                    <a
                      href={urls[galleryAtt.id]}
                      download={galleryAtt.filename}
                      className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-[11px] font-semibold text-foreground"
                    >
                      <Download className="h-3 w-3" /> Save
                    </a>
                  )}
                  <Button size="sm" variant="outline" className="bg-white" onClick={() => setGalleryIndex(null)}>Close</Button>
                </div>
              </div>
              {urls[galleryAtt.id] ? (
                <img src={urls[galleryAtt.id]} alt={galleryAtt.filename} className="max-h-[80vh] w-full rounded-lg object-contain" />
              ) : (
                <p className="py-16 text-center text-sm text-white">Loading preview…</p>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0 bg-white"
              disabled={galleryIndex == null || galleryIndex >= images.length - 1}
              aria-label="Next image"
              onClick={() => setGalleryIndex((i) => (i == null ? i : Math.min(images.length - 1, i + 1)))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {active && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          onClick={(e) => { e.stopPropagation(); setActive(null) }}
        >
          <div className="relative max-h-[90vh] w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end gap-2">
              {urls[active.id] && (
                <a
                  href={urls[active.id]}
                  download={active.filename}
                  className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-[11px] font-semibold"
                >
                  <Download className="h-3 w-3" /> Save
                </a>
              )}
              <Button size="sm" variant="outline" className="bg-white" onClick={() => setActive(null)}>Close</Button>
            </div>
            {urls[active.id] && isVideoType(active.content_type) && (
              <video src={urls[active.id]} controls autoPlay className="max-h-[85vh] max-w-full rounded-lg" />
            )}
            {urls[active.id] && !isVideoType(active.content_type) && canEmbed(active.content_type) && !previewFailed && (
              <div>
                <iframe
                  title={active.filename}
                  src={urls[active.id]}
                  className="h-[75vh] w-full rounded-lg bg-white"
                  onError={() => setPreviewFailed(true)}
                />
                <p className="mt-2 text-center text-xs text-white">
                  If this preview is blank,{" "}
                  <a href={urls[active.id]} download={active.filename} className="font-semibold underline">download the file</a>.
                </p>
              </div>
            )}
            {(!urls[active.id] || previewFailed || (!isVideoType(active.content_type) && !canEmbed(active.content_type))) && (
              <div className="rounded-2xl bg-card p-8 text-center">
                <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="font-semibold">{active.filename}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {urls[active.id] ? "This file can’t be previewed in the browser." : "Loading preview…"}
                </p>
                {urls[active.id] && (
                  <a href={urls[active.id]} download={active.filename} className="mt-3 inline-block text-sm font-semibold text-primary underline">
                    Download file
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {pdf && blobs[pdf.id] && (
        <PdfPreviewModal blob={blobs[pdf.id]} filename={pdf.filename} onClose={() => setPdf(null)} />
      )}
      {pdf && !blobs[pdf.id] && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          onClick={(e) => { e.stopPropagation(); setPdf(null) }}
        >
          <p className="text-sm text-white">Loading preview…</p>
        </div>
      )}
    </div>
  )
}
