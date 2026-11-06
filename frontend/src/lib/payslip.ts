import type { PayrollVA, Settings } from "@/lib/types"

export interface PayslipTask {
  date: string
  task: string
  description: string
  hours: number
  amount: number
  rateMissing?: boolean
}

export interface PayslipClient {
  name: string
  hours: number
  rate: number | null
  payType: string | null
  amount: number
  tasks: PayslipTask[]
  clientId?: string | null
  /** Admin review keeps a skipped package visible at 0. The printed payslip hides it. */
  skipped?: boolean
  adjusted?: boolean
  originalAmount?: number | null
  note?: string | null
  overrideAmount?: number | null
  deduction?: number | null
  rateMissing?: boolean
  rateNote?: string | null
}

export interface PayslipModel {
  vaName: string
  currency: "PHP" | "USD"
  payslipDate: string
  periodStart: string
  periodEnd: string
  companyName: string
  location: string
  clients: PayslipClient[]
  totalHours: number
  totalPay: number
  paymentLabel?: string | null
  /** Shown under the title when this PDF is the labelled sample, not a live payroll run. */
  exampleNote?: string | null
}

function num(v?: string | number | null) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""))
  return Number.isFinite(n) ? n : 0
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export function buildPayslip(
  va: PayrollVA,
  periodStart: string,
  periodEnd: string,
  settings?: Pick<Settings, "company_name" | "location"> | null,
  payslipDate?: string,
): PayslipModel {
  const groups = new Map<string, typeof va.entries>()
  for (const entry of va.entries) {
    const name = entry.client_name || "Client"
    const list = groups.get(name) ?? []
    list.push(entry)
    groups.set(name, list)
  }
  // A Fixed Package is owed for the period even when that client has no time logs.
  for (const row of va.by_client ?? []) {
    if (row.pay_type === "package" && row.label && !groups.has(row.label)) {
      groups.set(row.label, [])
    }
  }

  const clients: PayslipClient[] = [...groups.entries()].map(([name, entries]) => {
    const sorted = entries.slice().sort((a, b) => a.work_date.localeCompare(b.work_date))
    const breakdown = va.by_client?.find((b) => b.label === name)
    const rates = [...new Set(sorted.map((e) => num(e.rate)).filter((r) => r > 0))]
    const rate = breakdown?.rate != null ? num(breakdown.rate) : rates.length === 1 ? rates[0] : rates[0] ?? null
    const payType = breakdown?.pay_type ?? (rates.length ? "hourly" : null)
    const tasks: PayslipTask[] = sorted.map((e) => {
      const hours = num(e.hours)
      const missing = Boolean(e.rate_missing)
      const lineRate = missing ? 0 : (num(e.rate) || rate || 0)
      const stored = !missing && e.pay != null && e.pay !== "" ? num(e.pay) : null
      const amount = missing || payType === "package"
        ? 0
        : stored != null && stored > 0
          ? stored
          : round2(hours * lineRate)
      const task = (e.task_name || e.task_title || "").trim() || "Logged work"
      const durationNote = e.entry_mode === "duration" || (!e.start_time && !e.end_time)
      let description = (e.description || "").trim()
      if (durationNote && !/entered as duration/i.test(description)) {
        description = description ? `${description} (entered as duration)` : "Entered as duration."
      }
      return {
        date: e.work_date,
        task,
        description: description && description !== task ? description : description || "",
        hours,
        amount,
        rateMissing: missing,
      }
    })
    const hours = round2(tasks.reduce((s, t) => s + t.hours, 0))
    const taskAmount = round2(tasks.reduce((s, t) => s + t.amount, 0))
    const skipped = breakdown?.skipped === true
    const amount = skipped
      ? 0
      : payType === "package"
        ? round2(num(breakdown?.pay))
        : breakdown?.pay != null
          ? round2(num(breakdown.pay))
          : taskAmount
    const originalAmount = breakdown?.calculated_pay != null ? round2(num(breakdown.calculated_pay)) : null
    return {
      name,
      hours,
      rate: rate && rate > 0 ? rate : null,
      payType,
      amount,
      tasks,
      clientId: breakdown?.client_id ?? null,
      skipped,
      adjusted: !skipped && breakdown?.adjusted === true,
      originalAmount,
      note: breakdown?.note ?? null,
      overrideAmount: breakdown?.override_amount != null && breakdown.override_amount !== "" ? round2(num(breakdown.override_amount)) : null,
      deduction: breakdown?.deduction != null && breakdown.deduction !== "" && num(breakdown.deduction) > 0 ? round2(num(breakdown.deduction)) : null,
      rateMissing: Boolean(breakdown?.rate_missing) || tasks.some((task) => task.rateMissing),
      rateNote: breakdown?.rate_note || (tasks.some((task) => task.rateMissing) ? "No approved rate yet. Set it in My Rates." : null),
    }
  }).sort((a, b) => Number(a.skipped) - Number(b.skipped) || b.amount - a.amount || b.hours - a.hours)

  const payable = clients.filter((c) => !c.skipped)
  const totalHours = round2(clients.reduce((s, c) => s + c.hours, 0)) || num(va.total_hours)
  const summedPay = round2(payable.reduce((s, c) => s + c.amount, 0))
  const totalPay = clients.length ? summedPay : num(va.total_pay)

  const today = new Date()
  const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`

  return {
    vaName: va.va_name,
    currency: va.currency === "PHP" ? "PHP" : "USD",
    payslipDate: payslipDate || isoToday,
    periodStart,
    periodEnd,
    companyName: settings?.company_name || "Sunny Hue Creatives",
    location: settings?.location || "Dumaguete City, Philippines",
    clients,
    totalHours,
    totalPay,
    paymentLabel: va.payment_label,
  }
}
