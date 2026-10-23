import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | string, currency = "USD") {
  const num = typeof amount === "string" ? parseFloat(amount) : amount
  if (currency === "PHP") return `₱${num.toFixed(2)}`
  return `$${num.toFixed(2)}`
}

/** Invoice PDF: `$13.00/hr` */
export function formatInvoiceRate(amount: number | string) {
  return `${formatCurrency(amount)}/hr`
}

/** Invoice PDF grand total: `$502.83 USD` */
export function formatInvoiceTotal(amount: number | string) {
  return `${formatCurrency(amount)} USD`
}

/** Decimal hours → `31 hrs 45 mins` */
export function formatHoursMins(hours: number | string) {
  const num = typeof hours === "string" ? parseFloat(hours) : hours
  if (Number.isNaN(num) || num < 0) return "0 hrs"
  const totalMins = Math.round(num * 60)
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  if (h === 0) return `${m} mins`
  if (m === 0) return `${h} hrs`
  return `${h} hrs ${m} mins`
}

export function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** Long invoice date: `October 16, 2026` */
export function formatInvoiceDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

export function calculateHoursFromTimes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number)
  const [eh, em] = end.split(":").map(Number)
  let startMins = sh * 60 + sm
  let endMins = eh * 60 + em
  if (endMins <= startMins) endMins += 24 * 60
  return Math.round(((endMins - startMins) / 60) * 100) / 100
}
