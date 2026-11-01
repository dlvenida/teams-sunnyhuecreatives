import { formatDate } from "@/lib/utils"

export interface WeekGroup<T> {
  id: string
  weekNumber: number
  start: string
  end: string
  label: string
  items: T[]
}

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Monday of the week containing `iso` (local calendar date, no UTC shift). */
export function weekStartISO(iso: string): string {
  const d = parseISODate(iso)
  const diff = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - diff)
  return toISO(d)
}

export function groupByWeek<T>(items: T[], dateOf: (item: T) => string): WeekGroup<T>[] {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const raw = dateOf(item)
    if (!raw) continue
    const start = weekStartISO(raw)
    const list = buckets.get(start) ?? []
    list.push(item)
    buckets.set(start, list)
  }
  const starts = [...buckets.keys()].sort()
  return starts.map((start, index) => {
    const startDate = parseISODate(start)
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + 6)
    const end = toISO(endDate)
    const weekNumber = index + 1
    const itemsInWeek = (buckets.get(start) ?? []).slice().sort((a, b) => dateOf(a).localeCompare(dateOf(b)))
    return {
      id: `week-${start}`,
      weekNumber,
      start,
      end,
      label: `Week ${weekNumber} · ${formatDate(start)} – ${formatDate(end)}`,
      items: itemsInWeek,
    }
  })
}
