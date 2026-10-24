import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { PayrollResponse, PayrollRun, Settings, VA } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input, Label, Select } from "@/components/ui/input"
import { StatCard } from "@/components/magicui/stat-card"
import { cn, formatCurrency, formatDate, payrollPdfFilename } from "@/lib/utils"
import { PayrollDocument } from "@/components/pdf/PayrollDocument"
import { PdfPreviewModal } from "@/components/pdf-viewer/PdfPreviewModal"
import { TimesheetReviewPanel } from "@/components/payroll/TimesheetReviewPanel"
import { generatePdfBlob } from "@/lib/pdf"
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BadgeCheck, Banknote, CheckCircle2, ClipboardCheck, FileDown, FileSpreadsheet, Trash2, Wallet } from "lucide-react"
import { useDisplaySettings } from "@/hooks/useDisplaySettings"
import { useCssVar } from "@/hooks/useCssVar"

const PERIODS = [
  { id: "this_week", label: "This Week" }, { id: "last_week", label: "Last Week" },
  { id: "this_month", label: "This Month" }, { id: "last_month", label: "Last Month" }, { id: "custom", label: "Custom Range" },
]
function initials(name: string) { return name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() }
const n = (v?: string | number | null) => Number(v ?? 0)

export function PayrollPage() {
  const qc = useQueryClient()
  const { showPricing } = useDisplaySettings()
  const isAdmin = getAuthUser()?.role === "admin"
  // Admin payslips include rate/pay; auditors review hours only (no money)
  const pdfShowPricing = isAdmin
  const chartColor = useCssVar("--chart", "#ec4899")
  const [period, setPeriod] = useState("custom")
  const [vaId, setVaId] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [openVa, setOpenVa] = useState<string>("")
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfFilename, setPdfFilename] = useState("va-payroll.pdf")
  const [editing, setEditing] = useState<{ id: string; description: string; start_time: string; end_time: string; va_rate: string; va_name: string; work_date: string } | null>(null)
  const [markPaidError, setMarkPaidError] = useState("")
  const [pdfError, setPdfError] = useState("")
  const [reviewTimesheetId, setReviewTimesheetId] = useState<string | null>(null)

  const { data: vas = [] } = useQuery({ queryKey: ["vas"], queryFn: () => apiFetch<VA[]>("/vas") })
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<Settings>("/settings") })

  type PendingSheet = {
    id: string
    va_id: string
    va_name?: string | null
    period_start: string
    period_end: string
    status: string
    total_hours: string
    entry_count: number
    submitted_at?: string
  }

  // Always-visible inbox of timesheets waiting for approval (independent of period filter)
  const { data: pendingSheets = [] } = useQuery({
    queryKey: ["payroll-timesheets-pending"],
    queryFn: () => apiFetch<PendingSheet[]>("/payroll/timesheets?status_filter=submitted"),
    refetchInterval: 30_000,
  })

  // Auto-computes whenever a filter changes — no Calculate button needed
  const { data: payroll, isLoading } = useQuery({
    queryKey: ["payroll", vaId, period, dateFrom, dateTo],
    queryFn: () => apiFetch<PayrollResponse>("/payroll/calculate", {
      method: "POST",
      body: JSON.stringify({ va_id: vaId || null, period, date_from: period === "custom" ? dateFrom || null : null, date_to: period === "custom" ? dateTo || null : null }),
    }),
    enabled: period !== "custom" || (!!dateFrom && !!dateTo),
  })
  const { data: runs = [] } = useQuery({ queryKey: ["payroll-runs"], queryFn: () => apiFetch<PayrollRun[]>("/payroll/runs") })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["payroll"] })
    qc.invalidateQueries({ queryKey: ["payroll-runs"] })
    qc.invalidateQueries({ queryKey: ["payroll-timesheets-pending"] })
  }
  const markPaid = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/payroll/runs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setMarkPaidError(""); invalidate() },
    onError: (err: Error) => setMarkPaidError(err.message),
  })
  const voidRun = useMutation({ mutationFn: (id: string) => apiFetch(`/payroll/runs/${id}`, { method: "DELETE" }), onSuccess: invalidate })
  const saveEntry = useMutation({
    mutationFn: () =>
      apiFetch(`/work-logs/${editing!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description_plain: editing!.description,
          start_time: editing!.start_time,
          end_time: editing!.end_time,
          va_rate: parseFloat(editing!.va_rate),
        }),
      }),
    onSuccess: () => {
      invalidate()
      qc.invalidateQueries({ queryKey: ["work-logs"] })
      setEditing(null)
    },
  })

  const teamDaily = useMemo(() => {
    const map = new Map<string, number>()
    for (const va of payroll?.vas ?? []) for (const d of va.daily ?? []) map.set(d.work_date, (map.get(d.work_date) ?? 0) + n(d.hours))
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([work_date, hours]) => ({ work_date, hours, label: new Date(work_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "narrow" }) + " " + new Date(work_date + "T00:00:00").getDate() }))
  }, [payroll])
  const teamClients = useMemo(() => {
    const map = new Map<string, { hours: number; pay: number }>()
    for (const va of payroll?.vas ?? []) for (const b of va.by_client ?? []) { const cur = map.get(b.label) ?? { hours: 0, pay: 0 }; cur.hours += n(b.hours); cur.pay += n(b.pay); map.set(b.label, cur) }
    return [...map.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.hours - a.hours)
  }, [payroll])

  const paidCount = (payroll?.vas ?? []).filter(v => v.is_paid).length
  const tasksDone = (payroll?.vas ?? []).reduce((s, v) => s + (v.tasks_done ?? 0), 0)

  const exportPdf = async (onlyVa?: string) => {
    if (!payroll || !settings) return
    const candidates = onlyVa ? payroll.vas.filter(v => v.va_id === onlyVa) : payroll.vas
    const ready = candidates.filter(v => v.timesheet_status === "reviewed")
    if (ready.length === 0) {
      setPdfError(
        onlyVa
          ? "Approve this VA’s submitted timesheet in Timesheet Review before generating the Payroll PDF."
          : "No VA in this period has an approved timesheet yet. Open Timesheet Review, approve, then export.",
      )
      return
    }
    if (!onlyVa && ready.length < candidates.length) {
      setPdfError(`PDF includes ${ready.length} of ${candidates.length} VAs with approved timesheets. Others still need review.`)
    } else {
      setPdfError("")
    }
    const doc = { ...payroll, vas: ready }
    const nameForFile = onlyVa
      ? (doc.vas[0]?.va_name || "VA")
      : doc.vas.length === 1
        ? doc.vas[0].va_name
        : "Team"
    setPdfFilename(payrollPdfFilename(nameForFile, payroll.period_start, payroll.period_end))
    setPdfBlob(await generatePdfBlob(<PayrollDocument payroll={doc} settings={settings} showPricing={pdfShowPricing} />))
  }
  const exportCsv = () => {
    if (!payroll) return
    const rows = [["VA", "Date", "Client", "Project", "Task", "Description", "Source", "Status", "Hours", "Rate", "Pay", "Currency"],
      ...payroll.vas.flatMap(va => va.entries.map(e => [va.va_name, e.work_date, e.client_name, e.project_name ?? "", e.task_title ?? "", `"${(e.description || "").replace(/"/g, '""')}"`, e.source ?? "", e.status ?? "", e.hours, e.rate, e.pay, va.currency]))]
    const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "va-payroll.csv"; a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <h1 className="font-display text-xl font-bold">VA Payroll</h1>
          <p className="text-xs text-muted-foreground">
            VA submits timesheet → you review entries &amp; attachments → approve → then Payroll PDF / Mark Paid unlock.
          </p>
        </div>
        {payroll && <p className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold">{formatDate(payroll.period_start)} – {formatDate(payroll.period_end)}</p>}
      </div>
      {markPaidError && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{markPaidError}</p>}
      {pdfError && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{pdfError}</p>}

      {pendingSheets.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/90 p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800">Pending Approval</p>
              <h2 className="font-display text-base font-bold text-amber-950">
                {pendingSheets.length} timesheet{pendingSheets.length === 1 ? "" : "s"} waiting for review
              </h2>
              <p className="text-xs text-amber-900/80">Open Timesheet Review to check entries &amp; attachments, then approve. PDF stays locked until approved.</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {pendingSheets.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setReviewTimesheetId(s.id)
                  setVaId(s.va_id)
                  setPeriod("custom")
                  setDateFrom(s.period_start)
                  setDateTo(s.period_end)
                }}
                className="rounded-xl border border-amber-200 bg-white p-3 text-left transition hover:border-amber-400 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-foreground">{s.va_name || "VA"}</p>
                  <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-900">
                    Pending Approval
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(s.period_start)} – {formatDate(s.period_end)}
                </p>
                <p className="mt-1 text-xs font-semibold text-amber-900">
                  {s.total_hours} hrs · {s.entry_count} entries
                  {s.submitted_at ? ` · submitted ${formatDate(s.submitted_at.slice(0, 10))}` : ""}
                </p>
                <p className="mt-2 text-[11px] font-bold text-primary">Review &amp; approve →</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters — results update live */}
      <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label>VA</Label><Select value={vaId} onChange={(e) => setVaId(e.target.value)}><option value="">All VAs</option>{vas.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></div>
        <div><Label>Period</Label><Select value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></div>
        {period === "custom" && <><div><Label>From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div><div><Label>To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div></>}
        <div className="flex items-end gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!payroll}><FileSpreadsheet className="h-4 w-4" /> CSV</Button>
          <Button variant="gold" onClick={() => exportPdf()} disabled={!payroll}><FileDown className="h-4 w-4" /> Payroll PDF</Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Computing payroll…</p>}
      {period === "custom" && (!dateFrom || !dateTo) && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Pick a From and To date to compute the custom period.</p>}

      {payroll && (<>
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard title="Payable Hours" value={`${payroll.total_hours ?? 0} hrs`} subtitle={`${payroll.vas.reduce((s, v) => s + v.entry_count, 0)} approved entries · ${payroll.vas.length} VA(s)`} />
          {showPricing
            ? <StatCard title="Total Pay Due" value={`${formatCurrency(payroll.total_php, "PHP")} + ${formatCurrency(payroll.total_usd, "USD")}`} subtitle="Across both currencies" className="border-primary/30" />
            : <StatCard title="Tasks Completed" value={tasksDone} subtitle="Marked done in this period" />}
          <StatCard title="Pending Approval" value={`${payroll.total_pending_hours ?? 0} hrs`} subtitle="Not payable until approved" className="border-amber-200/70" />
          <StatCard title="Paid This Period" value={`${paidCount}/${payroll.vas.length}`} subtitle="VAs marked paid below" className="border-green-200/70" />
        </div>

        {n(payroll.total_pending_hours) > 0 && (
          <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" /> {payroll.total_pending_hours} hrs are still <b>submitted</b> and not counted in pay yet. <Link to="/admin/logs" className="font-bold underline">Approve them in All Logs →</Link></p>
        )}

        {/* Charts row */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="min-w-0 lg:col-span-2"><CardHeader className="pb-2"><CardTitle>Team Hours by Day</CardTitle></CardHeader><CardContent>
            <ResponsiveContainer width="100%" height={200}><BarChart data={teamDaily}><XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} /><YAxis tick={{ fontSize: 10 }} width={30} /><Tooltip formatter={(v) => [`${v} hrs`, "Hours"]} /><Bar dataKey="hours" fill={chartColor} radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>
          </CardContent></Card>
          <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle>Hours by Client</CardTitle></CardHeader><CardContent className="space-y-2.5">
            {teamClients.map(c => { const pct = n(payroll.total_hours) ? (c.hours / n(payroll.total_hours)) * 100 : 0; return (
              <div key={c.label} className="text-xs"><div className="flex justify-between gap-2"><span className="truncate font-semibold">{c.label}</span><span className="whitespace-nowrap text-muted-foreground">{c.hours.toFixed(2)} hrs{showPricing ? ` · ${formatCurrency(c.pay)}` : ""}</span></div>
              <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} /></div></div>) })}
            {teamClients.length === 0 && <p className="text-xs text-muted-foreground">No approved hours in this period.</p>}
          </CardContent></Card>
        </div>

        {/* VA cards */}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Per VA — click a card for entries</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {payroll.vas.map(va => (
              <div
                key={va.va_id}
                className={cn(
                  "monday-card rounded-2xl border bg-card p-4",
                  openVa === va.va_id && "border-primary ring-2 ring-primary/25",
                  va.timesheet_submitted && va.timesheet_status !== "reviewed" && "border-amber-300 ring-2 ring-amber-200/60",
                )}
              >
                <button className="w-full text-left" onClick={() => setOpenVa(openVa === va.va_id ? "" : va.va_id)}>
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-extrabold text-primary">{initials(va.va_name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{va.va_name} <span className="text-[11px] font-semibold text-muted-foreground">({va.currency})</span></span>
                      <span className="block truncate text-[11px] text-muted-foreground">{va.payment_label ?? "No payment details on profile"}</span>
                    </span>
                    {va.change_pct != null && n(va.prev_hours) > 0 && (
                      <span className={cn("flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold", va.change_pct >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                        {va.change_pct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(va.change_pct).toFixed(0)}% vs prev
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div><p className="text-2xl font-extrabold leading-none">{showPricing ? formatCurrency(va.total_pay, va.currency) : `${va.total_hours} hrs`}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{va.total_hours} hrs · {va.entry_count} entries · {va.days_worked} days · avg {va.avg_hours_per_day}/day</p></div>
                    {va.is_paid
                      ? <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-[10px] font-bold text-green-700"><BadgeCheck className="h-3.5 w-3.5" /> Paid</span>
                      : <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700">Unpaid</span>}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px] font-semibold text-muted-foreground">
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-green-700">⏱ Clock {va.clock_hours}h</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">✍ Manual {va.manual_hours}h</span>
                    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">✓ {va.tasks_done} tasks done</span>
                    {n(va.pending_hours) > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">⚠ {va.pending_hours}h pending</span>}
                    {va.timesheet_status === "reviewed" ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">📋 Timesheet approved</span>
                    ) : va.timesheet_submitted ? (
                      <span className="rounded-full bg-amber-200 px-2 py-0.5 font-extrabold uppercase tracking-wide text-amber-900">Pending Approval</span>
                    ) : (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">📋 Timesheet not submitted</span>
                    )}
                  </div>
                </button>
                <div className="mt-3 flex flex-wrap gap-2">
                  {va.timesheet_id && (
                    <Button
                      size="sm"
                      variant={va.timesheet_status === "reviewed" ? "outline" : "gold"}
                      className="flex-1"
                      onClick={() => setReviewTimesheetId(va.timesheet_id!)}
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" />
                      {va.timesheet_status === "reviewed" ? "View timesheet" : "Review & Approve"}
                    </Button>
                  )}
                  {isAdmin && !va.is_paid && n(va.total_hours) > 0 && (
                    <Button
                      size="sm"
                      variant="success"
                      className="flex-1"
                      disabled={markPaid.isPending || va.timesheet_status !== "reviewed"}
                      title={
                        !va.timesheet_submitted
                          ? "VA must submit timesheet first"
                          : va.timesheet_status !== "reviewed"
                            ? "Approve the timesheet in Timesheet Review first"
                            : undefined
                      }
                      onClick={() => markPaid.mutate({ va_id: va.va_id, period_start: payroll.period_start, period_end: payroll.period_end, total_hours: va.total_hours, total_pay: va.total_pay, currency: va.currency, method: va.payment_label?.startsWith("Wise") ? "wise" : "bank_transfer" })}
                    >
                      <Wallet className="h-3.5 w-3.5" /> Mark Paid
                    </Button>
                  )}
                  {isAdmin && va.is_paid && va.run_id && <Button size="sm" variant="outline" className="flex-1" onClick={() => { if (confirm(`Undo paid status for ${va.va_name}?`)) voidRun.mutate(va.run_id!) }}>Undo Paid</Button>}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={va.timesheet_status !== "reviewed"}
                    title={va.timesheet_status !== "reviewed" ? "Approve timesheet first" : undefined}
                    onClick={() => exportPdf(va.va_id)}
                  >
                    <FileDown className="h-3.5 w-3.5" /> Payslip
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {payroll.vas.length === 0 && <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">No approved or pending work in this period. Approved logs appear here automatically.</p>}
        </div>

        {/* Entries for the opened VA */}
        {openVa && payroll.vas.filter(v => v.va_id === openVa).map(va => (
          <Card key={va.va_id}>
            <CardHeader className="pb-2"><CardTitle>{va.va_name} — Entries ({va.entry_count})</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-xs">
                <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-3">Date</th><th className="p-3">Client / Project</th><th className="p-3">Description</th><th className="p-3">Source</th><th className="p-3">Hours</th>{showPricing && <><th className="p-3">Rate</th><th className="p-3">Pay</th></>}<th className="p-3 text-right">Edit</th></tr></thead>
                <tbody>{va.entries.map(e => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="whitespace-nowrap p-3">{formatDate(e.work_date)}</td>
                    <td className="p-3"><span className="font-medium">{e.client_name}</span>{e.project_name && <span className="block text-[11px] text-muted-foreground">{e.project_name}</span>}</td>
                    <td className="max-w-xs p-3"><span className="line-clamp-2">{e.description}</span>{e.task_title && <span className="block text-[11px] text-muted-foreground">Task: {e.task_title}</span>}</td>
                    <td className="p-3"><span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", e.source === "clock" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600")}>{e.source === "clock" ? "Clock" : "Manual"}</span></td>
                    <td className="p-3 font-bold">{e.hours}</td>
                    {showPricing && <><td className="p-3">{formatCurrency(e.rate, va.currency)}</td><td className="p-3 font-semibold">{formatCurrency(e.pay, va.currency)}</td></>}
                    <td className="p-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({
                        id: e.id,
                        description: e.description || "",
                        start_time: e.start_time?.slice(0, 5) || "09:00",
                        end_time: e.end_time?.slice(0, 5) || "17:00",
                        va_rate: String(e.rate ?? ""),
                        va_name: va.va_name,
                        work_date: e.work_date,
                      })}>Edit</Button>
                    </td>
                  </tr>))}
                  {va.entries.length === 0 && <tr><td colSpan={showPricing ? 8 : 6} className="p-5 text-center text-muted-foreground">No approved entries — only pending work so far (see the ⚠ chip on the card).</td></tr>}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}

        {/* Payment history */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Banknote className="h-4 w-4 text-primary" /> Payment History</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-xs">
              <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-3">Paid On</th><th className="p-3">VA</th><th className="p-3">Period</th><th className="p-3">Hours</th>{showPricing && <th className="p-3">Amount</th>}<th className="p-3">Method</th><th className="p-3 text-right">Actions</th></tr></thead>
              <tbody>{runs.map(r => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="whitespace-nowrap p-3">{formatDate(r.paid_at.slice(0, 10))}</td>
                  <td className="p-3 font-semibold">{r.va_name}</td>
                  <td className="whitespace-nowrap p-3 text-muted-foreground">{formatDate(r.period_start)} – {formatDate(r.period_end)}</td>
                  <td className="p-3">{r.total_hours} hrs</td>
                  {showPricing && <td className="p-3 font-semibold">{formatCurrency(r.total_pay, r.currency as "PHP" | "USD")}</td>}
                  <td className="p-3 capitalize">{r.method?.replace("_", " ") ?? "—"}</td>
                  <td className="p-3"><div className="flex justify-end"><Button size="sm" variant="ghost" title="Void this payment record" onClick={() => { if (confirm("Void this payment record? The VA will show as unpaid for that period.")) voidRun.mutate(r.id) }}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button></div></td>
                </tr>))}
                {runs.length === 0 && <tr><td colSpan={showPricing ? 7 : 6} className="p-6 text-center text-muted-foreground"><CheckCircle2 className="mr-1 inline h-4 w-4" /> No payments recorded yet — use “Mark Paid” on a VA card after you send payroll.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </>)}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-sm font-semibold">Edit payroll entry</h2>
            <p className="mb-3 text-[11px] text-muted-foreground">{editing.va_name} · {formatDate(editing.work_date)}</p>
            <div className="space-y-3">
              <div><Label>Description</Label><Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Start</Label><Input type="time" value={editing.start_time} onChange={(e) => setEditing({ ...editing, start_time: e.target.value })} /></div>
                <div><Label>End</Label><Input type="time" value={editing.end_time} onChange={(e) => setEditing({ ...editing, end_time: e.target.value })} /></div>
              </div>
              <div><Label>VA Rate</Label><Input type="number" step="0.01" value={editing.va_rate} onChange={(e) => setEditing({ ...editing, va_rate: e.target.value })} /></div>
              <p className="text-[11px] text-muted-foreground">Hours and pay recalculate from start/end and rate.</p>
              <div className="flex gap-2">
                <Button variant="gold" className="flex-1" disabled={saveEntry.isPending || !editing.description} onClick={() => saveEntry.mutate()}>Save</Button>
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {reviewTimesheetId && (
        <TimesheetReviewPanel
          timesheetId={reviewTimesheetId}
          onClose={() => setReviewTimesheetId(null)}
        />
      )}
      <PdfPreviewModal blob={pdfBlob} filename={pdfFilename} onClose={() => setPdfBlob(null)} />
    </div>
  )
}
