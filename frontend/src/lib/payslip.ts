import type { PayrollVA, Settings } from "@/lib/types"

export interface PayslipTask {
  date: string
  task: string
  description: string
  hours: number
  amount: number
}

export interface PayslipClient {
  name: string
  hours: number
  rate: number | null
  payType: string | null
  amount: number
  tasks: PayslipTask[]
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

  const clients: PayslipClient[] = [...groups.entries()].map(([name, entries]) => {
    const sorted = entries.slice().sort((a, b) => a.work_date.localeCompare(b.work_date))
    const breakdown = va.by_client?.find((b) => b.label === name)
    const rates = [...new Set(sorted.map((e) => num(e.rate)).filter((r) => r > 0))]
    const rate = breakdown?.rate != null ? num(breakdown.rate) : rates.length === 1 ? rates[0] : rates[0] ?? null
    const payType = breakdown?.pay_type ?? (rates.length ? "hourly" : null)
    const tasks: PayslipTask[] = sorted.map((e) => {
      const hours = num(e.hours)
      const lineRate = num(e.rate) || rate || 0
      const stored = e.pay != null && e.pay !== "" ? num(e.pay) : null
      const amount = payType === "package"
        ? 0
        : stored != null && stored > 0
          ? stored
          : round2(hours * lineRate)
      const task = (e.task_name || e.task_title || "").trim() || "Logged work"
      const description = (e.description || "").trim()
      return {
        date: e.work_date,
        task,
        description: description && description !== task ? description : description || "",
        hours,
        amount,
      }
    })
    const hours = round2(tasks.reduce((s, t) => s + t.hours, 0))
    const taskAmount = round2(tasks.reduce((s, t) => s + t.amount, 0))
    const amount = breakdown?.pay != null ? round2(num(breakdown.pay)) : taskAmount
    if (payType === "package" && amount > 0 && tasks.length) {
      // Package flat is the client amount; keep task rows as hours with the flat on the subtotal only.
    }
    return { name, hours, rate: rate && rate > 0 ? rate : null, payType, amount, tasks }
  }).sort((a, b) => b.hours - a.hours)

  const totalHours = round2(clients.reduce((s, c) => s + c.hours, 0)) || num(va.total_hours)
  const totalPay = round2(clients.reduce((s, c) => s + c.amount, 0)) || num(va.total_pay)

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
