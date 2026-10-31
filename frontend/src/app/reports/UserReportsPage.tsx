import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { UserReport } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn, formatDate, roleLabel } from "@/lib/utils"
import { CreateReportModal, REPORT_CATEGORIES } from "@/components/reports/CreateReportModal"
import { Flag, Inbox } from "lucide-react"

const STATUS_META: Record<string, string> = {
  open: "bg-red-100 text-red-700 border-red-200",
  acknowledged: "bg-amber-100 text-amber-800 border-amber-200",
  resolved: "bg-green-100 text-green-700 border-green-200",
}
const categoryLabel = (id: string) => REPORT_CATEGORIES.find(([c]) => c === id)?.[1] ?? id
const fmtDateTime = (v?: string | null) => v ? `${formatDate(v.slice(0, 10))} ${new Date(v).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""

/**
 * VA: "My Reports" — create a report to Administrator & Auditor, track status.
 * Admin/Auditor: "Team Reports" inbox — acknowledge / resolve with a note.
 */
export function UserReportsPage() {
  const user = getAuthUser()
  const isStaff = user?.role === "admin" || user?.role === "auditor"
  const readOnly = user?.role === "auditor"
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["user-reports", statusFilter],
    queryFn: () => apiFetch<UserReport[]>(`/user-reports${statusFilter ? `?status_filter=${statusFilter}` : ""}`),
  })
  const update = useMutation({
    mutationFn: (data: { id: string; status: string }) => apiFetch(`/user-reports/${data.id}`, { method: "PATCH", body: JSON.stringify({ status: data.status, admin_note: notes[data.id] || undefined }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-reports"] }),
    onError: (e: Error) => alert(e.message),
  })
  const counts = { open: reports.filter((r) => r.status === "open").length, acknowledged: reports.filter((r) => r.status === "acknowledged").length, resolved: reports.filter((r) => r.status === "resolved").length }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">{isStaff ? "Team Reports" : "My Reports"}</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            {isStaff
              ? "Reports sent by the team to the Administrator and Project Manager. Acknowledge or resolve them — the reporter is notified."
              : "Create a report to the Administrator and Project Manager, and track what happens to it here."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isStaff && <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700">{counts.open} open</span>}
          <Button variant="gold" size="sm" onClick={() => setCreateOpen(true)}><Flag className="h-3.5 w-3.5" /> Create a Report</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[["", `All (${reports.length})`], ["open", `Open (${counts.open})`], ["acknowledged", `Acknowledged (${counts.acknowledged})`], ["resolved", `Resolved (${counts.resolved})`]].map(([id, label]) => (
          <button key={id || "all"} onClick={() => setStatusFilter(id)} className={cn("rounded-full border px-3.5 py-1.5 text-xs font-bold transition", statusFilter === id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted/60")}>{label}</button>
        ))}
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading reports…</p> : reports.length === 0 ? (
        <div className="rounded-2xl border bg-card p-10 text-center">
          <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">No reports {statusFilter ? `with status “${statusFilter}”` : "yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{isStaff ? "When a VA creates a report, it will appear here and in your notifications." : "Use “Create a Report” to tell the Administrator and Project Manager about a client, task, time-clock, or payroll issue."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="rounded-2xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    {r.title}
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize", STATUS_META[r.status])}>{r.status}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{categoryLabel(r.category)}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {isStaff ? <>By <strong className="text-foreground">{r.reporter_name}</strong> ({roleLabel(r.reporter_role)}) · </> : ""}{fmtDateTime(r.created_at)}
                    {r.client_name ? ` · Client: ${r.client_name}` : ""}{r.project_name ? ` · ${r.project_name}` : ""}{r.task_title ? ` · Task: ${r.task_title}` : ""}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{r.body}</p>
                  {r.admin_note && <p className="mt-2 rounded-xl bg-muted/60 px-3 py-2 text-sm"><span className="font-bold">Admin note:</span> {r.admin_note}</p>}
                </div>
              </div>
              {isStaff && !readOnly && r.status !== "resolved" && (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                  <div className="min-w-[220px] flex-1">
                    <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Note to reporter (optional)</span>
                    <Input value={notes[r.id] ?? r.admin_note ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} placeholder="What did you check / decide?" />
                  </div>
                  {r.status === "open" && <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ id: r.id, status: "acknowledged" })}>Acknowledge</Button>}
                  <Button size="sm" variant="success" disabled={update.isPending} onClick={() => update.mutate({ id: r.id, status: "resolved" })}>Mark resolved</Button>
                </div>
              )}
              {isStaff && readOnly && <p className="mt-2 text-xs text-muted-foreground">Project Managers can view reports; only administrators can change the status.</p>}
              {!isStaff && <p className="mt-2 text-xs text-muted-foreground">Sent to: Administrator &amp; Project Manager</p>}
            </div>
          ))}
        </div>
      )}

      <CreateReportModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
