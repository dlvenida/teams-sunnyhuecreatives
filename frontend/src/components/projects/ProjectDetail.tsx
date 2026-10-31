import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { Project, ProjectMeetup, TaskItem, TeamMember } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Textarea } from "@/components/ui/input"
import { CommentThread } from "@/components/comments/CommentThread"
import { DetailAttachments } from "@/components/comments/DetailAttachments"
import { formatDate } from "@/lib/utils"
import { CalendarPlus, FolderKanban, ListTodo, MessagesSquare, Trash2, Video, X } from "lucide-react"
import { Link } from "react-router-dom"

type Tab = "tasks" | "details" | "discussion" | "meetups"
const TABS: { id: Tab; label: string; icon: typeof ListTodo }[] = [
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "details", label: "Project Details", icon: FolderKanban },
  { id: "discussion", label: "Discussion", icon: MessagesSquare },
  { id: "meetups", label: "Meet-ups", icon: Video },
]

export function ProjectDetail({
  project,
  onClose,
  initialTab,
  highlightCommentId,
}: {
  project: Project
  onClose: () => void
  initialTab?: Tab
  highlightCommentId?: string | null
}) {
  const qc = useQueryClient()
  const user = getAuthUser()
  const prefix = user?.role === "va" ? "/va" : "/admin"
  const [tab, setTab] = useState<Tab>(initialTab || (highlightCommentId ? "discussion" : "tasks"))
  const pct = project.task_total ? Math.round((project.task_done / project.task_total) * 100) : 0

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({ queryKey: ["tasks", "project", project.id], queryFn: () => apiFetch<TaskItem[]>(`/tasks?project_id=${project.id}`), enabled: tab === "tasks" })
  const { data: meetups = [] } = useQuery({ queryKey: ["meetups", project.id], queryFn: () => apiFetch<ProjectMeetup[]>(`/projects/${project.id}/meetups`), enabled: tab === "meetups" })
  const { data: team = [] } = useQuery({ queryKey: ["team"], queryFn: () => apiFetch<TeamMember[]>("/team"), enabled: tab === "meetups" })

  const [form, setForm] = useState({ title: "", notes: "", starts_at: "", ends_at: "", location: "", attendee_ids: [] as string[] })
  const createMeetup = useMutation({
    mutationFn: () => apiFetch(`/projects/${project.id}/meetups`, { method: "POST", body: JSON.stringify({
      title: form.title, notes: form.notes || null,
      starts_at: new Date(form.starts_at).toISOString(), ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      location: form.location || null,
      attendees: team.filter(t => form.attendee_ids.includes(t.user_id)).map(t => ({ user_id: t.user_id, name: t.name })),
    }) }),
    onSuccess: () => { setForm({ title: "", notes: "", starts_at: "", ends_at: "", location: "", attendee_ids: [] }); qc.invalidateQueries({ queryKey: ["meetups", project.id] }) },
  })
  const deleteMeetup = useMutation({ mutationFn: (id: string) => apiFetch(`/projects/${project.id}/meetups/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["meetups", project.id] }) })

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-card shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="h-1.5" style={{ background: project.color }} />
        <div className="p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Project · {project.client_name}</div>
              <h2 className="text-base font-semibold">{project.name}</h2>
              <p className="text-[11px] capitalize text-muted-foreground">{project.status.replace("_", " ")} · {project.cadence} · {project.task_done}/{project.task_total} tasks done ({pct}%) · {project.total_hours}h logged</p>
            </div>
            <button onClick={onClose} className="p-1"><X className="h-4 w-4" /></button>
          </div>

          <div className="mt-3 flex gap-1 overflow-x-auto rounded-xl border p-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === id ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"}`}>
                <Icon className="h-3.5 w-3.5" /> {label}
                {id === "tasks" && <span className="rounded-full bg-black/15 px-1.5 text-[10px]">{project.task_total}</span>}
                {id === "meetups" && meetups.length > 0 && <span className="rounded-full bg-black/15 px-1.5 text-[10px]">{meetups.length}</span>}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {tab === "tasks" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">Tasks in this project — click through to the board to open Task View, comment, attach and draw.</p>
                  <Link className="text-xs text-primary underline" to={`${prefix}/tasks?project=${project.id}`}>Open Task Board →</Link></div>
                {tasks.map(t => (
                  <div key={t.id} className="flex items-center gap-2 rounded-lg border p-2.5 text-xs">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: project.color }} />
                    <span className="min-w-0 flex-1"><span className="font-medium">{t.title}</span><span className="block text-[10px] text-muted-foreground">{t.assignee_name || "Unassigned"} · {t.logged_hours}h{t.estimated_hours ? ` / ${t.estimated_hours}h est` : ""}</span></span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize">{t.status.replace("_", " ")}</span>
                    <span className="text-[10px] text-muted-foreground">{t.due_date ? formatDate(t.due_date) : ""}</span>
                  </div>
                ))}
                {tasksLoading ? <p className="text-xs text-muted-foreground">Loading tasks…</p> : tasks.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No tasks yet in this project.</p>}
              </div>
            )}

            {tab === "details" && (
              <div className="space-y-3 text-xs">
                <div className="grid gap-2 sm:grid-cols-2">
                  {[["Client", project.client_name || "—"], ["Sub-client", project.sub_client_name || "—"], ["Status", project.status.replace("_", " ")],
                    ["Cadence", project.cadence], ["Start", project.start_date ? formatDate(project.start_date) : "—"], ["Due", project.due_date ? formatDate(project.due_date) : "—"],
                    ["Tasks", `${project.task_done} done · ${project.task_in_progress} in progress · ${project.task_total} total`], ["Hours logged", `${project.total_hours}h`]
                  ].map(([k, v]) => <div key={k} className="rounded-lg border bg-muted/20 p-2.5"><div className="text-muted-foreground">{k}</div><div className="mt-0.5 font-medium capitalize">{v}</div></div>)}
                </div>
                <div><div className="mb-1 flex justify-between text-[11px]"><span>Progress</span><span>{pct}%</span></div>
                  <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${pct}%`, background: project.color }} /></div></div>
                <div className="rounded-lg border p-3"><div className="mb-1 font-medium">Description</div>
                  <p className="whitespace-pre-wrap text-muted-foreground">{project.description || "No description yet — edit the project from the Projects list (Admin) to add scope, links and notes."}</p></div>
                <DetailAttachments scope="project" scopeId={project.id} />
              </div>
            )}

            {tab === "discussion" && (
              <div>
                <p className="mb-2 text-[11px] text-muted-foreground">Project-wide discussion for Admin, Project Managers, and VAs — tag teammates with @, react, attach images, and draw on them. For task-specific talk, open the task instead.</p>
                <CommentThread scope="project" scopeId={project.id} scopeTitle={project.name} highlightCommentId={highlightCommentId} />
              </div>
            )}

            {tab === "meetups" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  {meetups.map(m => {
                    const past = new Date(m.starts_at) < new Date()
                    return (
                      <div key={m.id} className={`rounded-lg border p-3 text-xs ${past ? "opacity-60" : ""}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div><span className="font-semibold">📅 {m.title}</span>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">{new Date(m.starts_at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{m.ends_at ? ` – ${new Date(m.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}{past ? " · done" : ""}</div></div>
                          <button onClick={() => { if (confirm("Delete this meet-up?")) deleteMeetup.mutate(m.id) }}><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                        </div>
                        {m.location && <div className="mt-1">📍 {m.location.startsWith("http") ? <a className="text-primary underline" href={m.location} target="_blank" rel="noreferrer">{m.location}</a> : m.location}</div>}
                        {m.notes && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{m.notes}</p>}
                        {m.attendees?.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{m.attendees.map(a => <span key={a.user_id} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">@{a.name}</span>)}</div>}
                        <div className="mt-1 text-[10px] text-muted-foreground">Created by {m.created_by_name} · attendees were notified</div>
                      </div>
                    )
                  })}
                  {meetups.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No meet-ups scheduled for this project yet.</p>}
                </div>

                <div className="rounded-xl border bg-muted/20 p-3">
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><CalendarPlus className="h-4 w-4 text-primary" /> Schedule a meet-up</h4>
                  <div className="space-y-2">
                    <div><Label>Title *</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Weekly sync — EmpowerHQ" /></div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div><Label>Starts *</Label><Input type="datetime-local" value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} /></div>
                      <div><Label>Ends</Label><Input type="datetime-local" value={form.ends_at} onChange={e => setForm({ ...form, ends_at: e.target.value })} /></div>
                    </div>
                    <div><Label>Location / meeting link</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Google Meet / Zoom link or room" /></div>
                    <div><Label>Attendees (tag the team)</Label>
                      <div className="flex flex-wrap gap-1.5">{team.map(t => {
                        const on = form.attendee_ids.includes(t.user_id)
                        return <button key={t.user_id} onClick={() => setForm({ ...form, attendee_ids: on ? form.attendee_ids.filter(x => x !== t.user_id) : [...form.attendee_ids, t.user_id] })}
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-primary bg-primary text-white" : "text-muted-foreground"}`}>@{t.name}</button>
                      })}</div></div>
                    <div><Label>Agenda / notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="What will you cover?" /></div>
                    {createMeetup.isError && <p className="text-[11px] text-red-600">{(createMeetup.error as Error).message}</p>}
                    <Button variant="gold" size="sm" disabled={!form.title || !form.starts_at || createMeetup.isPending} onClick={() => createMeetup.mutate()}>
                      {createMeetup.isPending ? "Scheduling…" : "Schedule meet-up & notify attendees"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
