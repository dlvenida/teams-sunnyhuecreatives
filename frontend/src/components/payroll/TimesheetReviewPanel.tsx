import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, apiFetchBlob, getAuthUser } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatCurrency, formatDate } from "@/lib/utils"
import { formatHoursMinutes } from "@/lib/approvalEntry"
import { groupByWeek } from "@/lib/weeks"
import { LogApprovalCard } from "@/components/payroll/LogApprovalCard"
import { CheckCircle2, FileText, Film, Image as ImageIcon, X, XCircle } from "lucide-react"

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
  task_name?: string | null
  description?: string | null
  notes?: string | null
  start_time?: string | null
  end_time?: string | null
  hours: string
  source?: string
  status?: string
  attachments: Att[]
}

interface PackagePayClient {
  client_id: string
  client_name: string
  calculated_amount: string
  amount: string
  pay_this_period: boolean
  reason?: string | null
  adjusted?: boolean
}

interface PackagePay {
  locked: boolean
  currency: "PHP" | "USD" | string
  clients: PackagePayClient[]
}

interface ReviewPayload {
  timesheet: {
    id: string
    va_id: string
    va_name?: string | null
    period_start: string
    period_end: string
    status: string
    review_note?: string | null
    entry_count: number
    total_hours: string
  }
  entries: ReviewEntry[]
  package_pay?: PackagePay | null
}

function EditPackagePay({
  sheet,
  packagePay,
  onSaved,
}: {
  sheet: ReviewPayload["timesheet"]
  packagePay: PackagePay
  onSaved: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, { pay: boolean; amount: string; reason: string }>>({})
  const [error, setError] = useState("")
  const locked = packagePay.locked
  const currency = packagePay.currency === "USD" ? "USD" : "PHP"

  const rowState = (client: PackagePayClient) => {
    const draft = drafts[client.client_id]
    return {
      pay: draft ? draft.pay : client.pay_this_period,
      amount: draft ? draft.amount : client.amount,
      reason: draft ? draft.reason : (client.reason || ""),
    }
  }

  const displayed = packagePay.clients.map((client) => {
    const state = rowState(client)
    const calculated = Number(client.calculated_amount)
    const typed = Number(state.amount)
    const amount = state.pay && Number.isFinite(typed) && typed >= 0 ? Math.round(typed * 100) / 100 : 0
    return { client, state, calculated, amount }
  })
  const total = displayed.reduce((sum, row) => sum + row.amount, 0)

  const save = async (client: PackagePayClient, state: { pay: boolean; amount: string; reason: string }) => {
    if (locked) return
    const calculated = Number(client.calculated_amount)
    const parsed = Number(state.amount)
    if (state.pay && (!Number.isFinite(parsed) || parsed < 0)) {
      setError("Amount cannot be negative.")
      return
    }
    let amount: number | null = null
    if (state.pay && state.amount.trim() !== "") {
      amount = Math.round(parsed * 100) / 100
      if (amount === Math.round(calculated * 100) / 100) amount = null
    }
    try {
      await apiFetch("/payroll/package-overrides", {
        method: "PUT",
        body: JSON.stringify({
          va_id: sheet.va_id,
          client_id: client.client_id,
          period_start: sheet.period_start,
          period_end: sheet.period_end,
          skipped: !state.pay,
          amount,
          note: state.reason.trim() || null,
        }),
      })
      setError("")
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[client.client_id]
        return next
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this period")
    }
  }

  return (
    <section className="mb-5 rounded-2xl border border-primary/25 bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Edit package pay</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Each Fixed Package is listed with this period's amount. A change here updates Timesheets & pay and the payslip.
      </p>
      <div className="mt-3 space-y-3">
        {displayed.map(({ client, state, calculated, amount }) => (
          <div key={client.client_id} className="rounded-xl border bg-muted/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold">{client.client_name}</p>
                <p className="text-[11px] font-semibold text-muted-foreground">Fixed Package</p>
                <p className="text-[11px] text-muted-foreground">Period amount {formatCurrency(calculated, currency)}</p>
              </div>
              <p className="text-sm font-bold">{state.pay ? formatCurrency(amount, currency) : `Skipped · ${formatCurrency(0, currency)}`}</p>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-primary"
                checked={state.pay}
                disabled={locked}
                onChange={(e) => {
                  const next = { ...state, pay: e.target.checked }
                  setDrafts((prev) => ({ ...prev, [client.client_id]: next }))
                  void save(client, next)
                }}
              />
              Pay this period
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr]">
              <Input
                type="number"
                min="0"
                step="0.01"
                className="h-8"
                aria-label={`${client.client_name} amount this period`}
                disabled={locked || !state.pay}
                value={state.amount}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [client.client_id]: { ...state, amount: e.target.value } }))}
                onBlur={(e) => void save(client, { ...state, amount: e.target.value })}
              />
              <Input
                className="h-8"
                placeholder="Reason (optional)"
                aria-label={`${client.client_name} reason`}
                disabled={locked}
                value={state.reason}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [client.client_id]: { ...state, reason: e.target.value } }))}
                onBlur={(e) => void save(client, { ...state, reason: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-right text-sm font-extrabold">Package total {formatCurrency(total, currency)}</p>
      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
      {locked && <p className="mt-2 text-[11px] text-muted-foreground">This period is paid. Undo Paid to change it.</p>}
    </section>
  )
}

function isImage(ctype: string) {
  return (ctype || "").toLowerCase().startsWith("image/")
}
function isVideo(ctype: string) {
  return (ctype || "").toLowerCase().startsWith("video/")
}

function weekdayLabel(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
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
  variant = "drawer",
}: {
  timesheetId: string
  onClose?: () => void
  variant?: "drawer" | "inline"
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

  const [reason, setReason] = useState("")
  const [actionError, setActionError] = useState("")

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["payroll"] })
    qc.invalidateQueries({ queryKey: ["payroll-timesheets-pending"] })
    qc.invalidateQueries({ queryKey: ["timesheet-review", timesheetId] })
  }
  const approve = useMutation({
    mutationFn: () => apiFetch(`/payroll/timesheets/${timesheetId}/review`, { method: "POST" }),
    onSuccess: () => {
      setActionError("")
      refresh()
      onClose?.()
    },
    onError: (err: Error) => setActionError(err.message),
  })
  const reject = useMutation({
    mutationFn: () => apiFetch(`/payroll/timesheets/${timesheetId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: reason.trim() || null }),
    }),
    onSuccess: () => {
      setActionError("")
      refresh()
      onClose?.()
    },
    onError: (err: Error) => setActionError(err.message),
  })

  const sheet = data?.timesheet
  const isAdmin = getAuthUser()?.role === "admin"
  const reviewed = sheet?.status === "reviewed"
  const rejected = sheet?.status === "rejected"
  const busy = approve.isPending || reject.isPending

  const inline = variant === "inline"
  return (
    <div className={inline ? "" : "fixed inset-0 z-50 flex items-stretch justify-end bg-black/40"} onClick={inline ? undefined : onClose}>
      <div
        id={`timesheet-${timesheetId}`}
        className={inline ? "flex flex-col rounded-2xl border border-[#F7C6D3] bg-white" : "flex h-full w-full max-w-4xl flex-col bg-card shadow-2xl animate-in slide-in-from-right"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8325F]">Timesheet Review</p>
            <h2 className="font-display text-lg font-bold">{sheet?.va_name || "VA"}</h2>
            {sheet && (
              <p className="text-xs text-muted-foreground">
                {formatDate(sheet.period_start)} to {formatDate(sheet.period_end)}
                {" · "}
                {sheet.entry_count} entries · {formatHoursMinutes(sheet.total_hours)}
                {" · "}
                <span className="capitalize font-semibold text-foreground">{sheet.status}</span>
              </p>
            )}
          </div>
          {!inline && onClose && <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isAdmin && sheet && data?.package_pay && (
            <EditPackagePay sheet={sheet} packagePay={data.package_pay} onSaved={refresh} />
          )}
          {isLoading && <p className="text-sm text-muted-foreground">Loading timesheet entries…</p>}
          {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{(error as Error).message}</p>}
          {!isLoading && data?.entries.length === 0 && (
            <p className="rounded-xl border bg-muted/30 p-6 text-center text-sm text-muted-foreground">No entries in this timesheet.</p>
          )}

          {sheet && data && data.entries.length > 0 && (
            <div className="mb-5 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Total</p>
              <p className="font-display text-2xl font-bold text-[#B8325F]">{formatHoursMinutes(sheet.total_hours)}</p>
              <p className="text-xs text-muted-foreground">
                {sheet.entry_count} {sheet.entry_count === 1 ? "entry" : "entries"} · {formatDate(sheet.period_start)} to {formatDate(sheet.period_end)}
              </p>
            </div>
          )}

          <div className="space-y-6">
            {groupByWeek(data?.entries ?? [], (entry) => entry.work_date).map((week) => {
              const byDate = new Map<string, ReviewEntry[]>()
              for (const entry of week.items) {
                const list = byDate.get(entry.work_date) ?? []
                list.push(entry)
                byDate.set(entry.work_date, list)
              }
              const dates = [...byDate.keys()].sort()
              return (
                <section key={week.id} className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold">Week {week.weekNumber} · {formatDate(week.start)} to {formatDate(week.end)}</h3>
                    <p className="text-xs font-semibold text-[#B8325F]">{formatHoursMinutes(week.items.reduce((sum, entry) => sum + Number(entry.hours || 0), 0))}</p>
                  </div>
                  {dates.map((iso) => {
                    const dayEntries = (byDate.get(iso) ?? []).slice().sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""))
                    return (
                      <div key={iso} className="space-y-2">
                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                          {weekdayLabel(iso)} · {formatHoursMinutes(dayEntries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0))}
                        </p>
                        {dayEntries.map((entry) => {
                          return (
                            <div key={entry.id}>
                              <LogApprovalCard entry={entry} />
                              {entry.attachments.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {entry.attachments.map((a) => (
                                    <AttachmentThumb key={a.id} att={a} url={urls[a.id]} onOpen={() => setLightbox(a)} />
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </div>
        </div>

        <div className="space-y-3 border-t bg-muted/30 px-5 py-4">
          {sheet?.review_note && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <span className="font-bold">Rejection note: </span>{sheet.review_note}
            </p>
          )}
          {actionError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{actionError}</p>}
          {!reviewed && (
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground" htmlFor="reject-reason">Rejection note (optional)</label>
              <textarea
                id="reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What should the VA fix before resubmitting?"
                className="mt-1 w-full rounded-xl border bg-card px-3 py-2 text-xs"
                rows={2}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Approve to unlock the payslip, or reject so the VA can fix and resubmit. Project Managers do not see rates or pay on this screen.
            </p>
            <div className="flex flex-wrap gap-2">
              {!inline && onClose && <Button variant="outline" onClick={onClose}>Close</Button>}
              {!reviewed && (
                <Button variant="danger" disabled={busy || isLoading} onClick={() => reject.mutate()}>
                  <XCircle className="h-4 w-4" />
                  {reject.isPending ? "Rejecting…" : "Reject"}
                </Button>
              )}
              {!reviewed && (
                <Button variant="success" disabled={busy || isLoading} onClick={() => approve.mutate()}>
                  <CheckCircle2 className="h-4 w-4" />
                  {approve.isPending ? "Approving…" : "Approve timesheet"}
                </Button>
              )}
              {reviewed && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1.5 text-xs font-bold text-green-800">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approved
                </span>
              )}
              {reviewed && (
                <Button variant="danger" disabled={busy} onClick={() => reject.mutate()}>
                  <XCircle className="h-4 w-4" /> Reject
                </Button>
              )}
              {rejected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-800">
                  Rejected. Waiting on the VA.
                </span>
              )}
            </div>
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
