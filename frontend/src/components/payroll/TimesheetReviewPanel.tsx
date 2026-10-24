import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, apiFetchBlob } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/utils"
import { CheckCircle2, FileText, Film, Image as ImageIcon, X } from "lucide-react"

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
  const [lightbox, setLightbox] = useState<Att | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const next: Record<string, string> = {}
      for (const a of allAtts) {
        try {
          const blob = await apiFetchBlob(`/work-logs/attachments/${a.id}/content`)
          if (blob && !cancelled) next[a.id] = URL.createObjectURL(blob)
        } catch {
          /* skip broken attachment */
        }
      }
      if (!cancelled) setUrls(next)
    }
    if (allAtts.length) load()
    return () => {
      cancelled = true
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAtts.map((a) => a.id).join(",")])

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
                      <AttachmentThumb key={a.id} att={a} url={urls[a.id]} onOpen={() => setLightbox(a)} />
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

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-h-[90vh] max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="outline"
              className="absolute -right-2 -top-10 bg-white"
              onClick={() => setLightbox(null)}
            >
              Close
            </Button>
            {urls[lightbox.id] && isImage(lightbox.content_type) && (
              <img src={urls[lightbox.id]} alt={lightbox.filename} className="max-h-[85vh] max-w-full rounded-lg object-contain" />
            )}
            {urls[lightbox.id] && isVideo(lightbox.content_type) && (
              <video src={urls[lightbox.id]} controls autoPlay className="max-h-[85vh] max-w-full rounded-lg" />
            )}
            {urls[lightbox.id] && !isImage(lightbox.content_type) && !isVideo(lightbox.content_type) && (
              <div className="rounded-2xl bg-card p-8 text-center">
                <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="font-semibold">{lightbox.filename}</p>
                <a href={urls[lightbox.id]} download={lightbox.filename} className="mt-3 inline-block text-sm font-semibold text-primary underline">
                  Open / download file
                </a>
              </div>
            )}
            {!urls[lightbox.id] && <p className="text-sm text-white">Loading preview…</p>}
          </div>
        </div>
      )}
    </div>
  )
}
