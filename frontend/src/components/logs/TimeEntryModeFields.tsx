import { Input, Label } from "@/components/ui/input"
import { calculateHoursFromTimes } from "@/lib/utils"

export type EntryMode = "range" | "duration"

export function splitStoredHours(hours: string | number | null | undefined): { hours: number; minutes: number } {
  const total = Math.round(Number(hours || 0) * 60)
  const safe = Number.isFinite(total) ? Math.max(0, total) : 0
  return { hours: Math.floor(safe / 60), minutes: safe % 60 }
}

export function durationError(hours: number, minutes: number): string {
  if (!Number.isInteger(hours) || hours < 0 || hours > 24) return "Hours must be a whole number from 0 to 24."
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return "Minutes must be a whole number from 0 to 59."
  const total = hours * 60 + minutes
  if (total <= 0) return "Duration must be greater than 0."
  if (total > 24 * 60) return "A single entry cannot be more than 24 hours."
  return ""
}

export function entryHours(mode: EntryMode, start: string, end: string, hours: number, minutes: number): number {
  if (mode === "duration") {
    const total = (Number(hours) || 0) * 60 + (Number(minutes) || 0)
    return Math.round((total / 60) * 100) / 100
  }
  if (!start || !end) return 0
  return calculateHoursFromTimes(start, end)
}

export function timingBody(mode: EntryMode, start: string, end: string, hours: number, minutes: number) {
  if (mode === "duration") {
    return { entry_mode: "duration" as const, duration_hours: hours, duration_minutes: minutes, start_time: null, end_time: null }
  }
  return { entry_mode: "range" as const, start_time: start, end_time: end, duration_hours: null, duration_minutes: null }
}

export function TimeEntryModeFields({
  mode,
  onMode,
  start,
  end,
  onStart,
  onEnd,
  hours,
  minutes,
  onHours,
  onMinutes,
}: {
  mode: EntryMode
  onMode: (mode: EntryMode) => void
  start: string
  end: string
  onStart: (value: string) => void
  onEnd: (value: string) => void
  hours: number
  minutes: number
  onHours: (value: number) => void
  onMinutes: (value: number) => void
}) {
  const error = mode === "duration" ? durationError(hours, minutes) : ""
  const parseWhole = (raw: string) => {
    if (raw.trim() === "") return 0
    const n = Number(raw)
    return Number.isFinite(n) ? Math.trunc(n) : 0
  }
  return (
    <div className="space-y-3 sm:col-span-2">
      <div>
        <Label>How are you logging this?</Label>
        <div className="mt-1 grid grid-cols-2 gap-1 rounded-xl bg-[#FDF2F5] p-1" role="group" aria-label="Time entry method">
          <button
            type="button"
            aria-pressed={mode === "range"}
            className={`rounded-lg px-3 py-2 text-xs font-bold transition ${mode === "range" ? "bg-card text-[#B8325F] shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => onMode("range")}
          >
            Start and end time
          </button>
          <button
            type="button"
            aria-pressed={mode === "duration"}
            className={`rounded-lg px-3 py-2 text-xs font-bold transition ${mode === "duration" ? "bg-card text-[#B8325F] shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => onMode("duration")}
          >
            Enter duration
          </button>
        </div>
      </div>
      {mode === "range" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Start Time</Label><Input type="time" value={start} onChange={(e) => onStart(e.target.value)} /></div>
          <div><Label>End Time</Label><Input type="time" value={end} onChange={(e) => onEnd(e.target.value)} /></div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Hours</Label>
            <Input type="number" min={0} max={24} step={1} inputMode="numeric" value={hours} onChange={(e) => onHours(parseWhole(e.target.value))} />
          </div>
          <div>
            <Label>Minutes</Label>
            <Input type="number" min={0} max={59} step={1} inputMode="numeric" value={minutes} onChange={(e) => onMinutes(parseWhole(e.target.value))} />
          </div>
          <p className="text-[11px] text-muted-foreground sm:col-span-2">For example, 2 hours and 15 minutes, or 0 hours and 45 minutes. Minutes stay between 0 and 59, and one entry can be at most 24 hours.</p>
          {error && <p className="text-[11px] text-red-600 sm:col-span-2">{error}</p>}
        </div>
      )}
    </div>
  )
}
