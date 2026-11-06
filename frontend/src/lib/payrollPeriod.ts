import { localISODate } from "@/lib/utils"

export type HalfMonth = "first_half" | "second_half"

/** Calendar date in Asia/Manila, as a local Date whose year/month/day match Manila. */
export function manilaCalendarDate(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === "year")?.value)
  const month = Number(parts.find((part) => part.type === "month")?.value)
  const day = Number(parts.find((part) => part.type === "day")?.value)
  return new Date(year, month - 1, day)
}

/** 1st-15th or 16th through the last day of the current Manila month. */
export function halfMonthRange(which: HalfMonth, now = new Date()): { from: string; to: string } {
  const today = manilaCalendarDate(now)
  const year = today.getFullYear()
  const month = today.getMonth()
  if (which === "first_half") {
    return {
      from: localISODate(new Date(year, month, 1)),
      to: localISODate(new Date(year, month, 15)),
    }
  }
  return {
    from: localISODate(new Date(year, month, 16)),
    to: localISODate(new Date(year, month + 1, 0)),
  }
}
