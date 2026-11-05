import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearchParams } from "react-router-dom"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { Cadence, Client, Project, ProjectStatus } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { formatDate } from "@/lib/utils"
import { ProjectDetail } from "@/components/projects/ProjectDetail"
import { FolderKanban, Pencil, Plus, Search, Trash2, X, ChevronDown } from "lucide-react"

const empty = { name: "", client_id: "", description: "", color: "#ec4899", status: "active" as ProjectStatus, cadence: "weekly" as Cadence, start_date: "", due_date: "" }
const CADENCE_LABEL: Record<Cadence, string> = { weekly: "Weekly", biweekly: "Bi-weekly", monthly: "Monthly" }
const COLLAPSE_KEY = "shc.projectSections.collapsed"

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export function ProjectsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const user = getAuthUser()
  const isAdmin = user?.role === "admin"
  const isAuditor = user?.role === "auditor"
  const isVA = user?.role === "va"
  const isStaff = isAdmin || isAuditor
  const canCreate = isStaff
  const canManage = isStaff
  const deepProjectId = searchParams.get("project")
  const deepCommentId = searchParams.get("comment")
  const [search, setSearch] = useState("")
  const [clientId, setClientId] = useState("")
  const [statusF, setStatusF] = useState("")
  const [modal, setModal] = useState<null | { mode: "create" | "edit"; project?: Project }>(null)
  const [detail, setDetail] = useState<Project | null>(null)
  const [highlightCommentId, setHighlightCommentId] = useState<string | null>(null)
  const [form, setForm] = useState(empty)
  const [error, setError] = useState("")
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed)

  const qs = `${clientId ? `&client_id=${clientId}` : ""}`
  const { data: projects = [], isLoading } = useQuery({ queryKey: ["projects", clientId], queryFn: () => apiFetch<Project[]>(`/projects?include_archived=true${qs}`) })
  const clientsKey = isVA ? "va-clients" : "clients"
  const clientsPath = isVA ? "/va/clients" : "/clients?active_only=true"
  const { data: clients = [] } = useQuery({ queryKey: [clientsKey], queryFn: () => apiFetch<Client[]>(clientsPath) })
  // canManage already includes auditor — advanced fields shown for staff

  useEffect(() => {
    if (!deepProjectId || !projects.length) return
    const p = projects.find((x) => x.id === deepProjectId)
    if (!p) return
    setDetail(p)
    setHighlightCommentId(deepCommentId)
    const base = user?.role === "va" ? "/va/projects" : "/admin/projects"
    navigate(base, { replace: true })
  }, [deepProjectId, deepCommentId, projects, navigate, user?.role])

  const needle = search.trim().toLowerCase()
  const filtered = projects.filter((p) => {
    if (statusF && p.status !== statusF) return false
    if (!needle) return true
    return p.name.toLowerCase().includes(needle) || (p.client_name || "").toLowerCase().includes(needle)
  })
  const groups = Object.values(
    filtered.reduce<Record<string, { client_id: string; client_name: string; projects: Project[] }>>((acc, project) => {
      const key = project.client_id
      const bucket = acc[key] ?? { client_id: key, client_name: project.client_name || "Client", projects: [] }
      bucket.projects.push(project)
      acc[key] = bucket
      return acc
    }, {}),
  )
    .map((group) => ({
      ...group,
      projects: group.projects.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.client_name.localeCompare(b.client_name))

  const toggleSection = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      return next
    })
  }
  const invalidate = () => qc.invalidateQueries({ queryKey: ["projects"] })
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, client_id: form.client_id, description: form.description || null, color: form.color, status: form.status, cadence: form.cadence, start_date: form.start_date || null, due_date: form.due_date || null }
      return modal?.mode === "edit" ? apiFetch(`/projects/${modal.project!.id}`, { method: "PATCH", body: JSON.stringify(body) }) : apiFetch("/projects", { method: "POST", body: JSON.stringify(body) })
    },
    onSuccess: () => { invalidate(); setModal(null) }, onError: (e: Error) => setError(e.message),
  })
  const remove = useMutation({ mutationFn: (id: string) => apiFetch(`/projects/${id}`, { method: "DELETE" }), onSuccess: invalidate })

  const openEdit = (p: Project) => { setForm({ name: p.name, client_id: p.client_id, description: p.description || "", color: p.color, status: p.status, cadence: p.cadence, start_date: p.start_date || "", due_date: p.due_date || "" }); setModal({ mode: "edit", project: p }); setError("") }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Projects</h1>
          <p className="text-xs text-muted-foreground">
            {isVA
              ? "Clients you are assigned to, with their projects underneath."
              : "Grouped by client. Open a section to see its projects."}
          </p>
        </div>
        {canCreate && <Button variant="gold" size="sm" onClick={() => { setForm(empty); setModal({ mode: "create" }); setError("") }}><Plus className="h-3.5 w-3.5" /> New Project</Button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[180px] flex-1"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input className="pl-8" placeholder="Search projects…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <Select value={clientId} onChange={e => setClientId(e.target.value)} className="w-auto"><option value="">All Clients</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select value={statusF} onChange={e => setStatusF(e.target.value)} className="w-auto"><option value="">Any Status</option><option value="active">Active</option><option value="on_hold">On Hold</option><option value="completed">Completed</option><option value="archived">Archived</option></Select>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="space-y-3">
          {groups.map((group) => {
            const searching = needle.length > 0
            const open = searching || !collapsed[group.client_id]
            return (
              <section key={group.client_id} className="overflow-hidden rounded-2xl border bg-card">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  aria-expanded={open}
                  onClick={() => toggleSection(group.client_id)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{group.client_name}</span>
                    <span className="text-[11px] text-muted-foreground">{group.projects.length} project{group.projects.length === 1 ? "" : "s"}</span>
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <div className="grid gap-3 border-t p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {group.projects.map(p => {
                      const pct = p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0
                      return (
                        <Card key={p.id} className="overflow-hidden">
                          <div className="h-1.5" style={{ background: p.color }} />
                          <CardContent className="space-y-2 p-4">
                            <div className="flex items-start justify-between gap-2">
                              <button className="text-left" onClick={() => setDetail(p)} title="Open project"><span className="flex items-center gap-1.5 text-sm font-semibold hover:underline"><FolderKanban className="h-4 w-4" style={{ color: p.color }} />{p.name}</span></button>
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize">{p.status.replace("_", " ")}</span>
                            </div>
                            {p.description && <p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
                            <div className="text-[11px] text-muted-foreground">{CADENCE_LABEL[p.cadence]} · {p.due_date ? `Due ${formatDate(p.due_date)}` : "No due date"}</div>
                            <div><div className="flex justify-between text-[11px]"><span>{p.task_done}/{p.task_total} done · {p.task_in_progress} in progress</span><span>{pct}%</span></div><div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${pct}%`, background: p.color }} /></div></div>
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-[11px] text-muted-foreground">{p.total_hours}h logged</span>
                              <span className="flex items-center gap-2">
                                <button className="text-xs text-primary underline" onClick={() => setDetail(p)}>Open</button>
                                {canManage && <button title="Edit project" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></button>}
                                {canManage && <button onClick={() => { if (confirm("Delete project? Tasks will be kept unlinked.")) remove.mutate(p.id) }}><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
          {groups.length === 0 && <p className="text-sm text-muted-foreground">No projects yet.{canCreate ? " Create one to group tasks per client." : ""}</p>}
        </div>
      )}
      {detail && (
        <ProjectDetail
          project={detail}
          highlightCommentId={highlightCommentId}
          initialTab={highlightCommentId ? "discussion" : undefined}
          onClose={() => { setDetail(null); setHighlightCommentId(null) }}
        />
      )}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{modal.mode === "edit" ? "Edit Project" : "New Project"}</h2><button onClick={() => setModal(null)}><X className="h-4 w-4" /></button></div>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Q4 Social Content" /></div>
              <div><Label>Client *</Label><Select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}><option value="">Select client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
              <div><Label>Short description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What this project covers…" /></div>
              {canManage && (
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Cadence</Label><Select value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value as Cadence })}><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option></Select></div>
                  <div><Label>Status</Label><Select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as ProjectStatus })}><option value="active">Active</option><option value="on_hold">On Hold</option><option value="completed">Completed</option><option value="archived">Archived</option></Select></div>
                  <div><Label>Start</Label><Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
                  <div><Label>Due</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
                  <div><Label>Color</Label><Input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="h-9 p-1" /></div>
                </div>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
              <Button variant="gold" className="w-full" disabled={!form.name || !form.client_id || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save project"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
