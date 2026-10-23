import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input, Label } from "@/components/ui/input"
import { StatCard } from "@/components/magicui/stat-card"
import { formatCurrency, formatDate, formatInvoiceDate, payrollPdfFilename } from "@/lib/utils"
import { VAEarningsDocument } from "@/components/pdf/VAEarningsDocument"
import { PdfPreviewModal } from "@/components/pdf-viewer/PdfPreviewModal"
import { generatePdfBlob } from "@/lib/pdf"
import { CheckCircle2, FileDown, Send } from "lucide-react"

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
  const submitted = sheets[0]

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
            range: earnings.range,
            by_client: earnings.by_client,
            entries: earnings.entries ?? [],
          }}
        />,
      ),
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <h1 className="font-display text-xl font-bold">My Payroll</h1>
          <p className="text-xs text-muted-foreground">
            Pick your date range, submit your timesheet for review, then download your PDF when you&apos;re ready.
          </p>
        </div>
        {rangeReady && earnings?.range && (
          <p className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold">
            {formatDate(dateFrom)} – {formatDate(dateTo)}
          </p>
        )}
      </div>

      <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label>From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div><Label>To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        <div className="flex items-end">
          <Button
            variant="gold"
            className="w-full"
            disabled={!rangeReady || submitTimesheet.isPending}
            onClick={() => submitTimesheet.mutate()}
          >
            <Send className="h-4 w-4" /> {submitted ? "Resubmit timesheet" : "Submit timesheet"}
          </Button>
        </div>
        <div className="flex items-end">
          <Button variant="outline" className="w-full" onClick={exportPdf} disabled={!earnings?.range}>
            <FileDown className="h-4 w-4" /> Download PDF
          </Button>
        </div>
      </div>

      {submitted && (
        <p className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          <CheckCircle2 className="h-4 w-4" />
          Timesheet submitted for {formatInvoiceDate(submitted.period_start)} – {formatInvoiceDate(submitted.period_end)}
          {" · "}status: <strong className="capitalize">{submitted.status}</strong>
        </p>
      )}
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
            <StatCard title="Range total" value={formatCurrency(earnings.range?.earned ?? 0, earnings.currency)} subtitle={`${earnings.range?.hours ?? 0} hrs approved`} className="border-primary/30" />
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

      <PdfPreviewModal blob={pdfBlob} filename={pdfFilename} onClose={() => setPdfBlob(null)} />
    </div>
  )
}
