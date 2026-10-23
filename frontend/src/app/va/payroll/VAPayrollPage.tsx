import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input, Label } from "@/components/ui/input"
import { StatCard } from "@/components/magicui/stat-card"
import { formatCurrency, formatDate } from "@/lib/utils"
import { VAEarningsDocument } from "@/components/pdf/VAEarningsDocument"
import { PdfPreviewModal } from "@/components/pdf-viewer/PdfPreviewModal"
import { generatePdfBlob } from "@/lib/pdf"
import { FileDown } from "lucide-react"

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
  const defaults = useMemo(() => defaultRange(), [])
  const [dateFrom, setDateFrom] = useState(defaults.from)
  const [dateTo, setDateTo] = useState(defaults.to)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)

  const rangeReady = !!dateFrom && !!dateTo
  const { data: earnings, isLoading } = useQuery({
    queryKey: ["va-payroll", dateFrom, dateTo],
    queryFn: () => apiFetch<EarningsResponse>(`/va/earnings?date_from=${dateFrom}&date_to=${dateTo}`),
    enabled: rangeReady,
  })

  const exportPdf = async () => {
    if (!earnings || !rangeReady) return
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
            Choose any date range (e.g. Oct 1–15) to see earnings per client and download your timesheet PDF.
          </p>
        </div>
        {rangeReady && earnings?.range && (
          <p className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold">
            {formatDate(dateFrom)} – {formatDate(dateTo)}
          </p>
        )}
      </div>

      <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-3">
        <div><Label>From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div><Label>To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        <div className="flex items-end">
          <Button variant="gold" className="w-full" onClick={exportPdf} disabled={!earnings?.range}>
            <FileDown className="h-4 w-4" /> Download timesheet PDF
          </Button>
        </div>
      </div>

      {!rangeReady && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Pick From and To dates to load your payroll report.</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading payroll…</p>}

      {earnings && rangeReady && (
        <>
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

      <PdfPreviewModal blob={pdfBlob} filename="my-payroll.pdf" onClose={() => setPdfBlob(null)} />
    </div>
  )
}
