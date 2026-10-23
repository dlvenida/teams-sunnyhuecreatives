import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { Cadence, Client, Project, TaskItem, TaskPriority, TaskRecurrence, TaskStatus, VA } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/utils"
import { TASK_STATUSES, PRIORITY_META, RECURRENCE_OPTIONS, WEEKDAY_OPTIONS, groupByPeriod, isDueToday, isOverdue } from "@/components/tasks/task-utils"
import { CommentThread } from "@/components/comments/CommentThread"
import { DetailAttachments } from "@/components/comments/DetailAttachments"
import { AlertTriangle, CalendarDays, Columns3, List, MessageSquare, Pencil, Plus, Repeat, Search, Timer, Trash2, X } from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"

type ViewMode = "board" | "list" | "timeline"

const emptyForm = {
  title: "", description: "", client_id: "", sub_client_id: "", project_id: "", assignee_va_id: "",
  status: "todo" as TaskStatus, priority: "medium" as TaskPriority, start_date: "", due_date: "",
  estimated_hours: "", tags: "",
  recurrence: "none" as TaskRecurrence, recurrence_interval: "1", recurrence_unit: "week",
  recurrence_weekdays: [0, 1, 2, 3, 4] as number[], recurrence_until: "",
}

export function TasksPage() {
  const qc = useQueryClient()
  const user = getAuthUser()
  const isAdmin = user?.role === "admin"
  const isAuditor = user?.role === "auditor"
  const [searchParams] = useSearchParams()
  const [view, setView] = useState<ViewMode>("board")
  const [cadence, setCadence] = useState<Cadence>("weekly")
  const [search, setSearch] = useState("")
  const [clientId, setClientId] = useState(() => searchParams.get("client") || "")
  const [projectId, setProjectId] = useState(() => searchParams.get("project") || "")
  const [assigneeId, setAssigneeId] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [priorityFilter, setPriorityFilter] = useState("")
  const [showOverdueOnly, setShowOverdueOnly] = useState(false)
  const [modal, setModal] = useState<null | { mode: "create" | "edit"; task?: TaskItem }>(null)
  const [form, setForm] = useState(emptyForm)
  const [commentTask, setCommentTask] = useState<TaskItem | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [error, setError] = useState("")

  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (clientId) p.set("client_id", clientId)
    if (projectId) p.set("project_id", projectId)
    if (assigneeId) p.set("assignee_va_id", assigneeId)
    if (statusFilter) p.set("status", statusFilter)
    if (priorityFilter) p.set("priority", priorityFilter)
    if (search) p.set("search", search)
    if (showOverdueOnly) p.set("overdue", "true")
    const s = p.toString(); return s ? `?${s}` : ""
  }, [clientId, projectId, assigneeId, statusFilter, priorityFilter, search, showOverdueOnly])

  const { data: tasks = [], isLoading } = useQuery({ queryKey: ["tasks", query, isAdmin], queryFn: () => apiFetch<TaskItem[]>(`/tasks${query}`) })
  const { data: stats } = useQuery({ queryKey: ["task-stats"], queryFn: () => apiFetch<{ total: number; by_status: Record<string, number>; overdue: number; due_today: number; unassigned: number }>("/tasks/stats") })
  const { data: clients = [] } = useQuery({ queryKey: [isAdmin ? "clients" : "va-clients"], queryFn: () => apiFetch<Client[]>(isAdmin ? "/clients?active_only=true" : "/va/clients") })
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => apiFetch<Project[]>("/projects?include_archived=false") })
  const { data: vas = [] } = useQuery({ queryKey: ["vas"], queryFn: () => apiFetch<VA[]>("/vas"), enabled: isAdmin })
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["task-stats"] }); qc.invalidateQueries({ queryKey: ["projects"] }) }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title,
        description: form.description || null,
        client_id: form.client_id,
        sub_client_id: form.sub_client_id || null,
        project_id: form.project_id || null,
        assignee_va_id: form.assignee_va_id || null,
        status: form.status,
        priority: form.priority,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
        estimated_hours: form.estimated_hours || null,
        tags: form.tags ? form.tags.split(",").map(s => s.trim()).filter(Boolean) : [],
        recurrence: form.recurrence,
        recurrence_interval: form.recurrence === "custom" ? Math.max(1, parseInt(form.recurrence_interval, 10) || 1) : 1,
        recurrence_unit: form.recurrence === "custom" ? form.recurrence_unit : null,
        recurrence_weekdays: form.recurrence === "custom" && form.recurrence_unit === "week" ? form.recurrence_weekdays : null,
        recurrence_until: form.recurrence !== "none" && form.recurrence_until ? form.recurrence_until : null,
      }
      return modal?.mode === "edit" && modal.task
        ? apiFetch(`/tasks/${modal.task.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : apiFetch("/tasks", { method: "POST", body: JSON.stringify(body) })
    },
    onSuccess: () => { invalidate(); setModal(null); setError("") },
    onError: (e: Error) => setError(e.message),
  })
  const move = useMutation({ mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => apiFetch(`/tasks/${id}/move`, { method: "POST", body: JSON.stringify({ status }) }), onSuccess: invalidate, onError: (e: Error) => setError(e.message) })
  const remove = useMutation({ mutationFn: (id: string) => apiFetch(`/tasks/${id}`, { method: "DELETE" }), onSuccess: invalidate })
  const openCreate = (status: TaskStatus = "todo") => { setForm({ ...emptyForm, status, client_id: clientId || "", project_id: projectId || "" }); setModal({ mode: "create" }); setError("") }
  const openEdit = (t: TaskItem) => {
    setForm({
      title: t.title,
      description: t.description || "",
      client_id: t.client_id,
      sub_client_id: t.sub_client_id || "",
      project_id: t.project_id || "",
      assignee_va_id: t.assignee_va_id || "",
      status: t.status,
      priority: t.priority,
      start_date: t.start_date || "",
      due_date: t.due_date || "",
      estimated_hours: t.estimated_hours || "",
      tags: (t.tags || []).join(", "),
      recurrence: (t.recurrence || "none") as TaskRecurrence,
      recurrence_interval: String(t.recurrence_interval || 1),
      recurrence_unit: t.recurrence_unit || "week",
      recurrence_weekdays: t.recurrence_weekdays?.length ? t.recurrence_weekdays : [0, 1, 2, 3, 4],
      recurrence_until: t.recurrence_until || "",
    })
    setModal({ mode: "edit", task: t })
    setError("")
  }
  const toggleWeekday = (day: number) => {
    setForm((prev) => {
      const has = prev.recurrence_weekdays.includes(day)
      const next = has ? prev.recurrence_weekdays.filter((d) => d !== day) : [...prev.recurrence_weekdays, day].sort()
      return { ...prev, recurrence_weekdays: next }
    })
  }
  const filteredProjects = projects.filter(p => !form.client_id || p.client_id === form.client_id)

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">{isAdmin ? "Task Board — All Tasks" : isAuditor ? "Task Board — Auditor View (view & comment)" : "Task Board — My Tasks"}</h1>
          <p className="text-xs text-muted-foreground">Manage work per client & project · Kanban, list, or timeline by week / bi-week / month</p>
        </div>
        <div className="flex gap-2">
          <Link to={user?.role === "va" ? "/va/projects" : "/admin/projects"} className="text-xs underline text-primary self-center">Projects →</Link>
          {!isAuditor && <Button variant="gold" size="sm" onClick={() => openCreate()}><Plus className="h-3.5 w-3.5" /> New Task</Button>}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[{ label: "Total", v: stats.total }, { label: "In Progress", v: stats.by_status.in_progress || 0 }, { label: "Due Today", v: stats.due_today }, { label: "Overdue", v: stats.overdue }, { label: "Done", v: stats.by_status.done || 0 }].map(s => (
            <div key={s.label} className={cn("rounded-xl border bg-card px-3 py-2", s.label === "Overdue" && stats.overdue > 0 && "border-red-300 bg-red-50")}>
              <div className="text-lg font-bold leading-none">{s.v}</div><div className="mt-1 text-[11px] text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <Card><CardContent className="space-y-3 p-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[180px] flex-1"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input className="pl-8" placeholder="Search tasks…" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <Select value={clientId} onChange={e => { setClientId(e.target.value); setProjectId("") }} className="w-auto"><option value="">All Clients</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select value={projectId} onChange={e => setProjectId(e.target.value)} className="w-auto"><option value="">All Projects</option>{projects.filter(p => !clientId || p.client_id === clientId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          {isAdmin && <Select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className="w-auto"><option value="">All Assignees</option>{vas.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>}
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-auto"><option value="">Any Status</option>{TASK_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
          <Select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} className="w-auto"><option value="">Any Priority</option>{Object.entries(PRIORITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={showOverdueOnly} onChange={e => setShowOverdueOnly(e.target.checked)} /> Overdue only</label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            {([["board", Columns3, "Board"], ["list", List, "List"], ["timeline", CalendarDays, "Timeline"]] as const).map(([m, Icon, label]) => (
              <button key={m} onClick={() => setView(m)} className={cn("flex items-center gap-1 rounded-md px-2.5 py-1 text-xs", view === m ? "bg-primary text-white" : "text-muted-foreground")}><Icon className="h-3.5 w-3.5" />{label}</button>
            ))}
          </div>
          {view === "timeline" && <Select value={cadence} onChange={e => setCadence(e.target.value as Cadence)} className="w-auto"><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option></Select>}
          <span className="text-[11px] text-muted-foreground">{tasks.length} task(s)</span>
          {error && <span className="text-[11px] text-red-600">{error}</span>}
        </div>
      </CardContent></Card>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading tasks…</p> : view === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {TASK_STATUSES.map(col => {
            const colTasks = tasks.filter(t => t.status === col.id)
            return (
              <div key={col.id} className="board-scroll w-[272px] shrink-0 overflow-hidden rounded-2xl border bg-card/70 shadow-sm backdrop-blur" onDragOver={e => e.preventDefault()} onDrop={() => { if (dragId) move.mutate({ id: dragId, status: col.id }); setDragId(null) }}>
                <div className="h-1.5" style={{ background: col.color }} />
                <div className="flex items-center justify-between px-3 py-2.5"><span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide"><span className="h-2.5 w-2.5 rounded-full" style={{ background: col.color }} />{col.label}</span><span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: col.color }}>{colTasks.length}</span></div>
                <div className="space-y-2 px-2 pb-2">
                  {colTasks.map(t => <TaskCard key={t.id} t={t} onComments={() => setCommentTask(t)} draggable onDragStart={() => setDragId(t.id)} />)}
                  {!isAuditor && <button onClick={() => openCreate(col.id)} className="w-full rounded-lg border border-dashed py-2 text-xs text-muted-foreground hover:bg-white">+ Add task</button>}
                </div>
              </div>
            )
          })}
        </div>
      ) : view === "list" ? (
        <Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-xs">
          <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-3">Task</th><th className="p-3">Client / Project</th><th className="p-3">Assignee</th><th className="p-3">Status</th><th className="p-3">Priority</th><th className="p-3">Deadline</th><th className="p-3">Repeat</th><th className="p-3">Hours</th><th className="p-3"></th></tr></thead>
          <tbody>{tasks.map(t => (
            <tr key={t.id} className="border-b hover:bg-muted/20">
              <td className="p-3"><button className="font-medium hover:underline text-left" onClick={() => setCommentTask(t)} title="Open task detail">{t.title}</button>{isOverdue(t) && <span className="ml-2 text-red-600 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />overdue</span>}</td>
              <td className="p-3">{t.client_name}{t.project_name ? <span className="text-muted-foreground"> · {t.project_name}</span> : null}</td>
              <td className="p-3">{t.assignee_name || <span className="text-amber-600">Unassigned</span>}</td>
              <td className="p-3"><Select value={t.status} onChange={e => move.mutate({ id: t.id, status: e.target.value as TaskStatus })} className="h-7 w-auto text-[11px]">{TASK_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></td>
              <td className="p-3"><span className={cn("rounded-full px-2 py-0.5", PRIORITY_META[t.priority].className)}>{PRIORITY_META[t.priority].label}</span></td>
              <td className="p-3">{t.due_date ? formatDate(t.due_date) : "—"}</td>
              <td className="p-3">{t.recurrence_label || "—"}</td>
              <td className="p-3">{t.logged_hours} / {t.estimated_hours || "—"}</td>
              <td className="p-3 whitespace-nowrap"><Button size="sm" variant="outline" onClick={() => setCommentTask(t)}>Comments</Button>{isAdmin && <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete this task?")) remove.mutate(t.id) }}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>}</td>
            </tr>
          ))}{tasks.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No tasks match. Create one to get started.</td></tr>}</tbody>
        </table></CardContent></Card>
      ) : (
        <div className="space-y-4">
          {groupByPeriod(tasks, cadence).map(([period, items]) => (
            <div key={period}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-primary" />{period} <span className="text-xs font-normal text-muted-foreground">({items.length})</span></h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{items.map(t => <TaskCard key={t.id} t={t} onComments={() => setCommentTask(t)} />)}</div>
            </div>
          ))}
          {tasks.length === 0 && <p className="text-sm text-muted-foreground">No tasks in this view.</p>}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{modal.mode === "edit" ? "Edit Task" : "New Task"}</h2><button onClick={() => setModal(null)}><X className="h-4 w-4" /></button></div>
            <div className="space-y-3">
              <div><Label>Title *</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="What needs to be done?" /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Details, links, notes…" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Client *</Label><Select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value, project_id: "" })}><option value="">Select client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
                <div><Label>Project</Label><Select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}><option value="">No project</option>{filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
                {isAdmin && <div><Label>Assignee</Label><Select value={form.assignee_va_id} onChange={e => setForm({ ...form, assignee_va_id: e.target.value })}><option value="">Unassigned</option>{vas.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></div>}
                <div><Label>Status</Label><Select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as TaskStatus })}>{TASK_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></div>
                <div><Label>Priority</Label><Select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as TaskPriority })}>{Object.entries(PRIORITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></div>
                <div><Label>Est. hours</Label><Input type="number" step="0.5" value={form.estimated_hours} onChange={e => setForm({ ...form, estimated_hours: e.target.value })} /></div>
                <div><Label>Start date</Label><Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
                <div><Label>Deadline</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
              </div>
              <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold"><Repeat className="h-3.5 w-3.5 text-primary" /> Repeating task</div>
                <div><Label>Repeat</Label>
                  <Select value={form.recurrence} onChange={e => setForm({ ...form, recurrence: e.target.value as TaskRecurrence })}>
                    {RECURRENCE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </Select>
                </div>
                {form.recurrence === "custom" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><Label>Every</Label><Input type="number" min={1} max={365} value={form.recurrence_interval} onChange={e => setForm({ ...form, recurrence_interval: e.target.value })} /></div>
                    <div><Label>Unit</Label>
                      <Select value={form.recurrence_unit} onChange={e => setForm({ ...form, recurrence_unit: e.target.value })}>
                        <option value="day">Day(s)</option>
                        <option value="week">Week(s)</option>
                        <option value="month">Month(s)</option>
                        <option value="year">Year(s)</option>
                      </Select>
                    </div>
                    {form.recurrence_unit === "week" && (
                      <div className="sm:col-span-2">
                        <Label>On days</Label>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {WEEKDAY_OPTIONS.map(d => (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => toggleWeekday(d.id)}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                                form.recurrence_weekdays.includes(d.id) ? "border-primary bg-primary text-white" : "bg-card text-muted-foreground",
                              )}
                            >{d.label}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {form.recurrence !== "none" && (
                  <div>
                    <Label>Repeat until (optional)</Label>
                    <Input type="date" value={form.recurrence_until} onChange={e => setForm({ ...form, recurrence_until: e.target.value })} />
                    <p className="mt-1 text-[11px] text-muted-foreground">When marked Done, the next occurrence is created automatically with the next deadline.</p>
                  </div>
                )}
              </div>
              <div><Label>Tags (comma separated)</Label><Input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="design, urgent-client" /></div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="gold"
                  className="flex-1"
                  disabled={
                    !form.title || !form.client_id || save.isPending
                    || (form.recurrence === "custom" && form.recurrence_unit === "week" && form.recurrence_weekdays.length === 0)
                  }
                  onClick={() => save.mutate()}
                >{save.isPending ? "Saving…" : modal.mode === "edit" ? "Save changes" : "Create task"}</Button>
                {modal.mode === "edit" && isAdmin && <Button variant="outline" onClick={() => { if (confirm("Delete this task?")) { remove.mutate(modal.task!.id); setModal(null) } }}>Delete</Button>}
              </div>
              {user?.role === "va" && <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Timer className="h-3 w-3" /> Tip: clock in on this task from Time Clock to auto-log your hours.</p>}
            </div>
          </div>
        </div>
      )}

      {commentTask && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setCommentTask(null)}>
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-1 flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Task View</div>
                <h2 className="text-base font-semibold leading-snug">{commentTask.title}</h2>
              </div>
              <span className="flex gap-1">
                {!isAuditor && <Button size="sm" variant="outline" onClick={() => openEdit(commentTask)}><Pencil className="h-3 w-3" /> Edit Task</Button>}
                <button onClick={() => setCommentTask(null)} className="p-1"><X className="h-4 w-4" /></button>
              </span>
            </div>
            {commentTask.description && <p className="mb-2 whitespace-pre-wrap text-xs text-muted-foreground">{commentTask.description}</p>}
            <div className="mb-4 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
              {[[ "Client / Project", `${commentTask.client_name || ""}${commentTask.project_name ? " · " + commentTask.project_name : ""}`],
                 ["Assignee", commentTask.assignee_name || "Unassigned"],
                 ["Status / Priority", `${commentTask.status.replace("_", " ")} · ${commentTask.priority}`],
                 ["Deadline", commentTask.due_date ? formatDate(commentTask.due_date) : "No deadline"],
                 ["Repeat", commentTask.recurrence_label || "Does not repeat"],
                 ["Hours", `${commentTask.logged_hours}/${commentTask.estimated_hours || "—"}h`]
              ].map(([k, v]) => <div key={k} className="rounded-lg border bg-muted/20 p-2"><div className="text-muted-foreground">{k}</div><div className="mt-0.5 font-medium capitalize">{v}</div></div>)}
            </div>
            <div className="mb-4"><DetailAttachments scope="task" scopeId={commentTask.id} /></div>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="h-4 w-4 text-primary" /> Comments & Updates</h3>
            <p className="mb-2 text-[11px] text-muted-foreground">Admin, Auditors and Users can comment here — tag teammates with @, react with emoji, attach images (auto-AVIF into the bucket) and draw on them.</p>
            <CommentThread scope="task" scopeId={commentTask.id} scopeTitle={commentTask.title} />
          </div>
        </div>
      )}
    </div>
  )
}

function TaskCard({ t, onComments, draggable, onDragStart }: { t: TaskItem; onComments: () => void; draggable?: boolean; onDragStart?: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => {
        e.stopPropagation()
        onDragStart?.()
      }}
      onClick={onComments}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onComments()
        }
      }}
      title="Open task — comments, files, reactions & mentions"
      className="monday-card cursor-pointer rounded-xl border bg-card p-3 shadow-sm transition hover:border-primary/40 hover:shadow-md active:cursor-grabbing"
      style={{ borderLeft: `4px solid ${t.project_color || "var(--primary)"}` }}
    >
      <span className="text-left w-full"><span className="text-xs font-semibold leading-snug">{t.title}</span></span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", PRIORITY_META[t.priority].className)}>{PRIORITY_META[t.priority].label}</span>
        {t.recurrence_label && <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700"><Repeat className="h-2.5 w-2.5" />{t.recurrence_label}</span>}
        {isOverdue(t) && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">Overdue</span>}
        {isDueToday(t) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Due today</span>}
        {(t.tags || []).map(tag => <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">#{tag}</span>)}
      </div>
      <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        <div>{t.client_name}{t.project_name ? ` · ${t.project_name}` : ""}</div>
        <div className="flex justify-between"><span>{t.assignee_name || "Unassigned"}</span><span>{t.due_date ? formatDate(t.due_date) : "No deadline"}</span></div>
        <div className="flex justify-between"><span>{t.logged_hours}h logged{t.estimated_hours ? ` / ${t.estimated_hours}h est` : ""}</span><span className="font-semibold text-primary underline">Open · Comments</span></div>
      </div>
      {t.estimated_hours && Number(t.estimated_hours) > 0 && <div className="mt-2 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.min(100, (Number(t.logged_hours) / Number(t.estimated_hours)) * 100)}%` }} /></div>}
    </div>
  )
}
