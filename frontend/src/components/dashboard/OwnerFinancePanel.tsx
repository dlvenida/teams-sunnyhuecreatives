import { useEffect, useMemo, useState } from "react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { formatCurrency, formatDate, localISODate } from "@/lib/utils"
import type { Client } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input, Label, Select } from "@/components/ui/input"
import { PiggyBank, Plus, Trash2, Wallet } from "lucide-react"

type MoneySide = {
  usd: string
  php: string
  combined_usd: string | null
  combined_php: string | null
}

type ByClient = {
  client_id: string | null
  client_name: string
  earned_usd: string
  earned_php: string
  combined_usd: string | null
  combined_php: string | null
  invoices: number
  manual: number
}

type ManualEarningRow = {
  id: string
  client_id: string
  client_name: string
  client_active: boolean
  earned_date: string
  description: string | null
  amount: string
  currency: string
}

type OwnerFinance = {
  period_start: string
  period_end: string
  usd_php_rate: string | null
  earned: MoneySide
  va_payroll: MoneySide
  expense_totals: MoneySide
  net: MoneySide
  by_client: ByClient[]
  manual_earnings: ManualEarningRow[]
  expenses: { id: string; expense_date: string; description: string; amount: string; currency: string }[]
  va_runs_count: number
  invoices_count: number
  manual_count: number
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function rangeBounds(from: string, to: string) {
  if (!isIsoDate(from) || !isIsoDate(to)) return null
  return from <= to ? { start: from, end: to } : { start: to, end: from }
}

function monthBounds(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return { from: localISODate(start), to: localISODate(end) }
}

function hasAmount(value: string | null | undefined) {
  const num = Number(value || 0)
  return !Number.isNaN(num) && num !== 0
}

function isCurrentClient(client: Client) {
  return client.is_active && (client.approval_status || "approved") === "approved"
}

function pastClientLabel(client: Client) {
  const status = client.approval_status || "approved"
  if (status === "pending") return `${client.name} (pending)`
  if (status === "rejected") return `${client.name} (declined)`
  return `${client.name} (past)`
}

function sourceLabel(row: ByClient) {
  const parts: string[] = []
  if (row.invoices) parts.push(`${row.invoices} invoice${row.invoices === 1 ? "" : "s"}`)
  if (row.manual) parts.push(`${row.manual} manual entr${row.manual === 1 ? "y" : "ies"}`)
  return parts.join(", ")
}

function MoneyFigures({
  side,
  tone = "",
  compact = false,
}: {
  side: { usd: string; php: string; combined_usd: string | null; combined_php: string | null }
  tone?: string
  compact?: boolean
}) {
  const money = asMoneySide(side)
  const rateOn = money.combined_usd != null && money.combined_php != null
  const usdOn = hasAmount(money.usd)
  const phpOn = hasAmount(money.php)
  const mixed = usdOn && phpOn
  const primary = compact ? "text-sm font-extrabold" : "text-2xl font-extrabold leading-none tracking-tight"
  const secondary = compact ? "text-xs font-extrabold" : "mt-1 text-lg font-extrabold leading-none tracking-tight"
  if (rateOn) {
    return (
      <div className={tone}>
        <p className={primary}>{formatCurrency(money.combined_usd, "USD")}</p>
        <p className={secondary}>{formatCurrency(money.combined_php, "PHP")}</p>
        {mixed && (
          <p className="mt-1 text-[10px] font-medium text-muted-foreground">
            Recorded {formatCurrency(money.usd, "USD")} · {formatCurrency(money.php, "PHP")}
          </p>
        )}
      </div>
    )
  }
  if (!usdOn && !phpOn) {
    return (
      <div className={tone}>
        <p className={primary}>{formatCurrency(0, "USD")}</p>
        <p className={secondary}>{formatCurrency(0, "PHP")}</p>
      </div>
    )
  }
  return (
    <div className={tone}>
      {(usdOn || !phpOn) && <p className={primary}>{formatCurrency(money.usd, "USD")}</p>}
      {phpOn && <p className={usdOn ? secondary : primary}>{formatCurrency(money.php, "PHP")}</p>}
    </div>
  )
}

function sideHasBoth(side: MoneySide) {
  return hasAmount(side.usd) && hasAmount(side.php)
}

const EMPTY_MONEY: MoneySide = {
  usd: "0.00",
  php: "0.00",
  combined_usd: null,
  combined_php: null,
}

/** A missing total (old payload, empty body, or a field the API did not send) is zero, never a crash. */
function asMoneySide(side: Partial<MoneySide> | null | undefined): MoneySide {
  if (!side || typeof side !== "object") return EMPTY_MONEY
  return {
    usd: side.usd ?? "0.00",
    php: side.php ?? "0.00",
    combined_usd: side.combined_usd ?? null,
    combined_php: side.combined_php ?? null,
  }
}

const LEGACY_MONEY_KEYS = {
  earned: ["total_earned", "total_earned_php"],
  va_payroll: ["total_va_payroll", "total_va_payroll_php"],
  expense_totals: ["total_expenses", "total_expenses_php"],
  net: ["net_profit", "net_profit_php"],
} as const

function financeSide(data: OwnerFinance | undefined, key: keyof typeof LEGACY_MONEY_KEYS): MoneySide {
  const direct = data?.[key]
  if (direct && typeof direct === "object") return asMoneySide(direct)
  const record = data as (OwnerFinance & Record<string, unknown>) | undefined
  const [usdKey, phpKey] = LEGACY_MONEY_KEYS[key]
  if (!record || (record[usdKey] == null && record[phpKey] == null)) return EMPTY_MONEY
  return asMoneySide({
    usd: record[usdKey] != null ? String(record[usdKey]) : "0.00",
    php: record[phpKey] != null ? String(record[phpKey]) : "0.00",
  })
}

function clientMoney(row: (ByClient & { earned?: string | null }) | null | undefined): MoneySide {
  if (!row) return EMPTY_MONEY
  return asMoneySide({
    usd: row.earned_usd ?? row.earned ?? "0.00",
    php: row.earned_php ?? "0.00",
    combined_usd: row.combined_usd ?? null,
    combined_php: row.combined_php ?? null,
  })
}

function moneySummary(side: MoneySide) {
  if (side.combined_usd != null && side.combined_php != null) {
    return `${formatCurrency(side.combined_usd, "USD")} · ${formatCurrency(side.combined_php, "PHP")}`
  }
  if (!hasAmount(side.usd) && !hasAmount(side.php)) {
    return `${formatCurrency(0, "USD")} · ${formatCurrency(0, "PHP")}`
  }
  return [
    (hasAmount(side.usd) || !hasAmount(side.php)) ? formatCurrency(side.usd, "USD") : null,
    hasAmount(side.php) ? formatCurrency(side.php, "PHP") : null,
  ].filter(Boolean).join(" · ")
}

export function OwnerFinancePanel() {
  const qc = useQueryClient()
  const defaults = useMemo(() => monthBounds(), [])
  const today = useMemo(() => localISODate(new Date()), [])
  const [dateFrom, setDateFrom] = useState(defaults.from)
  const [dateTo, setDateTo] = useState(defaults.to)
  const [appliedFrom, setAppliedFrom] = useState(defaults.from)
  const [appliedTo, setAppliedTo] = useState(defaults.to)
  const [rate, setRate] = useState("")
  const [expDate, setExpDate] = useState(today)
  const [expDesc, setExpDesc] = useState("")
  const [expAmount, setExpAmount] = useState("")
  const [expenseError, setExpenseError] = useState("")
  const [earnDate, setEarnDate] = useState(today)
  const [earnClient, setEarnClient] = useState("")
  const [earnNote, setEarnNote] = useState("")
  const [earnAmount, setEarnAmount] = useState("")
  const [earnCurrency, setEarnCurrency] = useState<"USD" | "PHP">("USD")
  const [earnError, setEarnError] = useState("")

  useEffect(() => {
    const next = rangeBounds(dateFrom, dateTo)
    if (!next) return
    setAppliedFrom(next.start)
    setAppliedTo(next.end)
    setEarnDate((current) => (current < next.start || current > next.end ? next.start : current))
  }, [dateFrom, dateTo])

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    p.set("date_from", appliedFrom)
    p.set("date_to", appliedTo)
    const r = parseFloat(rate)
    if (rate && !Number.isNaN(r) && r > 0) p.set("usd_php_rate", String(r))
    return p.toString()
  }, [appliedFrom, appliedTo, rate])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["owner-finance", qs],
    queryFn: () => apiFetch<OwnerFinance>(`/dashboard/owner-finance?${qs}`),
    placeholderData: keepPreviousData,
  })

  const { data: clients = [] } = useQuery({
    queryKey: ["clients", "manual-earnings"],
    queryFn: () => apiFetch<Client[]>("/clients?include_archived=true"),
  })

  const currentClients = clients.filter(isCurrentClient)
  const pastClients = clients.filter((client) => !isCurrentClient(client))

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
      setExpenseError("")
      setExpDesc("")
      setExpAmount("")
      qc.invalidateQueries({ queryKey: ["owner-finance"] })
    },
    onError: (err: Error) => setExpenseError(err.message),
  })

  const removeExpense = useMutation({
    mutationFn: (id: string) => apiFetch(`/expenses/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner-finance"] }),
  })

  const addEarning = useMutation({
    mutationFn: () =>
      apiFetch("/manual-earnings", {
        method: "POST",
        body: JSON.stringify({
          client_id: earnClient,
          earned_date: earnDate,
          description: earnNote.trim() || null,
          amount: parseFloat(earnAmount),
          currency: earnCurrency,
        }),
      }),
    onSuccess: () => {
      setEarnError("")
      setEarnNote("")
      setEarnAmount("")
      qc.invalidateQueries({ queryKey: ["owner-finance"] })
    },
    onError: (err: Error) => setEarnError(err.message),
  })

  const removeEarning = useMutation({
    mutationFn: (id: string) => apiFetch(`/manual-earnings/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner-finance"] }),
  })

  const earned = financeSide(data, "earned")
  const vaPayroll = financeSide(data, "va_payroll")
  const expenseTotals = financeSide(data, "expense_totals")
  const net = financeSide(data, "net")
  const manualRows = data?.manual_earnings ?? []
  const expenseRows = data?.expenses ?? []
  const clientRows = data?.by_client ?? []

  const netPositive = !data
    ? true
    : net.combined_usd != null
      ? Number(net.combined_usd) >= 0
      : Number(net.usd) >= 0 && Number(net.php) >= 0

  const mixedWithoutRate = !!data && !data.usd_php_rate && (
    sideHasBoth(earned) || sideHasBoth(vaPayroll) || sideHasBoth(expenseTotals) || sideHasBoth(net)
    || ((hasAmount(earned.usd) || hasAmount(vaPayroll.usd) || hasAmount(expenseTotals.usd))
      && (hasAmount(earned.php) || hasAmount(vaPayroll.php) || hasAmount(expenseTotals.php)))
  )

  const bounds = rangeBounds(dateFrom, dateTo)

  const submitEarning = () => {
    if (bounds && (earnDate < bounds.start || earnDate > bounds.end)) {
      setEarnError(`Pick a date from ${formatDate(bounds.start)} to ${formatDate(bounds.end)} so it counts in these totals.`)
      return
    }
    if (!earnClient) {
      setEarnError("Select a client.")
      return
    }
    const amount = parseFloat(earnAmount)
    if (!earnAmount || Number.isNaN(amount) || amount <= 0) {
      setEarnError("Enter an amount greater than zero.")
      return
    }
    setEarnError("")
    addEarning.mutate()
  }

  return (
    <div className="space-y-4 rounded-3xl border border-primary/20 bg-gradient-to-br from-rose-50/80 via-card to-amber-50/50 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
            <PiggyBank className="h-3.5 w-3.5" /> Owner earnings
          </p>
          <h2 className="font-display text-lg font-bold">Your money at a glance</h2>
          <p className="text-xs text-muted-foreground">
            Totals follow the dates you pick. Enter a USD to PHP rate to see one total in dollars and the same total in pesos. Private to you.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-[10px]">From</Label>
            <Input aria-label="From" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[140px]" />
          </div>
          <div>
            <Label className="text-[10px]">To</Label>
            <Input aria-label="To" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[140px]" />
          </div>
          <div>
            <Label className="text-[10px]">USD to PHP Rate</Label>
            <Input
              aria-label="USD to PHP Rate"
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

      {mixedWithoutRate && (
        <p className="text-xs text-muted-foreground">
          This range has both USD and PHP. Enter a rate above to turn them into one total in dollars and one total in pesos.
        </p>
      )}
      {data?.usd_php_rate && (
        <p className="text-xs text-muted-foreground">
          Each total below is the same money in USD and in PHP, using 1 USD = {data.usd_php_rate} PHP. Recorded lines are the original amounts.
        </p>
      )}

      {isLoading && !data && <p className="text-sm text-muted-foreground">Loading earnings…</p>}
      {isError && !data && <p className="text-sm text-red-600">{error instanceof Error ? error.message : "Could not load earnings."}</p>}
      {!rangeBounds(dateFrom, dateTo) && (
        <p className="text-xs text-muted-foreground">Enter a real From date and To date. Totals stay on the last complete range until both dates are set.</p>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Total Earned", hint: data.usd_php_rate ? "Combined for these dates" : "Invoices and manual entries", side: earned, tone: "" },
              { label: "Total Paid to VAs", hint: `${data.va_runs_count ?? 0} payroll run(s)`, side: vaPayroll, tone: "" },
              { label: "Total Expenses", hint: "Tools and misc", side: expenseTotals, tone: "" },
              {
                label: "Net Profit",
                hint: "After VA pay and expenses",
                side: net,
                tone: netPositive ? "text-green-700" : "text-red-600",
              },
            ].map((s) => (
              <Card key={s.label} className="min-w-0 border-primary/10 bg-white/80">
                <CardContent className="p-4">
                  <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
                  <div className="mt-1">
                    <MoneyFigures side={s.side} tone={s.tone} />
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
              <CardContent className="space-y-3">
                <div className="grid gap-2 rounded-xl border border-dashed border-primary/25 bg-primary/[0.03] p-3">
                  <p className="text-[11px] font-bold">Add an earning</p>
                  <p className="text-[10px] text-muted-foreground">
                    Current and past clients are both listed. Choose USD or PHP. The date must fall inside From and To.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label className="text-[10px]">Date</Label>
                      <Input aria-label="Earning date" type="date" min={bounds?.start} max={bounds?.end} value={earnDate} onChange={(e) => setEarnDate(e.target.value)} className="h-9" />
                    </div>
                    <div>
                      <Label className="text-[10px]">Currency</Label>
                      <Select aria-label="Earning currency" value={earnCurrency} onChange={(e) => setEarnCurrency(e.target.value === "PHP" ? "PHP" : "USD")} className="h-9">
                        <option value="USD">USD ($)</option>
                        <option value="PHP">PHP (₱)</option>
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-[10px]">Client</Label>
                      <Select aria-label="Earning client" value={earnClient} onChange={(e) => setEarnClient(e.target.value)} className="h-9">
                        <option value="">Select a client</option>
                        {currentClients.length > 0 && (
                          <optgroup label="Current clients">
                            {currentClients.map((client) => (
                              <option key={client.id} value={client.id}>{client.name}</option>
                            ))}
                          </optgroup>
                        )}
                        {pastClients.length > 0 && (
                          <optgroup label="Past clients">
                            {pastClients.map((client) => (
                              <option key={client.id} value={client.id}>{pastClientLabel(client)}</option>
                            ))}
                          </optgroup>
                        )}
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px]">Note</Label>
                      <Input
                        aria-label="Earning note"
                        placeholder="Optional note"
                        value={earnNote}
                        onChange={(e) => setEarnNote(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                      <div>
                        <Label className="text-[10px]">Amount</Label>
                        <Input
                          aria-label="Earning amount"
                          type="number"
                          step="0.01"
                          min="0.01"
                          placeholder="0.00"
                          value={earnAmount}
                          onChange={(e) => setEarnAmount(e.target.value)}
                          className="h-9"
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="gold"
                        disabled={addEarning.isPending || !earnClient || !earnAmount}
                        onClick={submitEarning}
                      >
                        <Plus className="h-3.5 w-3.5" /> Add
                      </Button>
                    </div>
                  </div>
                </div>
                {earnError && <p className="text-xs text-red-600">{earnError}</p>}

                <div className="max-h-40 space-y-1.5 overflow-y-auto">
                  {manualRows.length === 0 && (
                    <p className="text-xs text-muted-foreground">No manual earnings in this period.</p>
                  )}
                  {manualRows.map((row) => (
                    <div key={row.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs">
                      <span className="w-[88px] shrink-0 text-muted-foreground">{formatDate(row.earned_date)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {row.client_name}
                        {!row.client_active && <span className="font-normal text-muted-foreground"> (past)</span>}
                        {row.description ? <span className="font-normal text-muted-foreground"> · {row.description}</span> : null}
                      </span>
                      <span className="shrink-0 font-bold">{formatCurrency(row.amount, row.currency)}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Remove earning"
                        onClick={() => {
                          if (confirm(`Remove this earning for ${row.client_name}?`)) removeEarning.mutate(row.id)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  {clientRows.length === 0 && (
                    <p className="text-xs text-muted-foreground">No earnings in this period yet.</p>
                  )}
                  {clientRows.map((row) => (
                    <div key={row.client_id || row.client_name} className="flex items-center justify-between gap-3 rounded-xl border border-rose-100/80 bg-rose-50/40 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{row.client_name}</p>
                        <p className="text-[10px] text-muted-foreground">{sourceLabel(row)}</p>
                      </div>
                      <MoneyFigures compact side={clientMoney(row)} />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  In this date range: <b>{moneySummary(earned)}</b>
                </p>
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
                {expenseError && <p className="text-xs text-red-600">{expenseError}</p>}

                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {expenseRows.length === 0 && (
                    <p className="text-xs text-muted-foreground">No expenses logged for this period. Add tools, subscriptions, or misc costs above.</p>
                  )}
                  {expenseRows.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs">
                      <span className="w-[88px] shrink-0 text-muted-foreground">{formatDate(e.expense_date)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{e.description}</span>
                      <span className="shrink-0 font-bold">{formatCurrency(e.amount, e.currency)}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Remove expense"
                        onClick={() => {
                          if (confirm(`Remove "${e.description}"?`)) removeExpense.mutate(e.id)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Period total expenses: <b>{moneySummary(expenseTotals)}</b>
                  {data.usd_php_rate && sideHasBoth(expenseTotals) && (
                    <> · recorded {formatCurrency(expenseTotals.usd, "USD")} · {formatCurrency(expenseTotals.php, "PHP")}</>
                  )}
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
