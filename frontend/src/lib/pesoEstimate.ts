export const VA_USD_PHP_STORAGE_KEY = "shc.va.usdPhpEstimate"

/** A positive rate, or null when the field is empty or not a usable number. */
export function parseUsdPhpRate(raw: string | null | undefined): number | null {
  const text = String(raw ?? "").trim()
  if (!text) return null
  const rate = Number(text)
  if (!Number.isFinite(rate) || rate <= 0) return null
  return rate
}

/**
 * Last value the VA typed wins, including a blank field.
 * The admin rate is only the first default, when nothing is saved in the browser.
 */
export function initialRateInput(stored: string | null, adminRate: string | null | undefined): string {
  if (stored !== null) return stored
  return parseUsdPhpRate(adminRate) != null ? String(adminRate).trim() : ""
}

function toPhp(amount: number | string, rate: number): number | null {
  const usd = typeof amount === "string" ? parseFloat(amount) : amount
  if (!Number.isFinite(usd) || !Number.isFinite(rate) || rate <= 0) return null
  return Math.round(usd * rate * 100) / 100
}

/** "≈ PHP 10,014.62", or null so the page never prints NaN. */
export function formatPesoEstimate(amount: number | string, rate: number | null): string | null {
  if (rate == null) return null
  const php = toPhp(amount, rate)
  if (php == null || !Number.isFinite(php)) return null
  const formatted = php.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `≈ PHP ${formatted}`
}

export function showsUsd(currency: string | null | undefined): boolean {
  return String(currency || "USD").toUpperCase() === "USD"
}
