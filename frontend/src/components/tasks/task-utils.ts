import type { Cadence, TaskItem, TaskPriority, TaskRecurrence, TaskStatus } from "@/lib/types"

export const TASK_STATUSES: { id: TaskStatus; label: string; color: string; bg: string }[] = [
  { id: "todo", label: "To Do", color: "#64748b", bg: "#f1f5f9" },
  { id: "in_progress", label: "In Progress", color: "#2563eb", bg: "#dbeafe" },
  { id: "in_review", label: "In Review", color: "#9333ea", bg: "#f3e8ff" },
  { id: "done", label: "Done", color: "#16a34a", bg: "#dcfce7" },
  { id: "blocked", label: "Blocked", color: "#dc2626", bg: "#fee2e2" },
]

export const PRIORITY_META: Record<TaskPriority, { label: string; className: string }> = {
  low: { label: "Low", className: "bg-slate-100 text-slate-600" },
  medium: { label: "Medium", className: "bg-amber-100 text-amber-700" },
  high: { label: "High", className: "bg-orange-100 text-orange-700" },
  urgent: { label: "Urgent", className: "bg-red-100 text-red-700" },
}

export const RECURRENCE_OPTIONS: { id: TaskRecurrence; label: string }[] = [
  { id: "none", label: "Does not repeat" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "weekdays", label: "Every Monday–Friday" },
  { id: "biweekly", label: "Every 2 weeks" },
  { id: "monthly", label: "Monthly" },
  { id: "annually", label: "Annually" },
  { id: "custom", label: "Custom schedule" },
]

export const WEEKDAY_OPTIONS = [
  { id: 0, label: "Mon" }, { id: 1, label: "Tue" }, { id: 2, label: "Wed" },
  { id: 3, label: "Thu" }, { id: 4, label: "Fri" }, { id: 5, label: "Sat" }, { id: 6, label: "Sun" },
]

export function isOverdue(t: TaskItem) {
  if (!t.due_date || t.status === "done") return false
  return t.due_date < new Date().toISOString().slice(0, 10)
}
export function isDueToday(t: TaskItem) {
  return t.due_date === new Date().toISOString().slice(0, 10) && t.status !== "done"
}

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

export function periodKey(dateStr: string, cadence: Cadence): string {
  const d = new Date(dateStr + "T00:00:00")
  if (cadence === "monthly") return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
  // Monday-start week
  const day = (d.getDay() + 6) % 7
  const monday = new Date(d); monday.setDate(d.getDate() - day)
  if (cadence === "biweekly") {
    // 2-week buckets anchored to epoch Monday 1970-01-05
    const epoch = new Date(1970, 0, 5)
    const weeks = Math.floor((monday.getTime() - epoch.getTime()) / (7 * 86400000))
    const bucketStart = new Date(epoch); bucketStart.setDate(epoch.getDate() + Math.floor(weeks / 2) * 14)
    const end = new Date(bucketStart); end.setDate(bucketStart.getDate() + 13)
    return `${bucketStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  return `${monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
}

export function groupByPeriod(tasks: TaskItem[], cadence: Cadence) {
  const groups = new Map<string, TaskItem[]>()
  for (const t of tasks) {
    const key = t.due_date ? periodKey(t.due_date, cadence) : "No due date"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }
  return [...groups.entries()]
}
