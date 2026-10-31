import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, apiFetchBlob } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/utils"
import { PdfPreviewModal } from "@/components/pdf-viewer/PdfPreviewModal"
import { CheckCircle2, ChevronLeft, ChevronRight, Download, FileText, Film, Image as ImageIcon, X } from "lucide-react"

interface Att {
  id: string
  filename: string
  content_type: string
  size_bytes?: number
}

interface ReviewEntry {
  id: string
  work_date: string
  client_name?: string | null
  project_name?: string | null
  task_title?: string | null
  description?: string | null
  notes?: string | null
  start_time?: string | null
  end_time?: string | null
  hours: string
  source?: string
  status?: string
  attachments: Att[]
}

interface ReviewPayload {
  timesheet: {
    id: string
    va_id: string
    va_name?: string | null
    period_start: string
    period_end: string
    status: string
    entry_count: number
    total_hours: string
  }
  entries: ReviewEntry[]
}

function isImage(ctype: string) {
  return (ctype || "").toLowerCase().startsWith("image/")
}
function isVideo(ctype: string) {
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

function hoursMinutes(hoursStr: string) {
  const h = Number(hoursStr || 0)
  const whole = Math.floor(h)
  const mins = Math.round((h - whole) * 60)
  if (whole === 0) return `${mins} min`
  if (mins === 0) return `${whole} hr${whole === 1 ? "" : "s"}`
  return `${whole} hr${whole === 1 ? "" : "s"} ${mins} min`
}

function AttachmentThumb({
  att,
  url,
  onOpen,
}: {
  att: Att
  url?: string
  onOpen: () => void
}) {
  if (url && isImage(att.content_type)) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border bg-muted/40"
        title={att.filename}
      >
        <img src={url} alt={att.filename} className="h-full w-full object-cover transition group-hover:scale-105" />
      </button>
    )
  }
  if (url && isVideo(att.content_type)) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="relative flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-slate-900"
        title={att.filename}
      >
        <video src={url} className="absolute inset-0 h-full w-full object-cover opacity-70" muted />
        <Film className="relative z-10 h-6 w-6 text-white" />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border bg-muted/40 px-1 text-center"
      title={att.filename}
    >
      {isImage(att.content_type) ? <ImageIcon className="h-5 w-5 text-muted-foreground" /> : <FileText className="h-5 w-5 text-muted-foreground" />}
      <span className="line-clamp-2 text-[9px] font-medium leading-tight">{att.filename}</span>
    </button>
  )
}

export function TimesheetReviewPanel({
  timesheetId,
  onClose,
}: {
  timesheetId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ["timesheet-review", timesheetId],
    queryFn: () => apiFetch<ReviewPayload>(`/payroll/timesheets/${timesheetId}/entries`),
  })

  const allAtts = useMemo(
    () => (data?.entries ?? []).flatMap((e) => e.attachments.map((a) => ({ ...a, entryId: e.id }))),
    [data],
  )
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [blobs, setBlobs] = useState<Record<string, Blob>>({})
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null)
  const [active, setActive] = useState<Att | null>(null)
  const [pdf, setPdf] = useState<Att | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const images = useMemo(() => allAtts.filter((a) => isImage(a.content_type)), [allAtts])
  const attKey = allAtts.map((a) => a.id).join(",")

  useEffect(() => {
    let cancelled = false
    const created: string[] = []
    const load = async () => {
      const nextUrls: Record<string, string> = {}
      const nextBlobs: Record<string, Blob> = {}
      for (const a of allAtts) {
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
    if (allAtts.length) void load()
    else {
      setUrls({})
      setBlobs({})
    }
    return () => {
      cancelled = true
      created.forEach((u) => URL.revokeObjectURL(u))
    }
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
    if (isImage(a.content_type)) {
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

  const approve = useMutation({
    mutationFn: () => apiFetch(`/payroll/timesheets/${timesheetId}/review`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll"] })
      qc.invalidateQueries({ queryKey: ["timesheet-review", timesheetId] })
      onClose()
    },
  })

  const sheet = data?.timesheet
  const reviewed = sheet?.status === "reviewed"

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-3xl flex-col bg-card shadow-2xl animate-in slide-in-from-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Timesheet Review</p>
            <h2 className="font-display text-lg font-bold">{sheet?.va_name || "VA"}</h2>
            {sheet && (
              <p className="text-xs text-muted-foreground">
                {formatDate(sheet.period_start)} – {formatDate(sheet.period_end)}
                {" · "}
                {sheet.entry_count} entries · {hoursMinutes(sheet.total_hours)}
                {" · "}
                <span className="capitalize font-semibold text-foreground">{sheet.status}</span>
              </p>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading && <p className="text-sm text-muted-foreground">Loading timesheet entries…</p>}
          {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{(error as Error).message}</p>}
          {!isLoading && data?.entries.length === 0 && (
            <p className="rounded-xl border bg-muted/30 p-6 text-center text-sm text-muted-foreground">No entries in this timesheet.</p>
          )}

          <div className="space-y-4">
            {(data?.entries ?? []).map((entry) => (
              <article key={entry.id} className="rounded-2xl border bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">{formatDate(entry.work_date)}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.client_name}
                      {entry.project_name ? ` · ${entry.project_name}` : ""}
                      {entry.start_time && entry.end_time ? ` · ${entry.start_time}–${entry.end_time}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-extrabold">{hoursMinutes(entry.hours)}</p>
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                      {entry.source === "clock" ? "Clock" : "Manual"} · {entry.status}
                    </p>
                  </div>
                </div>

                {entry.task_title && (
                  <p className="mt-2 text-[11px] font-semibold text-violet-700">Task: {entry.task_title}</p>
                )}
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{entry.description || "—"}</p>
                {entry.notes && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span className="font-bold">Comments: </span>
                    {entry.notes}
                  </p>
                )}

                {entry.attachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.attachments.map((a) => (
                      <AttachmentThumb key={a.id} att={a} url={urls[a.id]} onOpen={() => openAttachment(a)} />
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-5 py-4">
          <p className="text-xs text-muted-foreground">
            Review every entry and attachment, then approve to unlock the Payroll PDF.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            {!reviewed && (
              <Button
                variant="success"
                disabled={approve.isPending || isLoading}
                onClick={() => approve.mutate()}
              >
                <CheckCircle2 className="h-4 w-4" />
                {approve.isPending ? "Approving…" : "Approve timesheet"}
              </Button>
            )}
            {reviewed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1.5 text-xs font-bold text-green-800">
                <CheckCircle2 className="h-3.5 w-3.5" /> Already approved
              </span>
            )}
          </div>
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
              <Button size="sm" variant="outline" className="bg-white" onClick={() => setActive(null)}>Close</Button>
            </div>
            {urls[active.id] && isVideo(active.content_type) && (
              <video src={urls[active.id]} controls autoPlay className="max-h-[85vh] max-w-full rounded-lg" />
            )}
            {urls[active.id] && !isVideo(active.content_type) && canEmbed(active.content_type) && !previewFailed && (
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
            {(!urls[active.id] || previewFailed || (!isVideo(active.content_type) && !canEmbed(active.content_type))) && (
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
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80"
          onClick={(e) => { e.stopPropagation(); setPdf(null) }}
        >
          <p className="text-sm text-white">Loading preview…</p>
        </div>
      )}
    </div>
  )
}
