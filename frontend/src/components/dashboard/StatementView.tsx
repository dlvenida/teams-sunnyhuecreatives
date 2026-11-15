import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formatStatementMoney, localISODate } from "@/lib/utils"
import { generatePdfBlob } from "@/lib/pdf"
import { StatementDocument, type StatementData } from "@/components/pdf/StatementDocument"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import type { Settings } from "@/lib/types"
import { Download } from "lucide-react"

function monthBounds(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return { from: localISODate(start), to: localISODate(end) }
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function StatementView() {
  const defaults = useMemo(() => monthBounds(), [])
  const [dateFrom, setDateFrom] = useState(defaults.from)
  const [dateTo, setDateTo] = useState(defaults.to)
  const [rate, setRate] = useState("")
  const [currency, setCurrency] = useState<"PHP" | "USD">("PHP")
  const [pdfError, setPdfError] = useState("")
  const [downloading, setDownloading] = useState(false)
  const bounds = isIsoDate(dateFrom) && isIsoDate(dateTo)
    ? (dateFrom <= dateTo ? { start: dateFrom, end: dateTo } : { start: dateTo, end: dateFrom })
    : null

  const qs = useMemo(() => {
    if (!bounds) return ""
    const params = new URLSearchParams()
    params.set("date_from", bounds.start)
    params.set("date_to", bounds.end)
    params.set("display_currency", currency)
    const parsed = parseFloat(rate)
    if (rate && !Number.isNaN(parsed) && parsed > 0) params.set("usd_php_rate", String(parsed))
    return params.toString()
  }, [bounds, currency, rate])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["owner-statement", qs],
    queryFn: () => apiFetch<StatementData>(`/dashboard/owner-statement?${qs}`),
    enabled: !!qs,
  })
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<Settings>("/settings"),
  })

  const download = async () => {
    if (!data) return
    setPdfError("")
    setDownloading(true)
    try {
      const blob = await generatePdfBlob(<StatementDocument statement={data} settings={settings} />)
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `Statement-${data.period_start}-to-${data.period_end}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "Could not build the statement PDF.")
    } finally {
      setDownloading(false)
    }
  }

  const show = (amount: string | null | undefined) => formatStatementMoney(amount ?? 0, currency)

  return (
    <div data-testid="statement-view" className="space-y-4 rounded-3xl border border-primary/20 bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Statement</h2>
          <p className="text-xs text-muted-foreground">Money in and money out for the dates you pick. Same totals as Earnings.</p>
        </div>
        <Button variant="gold" disabled={!data || downloading} onClick={() => void download()}>
          <Download className="h-3.5 w-3.5" /> Download statement PDF
        </Button>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <Label className="text-[10px]">From</Label>
            <Input aria-label="Statement from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-full" />
          </div>
          <div className="min-w-0">
            <Label className="text-[10px]">To</Label>
            <Input aria-label="Statement to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-full" />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 w-full sm:w-auto">
            <Label className="text-[10px]">USD to PHP Rate</Label>
            <Input aria-label="Statement USD to PHP Rate" type="number" step="0.01" min="0" placeholder="e.g. 58.50" value={rate} onChange={(e) => setRate(e.target.value)} className="h-9 w-full sm:w-[140px]" />
          </div>
          <div className="flex gap-1">
            <Button type="button" size="sm" variant={currency === "PHP" ? "gold" : "outline"} onClick={() => setCurrency("PHP")}>PHP</Button>
            <Button type="button" size="sm" variant={currency === "USD" ? "gold" : "outline"} onClick={() => setCurrency("USD")}>USD</Button>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => { const next = monthBounds(); setDateFrom(next.from); setDateTo(next.to) }}>This month</Button>
        </div>
      </div>
      {pdfError && <p className="text-xs text-red-600">{pdfError}</p>}
      {data?.needs_rate && data.rate_hint && <p className="text-xs text-muted-foreground">{data.rate_hint}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading statement…</p>}
      {isError && <p className="text-sm text-red-600">{error instanceof Error ? error.message : "Could not load the statement."}</p>}
      {data && (
        <>
          <div data-testid="statement-summary" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Opening balance", show(data.opening_balance)],
              ["Total money in", show(data.total_in)],
              ["VA pay", show(data.va_pay)],
              ["Business expenses", show(data.business_expenses)],
              ["Total money out", show(data.total_out)],
              ["Net profit", show(data.net)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border bg-white/80 px-3 py-2">
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className="text-sm font-extrabold">{value}</p>
              </div>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead>
                <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Date</th>
                  <th className="py-2 pr-2 font-medium">Description</th>
                  <th className="py-2 pr-2 font-medium">Category</th>
                  <th className="py-2 pr-2 text-right font-medium">Money in</th>
                  <th className="py-2 pr-2 text-right font-medium">Money out</th>
                  <th className="py-2 text-right font-medium">Running balance</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.length === 0 && (
                  <tr><td colSpan={6} className="py-3 text-muted-foreground">No money in this date range.</td></tr>
                )}
                {data.lines.map((line, index) => (
                  <tr key={`${line.date}-${index}`} className="border-b align-top">
                    <td className="py-2 pr-2 whitespace-nowrap">{line.date}</td>
                    <td className="py-2 pr-2">
                      {line.description}
                      {line.original_amount && (
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">Recorded {formatStatementMoney(line.original_amount, line.original_currency || currency)}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2">{line.category}</td>
                    <td className="py-2 pr-2 text-right">{line.money_in ? show(line.money_in) : ""}</td>
                    <td className="py-2 pr-2 text-right">{line.money_out ? show(line.money_out) : ""}</td>
                    <td className="py-2 text-right font-semibold">{line.balance ? show(line.balance) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 md:hidden">
            {data.lines.length === 0 && <p className="text-xs text-muted-foreground">No money in this date range.</p>}
            {data.lines.map((line, index) => (
              <div key={`${line.date}-card-${index}`} className="rounded-2xl border px-3 py-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{line.description}</p>
                  <p className="shrink-0 text-[10px] text-muted-foreground">{line.date}</p>
                </div>
                <p className="text-[10px] text-muted-foreground">{line.category}</p>
                {line.original_amount && (
                  <p className="text-[10px] text-muted-foreground">Recorded {formatStatementMoney(line.original_amount, line.original_currency || currency)}</p>
                )}
                <div className="mt-1 flex justify-between gap-2">
                  <span>In {line.money_in ? show(line.money_in) : "-"}</span>
                  <span>Out {line.money_out ? show(line.money_out) : "-"}</span>
                  <span className="font-semibold">Balance {line.balance ? show(line.balance) : "-"}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
