import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useSearchParams } from "react-router-dom"
import { apiFetch, getAuthUser } from "@/lib/api"
import { NeedsActionList } from "@/components/payroll/NeedsActionList"
import { payrollActionBucket } from "@/components/payroll/payrollAction"
import type { PayrollResponse, PayrollRun, PayrollVA, Settings, VA } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input, Label, Select } from "@/components/ui/input"
import { StatCard } from "@/components/magicui/stat-card"
import { halfMonthRange, type HalfMonth } from "@/lib/payrollPeriod"
import { calendarHalf, halfMonthLabel, moneyEq, resolvePackagePay, type PackageChoice } from "@/lib/packageHalf"
import { cn, formatCurrency, formatDate, payrollPdfFilename } from "@/lib/utils"
import { parseUsdPhpRate } from "@/lib/pesoEstimate"
import { PayrollDocument } from "@/components/pdf/PayrollDocument"
import { PdfPreviewModal } from "@/components/pdf-viewer/PdfPreviewModal"
import { PayslipPaperModal } from "@/components/payroll/PayslipPaperModal"
import { PersonTimesheet } from "@/components/payroll/PersonTimesheet"
import { TimesheetReviewPanel } from "@/components/payroll/TimesheetReviewPanel"
import { buildPayslip, type PayslipClient } from "@/lib/payslip"
import { TimeEntryModeFields, durationError, splitStoredHours, timingBody, type EntryMode } from "@/components/logs/TimeEntryModeFields"
import { renderPayslipHtml } from "@/lib/payslipHtml"
import { generatePdfBlob } from "@/lib/pdf"
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BadgeCheck, Banknote, CheckCircle2, ClipboardCheck, FileDown, FileSpreadsheet, Trash2, Wallet } from "lucide-react"
import { useCssVar } from "@/hooks/useCssVar"

const PERIODS = [
  { id: "this_week", label: "This Week" },
  { id: "last_week", label: "Last Week" },
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "first_half", label: "1st – 15th" },
  { id: "second_half", label: "16th – end" },
  { id: "custom", label: "Custom Range" },
]

function payrollRequestWindow(period: string, dateFrom: string, dateTo: string) {
  if (period === "first_half" || period === "second_half") {
    const range = halfMonthRange(period as HalfMonth)
    return { period: "custom", date_from: range.from, date_to: range.to }
  }
  if (period === "custom") {
    return { period: "custom", date_from: dateFrom || null, date_to: dateTo || null }
  }
  return { period, date_from: null, date_to: null }
}
function initials(name: string) { return name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() }
const n = (v?: string | number | null) => Number(v ?? 0)

function canOfferPay(va: PayrollVA) {
  return n(va.total_hours) > 0 || n(va.total_pay) > 0
}

function markPaidTitle(va: PayrollVA) {
  if (!va.timesheet_submitted) return "VA must submit timesheet first"
  if (va.timesheet_status !== "reviewed") return "Approve the timesheet in Timesheet Review first"
  return undefined
}

type PackageDraft = { skipped: boolean; mode: "amount" | "deduction"; amount: string; deduction: string; note: string; choice?: PackageChoice }

function packageResolution(row: NonNullable<PayrollVA["by_client"]>[number], draft: PackageDraft | undefined, periodStart: string, periodEnd: string) {
  const calculated = n(row.calculated_pay ?? row.pay)
  const monthly = n(row.monthly_amount)
  return resolvePackagePay({
    monthly,
    calculated,
    periodStart,
    periodEnd,
    skipped: draft ? draft.skipped : !!row.skipped,
    overrideAmount: draft || row.override_amount == null || row.override_amount === "" ? null : n(row.override_amount),
    choice: draft?.choice ?? (draft ? "custom" : null),
    customAmount: draft && draft.mode === "amount" && draft.amount.trim() !== "" ? n(draft.amount) : null,
  })
}

function overlayVa(va: PayrollVA, drafts: Record<string, PackageDraft>, periodStart = "", periodEnd = ""): PayrollVA {
  if (!va.by_client?.length) return va
  let changed = false
  const by_client = va.by_client.map((row) => {
    if (row.pay_type !== "package" || !row.client_id) return row
    const draft = drafts[`${va.va_id}:${row.client_id}`]
    const calculated = n(row.calculated_pay ?? row.pay)
    const deductionMode = draft ? draft.mode === "deduction" : n(row.deduction) > 0
    if (deductionMode) {
      if (!draft && !(n(row.deduction) > 0)) return row
      changed = true
      const skipped = draft ? draft.skipped : !!row.skipped
      let effective = calculated
      let deduction: number | null = null
      const deductionRaw = draft ? draft.deduction : String(row.deduction ?? "")
      if (!skipped) {
        const parsed = Number(deductionRaw)
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= calculated + 0.001) {
          deduction = Math.round(parsed * 100) / 100
          effective = Math.round((calculated - deduction) * 100) / 100
        }
      }
      if (skipped) effective = 0
      return {
        ...row,
        pay: effective.toFixed(2),
        skipped,
        adjusted: false,
        deduction: deduction != null && deduction > 0 ? deduction.toFixed(2) : null,
        note: (draft ? draft.note : row.note || "").trim() || null,
      }
    }
    const resolved = packageResolution(row, draft, periodStart, periodEnd)
    const effective = resolved.skipped ? 0 : resolved.amount
    const serverPay = n(row.pay)
    const same = !draft && resolved.skipped === !!row.skipped && moneyEq(effective, serverPay)
    if (same) return row
    changed = true
    const standard = resolved.choice === "half" || resolved.choice === "full" || resolved.choice === "skip"
    return {
      ...row,
      pay: effective.toFixed(2),
      skipped: resolved.skipped,
      adjusted: !resolved.skipped && !standard && !moneyEq(effective, calculated),
      deduction: null,
      note: (draft?.note ?? row.note ?? "").trim() || null,
    }
  })
  if (!changed) return va
  const total = by_client.reduce((sum, row) => sum + n(row.pay), 0)
  return { ...va, by_client, total_pay: total.toFixed(2) }
}

function overlayPayroll<T extends { vas: PayrollVA[]; period_start: string; period_end: string; total_php?: string | null; total_usd?: string | null }>(
  payroll: T | undefined,
  drafts: Record<string, PackageDraft>,
): T | undefined {
  if (!payroll) return payroll
  const vas = payroll.vas.map((va) => overlayVa(va, drafts, payroll.period_start, payroll.period_end))
  let php = 0
  let usd = 0
  for (const va of vas) {
    const pay = n(va.total_pay)
    if (va.currency === "USD") usd += pay
    else php += pay
  }
  return { ...payroll, vas, total_php: php.toFixed(2), total_usd: usd.toFixed(2) }
}

function draftForChoice(choice: "half" | "full" | "skip", client: PayslipClient, periodStart: string, periodEnd: string, note: string): PackageDraft {
  const resolved = resolvePackagePay({
    monthly: client.monthlyAmount ?? 0,
    calculated: client.originalAmount ?? client.amount,
    periodStart,
    periodEnd,
    choice,
  })
  const shown = choice === "skip" ? (resolved.half || resolved.monthly || client.originalAmount || client.amount) : resolved.amount
  return {
    skipped: choice === "skip",
    mode: "amount",
    amount: shown.toFixed(2),
    deduction: "",
    note,
    choice,
  }
}

function PackagePeriodFields({
  client,
  currency,
  locked,
  periodStart,
  periodEnd,
  draft,
  onDraft,
  onCommit,
}: {
  client: PayslipClient
  currency: "PHP" | "USD"
  locked: boolean
  periodStart: string
  periodEnd: string
  draft?: PackageDraft
  onDraft: (next: PackageDraft) => void
  onCommit: (next: PackageDraft) => void
}) {
  const mode = draft?.mode ?? (client.deduction ? "deduction" : "amount")
  const noteValue = draft ? draft.note : (client.note || "")
  const deductionValue = draft ? draft.deduction : (client.deduction ? client.deduction.toFixed(2) : "")
  const monthly = client.monthlyAmount ?? 0
  const calculated = client.originalAmount ?? client.amount
  const resolved = resolvePackagePay({
    monthly,
    calculated,
    periodStart,
    periodEnd,
    skipped: draft ? draft.skipped : !!client.skipped,
    overrideAmount: draft || client.overrideAmount == null ? null : client.overrideAmount,
    choice: mode === "deduction" ? "custom" : (draft?.choice ?? null),
    customAmount: draft && mode === "amount" && draft.amount.trim() !== "" ? n(draft.amount) : null,
  })
  const skipped = mode === "deduction" ? (draft ? draft.skipped : !!client.skipped) : resolved.skipped
  const amountValue = draft && mode === "amount"
    ? draft.amount
    : (skipped ? (resolved.half || monthly || calculated) : resolved.amount).toFixed(2)
  const choice: PackageChoice | null = mode === "deduction" ? null : (draft?.choice === "custom" ? resolved.choice : (draft?.choice ?? resolved.choice))
  const current = (): PackageDraft => ({
    skipped,
    mode,
    amount: amountValue,
    deduction: deductionValue,
    note: noteValue,
    choice: choice ?? "custom",
  })
  const packageAmount = monthly > 0 ? monthly : calculated
  const deductionNumber = Number(deductionValue)
  const deductionOk = Number.isFinite(deductionNumber) && deductionNumber >= 0 && deductionNumber <= packageAmount + 0.001
  const payPreview = deductionOk ? Math.round((packageAmount - deductionNumber) * 100) / 100 : null
  const apply = (next: PackageDraft, commit = false) => {
    onDraft(next)
    if (commit) onCommit(next)
  }
  const pick = (nextChoice: "half" | "full" | "skip") => {
    const next = draftForChoice(nextChoice, client, periodStart, periodEnd, noteValue)
    apply(next, true)
  }
  return (
    <div className="mt-2 space-y-2">
      <p className="text-[11px] font-semibold text-muted-foreground">
        Fixed Package {formatCurrency(packageAmount, currency)}{monthly > 0 ? " monthly" : ""}
      </p>
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={`${client.name} package pay`}>
        {([
          ["half", "Half month"],
          ["full", "Full month"],
          ["skip", "Skip"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={choice === id}
            disabled={locked || (monthly <= 0 && id !== "skip")}
            className={cn(
              "min-h-11 rounded-full px-1.5 text-[13px] font-semibold leading-tight",
              choice === id ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground",
            )}
            onClick={() => pick(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-[13px] font-semibold">
        <input
          type="checkbox"
          className="h-5 w-5 accent-primary"
          checked={!skipped}
          disabled={locked}
          onChange={(e) => {
            if (!e.target.checked) {
              pick("skip")
              return
            }
            pick(calendarHalf(periodStart, periodEnd) ? "half" : "full")
          }}
        />
        Pay this period
      </label>
      {!skipped && (
        <div className="flex gap-3 text-[11px] font-semibold">
          <label className="flex min-h-11 items-center gap-1">
            <input type="radio" name={`${client.clientId}-mode`} checked={mode === "amount"} disabled={locked} onChange={() => apply({ ...current(), mode: "amount", choice: choice ?? "custom" })} />
            New amount
          </label>
          <label className="flex min-h-11 items-center gap-1">
            <input type="radio" name={`${client.clientId}-mode`} checked={mode === "deduction"} disabled={locked} onChange={() => apply({ ...current(), mode: "deduction", choice: "custom", skipped: false })} />
            Deduction
          </label>
        </div>
      )}
      {mode === "amount" || skipped ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            className="h-11 w-full max-w-[9rem] text-base"
            aria-label={`${client.name} amount this period`}
            disabled={locked || skipped}
            value={amountValue}
            onChange={(e) => apply({ ...current(), mode: "amount", skipped: false, choice: "custom", amount: e.target.value })}
            onBlur={() => onCommit(draft ?? current())}
          />
          {choice === "half" && monthly > 0 && (
            <span className="text-[13px] font-semibold text-primary">{halfMonthLabel(monthly, currency)}</span>
          )}
          {skipped && <span className="text-[13px] font-semibold text-amber-800">Skipped · {formatCurrency(0, currency)}</span>}
          {!skipped && choice === "custom" && client.adjusted && client.originalAmount != null && (
            <span className="text-[11px] font-semibold text-primary">Adjusted · was {formatCurrency(client.originalAmount, currency)}</span>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <Input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            className="h-11 w-full max-w-[9rem] text-base"
            aria-label={`${client.name} deduction this period`}
            disabled={locked}
            value={deductionValue}
            onChange={(e) => apply({ ...current(), mode: "deduction", choice: "custom", deduction: e.target.value })}
            onBlur={() => onCommit(draft ?? current())}
          />
          {payPreview != null && deductionNumber > 0 && (
            <div className="text-[11px] leading-5">
              <p>Fixed Package {formatCurrency(packageAmount, currency)}</p>
              <p>Deduction{noteValue.trim() ? ` (${noteValue.trim()})` : ""} -{formatCurrency(deductionNumber, currency)}</p>
              <p className="font-semibold">Pay {formatCurrency(payPreview, currency)}</p>
            </div>
          )}
        </div>
      )}
      <Input
        className="h-11 text-base"
        placeholder={mode === "deduction" ? "Reason, such as days off" : "Reason (optional)"}
        aria-label={`${client.name} reason`}
        disabled={locked}
        value={noteValue}
        onChange={(e) => apply({ ...current(), note: e.target.value })}
        onBlur={() => onCommit(draft ?? current())}
      />
      {locked && <p className="text-[11px] text-muted-foreground">This period is paid. Undo Paid to change it.</p>}
    </div>
  )
}

export function PayrollPage() {
  const qc = useQueryClient()
  const isAdmin = getAuthUser()?.role === "admin"
  // Payroll money is always visible to Admin. Project Managers (auditor) never see it,
  // even if the company "hide pricing" toggle is off elsewhere.
  const showPricing = isAdmin
  const chartColor = useCssVar("--chart", "#ec4899")
  const [period, setPeriod] = useState("this_month")
  const [vaId, setVaId] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [openVa, setOpenVa] = useState<string>("")
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfFilename, setPdfFilename] = useState("va-payroll.pdf")
  const [payslipHtml, setPayslipHtml] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; description: string; start_time: string; end_time: string; va_rate: string; va_name: string; work_date: string; mode: EntryMode; durationHours: number; durationMinutes: number } | null>(null)
  const [markPaidError, setMarkPaidError] = useState("")
  const [pdfError, setPdfError] = useState("")
  const [searchParams] = useSearchParams()
  const [reviewTimesheetId, setReviewTimesheetId] = useState<string | null>(null)
  const [fullReviewOpen, setFullReviewOpen] = useState(false)
  const [payReview, setPayReview] = useState<PayrollVA | null>(null)
  const [usdPhpRate, setUsdPhpRate] = useState("")
  const rateHydrated = useRef(false)
  const rateTimer = useRef<number | null>(null)
  const parsedRate = parseUsdPhpRate(usdPhpRate)

  const { data: vas = [] } = useQuery({ queryKey: ["vas"], queryFn: () => apiFetch<VA[]>("/vas") })
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<Settings>("/settings") })
  useEffect(() => {
    if (rateHydrated.current || !settings) return
    rateHydrated.current = true
    if (settings.usd_php_rate) setUsdPhpRate(String(settings.usd_php_rate))
  }, [settings])
  function rememberRate(value: string) {
    setUsdPhpRate(value)
    if (!isAdmin) return
    if (rateTimer.current) window.clearTimeout(rateTimer.current)
    rateTimer.current = window.setTimeout(() => {
      apiFetch("/settings", { method: "PUT", body: JSON.stringify({ usd_php_rate: parseUsdPhpRate(value) }) }).catch(() => {})
    }, 400)
  }

  type PendingSheet = {
    id: string
    va_id: string
    va_name?: string | null
    period_start: string
    period_end: string
    status: string
    total_hours: string
    entry_count: number
    submitted_at?: string
  }

  // Always-visible inbox of timesheets waiting for approval (independent of period filter)
  const { data: pendingSheets = [] } = useQuery({
    queryKey: ["payroll-timesheets-pending"],
    queryFn: () => apiFetch<PendingSheet[]>("/payroll/timesheets?status_filter=submitted"),
    refetchInterval: 30_000,
  })

  useEffect(() => {
    const id = searchParams.get("timesheet")
    if (!id) return
    if (pendingSheets.some((s) => s.id === id)) {
      setFullReviewOpen(true)
      setReviewTimesheetId(null)
    } else {
      setReviewTimesheetId(id)
    }
  }, [searchParams, pendingSheets])
  useEffect(() => {
    const id = searchParams.get("timesheet")
    if (!id || !fullReviewOpen) return
    document.getElementById(`timesheet-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [fullReviewOpen, searchParams, pendingSheets])

  // Auto-computes whenever a filter changes — no Calculate button needed
  const requestWindow = payrollRequestWindow(period, dateFrom, dateTo)
  const { data: payrollSource, isLoading } = useQuery({
    queryKey: ["payroll", vaId, period, requestWindow.date_from, requestWindow.date_to],
    queryFn: () => apiFetch<PayrollResponse>("/payroll/calculate", {
      method: "POST",
      body: JSON.stringify({ va_id: vaId || null, ...requestWindow }),
    }),
    enabled: period !== "custom" || (!!dateFrom && !!dateTo),
  })
  const [drafts, setDrafts] = useState<Record<string, PackageDraft>>({})
  const [overrideError, setOverrideError] = useState("")
  useEffect(() => {
    setDrafts({})
    setOverrideError("")
  }, [vaId, period, dateFrom, dateTo])
  const payroll = useMemo(
    () => overlayPayroll(payrollSource, drafts),
    [payrollSource, drafts],
  )
  useEffect(() => {
    if (!openVa || !payroll) return
    if (!payroll.vas.some((va) => va.va_id === openVa)) setOpenVa("")
  }, [payroll, openVa])
  useEffect(() => {
    if (!openVa) return
    document.getElementById("va-week-detail")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [openVa])
  const { data: runs = [] } = useQuery({
    queryKey: ["payroll-runs"],
    queryFn: () => apiFetch<PayrollRun[]>("/payroll/runs"),
    enabled: isAdmin,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["payroll"] })
    qc.invalidateQueries({ queryKey: ["payroll-runs"] })
    qc.invalidateQueries({ queryKey: ["payroll-timesheets-pending"] })
  }
  const markPaid = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/payroll/runs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setMarkPaidError(""); invalidate() },
    onError: (err: Error) => setMarkPaidError(err.message),
  })
  const approveSheet = useMutation({
    mutationFn: (id: string) => apiFetch(`/payroll/timesheets/${id}/review`, { method: "POST" }),
    onSuccess: () => { setMarkPaidError(""); invalidate() },
    onError: (err: Error) => setMarkPaidError(err.message),
  })
  const returnSheet = useMutation({
    mutationFn: (body: { id: string; reason: string }) => apiFetch(`/payroll/timesheets/${body.id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: body.reason.trim() || null }),
    }),
    onSuccess: () => { setMarkPaidError(""); invalidate() },
    onError: (err: Error) => setMarkPaidError(err.message),
  })
  const saveOverride = async (va: PayrollVA, clientId: string, draft: PackageDraft, calculated: number) => {
    if (va.is_paid || !payroll?.period_start || !payroll.period_end) return false
    let amount: number | null = null
    let deduction: number | null = null
    if (!draft.skipped && draft.mode === "deduction") {
      const parsed = Number(draft.deduction)
      if (!Number.isFinite(parsed) || parsed < 0) {
        setOverrideError("Deduction cannot be negative.")
        return false
      }
      if (parsed > calculated + 0.001) {
        setOverrideError("Deduction cannot be more than the package amount.")
        return false
      }
      if (parsed > 0 && !draft.note.trim()) {
        setOverrideError("Add a reason for the deduction.")
        return false
      }
      deduction = Math.round(parsed * 100) / 100
      if (deduction === 0) deduction = null
    } else {
      const raw = draft.amount.trim()
      if (raw !== "") {
        const parsed = Number(raw)
        if (!Number.isFinite(parsed) || parsed < 0) {
          setOverrideError("Amount cannot be negative.")
          return false
        }
        amount = Math.round(parsed * 100) / 100
        if (amount === Math.round(calculated * 100) / 100) amount = null
      }
    }
    const key = `${va.va_id}:${clientId}`
    try {
      await apiFetch("/payroll/package-overrides", {
        method: "PUT",
        body: JSON.stringify({
          va_id: va.va_id,
          client_id: clientId,
          period_start: payroll.period_start,
          period_end: payroll.period_end,
          skipped: draft.skipped,
          amount,
          deduction,
          note: draft.note.trim() || null,
        }),
      })
      setOverrideError("")
      setDrafts((prev) => {
        const cur = prev[key]
        if (!cur || cur.amount !== draft.amount || cur.deduction !== draft.deduction || cur.mode !== draft.mode || cur.skipped !== draft.skipped || cur.note !== draft.note || cur.choice !== draft.choice) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
      invalidate()
      return true
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : "Could not save this period")
      return false
    }
  }
  const persistDisplayedPackages = async (va: PayrollVA) => {
    const source = payrollSource?.vas.find((item) => item.va_id === va.va_id)
    for (const row of va.by_client ?? []) {
      if (row.pay_type !== "package" || !row.client_id) continue
      const src = source?.by_client?.find((item) => item.client_id === row.client_id)
      const serverSkipped = !!src?.skipped
      const serverPay = serverSkipped ? 0 : n(src?.pay)
      if (serverSkipped === !!row.skipped && moneyEq(serverPay, n(row.pay))) continue
      const key = `${va.va_id}:${row.client_id}`
      const existing = drafts[key]
      const draft: PackageDraft = existing?.mode === "deduction"
        ? { ...existing, skipped: !!row.skipped }
        : {
            skipped: !!row.skipped,
            mode: "amount",
            amount: row.skipped ? "" : n(row.pay).toFixed(2),
            deduction: "",
            note: existing?.note ?? row.note ?? "",
            choice: row.skipped ? "skip" : existing?.choice,
          }
      const saved = await saveOverride(va, row.client_id, draft, n(src?.calculated_pay ?? src?.pay))
      if (!saved) return false
    }
    return true
  }
  const setAllPackages = async (va: PayrollVA, choice: "half" | "full") => {
    if (!payroll) return
    const slip = buildPayslip(va, payroll.period_start, payroll.period_end, settings)
    const rows = slip.clients.filter((client) => client.payType === "package" && client.clientId && (client.monthlyAmount ?? 0) > 0)
    const next: Record<string, PackageDraft> = {}
    for (const client of rows) {
      next[`${va.va_id}:${client.clientId}`] = draftForChoice(choice, client, payroll.period_start, payroll.period_end, client.note || "")
    }
    setDrafts((prev) => ({ ...prev, ...next }))
    for (const client of rows) {
      const draft = next[`${va.va_id}:${client.clientId}`]
      if (!draft || !client.clientId) continue
      const saved = await saveOverride(va, client.clientId, draft, client.originalAmount ?? client.amount)
      if (!saved) return
    }
  }
  const voidRun = useMutation({ mutationFn: (id: string) => apiFetch(`/payroll/runs/${id}`, { method: "DELETE" }), onSuccess: invalidate })
  const saveEntry = useMutation({
    mutationFn: () =>
      apiFetch(`/work-logs/${editing!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description_plain: editing!.description,
          ...timingBody(editing!.mode, editing!.start_time, editing!.end_time, editing!.durationHours, editing!.durationMinutes),
          ...(showPricing ? { va_rate: parseFloat(editing!.va_rate) } : {}),
        }),
      }),
    onSuccess: () => {
      invalidate()
      qc.invalidateQueries({ queryKey: ["work-logs"] })
      setEditing(null)
    },
  })

  const teamDaily = useMemo(() => {
    const map = new Map<string, number>()
    for (const va of payroll?.vas ?? []) for (const d of va.daily ?? []) map.set(d.work_date, (map.get(d.work_date) ?? 0) + n(d.hours))
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([work_date, hours]) => ({ work_date, hours, label: new Date(work_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "narrow" }) + " " + new Date(work_date + "T00:00:00").getDate() }))
  }, [payroll])
  const teamClients = useMemo(() => {
    const map = new Map<string, { label: string; currency: "PHP" | "USD"; hours: number; pay: number }>()
    for (const va of payroll?.vas ?? []) {
      const currency: "PHP" | "USD" = va.currency === "USD" ? "USD" : "PHP"
      for (const row of va.by_client ?? []) {
        const key = `${row.label}::${currency}`
        const cur = map.get(key) ?? { label: row.label, currency, hours: 0, pay: 0 }
        cur.hours += n(row.hours)
        cur.pay += n(row.pay)
        map.set(key, cur)
      }
    }
    return [...map.values()].sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label))
  }, [payroll])

  const paidCount = (payroll?.vas ?? []).filter(v => v.is_paid).length
  const tasksDone = (payroll?.vas ?? []).reduce((s, v) => s + (v.tasks_done ?? 0), 0)

  const exportPdf = async (onlyVa?: string) => {
    if (!payroll || !settings) return
    const candidates = onlyVa ? payroll.vas.filter(v => v.va_id === onlyVa) : payroll.vas
    const ready = candidates.filter(v => v.timesheet_status === "reviewed")
    if (ready.length === 0) {
      setPdfError(
        onlyVa
          ? "Approve this VA’s submitted timesheet in Timesheet Review before generating the Payroll PDF."
          : "No VA in this period has an approved timesheet yet. Open Timesheet Review, approve, then export.",
      )
      return
    }
    if (!onlyVa && ready.length < candidates.length) {
      setPdfError(`PDF includes ${ready.length} of ${candidates.length} VAs with approved timesheets. Others still need review.`)
    } else {
      setPdfError("")
    }
    const doc = { ...payroll, vas: ready }
    const nameForFile = onlyVa
      ? (doc.vas[0]?.va_name || "VA")
      : doc.vas.length === 1
        ? doc.vas[0].va_name
        : "Team"
    setPdfFilename(payrollPdfFilename(nameForFile, payroll.period_start, payroll.period_end))
    if (isAdmin) {
      const slips = doc.vas.map((va) => buildPayslip(va, payroll.period_start, payroll.period_end, settings))
      setPayslipHtml(renderPayslipHtml(slips))
      return
    }
    setPdfBlob(await generatePdfBlob(
      <PayrollDocument payroll={doc} settings={settings} showPricing={false} usdPhpRate={null} />,
    ))
  }
  const exportCsv = () => {
    if (!payroll) return
    const rows = showPricing
      ? [["VA", "Date", "Client", "Project", "Task", "Description", "Source", "Status", "Hours", "Rate", "Pay", "Currency"],
        ...payroll.vas.flatMap(va => va.entries.map(e => [va.va_name, e.work_date, e.client_name, e.project_name ?? "", e.task_name || e.task_title || "", `"${(e.description || "").replace(/"/g, '""')}"`, e.source ?? "", e.status ?? "", e.hours, e.rate ?? "", e.pay ?? "", va.currency]))]
      : [["VA", "Date", "Client", "Project", "Task", "Description", "Source", "Status", "Hours"],
        ...payroll.vas.flatMap(va => va.entries.map(e => [va.va_name, e.work_date, e.client_name, e.project_name ?? "", e.task_name || e.task_title || "", `"${(e.description || "").replace(/"/g, '""')}"`, e.source ?? "", e.status ?? "", e.hours]))]
    const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "va-payroll.csv"; a.click(); URL.revokeObjectURL(a.href)
  }

  const orderedVas = [...(payroll?.vas ?? [])].sort((a, b) => {
    const rank = { approve: 0, pay: 1, draft: 2, paid: 3 }
    return rank[payrollActionBucket(a)] - rank[payrollActionBucket(b)] || a.va_name.localeCompare(b.va_name)
  })

  return (
    <div className="shc-brand min-w-0 max-w-full space-y-4 overflow-x-clip animate-fade-in">
      <div className="min-w-0 px-1 pt-1">
        <h1 className="text-2xl text-[#B8325F]">{isAdmin ? "Timesheets & pay" : "Timesheet review"}</h1>
        <p className="mt-1 text-sm text-[#43303a]">
          {isAdmin
            ? "Approve submitted timesheets, return one for fixes, then mark it paid."
            : "Approve a timesheet or return it for fixes. You see the VA name, dates, tasks, hours, and status. Rates, pay, and payroll totals stay hidden."}
        </p>
      </div>

      <div id="payroll-period" className="sticky top-14 z-10 -mx-3 border-b border-[#F7C6D3] bg-[#FDF2F5]/95 px-3 py-2 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border">
        <p className="brand-label text-[10px] font-semibold uppercase tracking-[0.14em] text-[#B8325F]">Period</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Period">
          {PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={period === item.id}
              onClick={() => setPeriod(item.id)}
              className={cn(
                "h-11 min-h-11 rounded-full border px-3 text-xs font-semibold uppercase tracking-wide",
                period === item.id ? "border-[#B8325F] bg-[#B8325F] text-white" : "border-[#F7C6D3] bg-white text-[#B8325F]",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {payroll && <p className="mt-2 text-xs font-semibold text-[#43303a]">{formatDate(payroll.period_start)} to {formatDate(payroll.period_end)}</p>}
        {period === "custom" && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="min-w-0"><Label>From</Label><Input type="date" className="h-11" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
            <div className="min-w-0"><Label>To</Label><Input type="date" className="h-11" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
          </div>
        )}
      </div>

      <NeedsActionList
        vas={payroll?.vas ?? []}
        periodStart={payroll?.period_start ?? ""}
        periodEnd={payroll?.period_end ?? ""}
        showPricing={showPricing}
        isAdmin={!!isAdmin}
        selfVaId={getAuthUser()?.vaId}
        loading={isLoading}
        approvingId={approveSheet.isPending ? approveSheet.variables : null}
        returningId={returnSheet.isPending ? returnSheet.variables?.id : null}
        onView={(id) => setOpenVa(id)}
        onApprove={(id) => approveSheet.mutate(id)}
        onReturn={(id, reason) => returnSheet.mutate({ id, reason })}
        onMarkPaid={(va) => setPayReview(va)}
        onUndo={(runId) => { if (confirm("Undo paid status for this VA?")) voidRun.mutate(runId) }}
      />

      {openVa && payroll && payroll.vas.filter(v => v.va_id === openVa).map(va => {
        const slip = showPricing ? buildPayslip(va, payroll.period_start, payroll.period_end, settings) : null
        const packages = slip?.clients.filter((client) => client.payType === "package" && client.clientId) ?? []
        return (
        <Card key={va.va_id} id="va-week-detail" className="scroll-mt-24">
          <CardHeader className="pb-2">
            <CardTitle>{va.va_name}, by week</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              {showPricing
                ? "Each week is split by client so the hours, rate, and pay are easy to add up. Edit a row to change the minutes."
                : "Each week is split by client so the hours are easy to add up. Edit a row to change the minutes."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <PersonTimesheet
              va={va}
              showMoney={showPricing}
              onEdit={(entry) => {
                const split = splitStoredHours(entry.hours)
                const duration = entry.entry_mode === "duration" || (!entry.start_time && !entry.end_time)
                setEditing({
                  id: entry.id,
                  description: entry.description || "",
                  start_time: entry.start_time?.slice(0, 5) || "09:00",
                  end_time: entry.end_time?.slice(0, 5) || "17:00",
                  va_rate: String(entry.rate ?? ""),
                  va_name: va.va_name,
                  work_date: entry.work_date,
                  mode: duration ? "duration" : "range",
                  durationHours: split.hours,
                  durationMinutes: split.minutes,
                })
              }}
            />
            {showPricing && packages.length > 0 && !va.is_paid && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="gold" className="min-h-11 flex-1" onClick={() => void setAllPackages(va, "half")}>
                  Set all packages to half
                </Button>
                <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={() => void setAllPackages(va, "full")}>
                  Set all to full
                </Button>
              </div>
            )}
            {showPricing && packages.map((client) => (
              <div key={client.clientId} className={cn("rounded-2xl border p-3", client.skipped && "opacity-70")}>
                <p className="font-display text-sm font-bold text-primary">{client.name}</p>
                <p className="text-[11px] text-muted-foreground">Fixed package for this whole period. It is not split across the weeks above.</p>
                <PackagePeriodFields
                  client={client}
                  currency={va.currency === "USD" ? "USD" : "PHP"}
                  locked={!!va.is_paid}
                  periodStart={payroll.period_start}
                  periodEnd={payroll.period_end}
                  draft={drafts[`${va.va_id}:${client.clientId}`]}
                  onDraft={(next) => setDrafts((prev) => ({ ...prev, [`${va.va_id}:${client.clientId}`]: next }))}
                  onCommit={(next) => saveOverride(va, client.clientId!, next, client.originalAmount ?? client.amount)}
                />
              </div>
            ))}
            {showPricing && !va.is_paid && canOfferPay(va) && (
              <div className="border-t pt-3">
                <Button
                  variant="success"
                  className="h-11 min-h-11 w-full"
                  disabled={markPaid.isPending || va.timesheet_status !== "reviewed"}
                  title={markPaidTitle(va)}
                  onClick={() => setPayReview(va)}
                >
                  <Wallet className="h-3.5 w-3.5" /> Mark Paid
                </Button>
              </div>
            )}
            {showPricing && va.is_paid && va.run_id && (
              <div className="border-t pt-3">
                <Button variant="outline" className="h-11 min-h-11 w-full" onClick={() => { if (confirm(`Undo paid status for ${va.va_name}?`)) voidRun.mutate(va.run_id!) }}>Undo Paid</Button>
              </div>
            )}
            {showPricing && !va.is_paid && canOfferPay(va) && va.timesheet_status !== "reviewed" && (
              <p className="text-right text-[11px] text-muted-foreground">{markPaidTitle(va)}</p>
            )}
          </CardContent>
        </Card>
        )
      })}

      {markPaidError && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{markPaidError}</p>}
      {overrideError && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{overrideError}</p>}
      {pdfError && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{pdfError}</p>}

      {pendingSheets.length > 0 && (
        <details
          className="rounded-2xl border border-[#F7C6D3] bg-white"
          open={fullReviewOpen}
          onToggle={(event) => setFullReviewOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="min-h-11 cursor-pointer list-none px-3 py-3 text-sm font-semibold uppercase tracking-wide text-[#B8325F]">
            Full entry review ({pendingSheets.length})
          </summary>
          <div className="space-y-4 p-3 pt-0">
            <p className="text-xs text-[#43303a]">Every log is listed here, before Approve. The payslip stays locked until approved.</p>
            {fullReviewOpen && pendingSheets.map((s) => (
              <TimesheetReviewPanel
                key={s.id}
                timesheetId={s.id}
                variant="inline"
                payPeriod={payroll ? { start: payroll.period_start, end: payroll.period_end } : undefined}
              />
            ))}
          </div>
        </details>
      )}

      <div className="grid min-w-0 gap-3 rounded-2xl border border-[#F7C6D3] bg-white p-3 sm:grid-cols-2 sm:p-4">
        <div className="min-w-0"><Label>VA</Label><Select className="h-11" value={vaId} onChange={(e) => setVaId(e.target.value)}><option value="">All VAs</option>{vas.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></div>
        {isAdmin && (
          <div className="min-w-0">
            <Label>USD to PHP Rate</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              className="h-11"
              placeholder="e.g. 58.50"
              value={usdPhpRate}
              onChange={(e) => rememberRate(e.target.value)}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {parsedRate
                ? `1 USD = ${parsedRate.toFixed(2)} PHP. Saved on Mark Paid and shown on the PDF.`
                : "Enter today’s rate. The PHP equivalent calculates automatically."}
            </p>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground sm:col-span-2">
          On 1st-15th and 16th-end, each package starts on Half month. Full month and Skip are one tap. This Month still shows the whole package until you choose Half.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:flex">
          <Button variant="outline" className="h-11 min-h-11 w-full sm:w-auto" onClick={exportCsv} disabled={!payroll}><FileSpreadsheet className="h-4 w-4" /> CSV</Button>
          <Button variant="gold" className="h-11 min-h-11 w-full bg-[#E8578A] sm:w-auto" onClick={() => exportPdf()} disabled={!payroll}><FileDown className="h-4 w-4" /> {isAdmin ? "Payroll PDF" : "Hours PDF"}</Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Computing payroll…</p>}
      {period === "custom" && (!dateFrom || !dateTo) && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Pick a From and To date to compute the custom period.</p>}

      {payroll && (<>
        {/* KPIs */}
        <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard className="min-w-0" title="Payable Hours" value={`${payroll.total_hours ?? 0} hrs`} subtitle={`${payroll.vas.reduce((s, v) => s + v.entry_count, 0)} approved entries, ${payroll.vas.length} VA(s)`} />
          {showPricing
            ? <StatCard className="min-w-0 break-words" title="Total Pay Due" value={`${formatCurrency(payroll.total_php, "PHP")} + ${formatCurrency(payroll.total_usd, "USD")}`} subtitle="Across both currencies" />
            : <StatCard className="min-w-0" title="Tasks Completed" value={tasksDone} subtitle="Marked done in this period" />}
          <StatCard className="min-w-0" title="Pending Approval" value={`${payroll.total_pending_hours ?? 0} hrs`} subtitle="Not payable until approved" />
          <StatCard className="min-w-0" title="Paid This Period" value={`${paidCount}/${payroll.vas.length}`} subtitle="VAs marked paid below" />
        </div>

        {n(payroll.total_pending_hours) > 0 && (
          <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" /> {payroll.total_pending_hours} hrs are still <b>submitted</b> and not counted in pay yet. <Link to="/admin/logs" className="font-bold underline">Approve them in Review logs</Link></p>
        )}

        {/* Charts row */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="min-w-0 overflow-hidden lg:col-span-2"><CardHeader className="pb-2"><CardTitle>Team Hours by Day</CardTitle></CardHeader><CardContent className="min-w-0 overflow-hidden">
            <ResponsiveContainer width="100%" height={200}><BarChart data={teamDaily}><XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 10 }} width={28} /><Tooltip formatter={(v) => [`${v} hrs`, "Hours"]} /><Bar dataKey="hours" fill={chartColor} radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>
          </CardContent></Card>
          <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle>Hours by Client</CardTitle></CardHeader><CardContent className="space-y-2.5">
            {teamClients.map(c => { const pct = n(payroll.total_hours) ? (c.hours / n(payroll.total_hours)) * 100 : 0; return (
              <div key={`${c.label}-${c.currency}`} className="text-xs"><div className="flex justify-between gap-2"><span className="truncate font-semibold">{c.label}</span><span className="whitespace-nowrap text-muted-foreground">{c.hours.toFixed(2)} hrs{showPricing ? ` · ${formatCurrency(c.pay, c.currency)}` : ""}</span></div>
              <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} /></div></div>) })}
            {teamClients.length === 0 && <p className="text-xs text-muted-foreground">No approved hours in this period.</p>}
          </CardContent></Card>
        </div>

        {/* VA cards */}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Per person. Click a card for entries</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {orderedVas.map(va => (
              <div
                key={va.va_id}
                className={cn(
                  "monday-card rounded-2xl border bg-card p-4",
                  openVa === va.va_id && "border-primary ring-2 ring-primary/25",
                  va.timesheet_submitted && va.timesheet_status !== "reviewed" && "border-amber-300 ring-2 ring-amber-200/60",
                )}
              >
                <button className="w-full text-left" onClick={() => setOpenVa(openVa === va.va_id ? "" : va.va_id)}>
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-extrabold text-primary">{initials(va.va_name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{va.va_name}{va.role_label === "Project Manager" ? <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">Project Manager</span> : null}{showPricing ? <span className="text-[11px] font-semibold text-muted-foreground"> ({va.currency})</span> : null}</span>
                      {showPricing && <span className="block truncate text-[11px] text-muted-foreground">{va.payment_label ?? "No payment details on profile"}</span>}
                    </span>
                    {va.change_pct != null && n(va.prev_hours) > 0 && (
                      <span className={cn("flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold", va.change_pct >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                        {va.change_pct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(va.change_pct).toFixed(0)}% vs prev
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-extrabold leading-none">{showPricing ? formatCurrency(va.total_pay, va.currency) : `${va.total_hours} hrs`}</p>
                      <p className="mt-1 text-[11px] font-semibold text-primary">{formatDate(payroll.period_start)} to {formatDate(payroll.period_end)}</p>
                      {showPricing && parsedRate && va.currency === "USD" && (
                        <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                          ≈ {formatCurrency(n(va.total_pay) * parsedRate, "PHP")}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">{va.total_hours} hrs · {va.entry_count} entries · {va.days_worked} days · avg {va.avg_hours_per_day}/day</p>
                    </div>
                    {va.is_paid
                      ? <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-[10px] font-bold text-green-700"><BadgeCheck className="h-3.5 w-3.5" /> Paid</span>
                      : <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700">Unpaid</span>}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px] font-semibold text-muted-foreground">
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-green-700">⏱ Clock {va.clock_hours}h</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">✍ Manual {va.manual_hours}h</span>
                    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">✓ {va.tasks_done} tasks done</span>
                    {n(va.pending_hours) > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">⚠ {va.pending_hours}h pending</span>}
                    {va.timesheet_status === "reviewed" ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">Timesheet approved</span>
                    ) : va.timesheet_status === "rejected" ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 font-extrabold text-rose-800">Returned for fixes</span>
                    ) : va.timesheet_submitted ? (
                      <span className="rounded-full bg-amber-200 px-2 py-0.5 font-extrabold uppercase tracking-wide text-amber-900">Pending Approval</span>
                    ) : (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">Timesheet not submitted</span>
                    )}
                  </div>
                </button>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className={cn("h-11 min-h-11 w-full", openVa === va.va_id && "border-primary bg-primary/10")}
                    aria-expanded={openVa === va.va_id}
                    aria-controls="va-week-detail"
                    aria-label={`View timesheet for ${va.va_name}`}
                    onClick={() => setOpenVa(va.va_id)}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" /> View timesheet
                  </Button>
                  {va.timesheet_id && va.timesheet_status !== "reviewed" && (
                    <Button
                      variant="gold"
                      className="h-11 min-h-11 w-full bg-[#E8578A]"
                      onClick={() => setReviewTimesheetId(va.timesheet_id!)}
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" /> Review
                    </Button>
                  )}
                  {va.timesheet_id && !va.is_paid && (va.timesheet_status === "submitted" || va.timesheet_status === "reviewed") && (
                    <Button
                      type="button"
                      variant="danger"
                      className="h-11 min-h-11 w-full"
                      onClick={() => setReviewTimesheetId(va.timesheet_id!)}
                    >
                      Return for fixes
                    </Button>
                  )}
                  {isAdmin && !va.is_paid && canOfferPay(va) && (
                    <Button
                      variant="success"
                      className="h-11 min-h-11 w-full"
                      disabled={markPaid.isPending || va.timesheet_status !== "reviewed"}
                      title={markPaidTitle(va)}
                      onClick={() => setPayReview(va)}
                    >
                      <Wallet className="h-3.5 w-3.5" /> Mark Paid
                    </Button>
                  )}
                  {isAdmin && va.is_paid && va.run_id && <Button variant="outline" className="h-11 min-h-11 w-full" onClick={() => { if (confirm(`Undo paid status for ${va.va_name}?`)) voidRun.mutate(va.run_id!) }}>Undo Paid</Button>}
                  {isAdmin && (
                    <Button
                      variant="outline"
                      className="h-11 min-h-11 w-full"
                      disabled={va.timesheet_status !== "reviewed"}
                      title={va.timesheet_status !== "reviewed" ? "Approve timesheet first" : "Payslip arranged per client"}
                      onClick={() => exportPdf(va.va_id)}
                    >
                      <FileDown className="h-3.5 w-3.5" /> Payslip
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {payroll.vas.length === 0 && <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">No approved or pending work in this period. Approved logs appear here automatically.</p>}
        </div>


        {/* Payment history — admin only (amounts) */}
        {isAdmin && <Card className="min-w-0 overflow-hidden">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Banknote className="h-4 w-4 text-primary" /> Payment History</CardTitle></CardHeader>
          <CardContent className="min-w-0 p-0">
            <div className="space-y-2 p-3 md:hidden">
              {runs.map(r => {
                const rate = r.usd_php_rate ? Number(r.usd_php_rate) : null
                const phpEq = showPricing && rate && r.currency === "USD" ? n(r.total_pay) * rate : null
                return (
                  <article key={r.id} className="min-w-0 rounded-xl border border-[#F7C6D3] bg-white p-3">
                    <p className="font-semibold">{r.va_name}</p>
                    <p className="text-xs text-muted-foreground">Paid {formatDate(r.paid_at.slice(0, 10))}</p>
                    <p className="text-xs">{formatDate(r.period_start)} to {formatDate(r.period_end)}</p>
                    <p className="mt-1 text-sm font-semibold">{r.total_hours} hrs</p>
                    {showPricing && (
                      <p className="text-sm font-semibold text-[#B8325F]">
                        {formatCurrency(r.total_pay, r.currency as "PHP" | "USD")}
                        {phpEq != null && <span className="mt-0.5 block text-[11px] font-medium text-muted-foreground">{formatCurrency(phpEq, "PHP")}</span>}
                      </p>
                    )}
                    {showPricing && <p className="text-xs text-muted-foreground">USD to PHP {rate ? rate.toFixed(2) : "not set"}</p>}
                    <p className="text-xs capitalize text-muted-foreground">{r.method?.replace("_", " ") ?? "No method"}</p>
                    <Button variant="outline" className="mt-2 h-11 min-h-11 w-full" title="Void this payment record" onClick={() => { if (confirm("Void this payment record? The VA will show as unpaid for that period.")) voidRun.mutate(r.id) }}>Undo payment</Button>
                  </article>
                )
              })}
              {runs.length === 0 && <p className="rounded-xl border border-[#F7C6D3] p-4 text-center text-sm text-muted-foreground"><CheckCircle2 className="mr-1 inline h-4 w-4" /> No payments recorded yet. Use Mark Paid on a VA card after you send payroll.</p>}
            </div>
            <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-xs">
              <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-3">Paid On</th><th className="p-3">VA</th><th className="p-3">Period</th><th className="p-3">Hours</th>{showPricing && <th className="p-3">Amount</th>}{showPricing && <th className="p-3">USD to PHP</th>}<th className="p-3">Method</th><th className="p-3 text-right">Actions</th></tr></thead>
              <tbody>{runs.map(r => {
                const rate = r.usd_php_rate ? Number(r.usd_php_rate) : null
                const phpEq = showPricing && rate && r.currency === "USD" ? n(r.total_pay) * rate : null
                return (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="whitespace-nowrap p-3">{formatDate(r.paid_at.slice(0, 10))}</td>
                  <td className="p-3 font-semibold">{r.va_name}</td>
                  <td className="whitespace-nowrap p-3 text-muted-foreground">{formatDate(r.period_start)} to {formatDate(r.period_end)}</td>
                  <td className="p-3">{r.total_hours} hrs</td>
                  {showPricing && (
                    <td className="p-3 font-semibold">
                      {formatCurrency(r.total_pay, r.currency as "PHP" | "USD")}
                      {phpEq != null && <span className="block text-[10px] font-medium text-muted-foreground">{formatCurrency(phpEq, "PHP")}</span>}
                    </td>
                  )}
                  {showPricing && <td className="p-3 text-muted-foreground">{rate ? rate.toFixed(2) : "not set"}</td>}
                  <td className="p-3 capitalize">{r.method?.replace("_", " ") ?? "No method"}</td>
                  <td className="p-3"><div className="flex justify-end"><Button size="sm" variant="ghost" title="Void this payment record" onClick={() => { if (confirm("Void this payment record? The VA will show as unpaid for that period.")) voidRun.mutate(r.id) }}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button></div></td>
                </tr>
              )})}
                {runs.length === 0 && <tr><td colSpan={showPricing ? 8 : 6} className="p-6 text-center text-muted-foreground"><CheckCircle2 className="mr-1 inline h-4 w-4" /> No payments recorded yet. Use Mark Paid on a VA card after you send payroll.</td></tr>}
              </tbody>
            </table>
            </div>
          </CardContent>
        </Card>}
      </>)}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-sm font-semibold">Edit payroll entry</h2>
            <p className="mb-3 text-[11px] text-muted-foreground">{editing.va_name} · {formatDate(editing.work_date)}</p>
            <div className="space-y-3">
              <div><Label>Description</Label><Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <TimeEntryModeFields
                mode={editing.mode}
                onMode={(mode) => setEditing({ ...editing, mode })}
                start={editing.start_time}
                end={editing.end_time}
                onStart={(start_time) => setEditing({ ...editing, start_time })}
                onEnd={(end_time) => setEditing({ ...editing, end_time })}
                hours={editing.durationHours}
                minutes={editing.durationMinutes}
                onHours={(durationHours) => setEditing({ ...editing, durationHours })}
                onMinutes={(durationMinutes) => setEditing({ ...editing, durationMinutes })}
              />
              {showPricing && <div><Label>VA Rate</Label><Input type="number" step="0.01" value={editing.va_rate} onChange={(e) => setEditing({ ...editing, va_rate: e.target.value })} /></div>}
              <p className="text-[11px] text-muted-foreground">{showPricing ? "Hours and pay follow the time method above and the rate." : "Hours follow the time method above. Rates stay hidden."}</p>
              <div className="flex gap-2">
                <Button variant="gold" className="flex-1" disabled={saveEntry.isPending || !editing.description || (editing.mode === "duration" && !!durationError(editing.durationHours, editing.durationMinutes))} onClick={() => saveEntry.mutate()}>Save</Button>
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {payReview && payroll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPayReview(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Review before Mark Paid</p>
            <h2 className="font-display text-lg font-bold">{payReview.va_name}</h2>
            <p className="mb-3 text-xs text-muted-foreground">{formatDate(payroll.period_start)} to {formatDate(payroll.period_end)}</p>
            {buildPayslip(payReview, payroll.period_start, payroll.period_end, settings).clients.map((client) => (
              <div key={client.name} className="flex items-start justify-between gap-3 border-b py-2 text-xs">
                <div className="min-w-0 break-words">
                  <p className="font-bold">{client.name}</p>
                  <p className="text-[11px] text-muted-foreground">{client.tasks.length} task{client.tasks.length === 1 ? "" : "s"} · {client.hours.toFixed(2)} hrs{client.skipped ? " · Skipped" : client.deduction ? ` · Fixed Package ${formatCurrency(client.originalAmount ?? client.amount + client.deduction, payReview.currency)} · Deduction${client.note ? ` (${client.note})` : ""} -${formatCurrency(client.deduction, payReview.currency)} · Pay ${formatCurrency(client.amount, payReview.currency)}` : client.payType === "package" ? (client.adjusted ? " · Fixed Package, Adjusted" : " · Fixed Package") : client.rate != null ? ` × ${formatCurrency(client.rate, payReview.currency)}/hr` : ""}</p>
                </div>
                <p className="font-bold">{client.skipped ? "Skipped · " : ""}{formatCurrency(client.amount, payReview.currency)}</p>
              </div>
            ))}
            <p className="mt-3 text-right font-display text-2xl font-bold text-primary">
              {formatCurrency(buildPayslip(payReview, payroll.period_start, payroll.period_end, settings).totalPay, payReview.currency)}
            </p>
            <p className="text-right text-[11px] text-muted-foreground">
              Grand total {buildPayslip(payReview, payroll.period_start, payroll.period_end, settings).totalHours.toFixed(2)} hrs
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                variant="success"
                className="h-11 min-h-11 w-full"
                disabled={markPaid.isPending}
                onClick={() => {
                  void (async () => {
                    const saved = await persistDisplayedPackages(payReview)
                    if (!saved) return
                    const slip = buildPayslip(payReview, payroll.period_start, payroll.period_end, settings)
                    const viewingHalf = calendarHalf(payroll.period_start, payroll.period_end)
                    markPaid.mutate({
                      va_id: payReview.va_id,
                      period_start: viewingHalf ? payroll.period_start : (payReview.timesheet_period_start || payroll.period_start),
                      period_end: viewingHalf ? payroll.period_end : (payReview.timesheet_period_end || payroll.period_end),
                      total_hours: slip.totalHours,
                      total_pay: slip.totalPay,
                      currency: payReview.currency,
                      method: payReview.payment_label?.startsWith("Wise") ? "wise" : "bank_transfer",
                      usd_php_rate: parsedRate,
                    })
                    setPayReview(null)
                  })()
                }}
              >
                <Wallet className="h-3.5 w-3.5" /> Confirm &amp; mark paid
              </Button>
              <Button variant="outline" className="h-11 min-h-11 w-full" onClick={() => setPayReview(null)}>Back</Button>
            </div>
          </div>
        </div>
      )}

      {reviewTimesheetId && (
        <TimesheetReviewPanel
          timesheetId={reviewTimesheetId}
          payPeriod={payroll ? { start: payroll.period_start, end: payroll.period_end } : undefined}
          onClose={() => setReviewTimesheetId(null)}
        />
      )}
      <PdfPreviewModal blob={pdfBlob} filename={pdfFilename} onClose={() => setPdfBlob(null)} />
      {payslipHtml && (
        <PayslipPaperModal html={payslipHtml} filename={pdfFilename} onClose={() => setPayslipHtml(null)} />
      )}
    </div>
  )
}
