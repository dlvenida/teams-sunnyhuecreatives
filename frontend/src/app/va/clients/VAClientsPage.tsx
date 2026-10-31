import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { apiFetch } from "@/lib/api"
import type { VAAssignedClient } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { CreateReportModal } from "@/components/reports/CreateReportModal"
import { formatDate } from "@/lib/utils"
import { Building2, Flag, FolderKanban, KanbanSquare } from "lucide-react"

/** VA view — Clients tab showing only clients ASSIGNED to this VA. */
export function VAClientsPage() {
  const [reportClientId, setReportClientId] = useState<string | null>(null)
  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["va-my-clients"],
    queryFn: () => apiFetch<VAAssignedClient[]>("/va/my-clients"),
  })
  const totalHours = clients.reduce((s, c) => s + Number(c.hours || 0), 0)

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">My Clients</h1>
          <p className="text-sm text-muted-foreground">
            Clients assigned to you. Your role on each client is set by the admin or Project Manager. {clients.length} client(s) · {totalHours.toFixed(1)} hrs logged.
          </p>
        </div>
        <Button variant="gold" size="sm" onClick={() => setReportClientId("")}>
          <Flag className="h-3.5 w-3.5" /> Create a Report
        </Button>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading your clients…</p> : clients.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">No assigned clients yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">When an administrator assigns you a task or you log time for a client, that client will appear here.</p>
          <Link to="/va/tasks"><Button variant="gold" size="sm" className="mt-3"><KanbanSquare className="h-3.5 w-3.5" /> Open Task Board</Button></Link>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((c) => (
            <div key={c.client_id} className="monday-card flex flex-col rounded-2xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-sm font-extrabold text-primary">{c.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{c.name}</p>
                  <p className="text-xs capitalize text-muted-foreground">{c.billing_type} billing{c.is_active ? "" : " · archived"}{c.sub_clients.length ? ` · ${c.sub_clients.join(", ")}` : ""}</p>
                  <div className="mt-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.role ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {c.role || "No role set"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {[["Hours", `${Number(c.hours).toFixed(1)}`], ["Open tasks", `${c.open_tasks}`], ["Done", `${c.done_tasks}`]].map(([label, v]) => (
                  <div key={label} className="rounded-xl bg-muted/50 px-2 py-2"><p className="text-base font-extrabold leading-none">{v}</p><p className="mt-1 text-[11px] text-muted-foreground">{label}</p></div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {c.overdue_tasks > 0 && <span className="font-bold text-red-600">{c.overdue_tasks} overdue · </span>}
                {c.next_due ? `Next due ${formatDate(c.next_due)} · ` : ""}{Number(c.pending_hours) > 0 ? `${c.pending_hours} hrs pending approval · ` : ""}{c.last_log_date ? `Last log ${formatDate(c.last_log_date)}` : "No logs yet"}
              </p>
              {c.projects.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {c.projects.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs">
                      <span className="flex items-center gap-1.5 font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.name}</span>
                      <span className="text-muted-foreground">{p.task_done}/{p.task_total} tasks</span>
                    </div>
                  ))}
                </div>
              )}
              {c.tasks.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {c.tasks.slice(0, 3).map((t) => <li key={t.id} className="truncate">• {t.title}{t.due_date ? ` — due ${formatDate(t.due_date)}` : ""}</li>)}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5 pt-1 mt-auto">
                <Link to={`/va/tasks?client=${c.client_id}`}><Button size="sm" variant="outline"><KanbanSquare className="h-3.5 w-3.5" /> Tasks</Button></Link>
                <Link to="/va/projects"><Button size="sm" variant="outline"><FolderKanban className="h-3.5 w-3.5" /> Projects</Button></Link>
                <Button size="sm" variant="gold" onClick={() => setReportClientId(c.client_id)}><Flag className="h-3.5 w-3.5" /> Report</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateReportModal open={reportClientId !== null} onClose={() => setReportClientId(null)} presetClientId={reportClientId || ""} presetCategory="client" />
    </div>
  )
}
