import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { apiFetch, getAuthUser, homeForRole, startImpersonation } from "@/lib/api"
import type { Client, UserDetail } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input, Label, Select } from "@/components/ui/input"
import { cn, formatCurrency, formatDate, roleLabel } from "@/lib/utils"
import { useDisplaySettings } from "@/hooks/useDisplaySettings"
import { TASK_STATUSES, PRIORITY_META } from "@/components/tasks/task-utils"
import { CLIENT_VA_ROLE_SUGGESTIONS } from "@/lib/clientVaRoles"
import { Building2, Clock, Eye, FolderKanban, History, KanbanSquare, Loader2, Pencil, Plus, UserCircle, X } from "lucide-react"

type Tab = "profile" | "clients" | "tasks" | "projects" | "timeline" | "logs" | "history"
const TABS: [Tab, string][] = [["profile", "Profile"], ["clients", "Roles per client"], ["tasks", "Assigned Tasks"], ["projects", "Assigned Projects"], ["timeline", "Timeline"], ["logs", "Time Logs"], ["history", "History"]]

export function UserDetailDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { showPricing } = useDisplaySettings()
  const me = getAuthUser()
  const isAdmin = me?.role === "admin"
  const canEditRoles = me?.role === "admin" || me?.role === "auditor"
  const [tab, setTab] = useState<Tab>("profile")
  const [switchError, setSwitchError] = useState("")
  const [switching, setSwitching] = useState(false)
  const [editingClientId, setEditingClientId] = useState<string | null>(null)
  const [editRole, setEditRole] = useState("")
  const [addClientId, setAddClientId] = useState("")
  const [addRole, setAddRole] = useState("")
  const [roleError, setRoleError] = useState("")
  const { data: detail, isLoading, error } = useQuery({
    queryKey: ["user-detail", userId],
    queryFn: () => apiFetch<UserDetail>(`/auth/users/${userId}/detail`),
    enabled: !!userId,
  })
  const { data: allClients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => apiFetch<Client[]>("/clients?active_only=true"),
    enabled: canEditRoles && tab === "clients" && !!detail?.profile.va_id,
  })

  const saveRole = useMutation({
    mutationFn: ({ client_id, role }: { client_id: string; role: string }) => {
      const vaId = detail?.profile.va_id
      if (!vaId) throw new Error("This user has no VA profile")
      return apiFetch(`/clients/${client_id}/team/${vaId}`, {
        method: "PUT",
        body: JSON.stringify({ role: role.trim() || "General VA" }),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-detail", userId] })
      setEditingClientId(null)
      setAddClientId("")
      setAddRole("")
      setRoleError("")
    },
    onError: (e: Error) => setRoleError(e.message),
  })

  const switchTo = async () => {
    if (!detail) return
    setSwitching(true); setSwitchError("")
    try {
      const user = await startImpersonation(detail.profile.user_id)
      window.location.href = homeForRole(user.role)
    } catch (e) {
      setSwitchError(e instanceof Error ? e.message : "Could not switch user")
      setSwitching(false)
    }
  }

  const p = detail?.profile
  const s = detail?.stats
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-card shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
        {isLoading || !detail || !p || !s ? (
          <div className="p-6 text-sm text-muted-foreground">
            {error ? <span className="text-red-600">{error instanceof Error ? error.message : "Could not load user"}</span> : <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading user…</span>}
            <button onClick={onClose} className="ml-4 rounded-full p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
        ) : (<>
          <div className="sticky top-0 z-10 border-b bg-card/95 px-5 py-4 backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-sm font-extrabold text-primary">{p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</span>
                <div>
                  <h2 className="text-base font-bold leading-tight">{p.name}</h2>
                  <p className="text-[11px] text-muted-foreground">{p.email} · {roleLabel(p.role)}{p.job_title ? ` · ${p.job_title}` : ""} · {p.is_active ? "Active" : "Archived"}{p.created_at ? ` · since ${formatDate(p.created_at.slice(0, 10))}` : ""}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {isAdmin && p.role !== "admin" && (
                  <Button size="sm" variant="gold" disabled={switching} onClick={() => void switchTo()}>
                    <Eye className="h-3.5 w-3.5" /> {switching ? "Switching…" : "Switch to their view"}
                  </Button>
                )}
                <button onClick={onClose} className="rounded-full p-2 hover:bg-muted"><X className="h-4 w-4" /></button>
              </div>
            </div>
            {switchError && <p className="mt-2 text-[11px] text-red-600">{switchError}</p>}
            <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
              {TABS.map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold", tab === id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/60")}>
                  {label}{id === "clients" ? ` (${s.clients_count})` : id === "tasks" ? ` (${s.tasks_open} open)` : id === "projects" ? ` (${s.projects_count})` : id === "logs" ? ` (${s.logs_count})` : ""}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 px-5 py-4">
            {tab === "profile" && (<>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Total Hours", `${s.total_hours} hrs`, `${s.hours_this_week} hrs this week`],
                  ...(showPricing ? [["VA Earned", formatCurrency(s.total_va_pay, (p.currency as "PHP" | "USD") || "USD"), `${s.pending_hours} hrs pending`] as const] : [["Pending hours", `${s.pending_hours} hrs`, "Awaiting approval"] as const]),
                  ["Tasks", `${s.tasks_open} open`, `${s.tasks_done} done · ${s.tasks_overdue} overdue`],
                  ["Clock", `${s.clock_hours} hrs`, `${s.clock_sessions} sessions`],
                ].map(([t, v, sub]) => (
                  <div key={t} className="rounded-2xl border p-3"><p className="text-[11px] font-semibold text-muted-foreground">{t}</p><p className="mt-1 text-lg font-extrabold leading-none">{v}</p><p className="mt-1 text-[11px] text-muted-foreground">{sub}</p></div>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border p-4 text-xs">
                  <p className="mb-2 flex items-center gap-1.5 font-bold"><UserCircle className="h-4 w-4 text-primary" /> Profile</p>
                  <dl className="space-y-1.5">
                    {([
                      ["Name", p.name], ["Email", p.email], ["Role", roleLabel(p.role)],
                      ...(showPricing ? [["Currency", p.currency || "—"] as const] : []),
                      ["Job title", p.job_title || "—"], ["Phone", p.phone || "—"], ["Timezone", p.timezone || "—"],
                      ["Hire date", p.hire_date ? formatDate(p.hire_date) : "—"], ["Status", p.status_message || "—"],
                      ["Reviewer", p.reviewer_name || "—"],
                      ...(showPricing ? [["Wise", p.wise_email || "—"] as const] : []),
                    ]).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold capitalize-first">{v}</dd></div>
                    ))}
                  </dl>
                  {p.skills && p.skills.length > 0 && <p className="mt-2 flex flex-wrap gap-1">{p.skills.map((sk) => <span key={sk} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{sk}</span>)}</p>}
                  {p.bio && <p className="mt-2 text-muted-foreground">{p.bio}</p>}
                  {(p.linkedin_url || p.portfolio_url) && <p className="mt-2 flex gap-3">{p.linkedin_url && <a className="font-semibold text-primary" href={p.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}{p.portfolio_url && <a className="font-semibold text-primary" href={p.portfolio_url} target="_blank" rel="noreferrer">Portfolio</a>}</p>}
                </div>
                <div className="rounded-2xl border p-4 text-xs">
                  <p className="mb-2 font-bold">At a glance</p>
                  <p className="text-muted-foreground">Assigned to <strong className="text-foreground">{s.clients_count} client(s)</strong> and <strong className="text-foreground">{s.projects_count} project(s)</strong> · {s.logs_count} time log(s){p.reviewing.length > 0 && <> · Reviewing: <strong className="text-foreground">{p.reviewing.map((r) => r.name).join(", ")}</strong></>}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to="/admin/tasks"><Button size="sm" variant="outline"><KanbanSquare className="h-3.5 w-3.5" /> Task Board</Button></Link>
                    <Link to="/admin/logs"><Button size="sm" variant="outline"><Clock className="h-3.5 w-3.5" /> All Logs</Button></Link>
                    <Link to="/admin/projects"><Button size="sm" variant="outline"><FolderKanban className="h-3.5 w-3.5" /> Projects</Button></Link>
                  </div>
                  {isAdmin && <p className="mt-3 text-[11px] text-muted-foreground">Use “Switch to their view” above to see the app exactly as {p.name.split(" ")[0]} sees it — their dashboard, Task Board, clock and logs.</p>}
                </div>
              </div>
            </>)}

            {tab === "clients" && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-primary/15 bg-primary/[0.03] p-3">
                  <p className="text-xs font-bold">Role per client</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Job function titles only (not pay). Example: Social Media Manager for Client A, Email Marketing Specialist for Client B.
                    {canEditRoles ? " Admin and Project Manager can add or update anytime. The VA can view only." : " The VA can view only."}
                  </p>
                </div>
                {roleError && <p className="text-[11px] text-red-600">{roleError}</p>}
                <div className="space-y-2">
                  {detail.assigned_clients.map((c) => (
                    <div key={c.client_id} className="rounded-xl border p-3 text-xs">
                      {editingClientId === c.client_id ? (
                        <div className="space-y-2">
                          <p className="font-bold">{c.name}</p>
                          <Label className="text-[10px]">Role for this client</Label>
                          <Input
                            className="h-8 text-xs"
                            list="client-va-role-suggestions"
                            value={editRole}
                            placeholder="e.g. Social Media Manager"
                            onChange={(e) => setEditRole(e.target.value)}
                            autoFocus
                          />
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="gold" disabled={saveRole.isPending} onClick={() => saveRole.mutate({ client_id: c.client_id, role: editRole })}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingClientId(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="inline-flex items-center gap-1.5 font-bold"><Building2 className="h-3.5 w-3.5 text-primary" /> {c.name}</span>
                              <span className="text-muted-foreground">—</span>
                              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", c.role ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                                {c.role || "No role set"}
                              </span>
                              {!c.is_active && <span className="text-muted-foreground">(archived)</span>}
                            </p>
                            <p className="mt-1 text-muted-foreground">
                              {c.hours} hrs
                              {showPricing && c.va_pay != null ? ` · ${formatCurrency(c.va_pay, (p.currency as "PHP" | "USD") || "USD")} earned` : ""}
                              {" · "}{c.open_tasks} open / {c.done_tasks} done tasks · {c.logs} logs
                              {c.last_log_date ? ` · last ${formatDate(c.last_log_date)}` : ""}
                            </p>
                          </div>
                          {canEditRoles && p.va_id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setRoleError(""); setEditingClientId(c.client_id); setEditRole(c.role || "") }}
                            >
                              <Pencil className="h-3 w-3" /> {c.role ? "Edit role" : "Set role"}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {detail.assigned_clients.length === 0 && (
                    <p className="text-xs text-muted-foreground">No clients yet — add a role below, or assign a task / log time for a client.</p>
                  )}
                </div>
                {canEditRoles && p.va_id && (
                  <div className="grid gap-2 rounded-xl border border-dashed border-primary/25 p-3 sm:grid-cols-[1fr_1fr_auto]">
                    <div>
                      <Label className="text-[10px]">Client</Label>
                      <Select value={addClientId} onChange={(e) => setAddClientId(e.target.value)} className="h-9">
                        <option value="">Select client…</option>
                        {allClients
                          .filter((c) => c.is_active !== false && !detail.assigned_clients.some((a) => a.client_id === c.id && a.has_explicit_role))
                          .map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px]">Role title</Label>
                      <Input
                        className="h-9"
                        list="client-va-role-suggestions"
                        placeholder="e.g. Community Manager"
                        value={addRole}
                        onChange={(e) => setAddRole(e.target.value)}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        size="sm"
                        variant="gold"
                        className="w-full"
                        disabled={!addClientId || saveRole.isPending}
                        onClick={() => saveRole.mutate({ client_id: addClientId, role: addRole })}
                      >
                        <Plus className="h-3.5 w-3.5" /> Add role
                      </Button>
                    </div>
                  </div>
                )}
                <datalist id="client-va-role-suggestions">
                  {CLIENT_VA_ROLE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}
                </datalist>
              </div>
            )}

            {tab === "tasks" && (
              <div className="space-y-2">
                {detail.tasks.map((t) => (
                  <Link key={t.id} to="/admin/tasks" className="flex items-center gap-3 rounded-xl border p-3 monday-card">
                    <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: t.project_color || "var(--primary)" }} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{t.title}</span><span className="block text-[11px] text-muted-foreground">{t.client_name ?? ""}{t.project_name ? ` · ${t.project_name}` : ""} · {TASK_STATUSES.find((x) => x.id === t.status)?.label ?? t.status} · {Number(t.logged_hours).toFixed(1)} hrs logged</span></span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", PRIORITY_META[t.priority]?.className)}>{PRIORITY_META[t.priority]?.label}</span>
                    <span className="whitespace-nowrap text-[11px] text-muted-foreground">{t.due_date ? formatDate(t.due_date) : "No date"}</span>
                  </Link>
                ))}
                {detail.tasks.length === 0 && <p className="text-xs text-muted-foreground">No assigned tasks.</p>}
              </div>
            )}

            {tab === "projects" && (
              <div className="space-y-2">
                {detail.assigned_projects.map((pr) => { const pct = pr.task_total ? Math.round((pr.task_done / pr.task_total) * 100) : 0; return (
                  <div key={pr.id} className="rounded-xl border p-3 text-xs">
                    <div className="flex justify-between"><span className="font-bold"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: pr.color }} />{pr.name}</span><span className="text-muted-foreground">{pct}%</span></div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{pr.client_name ?? ""}{pr.sub_client_name ? ` · ${pr.sub_client_name}` : ""} · {pr.cadence} · {pr.status.replace("_", " ")} · {pr.task_done}/{pr.task_total} tasks · {pr.hours} hrs{pr.due_date ? ` · due ${formatDate(pr.due_date)}` : ""}</p>
                    <div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${pct}%`, background: pr.color }} /></div>
                  </div>) })}
                {detail.assigned_projects.length === 0 && <p className="text-xs text-muted-foreground">No assigned projects.</p>}
              </div>
            )}

            {tab === "timeline" && (
              <ol className="relative space-y-0 border-l pl-5">
                {detail.timeline.map((ev, i) => (
                  <li key={i} className="relative pb-4 last:pb-0">
                    <span className={cn("absolute -left-[25px] top-1 h-3 w-3 rounded-full border-2 border-card", ev.kind === "clock" ? "bg-green-500" : ev.kind === "task_done" ? "bg-primary" : "bg-amber-500")} />
                    <p className="text-xs font-bold">{ev.title} <Badge variant="default" className="ml-1 capitalize">{ev.status}</Badge></p>
                    <p className="text-[11px] text-muted-foreground">{ev.date_label}{ev.detail ? ` · ${ev.detail}` : ""}</p>
                  </li>
                ))}
                {detail.timeline.length === 0 && <p className="text-xs text-muted-foreground">No timeline activity yet.</p>}
              </ol>
            )}

            {tab === "logs" && (<>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-xs">
                  <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-2.5">Date</th><th className="p-2.5">Client / Project</th><th className="p-2.5">Description</th><th className="p-2.5">Hours</th>{showPricing && <th className="p-2.5">Earned</th>}<th className="p-2.5">Status</th></tr></thead>
                  <tbody>{detail.time_logs.map((l) => (
                    <tr key={l.id} className="border-b last:border-0"><td className="whitespace-nowrap p-2.5">{formatDate(l.work_date)}</td><td className="whitespace-nowrap p-2.5 font-medium">{l.client_name}{l.project_name ? <span className="block text-[10px] font-normal text-muted-foreground">{l.project_name}</span> : null}</td><td className="max-w-[220px] p-2.5"><span className="line-clamp-2">{l.description_plain}</span></td><td className="p-2.5 font-bold">{Number(l.hours).toFixed(2)}</td>{showPricing && <td className="p-2.5">{formatCurrency(l.va_pay, (p.currency as "PHP" | "USD") || "USD")}</td>}<td className="p-2.5 capitalize">{l.status}</td></tr>
                  ))}{detail.time_logs.length === 0 && <tr><td colSpan={showPricing ? 6 : 5} className="p-5 text-center text-muted-foreground">No time logs yet.</td></tr>}</tbody>
                </table>
              </div>
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Clock history ({detail.clock_history.length})</p>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-xs">
                  <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-2.5">Clock in</th><th className="p-2.5">Clock out</th><th className="p-2.5">Client / Task</th><th className="p-2.5">Duration</th><th className="p-2.5">Status</th></tr></thead>
                  <tbody>{detail.clock_history.map((c) => (
                    <tr key={c.id} className="border-b last:border-0"><td className="whitespace-nowrap p-2.5">{new Date(c.clock_in).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td><td className="whitespace-nowrap p-2.5">{c.clock_out ? new Date(c.clock_out).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—"}</td><td className="p-2.5">{c.client_name || c.task_title || "General"}</td><td className="p-2.5 font-bold">{c.duration_seconds ? `${(c.duration_seconds / 3600).toFixed(2)} hrs` : "—"}</td><td className="p-2.5 capitalize">{c.status}</td></tr>
                  ))}{detail.clock_history.length === 0 && <tr><td colSpan={5} className="p-5 text-center text-muted-foreground">No clock sessions yet.</td></tr>}</tbody>
                </table>
              </div>
            </>)}

            {tab === "history" && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"><History className="h-3.5 w-3.5" /> Activity history</p>
                {detail.history.map((h) => (
                  <div key={h.id} className="flex items-start justify-between gap-3 rounded-xl border p-3 text-xs">
                    <span><span className="font-bold capitalize">{h.action}</span> — {h.description}<span className="block text-[11px] text-muted-foreground">{h.method} {h.path}</span></span>
                    <span className="whitespace-nowrap text-[11px] text-muted-foreground">{h.created_at ? new Date(h.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</span>
                  </div>
                ))}
                {detail.history.length === 0 && <p className="text-xs text-muted-foreground">No recorded activity yet. Actions this user takes in the app will appear here.</p>}
              </div>
            )}
          </div>
        </>)}
      </div>
    </div>
  )
}
