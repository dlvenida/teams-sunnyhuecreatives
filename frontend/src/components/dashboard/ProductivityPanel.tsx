import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { apiFetch } from "@/lib/api"
import { Card, CardContent } from "@/components/ui/card"
import { Input, Label } from "@/components/ui/input"
import { VA_USD_PHP_STORAGE_KEY, formatPesoEstimate, initialRateInput, isUsdPaid, parseUsdPhpRate } from "@/lib/pesoEstimate"
import { cn, formatCurrency } from "@/lib/utils"

interface DueItem {
  id?: string
  title: string
  client_name?: string
  due_date?: string | null
  task_status_label?: string
  link?: string
  detail?: string
  tone?: string
  bucket?: string
}

interface OwnProductivity {
  va_name: string
  percentage: number
  status: "on_track" | "behind" | "no_hours"
  status_label: string
  summary: string
  days_logged: number
  expected_workdays: number
  hours_this_week: string
  tasks_done_this_week: number
  tasks_open: number
  week_start: string
  week_end: string
  counts: { overdue: number; due_today: number; due_soon: number; pending: number; timesheet: number; still_open: number }
  dues: {
    overdue: DueItem[]
    due_today: DueItem[]
    due_soon: DueItem[]
    pending: DueItem[]
    timesheets: DueItem[]
  }
}

interface TeamMember {
  va_id: string
  va_name: string
  percentage: number
  status: "on_track" | "behind" | "no_hours"
  status_label: string
  summary: string
  days_logged: number
  expected_workdays: number
  hours_this_week: string
  tasks_open: number
  tasks_done_this_week: number
  timesheet_waiting: boolean
  counts: OwnProductivity["counts"]
  dues_preview: DueItem[]
  month_pay?: string
  period_pay?: string
  pay_currency?: string
  month_label?: string
  period_label?: string
}

interface TeamProductivity {
  week_start: string
  week_end: string
  counts: { on_track: number; behind: number; no_hours: number }
  members: TeamMember[]
}

const TONE: Record<string, string> = {
  on_track: "bg-green-100 text-green-800",
  behind: "bg-amber-100 text-amber-900",
  no_hours: "bg-[#F7C6D3] text-[#B8325F]",
}

const GROUPS: { key: keyof OwnProductivity["dues"]; label: string; className: string }[] = [
  { key: "overdue", label: "Overdue", className: "border-red-200 bg-red-50" },
  { key: "due_today", label: "Due today", className: "border-[#E8578A]/40 bg-[#FDF2F5]" },
  { key: "due_soon", label: "Due soon", className: "border-amber-200 bg-amber-50" },
  { key: "pending", label: "Pending", className: "bg-card" },
]

function statusClass(status: string) {
  return TONE[status] || TONE.behind
}

interface MonthPay {
  month_label: string
  month_pay: string
  month_hours: string
  period_label: string
  period_pay: string
  period_hours: string
  currency: string
}

function MonthPayCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["va-month-pay"],
    queryFn: () => apiFetch<MonthPay>("/va/month-pay"),
    retry: false,
  })
  const usd = isUsdPaid(data?.currency)
  const [rateInput, setRateInput] = useState(() => localStorage.getItem(VA_USD_PHP_STORAGE_KEY) ?? "")
  const [rateChosen, setRateChosen] = useState(() => localStorage.getItem(VA_USD_PHP_STORAGE_KEY) !== null)
  const { data: adminRate } = useQuery({
    queryKey: ["va-usd-php-rate"],
    queryFn: () => apiFetch<{ usd_php_rate: string | null }>("/va/usd-php-rate"),
    enabled: usd,
  })
  useEffect(() => {
    if (!usd || rateChosen || !adminRate) return
    setRateInput(initialRateInput(null, adminRate.usd_php_rate))
  }, [adminRate, usd, rateChosen])
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading your pay…</p>
  if (isError || !data) return null
  const rate = usd ? parseUsdPhpRate(rateInput) : null
  const monthEstimate = usd ? formatPesoEstimate(data.month_pay, rate) : null
  const periodEstimate = usd ? formatPesoEstimate(data.period_pay, rate) : null
  return (
    <div className="rounded-2xl border border-[#F7C6D3] bg-[#FDF2F5] p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="brand-label text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8325F]">Your pay</p>
          <p className="mt-1 text-4xl leading-none text-[#B8325F]">{formatCurrency(data.month_pay, data.currency)}</p>
          <p className="mt-1 text-sm font-semibold">This month, {data.month_label}</p>
          {monthEstimate && <p className="text-xs text-muted-foreground">{monthEstimate}</p>}
          <p className="text-[11px] text-muted-foreground">{data.month_hours} approved hours</p>
        </div>
        <div className="rounded-xl bg-white/80 px-3 py-2">
          <p className="brand-label text-[11px] font-bold uppercase tracking-wide text-[#B8325F]">This pay period</p>
          <p className="text-xl font-bold text-[#B8325F]">{formatCurrency(data.period_pay, data.currency)}</p>
          <p className="text-xs text-muted-foreground">{data.period_label}</p>
          {periodEstimate && <p className="text-[11px] text-muted-foreground">{periodEstimate}</p>}
          <p className="text-[11px] text-muted-foreground">{data.period_hours} approved hours</p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Same totals as My Timesheets and Pay, including a bi-weekly package half when that is your setup.</p>
      {usd && (
        <div className="mt-3">
          <Label htmlFor="dash-usd-php-rate">Enter USD to PHP rate to estimate your pay in pesos:</Label>
          <Input
            id="dash-usd-php-rate"
            className="mt-1 max-w-xs bg-white"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="58.50"
            value={rateInput}
            onChange={(event) => {
              setRateInput(event.target.value)
              setRateChosen(true)
              localStorage.setItem(VA_USD_PHP_STORAGE_KEY, event.target.value)
            }}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">This is an estimate only. Your actual peso amount will depend on the exchange rate on payroll day.</p>
        </div>
      )}
      <Link to="/va/payroll" className="mt-2 inline-block text-xs font-bold text-[#B8325F] underline">Open My Timesheets and Pay</Link>
    </div>
  )
}

export function MyProductivity() {
  const { data, isLoading } = useQuery({
    queryKey: ["my-productivity"],
    queryFn: () => apiFetch<OwnProductivity>("/dashboard/productivity"),
  })
  if (isLoading) {
    return <Card><CardContent className="p-5 text-sm text-muted-foreground">Loading your week…</CardContent></Card>
  }
  if (!data) {
    return <Card><CardContent className="p-5 text-sm text-muted-foreground">Your week could not be loaded.</CardContent></Card>
  }
  const chips = [
    ["Overdue", data.counts.overdue, data.counts.overdue > 0],
    ["Due today", data.counts.due_today, data.counts.due_today > 0],
    ["Due soon", data.counts.due_soon, false],
    ["Pending", data.counts.pending, false],
  ] as const
  return (
    <Card className="shc-brand overflow-hidden border-[#F7C6D3]">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <MonthPayCard />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="brand-label text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8325F]">This week</p>
            <div className="mt-1 flex flex-wrap items-end gap-3">
              <p className="text-5xl leading-none text-[#B8325F] sm:text-6xl">{data.percentage}%</p>
              <span className={cn("mb-1 rounded-full px-3 py-1 text-xs font-bold", statusClass(data.status))}>{data.status_label}</span>
            </div>
            <p className="mt-2 max-w-xl text-sm text-foreground/90">{data.summary}</p>
            <p className="mt-1 text-xs text-muted-foreground">{data.tasks_done_this_week} completed this week · {data.hours_this_week} hours logged · {data.tasks_open} still open</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {chips.map(([label, value, hot]) => (
            <div key={label} className={cn("rounded-2xl border px-3 py-2", hot ? "border-red-200 bg-red-50" : "border-[#F7C6D3] bg-[#FDF2F5]")}>
              <p className={cn("text-2xl font-bold leading-none", hot ? "text-red-600" : "text-[#B8325F]")}>{value}</p>
              <p className="brand-label mt-1 text-[11px] font-semibold text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
        {data.dues.timesheets.map((item) => (
          <Link key={item.title + item.detail} to={item.link || "/va/payroll"} className="block rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-sm font-bold text-amber-950">{item.title}</p>
            <p className="text-xs text-amber-900/80">{item.detail}</p>
          </Link>
        ))}
        <div className="grid gap-3 lg:grid-cols-2">
          {GROUPS.map((group) => {
            const rows = data.dues[group.key] as DueItem[]
            if (!rows?.length) return null
            return (
              <div key={group.key} className={cn("rounded-2xl border p-3", group.className)}>
                <p className="brand-label text-[11px] font-bold uppercase tracking-[0.12em] text-[#B8325F]">{group.label} · {rows.length}</p>
                <ul className="mt-2 space-y-2">
                  {rows.slice(0, 6).map((row) => (
                    <li key={row.id || row.title}>
                      <Link to={row.link || "/va/tasks"} className="block rounded-xl bg-white/80 px-2.5 py-2 hover:bg-white">
                        <span className="block text-sm font-semibold">{row.title}</span>
                        <span className="block text-[11px] text-muted-foreground">{row.client_name || "No client"}{row.task_status_label ? ` · ${row.task_status_label}` : ""}{row.due_date ? ` · ${row.due_date}` : ""}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {rows.length > 6 && <p className="mt-2 text-[11px] text-muted-foreground">{rows.length - 6} more on the Task Board.</p>}
              </div>
            )
          })}
        </div>
        {data.counts.still_open === 0 && data.counts.timesheet === 0 && (
          <p className="text-sm text-muted-foreground">Nothing is waiting on you right now.</p>
        )}
      </CardContent>
    </Card>
  )
}

export function TeamProductivity({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["team-productivity"],
    queryFn: () => apiFetch<TeamProductivity>("/dashboard/productivity/team"),
  })
  if (isLoading) {
    return <Card><CardContent className="p-5 text-sm text-muted-foreground">Loading team productivity…</CardContent></Card>
  }
  if (!data) {
    return <Card><CardContent className="p-5 text-sm text-muted-foreground">Team productivity could not be loaded.</CardContent></Card>
  }
  const totals = [
    ["On track", data.counts.on_track, "on_track"],
    ["Behind", data.counts.behind, "behind"],
    ["No hours yet", data.counts.no_hours, "no_hours"],
  ] as const
  return (
    <Card className="shc-brand border-[#F7C6D3]">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="brand-label text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8325F]">Team productivity</p>
            <h2 className="text-3xl text-[#B8325F]">Who is on track this week</h2>
            <p className="mt-1 text-sm text-muted-foreground">Days with logged time, out of the workdays so far. Open tasks and dues sit beside the percentage.</p>
          </div>
          {compact && <Link to="/admin/analytics" className="text-sm font-bold text-[#B8325F] underline">Open Insights</Link>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {totals.map(([label, value, status]) => (
            <div key={label} className="rounded-2xl border border-[#F7C6D3] bg-[#FDF2F5] px-3 py-2">
              <p className="text-2xl font-bold leading-none text-[#B8325F]">{value}</p>
              <p className={cn("brand-label mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold", statusClass(status))}>{label}</p>
            </div>
          ))}
        </div>
        <ul className="space-y-2">
          {(compact ? data.members.filter((row) => row.status !== "on_track").slice(0, 4) : data.members).map((row) => (
            <li key={row.va_id} className="rounded-2xl border bg-card p-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-3xl leading-none text-[#B8325F]">{row.percentage}%</p>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{row.va_name}</p>
                  <p className="text-xs text-muted-foreground">{row.summary}</p>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", statusClass(row.status))}>{row.status_label}</span>
              </div>
              {row.month_pay && (
                <p className="mt-2 text-sm font-semibold text-[#B8325F]">
                  This month {formatCurrency(row.month_pay, row.pay_currency)} · This pay period {formatCurrency(row.period_pay, row.pay_currency)}
                  {row.period_label ? ` (${row.period_label})` : ""}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                <span className={cn("rounded-full px-2 py-0.5", row.counts.overdue ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground")}>{row.counts.overdue} overdue</span>
                <span className="rounded-full bg-[#FDF2F5] px-2 py-0.5 text-[#B8325F]">{row.counts.due_today} due today</span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-900">{row.counts.due_soon} due soon</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{row.counts.pending} pending</span>
                {row.timesheet_waiting && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-950">Timesheet waiting</span>}
              </div>
              {!compact && row.dues_preview.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {row.dues_preview.slice(0, 4).map((item) => (
                    <li key={`${row.va_id}-${item.title}`}>
                      <Link to={item.link || "/admin/tasks"} className="block text-xs text-foreground/80 hover:text-[#B8325F]">
                        <span className="font-semibold capitalize">{(item.bucket || "").replace("_", " ")}</span>
                        {": "}{item.title}{item.client_name ? ` · ${item.client_name}` : ""}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {compact && data.members.every((row) => row.status === "on_track") && (
            <li className="text-sm text-muted-foreground">Everyone with logged time is on track so far.</li>
          )}
        </ul>
      </CardContent>
    </Card>
  )
}
