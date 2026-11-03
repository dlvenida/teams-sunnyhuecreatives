import { formatDate } from "@/lib/utils"
import { approvalTaskLabel, formatClock, formatHoursMinutes } from "@/lib/approvalEntry"

export interface ApprovalEntryView {
  id: string
  work_date: string
  client_name?: string | null
  project_name?: string | null
  task_title?: string | null
  task_name?: string | null
  description?: string | null
  description_plain?: string | null
  notes?: string | null
  start_time?: string | null
  end_time?: string | null
  hours: string | number
  source?: string | null
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary/80">{label}</p>
      <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground">{value}</p>
    </div>
  )
}

function loggedWhen(entry: ApprovalEntryView): string {
  const day = formatDate(entry.work_date)
  const start = entry.start_time ? formatClock(entry.start_time) : ""
  const end = entry.end_time ? formatClock(entry.end_time) : ""
  if (start && end) return `${day}, ${start} to ${end}`
  if (start) return `${day}, from ${start}`
  return `${day}. No start and end time.`
}

export function LogApprovalCard({ entry }: { entry: ApprovalEntryView }) {
  const description = (entry.description || entry.description_plain || "").trim()
  const notes = (entry.notes || "").trim()
  const extraNote = notes && notes !== description ? notes : ""
  const task = approvalTaskLabel(entry)
  const fromClock = entry.source === "clock"
  return (
    <article className="rounded-2xl border border-primary/15 bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-display text-base font-bold text-[#B8325F]">{task}</h4>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{fromClock ? "From the time clock" : "Logged by hand"}</p>
        </div>
        <p className="shrink-0 rounded-full bg-[#FDF2F5] px-3 py-1 text-sm font-extrabold text-[#B8325F]">{formatHoursMinutes(entry.hours)}</p>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Project" value={entry.project_name || "No project"} />
        <Field label="Client" value={entry.client_name || "No client"} />
        <Field label="Duration" value={formatHoursMinutes(entry.hours)} />
        <Field label="Logged" value={loggedWhen(entry)} />
      </dl>
      <div className="mt-3 rounded-xl bg-[#FDF2F5] px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#B8325F]">Description</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[#3D2B33]">{description || "No description"}</p>
        {extraNote && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#3D2B33]">Note: {extraNote}</p>}
      </div>
    </article>
  )
}
