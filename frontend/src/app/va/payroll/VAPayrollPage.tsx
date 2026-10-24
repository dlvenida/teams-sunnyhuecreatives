import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input, Label, Select } from "@/components/ui/input"
import { StatCard } from "@/components/magicui/stat-card"
import { cn, formatCurrency, formatDate, formatInvoiceDate, payrollPdfFilename } from "@/lib/utils"
import { VAEarningsDocument } from "@/components/pdf/VAEarningsDocument"
import { PdfPreviewModal } from "@/components/pdf-viewer/PdfPreviewModal"
import { generatePdfBlob } from "@/lib/pdf"
import { BadgeCheck, CheckCircle2, FileDown, Send, Wallet } from "lucide-react"

interface EarningsResponse {
  currency: string
  va_name?: string | null
  company_name?: string
  this_week: { hours: string; earned: string; entries: number; currency: string }
  this_month: { hours: string; earned: string; entries: number; currency: string }
  all_time: { hours: string; earned: string; entries: number; currency: string }
  range: { hours: string; earned: string; entries: number; currency: string } | null
  by_client: { client_id: string; client_name: string; hours: string; earned: string; pay_type: string; currency: string; status: string }[]
  entries: {
    id: string
    work_date: string
    client_name: string
    description: string
    hours: string
    rate: string
    pay: string
    project_name?: string | null
    task_title?: string | null
    source?: string
  }[]
  date_from?: string | null
  date_to?: string | null
}

interface TimesheetRow {
  id: string
  period_start: string
  period_end: string
  status: string
  submitted_at: string
  total_hours: string
  entry_count: number
}

interface HistoryEntry {
  id: string
  kind: string
  status: "paid" | "unpaid" | string
  timesheet_status?: string | null
  period_start: string
  period_end: string
  paid_at?: string | null
  total_hours?: string | null
  total_pay?: string | null
  currency?: string | null
  usd_php_rate?: string | null
  php_amount?: string | null
  usd_amount?: string | null
  method?: string | null
  month_key: string
  month_label: string
}

interface HistoryResponse {
  year: number
  months: { month_key: string; month_label: string; entries: HistoryEntry[] }[]
  total_paid_php: string
  paid_count: number
  unpaid_count: number
}

function defaultRange() {
  const now = new Date()
  const mid = 15
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  if (now.getDate() <= mid) {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), mid)) }
  }
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), mid + 1)), to: iso(last) }
}

export function VAPayrollPage() {
  const qc = useQueryClient()
  const defaults = useMemo(() => defaultRange(), [])
  const [dateFrom, setDateFrom] = useState(defaults.from)
  const [dateTo, setDateTo] = useState(defaults.to)
  const [year, setYear] = useState(new Date().getFullYear())
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfFilename, setPdfFilename] = useState("my-payroll.pdf")
  const [submitMsg, setSubmitMsg] = useState("")
  const [submitErr, setSubmitErr] = useState("")

  const rangeReady = !!dateFrom && !!dateTo
  const { data: earnings, isLoading } = useQuery({
    queryKey: ["va-payroll", dateFrom, dateTo],
    queryFn: () => apiFetch<EarningsResponse>(`/va/earnings?date_from=${dateFrom}&date_to=${dateTo}`),
    enabled: rangeReady,
  })
  const { data: sheets = [] } = useQuery({
    queryKey: ["va-timesheets", dateFrom, dateTo],
    queryFn: () => apiFetch<TimesheetRow[]>(`/va/timesheets?date_from=${dateFrom}&date_to=${dateTo}`),
    enabled: rangeReady,
  })
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ["va-payroll-history", year],
    queryFn: () => apiFetch<HistoryResponse>(`/va/payroll-history?year=${year}`),
  })
  const submitted = sheets[0]

  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return [y, y - 1, y - 2]
  }, [])

  const submitTimesheet = useMutation({
    mutationFn: () =>
      apiFetch<TimesheetRow>("/va/timesheets/submit", {
        method: "POST",
        body: JSON.stringify({ date_from: dateFrom, date_to: dateTo }),
      }),
    onSuccess: () => {
      setSubmitErr("")
      setSubmitMsg("Timesheet submitted! Admin and auditor can review it for payroll.")
      qc.invalidateQueries({ queryKey: ["va-timesheets"] })
      qc.invalidateQueries({ queryKey: ["va-payroll-history"] })
    },
    onError: (err: Error) => {
      setSubmitMsg("")
      setSubmitErr(err.message)
    },
  })

  const exportPdf = async () => {
    if (!earnings || !rangeReady) return
    const name = earnings.va_name || "VA"
    setPdfFilename(payrollPdfFilename(name, dateFrom, dateTo))
    setPdfBlob(
      await generatePdfBlob(
        <VAEarningsDocument
          data={{
            va_name: earnings.va_name,
            currency: earnings.currency,
            date_from: dateFrom,
            date_to: dateTo,
            company_name: earnings.company_name || "Sunny Hue Creatives",
            principal_name: "Jane Laurine Venida",
            location: "Dumaguete City, Philippines",
            range: earnings.range,
            by_client: earnings.by_client,
            entries: earnings.entries ?? [],
          }}
        />,
      ),
    )
  }

  const openPeriod = (e: HistoryEntry) => {
    setDateFrom(e.period_start)
    setDateTo(e.period_end)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <h1 className="font-display text-xl font-bold">My Payroll</h1>
          <p className="text-xs text-muted-foreground">
            Your year of pay at a glance — peso amounts first — plus submit a timesheet for any period.
          </p>
        </div>
      </div>

      {/* Year history — primary, easy to scan */}
      <div className="space-y-3 rounded-3xl border border-primary/20 bg-gradient-to-br from-rose-50/70 via-card to-amber-50/40 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              <Wallet className="h-3.5 w-3.5" /> Payroll history
            </p>
            <h2 className="font-display text-lg font-bold">Your pay by month</h2>
            <p className="text-xs text-muted-foreground">Scroll the year. Each period shows the peso you received and paid/unpaid status.</p>
          </div>
          <div>
            <Label className="text-[10px]">Year</Label>
            <Select value={String(year)} onChange={(e) => setYear(parseInt(e.target.value, 10))} className="h-9 w-[110px]">
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </div>
        </div>

        {history && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border bg-white/80 p-3">
              <p className="text-[11px] text-muted-foreground">Paid this year (₱)</p>
              <p className="mt-1 text-2xl font-extrabold tracking-tight">{formatCurrency(history.total_paid_php, "PHP")}</p>
            </div>
            <div className="rounded-2xl border bg-white/80 p-3">
              <p className="text-[11px] text-muted-foreground">Paid periods</p>
              <p className="mt-1 text-2xl font-extrabold">{history.paid_count}</p>
            </div>
            <div className="rounded-2xl border bg-white/80 p-3 col-span-2 sm:col-span-1">
              <p className="text-[11px] text-muted-foreground">Waiting to be paid</p>
              <p className="mt-1 text-2xl font-extrabold">{history.unpaid_count}</p>
            </div>
          </div>
        )}

        {historyLoading && <p className="text-sm text-muted-foreground">Loading your payroll history…</p>}

        {history && history.months.length === 0 && (
          <p className="rounded-xl border border-dashed bg-white/60 p-5 text-center text-sm text-muted-foreground">
            No payroll periods in {year} yet. Submit a timesheet below when you&apos;re ready.
          </p>
        )}

        {history?.months.map((month) => (
          <div key={month.month_key} className="space-y-2">
            <h3 className="px-1 pt-2 text-sm font-extrabold text-foreground">{month.month_label}</h3>
            <div className="space-y-2">
              {month.entries.map((e) => {
                const paid = e.status === "paid"
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => openPeriod(e)}
                    className="flex w-full flex-wrap items-center gap-3 rounded-2xl border bg-white/90 px-4 py-3 text-left transition hover:border-primary/40 hover:shadow-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">
                        {formatDate(e.period_start)} – {formatDate(e.period_end)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {e.total_hours != null ? `${e.total_hours} hrs` : "—"}
                        {e.paid_at ? ` · paid ${formatDate(e.paid_at.slice(0, 10))}` : ""}
                        {e.timesheet_status && !paid ? ` · timesheet ${e.timesheet_status}` : ""}
                        {e.method ? ` · ${e.method.replace("_", " ")}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      {e.php_amount != null ? (
                        <>
                          <p className="text-xl font-extrabold leading-none tracking-tight">{formatCurrency(e.php_amount, "PHP")}</p>
                          {e.usd_amount != null && (
                            <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                              {formatCurrency(e.usd_amount, "USD")} USD
                              {e.usd_php_rate ? ` · @ ${Number(e.usd_php_rate).toFixed(2)}` : ""}
                            </p>
                          )}
                        </>
                      ) : e.usd_amount != null || e.total_pay != null ? (
                        <p className="text-lg font-extrabold">{formatCurrency(e.usd_amount || e.total_pay || 0, (e.currency as "PHP" | "USD") || "USD")}</p>
                      ) : (
                        <p className="text-sm font-semibold text-muted-foreground">Amount pending</p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide",
                        paid ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900",
                      )}
                    >
                      {paid ? (
                        <span className="inline-flex items-center gap-1"><BadgeCheck className="h-3 w-3" /> Paid</span>
                      ) : (
                        "Unpaid"
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Timesheet tools for a selected range */}
      <div className="space-y-4">
        <div>
          <h2 className="font-display text-base font-bold">Submit timesheet</h2>
          <p className="text-xs text-muted-foreground">Pick a date range, submit for review, or download a PDF of approved work.</p>
        </div>

        <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label>From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
          <div className="flex items-end">
            <Button
              variant="gold"
              className="w-full"
              disabled={!rangeReady || submitTimesheet.isPending || submitted?.status === "reviewed"}
              onClick={() => submitTimesheet.mutate()}
              title={submitted?.status === "reviewed" ? "Approved timesheets are locked" : undefined}
            >
              <Send className="h-4 w-4" />{" "}
              {submitted?.status === "reviewed"
                ? "Timesheet locked"
                : submitted
                  ? "Resubmit timesheet"
                  : "Submit timesheet"}
            </Button>
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={exportPdf} disabled={!earnings?.range}>
              <FileDown className="h-4 w-4" /> Download PDF
            </Button>
          </div>
        </div>

        {submitted && (
          <p className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs",
            submitted.status === "reviewed"
              ? "border-green-200 bg-green-50 text-green-900"
              : "border-sky-200 bg-sky-50 text-sky-800",
          )}>
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              Timesheet for {formatInvoiceDate(submitted.period_start)} – {formatInvoiceDate(submitted.period_end)}
              {" · "}status: <strong className="capitalize">{submitted.status === "reviewed" ? "approved (locked)" : submitted.status}</strong>
              {submitted.status === "reviewed" && (
                <span className="mt-1 block text-[11px]">
                  You cannot resubmit this period. Late entries for these dates still work — they roll over to the next payroll (paid after the next cutoff: 15th or end of month).
                </span>
              )}
            </span>
          </p>
        )}
        <p className="rounded-xl border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
          Payroll schedule: submit by the <strong>15th</strong> (paid on the 16th) and by the <strong>30th/31st</strong> (paid on the 1st). Dashboard reminders appear a few days before each deadline.
        </p>
        {submitMsg && <p className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">{submitMsg}</p>}
        {submitErr && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{submitErr}</p>}

        {!rangeReady && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Pick From and To dates to load your payroll report.</p>}
        {isLoading && <p className="text-sm text-muted-foreground">Loading payroll…</p>}

        {earnings && rangeReady && (
          <>
            <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-card p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Timesheet for</p>
              <p className="mt-1 font-display text-lg font-bold">{earnings.va_name || "You"}</p>
              <p className="text-sm text-muted-foreground">
                {formatInvoiceDate(dateFrom)} – {formatInvoiceDate(dateTo)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                title="Range total"
                value={formatCurrency(earnings.range?.earned ?? 0, earnings.currency)}
                subtitle={`${earnings.range?.hours ?? 0} hrs approved`}
                className="border-primary/30"
              />
              <StatCard title="Entries" value={earnings.range?.entries ?? 0} subtitle="Approved in this range" />
              <StatCard title="This week" value={formatCurrency(earnings.this_week.earned, earnings.this_week.currency)} subtitle={`${earnings.this_week.hours} hrs`} />
              <StatCard title="This month" value={formatCurrency(earnings.this_month.earned, earnings.this_month.currency)} subtitle={`${earnings.this_month.hours} hrs`} />
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle>Earnings by client</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                      <th className="p-3">Client</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Hours</th>
                      <th className="p-3">Earned</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {earnings.by_client.map((r) => (
                      <tr key={r.client_id} className="border-b last:border-0">
                        <td className="p-3 font-semibold">{r.client_name}</td>
                        <td className="p-3 capitalize">{r.pay_type}</td>
                        <td className="p-3">{r.hours}</td>
                        <td className="p-3 font-semibold">{formatCurrency(r.earned, r.currency)}</td>
                        <td className="p-3">{r.status}</td>
                      </tr>
                    ))}
                    {earnings.by_client.length === 0 && (
                      <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No approved work in this range yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle>Timesheet detail</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                      <th className="p-3">Date</th>
                      <th className="p-3">Client</th>
                      <th className="p-3">Description</th>
                      <th className="p-3">Hours</th>
                      <th className="p-3">Rate</th>
                      <th className="p-3">Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(earnings.entries ?? []).map((e) => (
                      <tr key={e.id} className="border-b last:border-0">
                        <td className="whitespace-nowrap p-3">{formatDate(e.work_date)}</td>
                        <td className="p-3 font-medium">{e.client_name}</td>
                        <td className="max-w-xs p-3"><span className="line-clamp-2">{e.description || e.task_title || "—"}</span></td>
                        <td className="p-3 font-bold">{e.hours}</td>
                        <td className="p-3">{formatCurrency(e.rate, earnings.currency)}</td>
                        <td className="p-3 font-semibold">{formatCurrency(e.pay, earnings.currency)}</td>
                      </tr>
                    ))}
                    {(earnings.entries ?? []).length === 0 && (
                      <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No approved entries in this range.</td></tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <PdfPreviewModal blob={pdfBlob} filename={pdfFilename} onClose={() => setPdfBlob(null)} />
    </div>
  )
}
