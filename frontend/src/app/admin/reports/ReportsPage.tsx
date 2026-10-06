import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { apiFetch } from "@/lib/api"
import type { Client, ReportResponse, Settings } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Label, Select } from "@/components/ui/input"
import { formatCurrency, formatDate } from "@/lib/utils"
import { ReportDocument } from "@/components/pdf/ReportDocument"
import { PdfPreviewModal } from "@/components/pdf-viewer/PdfPreviewModal"
import { generatePdfBlob } from "@/lib/pdf"
import { FileDown } from "lucide-react"
import { useDisplaySettings } from "@/hooks/useDisplaySettings"

export function ReportsPage() {
  const navigate = useNavigate()
  const { showPricing } = useDisplaySettings()
  const [clientId, setClientId] = useState("")
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [cutoff, setCutoff] = useState(15)
  const [showRate, setShowRate] = useState(false)
  const [report, setReport] = useState<ReportResponse | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)

  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => apiFetch<Client[]>("/clients") })
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<Settings>("/settings") })

  const generate = async () => {
    const result = await apiFetch<ReportResponse>("/reports/generate", {
      method: "POST",
      body: JSON.stringify({ client_id: clientId, year, month, cutoff, show_rate: showPricing && showRate }),
    })
    setReport(result)
  }

  const exportPdf = async () => {
    if (!report || !settings) return
    const blob = await generatePdfBlob(<ReportDocument report={report} settings={settings} />)
    setPdfBlob(blob)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="font-display text-base font-semibold">Client Reports</h1>

      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div><Label>Client</Label><Select value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">Select client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
        <div><Label>Month</Label><Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleString("en", { month: "long" })}</option>)}</Select></div>
        <div><Label>Year</Label><Select value={year} onChange={(e) => setYear(Number(e.target.value))}>{[2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}</Select></div>
        <div><Label>Cutoff</Label><Select value={cutoff} onChange={(e) => setCutoff(Number(e.target.value))}><option value={15}>15th</option><option value={30}>30th</option></Select></div>
        {showPricing && (
          <div><Label>Show Rate?</Label><Select value={showRate ? "yes" : "no"} onChange={(e) => setShowRate(e.target.value === "yes")}><option value="no">Hours Only</option><option value="yes">Include Rate</option></Select></div>
        )}
        <div className="flex items-end"><Button variant="gold" onClick={generate} disabled={!clientId}>Generate</Button></div>
      </div>

      {report && (
        <div className="rounded-xl border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{report.client_name}</h2>
              <p className="text-sm text-muted-foreground">{report.period_label}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={exportPdf}><FileDown className="h-4 w-4" /> PDF</Button>
              <Button variant="gold" onClick={() => navigate(`/admin/invoices?client=${clientId}&month=${month}&year=${year}&cutoff=${cutoff}`)}>Create Invoice →</Button>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">Date</th><th className="p-2">Description</th><th className="p-2">Hours</th>{report.show_rate && <th className="p-2">Amount</th>}</tr></thead>
            <tbody>{report.lines.map((line, i) => (<tr key={i} className="border-b"><td className="p-2">{formatDate(line.work_date)}</td><td className="p-2">{line.description}</td><td className="p-2">{line.hours}</td>{report.show_rate && <td className="p-2">{formatCurrency(line.amount || 0)}</td>}</tr>))}</tbody>
          </table>
          <div className="mt-4 rounded-lg bg-surface p-3 text-surface-foreground flex justify-between">
            <span>Total Hours</span><span className="font-bold">{report.total_hours} hrs</span>
          </div>
        </div>
      )}

      <PdfPreviewModal blob={pdfBlob} filename="client-report.pdf" onClose={() => setPdfBlob(null)} />
    </div>
  )
}
