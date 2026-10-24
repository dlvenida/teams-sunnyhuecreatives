import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input, Label } from "@/components/ui/input"
import { PiggyBank, Plus, Trash2, Wallet } from "lucide-react"

type OwnerFinance = {
  period_start: string
  period_end: string
  usd_php_rate: string | null
  total_earned: string
  total_earned_php: string | null
  total_va_payroll: string
  total_va_payroll_php: string | null
  total_expenses: string
  total_expenses_php: string | null
  net_profit: string
  net_profit_php: string | null
  by_client: { client_name: string; earned: string; earned_php: string | null; invoices: number }[]
  expenses: { id: string; expense_date: string; description: string; amount: string; currency: string }[]
  va_runs_count: number
  invoices_count: number
}

function monthBounds(d = new Date()) {
  const y = d.getFullYear()
  const m = d.getMonth()
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 0)
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  return { from: iso(start), to: iso(end) }
}

function Dual({ usd, php }: { usd: string | number; php?: string | null }) {
  return (
    <div>
      <p className="text-2xl font-extrabold leading-none tracking-tight">{formatCurrency(usd, "USD")}</p>
      {php != null && php !== "" && (
        <p className="mt-1 text-xs font-semibold text-muted-foreground">{formatCurrency(php, "PHP")}</p>
      )}
    </div>
  )
}

export function OwnerFinancePanel() {
  const qc = useQueryClient()
  const defaults = useMemo(() => monthBounds(), [])
  const [dateFrom, setDateFrom] = useState(defaults.from)
  const [dateTo, setDateTo] = useState(defaults.to)
  const [rate, setRate] = useState("")
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10))
  const [expDesc, setExpDesc] = useState("")
  const [expAmount, setExpAmount] = useState("")
  const [formError, setFormError] = useState("")

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    if (dateFrom) p.set("date_from", dateFrom)
    if (dateTo) p.set("date_to", dateTo)
    const r = parseFloat(rate)
    if (rate && !Number.isNaN(r) && r > 0) p.set("usd_php_rate", String(r))
    return p.toString()
  }, [dateFrom, dateTo, rate])

  const { data, isLoading } = useQuery({
    queryKey: ["owner-finance", qs],
    queryFn: () => apiFetch<OwnerFinance>(`/dashboard/owner-finance?${qs}`),
  })

  const addExpense = useMutation({
    mutationFn: () =>
      apiFetch("/expenses", {
        method: "POST",
        body: JSON.stringify({
          expense_date: expDate,
          description: expDesc.trim(),
          amount: parseFloat(expAmount),
          currency: "USD",
        }),
      }),
    onSuccess: () => {
      setFormError("")
      setExpDesc("")
      setExpAmount("")
      qc.invalidateQueries({ queryKey: ["owner-finance"] })
    },
    onError: (err: Error) => setFormError(err.message),
  })

  const removeExpense = useMutation({
    mutationFn: (id: string) => apiFetch(`/expenses/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner-finance"] }),
  })

  const netPositive = data ? Number(data.net_profit) >= 0 : true

  return (
    <div className="space-y-4 rounded-3xl border border-primary/20 bg-gradient-to-br from-rose-50/80 via-card to-amber-50/50 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
            <PiggyBank className="h-3.5 w-3.5" /> Owner earnings
          </p>
          <h2 className="font-display text-lg font-bold">Your money at a glance</h2>
          <p className="text-xs text-muted-foreground">
            Client income, VA payroll, and other expenses — private to you. Pick dates and a USD→PHP rate to see pesos too.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-[10px]">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[140px]" />
          </div>
          <div>
            <Label className="text-[10px]">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[140px]" />
          </div>
          <div>
            <Label className="text-[10px]">USD to PHP Rate</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 58.50"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="h-9 w-[120px]"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const b = monthBounds()
              setDateFrom(b.from)
              setDateTo(b.to)
            }}
          >
            This month
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading earnings…</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Total Earned", hint: "From clients", usd: data.total_earned, php: data.total_earned_php, tone: "" },
              { label: "Total Paid to VAs", hint: `${data.va_runs_count} payroll run(s)`, usd: data.total_va_payroll, php: data.total_va_payroll_php, tone: "" },
              { label: "Total Expenses", hint: "Tools & misc", usd: data.total_expenses, php: data.total_expenses_php, tone: "" },
              {
                label: "Net Profit",
                hint: "Income − payroll − expenses",
                usd: data.net_profit,
                php: data.net_profit_php,
                tone: netPositive ? "text-green-700" : "text-red-600",
              },
            ].map((s) => (
              <Card key={s.label} className="min-w-0 border-primary/10 bg-white/80">
                <CardContent className="p-4">
                  <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
                  <div className={s.tone}>
                    <Dual usd={s.usd} php={s.php} />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{s.hint}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="min-w-0 border-primary/10 bg-white/80">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wallet className="h-4 w-4 text-primary" /> Earned per client
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.by_client.length === 0 && (
                  <p className="text-xs text-muted-foreground">No invoices in this period yet.</p>
                )}
                {data.by_client.map((row) => (
                  <div key={row.client_name} className="flex items-center justify-between gap-3 rounded-xl border border-rose-100/80 bg-rose-50/40 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{row.client_name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {row.invoices} invoice{row.invoices === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-extrabold">{formatCurrency(row.earned, "USD")}</p>
                      {row.earned_php && (
                        <p className="text-[10px] font-semibold text-muted-foreground">{formatCurrency(row.earned_php, "PHP")}</p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="min-w-0 border-primary/10 bg-white/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Business expenses</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 rounded-xl border border-dashed border-primary/25 bg-primary/[0.03] p-3 sm:grid-cols-[1fr_1.4fr_0.8fr_auto]">
                  <div>
                    <Label className="text-[10px]">Date</Label>
                    <Input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-[10px]">Description</Label>
                    <Input
                      placeholder="e.g. Canva Pro"
                      value={expDesc}
                      onChange={(e) => setExpDesc(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px]">Amount (USD)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={expAmount}
                      onChange={(e) => setExpAmount(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      size="sm"
                      variant="gold"
                      className="w-full"
                      disabled={addExpense.isPending || !expDesc.trim() || !expAmount}
                      onClick={() => addExpense.mutate()}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </div>
                </div>
                {formError && <p className="text-xs text-red-600">{formError}</p>}

                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {data.expenses.length === 0 && (
                    <p className="text-xs text-muted-foreground">No expenses logged for this period. Add tools, subscriptions, or misc costs above.</p>
                  )}
                  {data.expenses.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs">
                      <span className="w-[88px] shrink-0 text-muted-foreground">{formatDate(e.expense_date)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{e.description}</span>
                      <span className="shrink-0 font-bold">{formatCurrency(e.amount, e.currency)}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Remove expense"
                        onClick={() => {
                          if (confirm(`Remove “${e.description}”?`)) removeExpense.mutate(e.id)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Period total expenses: <b>{formatCurrency(data.total_expenses, "USD")}</b>
                  {data.total_expenses_php ? <> · <b>{formatCurrency(data.total_expenses_php, "PHP")}</b></> : null}
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
