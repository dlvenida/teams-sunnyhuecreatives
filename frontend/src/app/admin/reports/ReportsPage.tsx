import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import { apiFetch } from "@/lib/api"
import type { ReportClientsResponse, ReportResponse, Settings } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input, Label, Select } from "@/components/ui/input"
import { StatCard } from "@/components/magicui/stat-card"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import { ReportDocument } from "@/components/pdf/ReportDocument"
import { PdfPreviewModal } from "@/components/pdf-viewer/PdfPreviewModal"
import { generatePdfBlob } from "@/lib/pdf"
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Clock3, FileDown, FileSpreadsheet, ReceiptText, Search } from "lucide-react"
import { useDisplaySettings } from "@/hooks/useDisplaySettings"
import { useCssVar } from "@/hooks/useCssVar"

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Date(2000, i).toLocaleString("en", { month: "long" }) }))

function initials(name: string) { return name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() }

export function ReportsPage() {
  const navigate = useNavigate()
  const { showPricing } = useDisplaySettings()
  const chartColor = useCssVar("--chart", "#ec4899")
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [cutoff, setCutoff] = useState(30)
  const [showRate, setShowRate] = useState(false)
  const [selected, setSelected] = useState<string>("")
  const [search, setSearch] = useState("")
  const [vaFilter, setVaFilter] = useState("")
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)

  const rateOn = showPricing && showRate
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<Settings>("/settings") })
  const { data: list, isLoading: listLoading } = useQuery({
    queryKey: ["report-clients", year, month, cutoff, rateOn],
    queryFn: () => apiFetch<ReportClientsResponse>(`/reports/clients?year=${year}&month=${month}&cutoff=${cutoff}&show_rate=${rateOn}`),
  })
  const { data: report, isLoading: repLoading } = useQuery({
    queryKey: ["report", selected, year, month, cutoff, rateOn],
    queryFn: () => apiFetch<ReportResponse>("/reports/generate", { method: "POST", body: JSON.stringify({ client_id: selected, year, month, cutoff, show_rate: rateOn }) }),
    enabled: !!selected,
  })

  const selectedSummary = list?.clients.find(c => c.client_id === selected)
  const lines = useMemo(() => (report?.lines ?? []).filter(l =>
    (!vaFilter || l.va_name === vaFilter) &&
    (!search || `${l.description} ${l.task_title ?? ""} ${l.project_name ?? ""} ${l.va_name ?? ""}`.toLowerCase().includes(search.toLowerCase()))
  ), [report, vaFilter, search])
  const shownHours = lines.reduce((s, l) => s + Number(l.hours || 0), 0)

  const exportPdf = async () => {
    if (!report || !settings) return
    setPdfBlob(await generatePdfBlob(<ReportDocument report={report} settings={settings} />))
  }
  const exportCsv = () => {
    if (!report) return
    const rows = [["Date", "VA", "Sub-client", "Project", "Task", "Description", "Source", "Start", "End", "Hours", ...(report.show_rate ? ["Rate", "Amount"] : [])],
      ...report.lines.map(l => [l.work_date, l.va_name ?? "", l.sub_client_name ?? "", l.project_name ?? "", l.task_title ?? "", `"${(l.description || "").replace(/"/g, '""')}"`, l.source ?? "", l.start_time ?? "", l.end_time ?? "", l.hours, ...(report.show_rate ? [l.rate ?? "", l.amount ?? ""] : [])])]
    const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${report.client_name.replace(/\s+/g, "-")}-report.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <h1 className="font-display text-xl font-bold">Client Reports</h1>
          <p className="text-xs text-muted-foreground">Billable work per client for the period — pick a client to see the full report. Nothing to generate, it computes itself.</p>
        </div>
        <p className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold">{list?.period_label ?? "…"} · <span className="text-primary">{list?.total_hours ?? "0"} hrs billable</span>{Number(list?.total_pending_hours ?? 0) > 0 && <span className="text-amber-600"> · {list?.total_pending_hours} hrs pending approval</span>}</p>
      </div>

      {/* Period controls — everything below updates automatically */}
      <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div><Label>Month</Label><Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></div>
        <div><Label>Year</Label><Select value={year} onChange={(e) => setYear(Number(e.target.value))}>{[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}</Select></div>
        <div><Label>Cutoff</Label><Select value={cutoff} onChange={(e) => setCutoff(Number(e.target.value))}><option value={15}>1st – 15th</option><option value={30}>Full month</option></Select></div>
        {showPricing && <div><Label>Amounts</Label><Select value={showRate ? "yes" : "no"} onChange={(e) => setShowRate(e.target.value === "yes")}><option value="no">Hours only</option><option value="yes">Include rate & amount</option></Select></div>}
        <div><Label>Find client</Label><div className="relative"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
      </div>

      {/* Client list */}
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Clients — {list?.period_label}</p>
        {listLoading && <p className="text-sm text-muted-foreground">Loading clients…</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(list?.clients ?? []).filter(c => !search || c.client_name.toLowerCase().includes(search.toLowerCase())).map(c => {
            const active = selected === c.client_id
            return (
              <button key={c.client_id} onClick={() => setSelected(active ? "" : c.client_id)} className={cn("monday-card rounded-2xl border bg-card p-4 text-left", active && "border-primary ring-2 ring-primary/30")}>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-extrabold text-primary">{initials(c.client_name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{c.client_name}</span>
                    <span className="block text-[11px] capitalize text-muted-foreground">{c.billing_type} billing{c.last_activity ? ` · last work ${formatDate(c.last_activity)}` : " · no work yet"}</span>
                  </span>
                  {c.change_pct != null && Number(c.prev_period_hours) > 0 && (
                    <span className={cn("flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold", c.change_pct >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                      {c.change_pct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(c.change_pct).toFixed(0)}%
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div><p className="text-2xl font-extrabold leading-none">{c.billable_hours}<span className="text-xs font-semibold text-muted-foreground"> hrs</span></p><p className="mt-1 text-[11px] text-muted-foreground">{c.entries} approved entries{rateOn && c.amount != null ? ` · ${formatCurrency(c.amount)}` : ""}</p></div>
                  <div className="text-right text-[11px]">
                    {c.invoice_number ? <p className="font-semibold text-green-700"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />{c.invoice_number} ({c.invoice_status})</p>
                      : Number(c.ready_to_invoice_hours) > 0 ? <p className="font-semibold text-primary"><ReceiptText className="mr-1 inline h-3.5 w-3.5" />{c.ready_to_invoice_hours} hrs ready to invoice</p>
                      : <p className="text-muted-foreground">Nothing to invoice</p>}
                    {c.pending_count > 0 && <p className="mt-0.5 font-semibold text-amber-600"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{c.pending_hours} hrs pending approval</p>}
                  </div>
                </div>
                {c.va_names.length > 0 && <p className="mt-2 truncate text-[11px] text-muted-foreground">Worked by: {c.va_names.join(", ")}</p>}
                <p className={cn("mt-2 text-xs font-bold", active ? "text-muted-foreground" : "text-primary")}>{active ? "Hide report" : "View full report →"}</p>
              </button>
            )
          })}
        </div>
        {!listLoading && (list?.clients.length ?? 0) === 0 && <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">No clients yet. Add one in Clients to start reporting.</p>}
      </div>

      {/* Full report for the selected client */}
      {selected && (
        <div className="space-y-4">
          {repLoading && <p className="text-sm text-muted-foreground">Building report…</p>}
          {report && (<>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
              <div>
                <h2 className="text-base font-bold">{report.client_name}</h2>
                <p className="text-xs text-muted-foreground">{report.period_label} · generated {formatDate(report.generated_at)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={exportCsv}><FileSpreadsheet className="h-4 w-4" /> CSV</Button>
                <Button variant="outline" onClick={exportPdf}><FileDown className="h-4 w-4" /> PDF</Button>
                <Button variant="gold" onClick={() => navigate(`/admin/invoices?client=${selected}&month=${month}&year=${year}&cutoff=${cutoff}`)}>Create Invoice <ArrowRight className="h-4 w-4" /></Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard title="Total Billable Hours" value={`${report.total_hours} hrs`} subtitle={`${report.lines.length} entries · ${report.days_worked ?? 0} days worked`} />
              <StatCard title="Tasks Completed" value={report.tasks_done ?? 0} subtitle="Marked done in this period" />
              <StatCard title="Pending Approval" value={`${report.pending_hours ?? 0} hrs`} subtitle={`${report.pending_count ?? 0} logs not yet in this report`} />
              <StatCard title={report.show_rate ? "Total Amount" : "Ready to Invoice"} value={report.show_rate && report.total_amount != null ? formatCurrency(report.total_amount) : `${selectedSummary?.ready_to_invoice_hours ?? 0} hrs`} subtitle={selectedSummary?.invoice_number ? `Invoice ${selectedSummary.invoice_number} · ${selectedSummary.invoice_status}` : "Approved & not yet invoiced"} />
            </div>

            {Number(report.pending_hours ?? 0) > 0 && (
              <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" /> {report.pending_hours} hrs ({report.pending_count} logs) are still waiting for approval and are <b>not</b> in this report yet. <Link to="/admin/logs" className="font-bold underline">Review in All Logs →</Link></p>
            )}

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="min-w-0 lg:col-span-1"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary" /> Hours by Day</CardTitle></CardHeader><CardContent>
                <ResponsiveContainer width="100%" height={190}><BarChart data={(report.by_day ?? []).map(d => ({ ...d, hours: Number(d.hours), label: new Date(d.work_date + "T00:00:00").getDate() }))}><XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} /><YAxis tick={{ fontSize: 10 }} width={28} /><Tooltip formatter={(v) => [`${v} hrs`, "Hours"]} labelFormatter={(d) => `Day ${d}`} /><Bar dataKey="hours" fill={chartColor} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
              </CardContent></Card>
              <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle>Hours by VA</CardTitle></CardHeader><CardContent className="space-y-2.5">
                {(report.by_va ?? []).map(b => { const pct = Number(report.total_hours) ? (Number(b.hours) / Number(report.total_hours)) * 100 : 0; return (
                  <div key={b.label} className="text-xs"><div className="flex justify-between"><span className="font-semibold">{b.label}</span><span className="text-muted-foreground">{b.hours} hrs · {b.entries} entries</span></div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div></div>) })}
                {(report.by_va ?? []).length === 0 && <p className="text-xs text-muted-foreground">No approved work in this period.</p>}
              </CardContent></Card>
              <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle>Hours by Project</CardTitle></CardHeader><CardContent className="space-y-2.5">
                {(report.by_project ?? []).map(b => { const pct = Number(report.total_hours) ? (Number(b.hours) / Number(report.total_hours)) * 100 : 0; return (
                  <div key={b.label} className="text-xs"><div className="flex justify-between"><span className="truncate font-semibold">{b.label}</span><span className="whitespace-nowrap text-muted-foreground">{b.hours} hrs</span></div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} /></div></div>) })}
                {(report.by_sub_client ?? []).length > 0 && <div className="border-t pt-2"><p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Sub-clients</p>{(report.by_sub_client ?? []).map(b => <p key={b.label} className="flex justify-between py-0.5 text-xs"><span>{b.label}</span><span className="text-muted-foreground">{b.hours} hrs</span></p>)}</div>}
                {(report.by_project ?? []).length === 0 && <p className="text-xs text-muted-foreground">No approved work in this period.</p>}
              </CardContent></Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Work Detail — {lines.length} entries · {shownHours.toFixed(2)} hrs shown</CardTitle>
                <div className="flex gap-2">
                  <Select value={vaFilter} onChange={(e) => setVaFilter(e.target.value)} className="h-8 w-auto text-xs"><option value="">All VAs</option>{(report.by_va ?? []).map(b => <option key={b.label} value={b.label}>{b.label}</option>)}</Select>
                </div></div></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-xs">
                  <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-3">Date</th><th className="p-3">VA</th><th className="p-3">Project / Task</th><th className="p-3">Description</th><th className="p-3">Time</th><th className="p-3">Hours</th>{report.show_rate && <th className="p-3">Amount</th>}</tr></thead>
                  <tbody>{lines.map((l, i) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="whitespace-nowrap p-3">{formatDate(l.work_date)}</td>
                      <td className="whitespace-nowrap p-3 font-medium">{l.va_name ?? "—"}</td>
                      <td className="p-3"><span className="font-medium">{l.project_name || l.task_title || "General"}</span>{l.sub_client_name && <span className="block text-[11px] text-muted-foreground">{l.sub_client_name}</span>}</td>
                      <td className="max-w-xs p-3"><span className="line-clamp-2">{l.description}</span>{l.task_title && l.project_name && <span className="block text-[11px] text-muted-foreground">{l.task_title}</span>}</td>
                      <td className="whitespace-nowrap p-3 text-muted-foreground">{l.start_time && l.end_time ? `${l.start_time}–${l.end_time}` : "—"}<span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", l.source === "clock" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600")}>{l.source === "clock" ? "Clock" : "Manual"}</span></td>
                      <td className="p-3 font-semibold">{l.hours}</td>
                      {report.show_rate && <td className="p-3">{formatCurrency(l.amount || 0)}</td>}
                    </tr>))}
                    {lines.length === 0 && <tr><td colSpan={report.show_rate ? 7 : 6} className="p-6 text-center text-muted-foreground">No entries match. Try another VA or clear the search.</td></tr>}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>)}
          {!repLoading && !report && <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">No report for this client in the selected period yet — approved work logs will appear here automatically.</p>}
        </div>
      )}

      <PdfPreviewModal blob={pdfBlob} filename="client-report.pdf" onClose={() => setPdfBlob(null)} />
    </div>
  )
}
