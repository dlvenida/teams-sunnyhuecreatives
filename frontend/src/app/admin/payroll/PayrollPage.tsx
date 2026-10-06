import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { PayrollResponse, Settings, VA } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { StatCard } from "@/components/magicui/stat-card"
import { formatCurrency } from "@/lib/utils"
import { PayrollDocument } from "@/components/pdf/PayrollDocument"
import { PdfPreviewModal } from "@/components/pdf-viewer/PdfPreviewModal"
import { generatePdfBlob } from "@/lib/pdf"
import { FileDown } from "lucide-react"
import { useDisplaySettings } from "@/hooks/useDisplaySettings"

export function PayrollPage() {
  const [period, setPeriod] = useState("this_week")
  const { showPricing } = useDisplaySettings()
  const [vaId, setVaId] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [payroll, setPayroll] = useState<PayrollResponse | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)

  const { data: vas = [] } = useQuery({ queryKey: ["vas"], queryFn: () => apiFetch<VA[]>("/vas") })
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<Settings>("/settings") })

  const calculate = async () => {
    const result = await apiFetch<PayrollResponse>("/payroll/calculate", {
      method: "POST",
      body: JSON.stringify({
        va_id: vaId || null,
        period,
        date_from: period === "custom" ? dateFrom : null,
        date_to: period === "custom" ? dateTo : null,
      }),
    })
    setPayroll(result)
  }

  const exportPdf = async () => {
    if (!payroll || !settings) return
    const blob = await generatePdfBlob(
      <PayrollDocument payroll={payroll} settings={settings} showPricing={showPricing} />,
    )
    setPdfBlob(blob)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="font-display text-base font-semibold">VA Payroll</h1>

      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div><Label>VA</Label><Select value={vaId} onChange={(e) => setVaId(e.target.value)}><option value="">All VAs</option>{vas.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></div>
        <div><Label>Period</Label><Select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="this_week">This Week</option><option value="last_week">Last Week</option><option value="custom">Custom Range</option></Select></div>
        {period === "custom" && <><div><Label>From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div><div><Label>To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div></>}
        <div className="flex items-end"><Button variant="gold" onClick={calculate}>Calculate</Button></div>
      </div>

      {payroll && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {payroll.vas.map((va) => (
              <StatCard
                key={va.va_id}
                title={`${va.va_name} (${va.currency})`}
                value={showPricing ? formatCurrency(va.total_pay, va.currency) : `${va.total_hours} hrs`}
                subtitle={showPricing ? `${va.total_hours} hrs · ${va.entry_count} entries` : `${va.entry_count} entries`}
              />
            ))}
          </div>

          {showPricing && (
          <div className="flex gap-4 rounded-xl bg-surface p-4 text-surface-foreground">
            <div><p className="text-xs text-muted-foreground">Total PHP</p><p className="text-lg font-bold">{formatCurrency(payroll.total_php, "PHP")}</p></div>
            <div><p className="text-xs text-muted-foreground">Total USD</p><p className="text-lg font-bold">{formatCurrency(payroll.total_usd, "USD")}</p></div>
            <div className="ml-auto"><Button variant="gold" onClick={exportPdf}><FileDown className="h-4 w-4" /> Export PDF</Button></div>
          </div>
          )}

          {payroll.vas.map((va) => (
            <div key={va.va_id} className="rounded-xl border bg-card p-4">
              <h3 className="mb-3 font-display font-semibold">{va.va_name} ({va.currency})</h3>
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">Date</th><th className="p-2">Client</th><th className="p-2">Description</th><th className="p-2">Hours</th>{showPricing && <><th className="p-2">Rate</th><th className="p-2">Pay</th></>}</tr></thead>
                <tbody>{va.entries.map((e) => (<tr key={e.id} className="border-b"><td className="p-2">{e.work_date}</td><td className="p-2">{e.client_name}</td><td className="p-2 max-w-xs truncate">{e.description}</td><td className="p-2">{e.hours}</td>{showPricing && <><td className="p-2">{formatCurrency(e.rate, va.currency)}</td><td className="p-2">{formatCurrency(e.pay, va.currency)}</td></>}</tr>))}</tbody>
              </table>
            </div>
          ))}
        </>
      )}

      <PdfPreviewModal blob={pdfBlob} filename="va-payroll.pdf" onClose={() => setPdfBlob(null)} />
    </div>
  )
}
