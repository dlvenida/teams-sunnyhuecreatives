import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { Cadence, Client, Project, ProjectStatus } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { formatDate } from "@/lib/utils"
import { ProjectDetail } from "@/components/projects/ProjectDetail"
import { FolderKanban, Pencil, Plus, Search, Trash2, X } from "lucide-react"

const empty = { name: "", client_id: "", description: "", color: "#ec4899", status: "active" as ProjectStatus, cadence: "weekly" as Cadence, start_date: "", due_date: "" }
const CADENCE_LABEL: Record<Cadence, string> = { weekly: "Weekly", biweekly: "Bi-weekly", monthly: "Monthly" }

export function ProjectsPage() {
  const qc = useQueryClient()
  const isAdmin = getAuthUser()?.role === "admin"
  const [search, setSearch] = useState("")
  const [clientId, setClientId] = useState("")
  const [statusF, setStatusF] = useState("")
  const [modal, setModal] = useState<null | { mode: "create" | "edit"; project?: Project }>(null)
  const [detail, setDetail] = useState<Project | null>(null)
  const [form, setForm] = useState(empty)
  const [error, setError] = useState("")

  const qs = `${clientId ? `&client_id=${clientId}` : ""}`
  const { data: projects = [], isLoading } = useQuery({ queryKey: ["projects", clientId], queryFn: () => apiFetch<Project[]>(`/projects?include_archived=true${qs}`) })
  const { data: clients = [] } = useQuery({ queryKey: [isAdmin ? "clients" : "va-clients"], queryFn: () => apiFetch<Client[]>(isAdmin ? "/clients?active_only=true" : "/va/clients") })

  const filtered = projects.filter(p => (!search || p.name.toLowerCase().includes(search.toLowerCase())) && (!statusF || p.status === statusF))
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
        <div><h1 className="text-base font-semibold tracking-tight">Projects</h1><p className="text-xs text-muted-foreground">One board per client project · cadence sets the reporting rhythm</p></div>
        {isAdmin && <Button variant="gold" size="sm" onClick={() => { setForm(empty); setModal({ mode: "create" }); setError("") }}><Plus className="h-3.5 w-3.5" /> New Project</Button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[180px] flex-1"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input className="pl-8" placeholder="Search projects…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <Select value={clientId} onChange={e => setClientId(e.target.value)} className="w-auto"><option value="">All Clients</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select value={statusF} onChange={e => setStatusF(e.target.value)} className="w-auto"><option value="">Any Status</option><option value="active">Active</option><option value="on_hold">On Hold</option><option value="completed">Completed</option><option value="archived">Archived</option></Select>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(p => {
            const pct = p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0
            return (
              <Card key={p.id} className="overflow-hidden">
                <div className="h-1.5" style={{ background: p.color }} />
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <button className="text-left" onClick={() => setDetail(p)} title="Open project — Tasks, Details, Discussion, Meet-ups"><span className="flex items-center gap-1.5 text-sm font-semibold hover:underline"><FolderKanban className="h-4 w-4" style={{ color: p.color }} />{p.name}</span></button>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize">{p.status.replace("_", " ")}</span>
                  </div>
                  {p.description && <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>}
                  <div className="text-[11px] text-muted-foreground">{p.client_name} · {CADENCE_LABEL[p.cadence]} · {p.due_date ? `Due ${formatDate(p.due_date)}` : "No due date"}</div>
                  <div><div className="flex justify-between text-[11px]"><span>{p.task_done}/{p.task_total} done · {p.task_in_progress} in progress</span><span>{pct}%</span></div><div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${pct}%`, background: p.color }} /></div></div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-muted-foreground">{p.total_hours}h logged</span>
                    <span className="flex items-center gap-2">
                      <button className="text-xs text-primary underline" onClick={() => setDetail(p)}>Tasks · Discussion · Meet-ups →</button>
                      {isAdmin && <button title="Edit project" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></button>}
                      {isAdmin && <button onClick={() => { if (confirm("Delete project? Tasks will be kept unlinked.")) remove.mutate(p.id) }}><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {filtered.length === 0 && <p className="text-sm text-muted-foreground">No projects yet.{isAdmin ? " Create one to group tasks per client." : ""}</p>}
        </div>
      )}
      {detail && <ProjectDetail project={detail} onClose={() => setDetail(null)} />}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{modal.mode === "edit" ? "Edit Project" : "New Project"}</h2><button onClick={() => setModal(null)}><X className="h-4 w-4" /></button></div>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Client *</Label><Select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}><option value="">Select client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Cadence</Label><Select value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value as Cadence })}><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option></Select></div>
                <div><Label>Status</Label><Select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as ProjectStatus })}><option value="active">Active</option><option value="on_hold">On Hold</option><option value="completed">Completed</option><option value="archived">Archived</option></Select></div>
                <div><Label>Start</Label><Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
                <div><Label>Due</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
                <div><Label>Color</Label><Input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="h-9 p-1" /></div>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <Button variant="gold" className="w-full" disabled={!form.name || !form.client_id || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save project"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
