/** Half of a monthly Fixed Package, in centavos.

The 1st-15th gets the lower half. The 16th through the end gets the remainder,
so the two halves add back to the monthly total. Half is always taken from the
monthly rate, never from an amount that is already one half.
*/

export type CalendarHalf = "first" | "second"
export type PackageChoice = "half" | "full" | "skip" | "custom"

export function moneyCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount * 100)
}

export function moneyEq(a: number, b: number): boolean {
  return moneyCents(a) === moneyCents(b)
}

export function splitMonthlyPackage(monthly: number): { first: number; second: number } {
  const cents = moneyCents(monthly)
  const first = Math.floor(cents / 2)
  const second = cents - first
  return { first: first / 100, second: second / 100 }
}

function parseISODate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "")
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** The 1st-15th or the 16th through the last day of the same month. */
export function calendarHalf(start: string, end: string): CalendarHalf | null {
  const from = parseISODate(start)
  const to = parseISODate(end)
  if (!from || !to || from.y !== to.y || from.m !== to.m) return null
  if (from.d === 1 && to.d === 15) return "first"
  if (from.d === 16 && to.d === daysInMonth(to.y, to.m)) return "second"
  return null
}

/** True when this window sits entirely on the 16th through the end of one month. */
export function usesSecondShare(start: string, end: string): boolean {
  if (calendarHalf(start, end) === "second") return true
  const from = parseISODate(start)
  const to = parseISODate(end)
  if (!from || !to || from.y !== to.y || from.m !== to.m) return false
  return from.d >= 16 && to.d >= 16
}

export function halfShare(monthly: number, start: string, end: string): number {
  const parts = splitMonthlyPackage(monthly)
  return usesSecondShare(start, end) ? parts.second : parts.first
}

export function formatPackageMoney(amount: number, currency: "PHP" | "USD"): string {
  const cents = moneyCents(Number.isFinite(amount) ? amount : 0)
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const frac = String(abs % 100).padStart(2, "0")
  const body = `${sign}${whole}.${frac}`
  return currency === "PHP" ? `₱${body}` : `$${body}`
}

export function halfMonthLabel(monthly: number, currency: "PHP" | "USD"): string {
  return `Half of ${formatPackageMoney(monthly, currency)} monthly`
}

function matchChoice(amount: number, half: number, monthly: number): PackageChoice {
  if (moneyEq(amount, monthly) && !moneyEq(amount, half)) return "full"
  if (moneyEq(amount, half)) return "half"
  if (moneyEq(amount, monthly)) return "full"
  return "custom"
}

export function resolvePackagePay(input: {
  monthly: number
  calculated: number
  periodStart: string
  periodEnd: string
  skipped?: boolean
  overrideAmount?: number | null
  choice?: PackageChoice | null
  customAmount?: number | null
}): { choice: PackageChoice; amount: number; skipped: boolean; half: number; monthly: number } {
  const monthly = moneyCents(input.monthly) / 100
  const calculated = moneyCents(input.calculated) / 100
  const half = monthly > 0 ? halfShare(monthly, input.periodStart, input.periodEnd) : calculated
  const choice = input.choice ?? null

  if (choice === "skip" || (choice == null && input.skipped)) {
    return { choice: "skip", amount: 0, skipped: true, half, monthly }
  }
  if (choice === "half") {
    return { choice: "half", amount: half, skipped: false, half, monthly }
  }
  if (choice === "full") {
    return { choice: "full", amount: monthly > 0 ? monthly : calculated, skipped: false, half, monthly }
  }
  if (choice === "custom") {
    if (input.customAmount == null || !Number.isFinite(input.customAmount)) {
      return { choice: "custom", amount: calculated, skipped: false, half, monthly }
    }
    const typed = Math.max(0, moneyCents(input.customAmount) / 100)
    return { choice: matchChoice(typed, half, monthly), amount: typed, skipped: false, half, monthly }
  }
  if (input.overrideAmount != null && Number.isFinite(input.overrideAmount)) {
    const amount = Math.max(0, moneyCents(input.overrideAmount) / 100)
    return { choice: matchChoice(amount, half, monthly), amount, skipped: false, half, monthly }
  }
  if (calendarHalf(input.periodStart, input.periodEnd) && monthly > 0) {
    return { choice: "half", amount: half, skipped: false, half, monthly }
  }
  return { choice: matchChoice(calculated, half, monthly), amount: calculated, skipped: false, half, monthly }
}

export function isStandardPackageAmount(amount: number, monthly: number, half: number): boolean {
  return moneyEq(amount, half) || (monthly > 0 && moneyEq(amount, monthly))
}
