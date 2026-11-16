import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/input"

export const REJECT_REASONS = [
  "Below target count",
  "Wrong client",
  "Wrong platform",
  "Screenshot unreadable",
  "Cropped or blurry",
  "Duplicate or reused screenshot",
  "Date mismatch",
  "Other",
] as const

export function RejectReasonDialog({
  count,
  busy,
  onClose,
  onConfirm,
}: {
  count: number
  busy?: boolean
  onClose: () => void
  onConfirm: (reasons: string[], note: string) => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState("")

  const toggle = (reason: string) => {
    setPicked((current) => current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-labelledby="reject-reason-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="reject-reason-title" className="text-sm font-semibold">Why send this back?</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick at least one reason. A short note is optional.{count > 1 ? ` This applies to ${count} entries.` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {REJECT_REASONS.map((reason) => {
            const on = picked.includes(reason)
            return (
              <button
                key={reason}
                type="button"
                aria-pressed={on}
                className={`min-h-11 rounded-full border px-3 py-2 text-left text-xs font-semibold ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                onClick={() => toggle(reason)}
              >
                {reason}
              </button>
            )
          })}
        </div>
        <div className="mt-3">
          <Label htmlFor="reject-note">Optional note</Label>
          <textarea
            id="reject-note"
            value={note}
            maxLength={200}
            rows={3}
            placeholder="What should they fix?"
            className="mt-1 w-full rounded-xl border bg-background px-3 py-2 text-sm"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            variant="danger"
            className="min-h-11 flex-1"
            disabled={picked.length === 0 || busy}
            onClick={() => onConfirm(picked, note.trim())}
          >
            Reject
          </Button>
          <Button variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

export function rejectionLine(log: { status?: string; needs_fixing?: string | null; rejection_history?: { last_sent_back?: string }[] }) {
  if (log.status === "rejected") return log.needs_fixing || "No reason given"
  const earlier = log.rejection_history?.[0]?.last_sent_back
  return earlier || ""
}
