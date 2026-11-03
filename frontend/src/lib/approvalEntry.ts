/** Duration shown on the approval screen, for example 1h 25m. */
export function formatHoursMinutes(hours: number | string | null | undefined): string {
  const totalMins = Math.round(Number(hours || 0) * 60)
  const whole = Math.floor(Math.abs(totalMins) / 60)
  const mins = Math.abs(totalMins) % 60
  if (whole && mins) return `${whole}h ${mins}m`
  if (whole) return `${whole}h`
  return `${mins}m`
}

export function approvalTaskLabel(entry: {
  task_name?: string | null
  task_title?: string | null
  description?: string | null
  description_plain?: string | null
}): string {
  const named = (entry.task_name || entry.task_title || "").trim()
  if (named && named !== "Untitled task") return named
  const desc = (entry.description || entry.description_plain || "").trim()
  if (desc) {
    const line = desc.split("\n")[0].trim()
    if (line) return line.slice(0, 140)
  }
  return named || "Untitled task"
}

export function isDurationEntry(entry: { entry_mode?: string | null; start_time?: string | null; end_time?: string | null }): boolean {
  if (entry.entry_mode === "duration") return true
  if (entry.entry_mode === "range") return false
  return !entry.start_time && !entry.end_time
}

/** Compact label for a duration log, for example "2h 15m, entered as duration". */
export function formatEnteredDuration(hours: number | string | null | undefined): string {
  const totalMins = Math.round(Number(hours || 0) * 60)
  const whole = Math.floor(Math.abs(totalMins) / 60)
  const mins = Math.abs(totalMins) % 60
  return `${whole}h ${mins}m, entered as duration`
}

export function formatClock(value?: string | null): string {
  if (!value) return ""
  const [hRaw, mRaw] = value.slice(0, 5).split(":")
  const h = Number(hRaw)
  const m = Number(mRaw)
  if (Number.isNaN(h) || Number.isNaN(m)) return value
  const suffix = h >= 12 ? "PM" : "AM"
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`
}
