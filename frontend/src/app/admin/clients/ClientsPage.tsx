import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { Client, ClientDetail, SubClient } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import { TASK_STATUSES, PRIORITY_META } from "@/components/tasks/task-utils"
import {
  Archive,
  ArchiveRestore,
  Building2,
  Eye,
  Layers,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { useDisplaySettings } from "@/hooks/useDisplaySettings"

type Tab = "clients" | "sub-clients"
type StatusFilter = "all" | "active" | "archived"

interface ClientForm {
  name: string
  billing_type: "hourly" | "fixed"
  default_rate: string
}

interface SubClientForm {
  client_id: string
  name: string
}

const emptyClient: ClientForm = { name: "", billing_type: "hourly", default_rate: "" }
const emptySub: SubClientForm = { client_id: "", name: "" }

export function ClientsPage() {
  const readOnly = getAuthUser()?.role === "auditor"
  const qc = useQueryClient()
  const { showPricing } = useDisplaySettings()
  const [tab, setTab] = useState<Tab>("clients")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active")
  const [modal, setModal] = useState<"create" | "edit" | null>(null)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [editingSub, setEditingSub] = useState<SubClient | null>(null)
  const [viewingId, setViewingId] = useState<string>("")
  const [detailTab, setDetailTab] = useState<"overview" | "projects" | "tasks" | "logs" | "invoices">("overview")
  const [clientForm, setClientForm] = useState<ClientForm>(emptyClient)
  const [subForm, setSubForm] = useState<SubClientForm>(emptySub)
  const [error, setError] = useState("")

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => apiFetch<Client[]>("/clients"),
  })
  const { data: subClients = [] } = useQuery({
    queryKey: ["sub-clients"],
    queryFn: () => apiFetch<SubClient[]>("/clients/sub-clients"),
  })
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["client-detail", viewingId],
    queryFn: () => apiFetch<ClientDetail>(`/clients/${viewingId}/detail`),
    enabled: !!viewingId,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["clients"] })
    qc.invalidateQueries({ queryKey: ["sub-clients"] })
  }

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.name])),
    [clients],
  )

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clients.filter((c) => {
      if (statusFilter === "active" && !c.is_active) return false
      if (statusFilter === "archived" && c.is_active) return false
      if (!q) return true
      return c.name.toLowerCase().includes(q) || c.billing_type.includes(q)
    })
  }, [clients, search, statusFilter])

  const filteredSubs = useMemo(() => {
    const q = search.trim().toLowerCase()
    return subClients.filter((s) => {
      if (statusFilter === "active" && !s.is_active) return false
      if (statusFilter === "archived" && s.is_active) return false
      if (!q) return true
      const parent = clientMap[s.client_id]?.toLowerCase() || ""
      return s.name.toLowerCase().includes(q) || parent.includes(q)
    })
  }, [subClients, search, statusFilter, clientMap])

  const createClient = useMutation({
    mutationFn: () =>
      apiFetch("/clients", {
        method: "POST",
        body: JSON.stringify({
          name: clientForm.name,
          billing_type: clientForm.billing_type,
          default_rate: clientForm.default_rate ? parseFloat(clientForm.default_rate) : null,
        }),
      }),
    onSuccess: () => {
      invalidate()
      closeModal()
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateClient = useMutation({
    mutationFn: (data: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/clients/${data.id}`, { method: "PATCH", body: JSON.stringify(data.body) }),
    onSuccess: () => {
      invalidate()
      closeModal()
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteClient = useMutation({
    mutationFn: (id: string) => apiFetch(`/clients/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (err: Error) => alert(err.message),
  })

  const createSub = useMutation({
    mutationFn: () =>
      apiFetch("/clients/sub-clients", { method: "POST", body: JSON.stringify(subForm) }),
    onSuccess: () => {
      invalidate()
      closeModal()
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateSub = useMutation({
    mutationFn: (data: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/clients/sub-clients/${data.id}`, { method: "PATCH", body: JSON.stringify(data.body) }),
    onSuccess: () => {
      invalidate()
      closeModal()
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteSub = useMutation({
    mutationFn: (id: string) => apiFetch(`/clients/sub-clients/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (err: Error) => alert(err.message),
  })

  const closeModal = () => {
    setModal(null)
    setEditingClient(null)
    setEditingSub(null)
    setClientForm(emptyClient)
    setSubForm(emptySub)
    setError("")
  }

  const openCreate = () => {
    setError("")
    setModal("create")
    if (tab === "clients") setClientForm(emptyClient)
    else setSubForm(emptySub)
  }

  const openEditClient = (client: Client) => {
    setError("")
    setEditingClient(client)
    setClientForm({
      name: client.name,
      billing_type: client.billing_type,
      default_rate: client.default_rate || "",
    })
    setModal("edit")
  }

  const openEditSub = (sub: SubClient) => {
    setError("")
    setEditingSub(sub)
    setSubForm({ client_id: sub.client_id, name: sub.name })
    setModal("edit")
  }

  const saveClient = () => {
    const body = {
      name: clientForm.name,
      billing_type: clientForm.billing_type,
      default_rate: clientForm.default_rate ? parseFloat(clientForm.default_rate) : null,
    }
    if (modal === "edit" && editingClient) {
      updateClient.mutate({ id: editingClient.id, body })
    } else {
      createClient.mutate()
    }
  }

  const saveSub = () => {
    if (modal === "edit" && editingSub) {
      updateSub.mutate({ id: editingSub.id, body: { ...subForm } })
    } else {
      createSub.mutate()
    }
  }

  const archiveClient = (client: Client) =>
    updateClient.mutate({ id: client.id, body: { is_active: false } })

  const restoreClient = (client: Client) =>
    updateClient.mutate({ id: client.id, body: { is_active: true } })

  const archiveSub = (sub: SubClient) =>
    updateSub.mutate({ id: sub.id, body: { is_active: false } })

  const restoreSub = (sub: SubClient) =>
    updateSub.mutate({ id: sub.id, body: { is_active: true } })

  const activeClients = clients.filter((c) => c.is_active)

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-base font-semibold">Clients</h1>
        {!readOnly && <Button variant="gold" size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          {tab === "clients" ? "New Client" : "New Sub-client"}
        </Button>}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        <button
          type="button"
          onClick={() => { setTab("clients"); setSearch("") }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            tab === "clients" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          <Building2 className="h-3.5 w-3.5" /> Clients
        </button>
        <button
          type="button"
          onClick={() => { setTab("sub-clients"); setSearch("") }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            tab === "sub-clients" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          <Layers className="h-3.5 w-3.5" /> Sub-clients
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={tab === "clients" ? "Search clients..." : "Search sub-clients..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="w-36"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </Select>
      </div>

      {tab === "clients" ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Billing</th>
                {showPricing && <th className="p-3 font-medium">Default Rate</th>}
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={showPricing ? 5 : 4} className="p-6 text-center text-muted-foreground">
                    No clients found
                  </td>
                </tr>
              ) : (
                filteredClients.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-b last:border-0 hover:bg-primary/[0.04]" onClick={() => { setViewingId(c.id); setDetailTab("overview") }}>
                    <td className="p-3 font-semibold text-primary">{c.name}</td>
                    <td className="p-3 capitalize">{c.billing_type}</td>
                    {showPricing && <td className="p-3">{c.default_rate || "—"}</td>}
                    <td className="p-3">
                      <Badge variant={c.is_active ? "success" : "default"}>
                        {c.is_active ? "Active" : "Archived"}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" title="View everything" onClick={() => { setViewingId(c.id); setDetailTab("overview") }}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" title="Edit" onClick={() => openEditClient(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {c.is_active ? (
                          <Button variant="ghost" size="sm" title="Archive" onClick={() => archiveClient(c)}>
                            <Archive className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" title="Restore" onClick={() => restoreClient(c)}>
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Delete"
                          onClick={() => {
                            if (confirm(`Permanently delete "${c.name}"?`)) deleteClient.mutate(c.id)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="p-3 font-medium">Sub-client</th>
                <th className="p-3 font-medium">Parent Client</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSubs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted-foreground">
                    No sub-clients found
                  </td>
                </tr>
              ) : (
                filteredSubs.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{s.name}</td>
                    <td className="p-3 text-muted-foreground">{clientMap[s.client_id] || "—"}</td>
                    <td className="p-3">
                      <Badge variant={s.is_active ? "success" : "default"}>
                        {s.is_active ? "Active" : "Archived"}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" title="Edit" onClick={() => openEditSub(s)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {s.is_active ? (
                          <Button variant="ghost" size="sm" title="Archive" onClick={() => archiveSub(s)}>
                            <Archive className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" title="Restore" onClick={() => restoreSub(s)}>
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Delete"
                          onClick={() => {
                            if (confirm(`Permanently delete "${s.name}"?`)) deleteSub.mutate(s.id)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Client detail — everything connected */}
      {viewingId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setViewingId("")}>
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-card shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
            {detailLoading || !detail ? (
              <p className="p-6 text-sm text-muted-foreground">Loading client…</p>
            ) : (<>
              <div className="sticky top-0 z-10 border-b bg-card/95 px-5 py-4 backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-sm font-extrabold text-primary">{detail.client.name.split(/\s+/).map(w => w[0]).slice(0, 2).join("")}</span>
                    <div>
                      <h2 className="text-base font-bold leading-tight">{detail.client.name}</h2>
                      <p className="text-[11px] capitalize text-muted-foreground">{detail.client.billing_type} billing · {detail.client.is_active ? "Active" : "Archived"}{detail.stats.last_activity ? ` · last work ${formatDate(detail.stats.last_activity)}` : ""}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => { const c = clients.find(x => x.id === detail.client.id); if (c) openEditClient(c) }}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                    <button onClick={() => setViewingId("")} className="rounded-full p-2 hover:bg-muted"><X className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="mt-3 flex gap-1 overflow-x-auto">
                  {([["overview", "Overview"], ["projects", `Projects (${detail.projects.length})`], ["tasks", `Tasks (${detail.stats.tasks_open} open)`], ["logs", `Logs (${detail.stats.logs_count})`], ["invoices", `Invoices (${detail.stats.invoices_count})`]] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setDetailTab(id)} className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold", detailTab === id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/60")}>{label}</button>
                  ))}
                </div>
              </div>

              <div className="space-y-4 px-5 py-4">
                {detailTab === "overview" && (<>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[["Total Hours", `${detail.stats.total_hours} hrs`, `${detail.stats.hours_this_month} hrs this month`], ["Tasks", `${detail.stats.tasks_open} open`, `${detail.stats.tasks_done} done · ${detail.stats.tasks_overdue} overdue`], ["Ready to Invoice", `${detail.stats.ready_to_invoice_hours} hrs`, `${detail.stats.invoiced_hours} hrs invoiced`], ["Pending Approval", `${detail.stats.pending_hours} hrs`, `${detail.stats.pending_count} logs waiting`]].map(([t, v, s]) => (
                      <div key={t} className="rounded-2xl border p-3"><p className="text-[11px] font-semibold text-muted-foreground">{t}</p><p className="mt-1 text-lg font-extrabold leading-none">{v}</p><p className="mt-1 text-[11px] text-muted-foreground">{s}</p></div>
                    ))}
                  </div>
                  {detail.stats.va_names.length > 0 && <p className="text-xs text-muted-foreground">Worked on by: <span className="font-semibold text-foreground">{detail.stats.va_names.join(", ")}</span></p>}
                  <div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Sub-clients</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {detail.sub_clients.map(s => (
                        <div key={s.id} className="rounded-xl border p-3 text-xs"><p className="font-bold">{s.name} {!s.is_active && <span className="text-muted-foreground">(archived)</span>}</p><p className="mt-1 text-muted-foreground">{s.hours} hrs · {s.logs} logs · {s.tasks} tasks</p></div>
                      ))}
                      {detail.sub_clients.length === 0 && <p className="text-xs text-muted-foreground">No sub-clients. Add them in the Sub-clients tab.</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/admin/reports`}><Button size="sm" variant="gold">Open Report</Button></Link>
                    <Link to={`/admin/tasks?client=${detail.client.id}`}><Button size="sm" variant="outline">View on Board</Button></Link>
                    <Link to={`/admin/invoices?client=${detail.client.id}`}><Button size="sm" variant="outline">Create Invoice</Button></Link>
                  </div>
                </>)}

                {detailTab === "projects" && (
                  <div className="space-y-2">
                    {detail.projects.map(p => { const pct = p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0; return (
                      <Link key={p.id} to={`/admin/tasks?project=${p.id}`} className="block rounded-xl border p-3 monday-card">
                        <div className="flex justify-between text-xs"><span className="font-bold"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.name}</span><span className="text-muted-foreground">{pct}%</span></div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{p.sub_client_name ? `${p.sub_client_name} · ` : ""}{p.cadence} · {p.status.replace("_", " ")} · {p.task_done}/{p.task_total} tasks · {p.hours} hrs{p.due_date ? ` · due ${formatDate(p.due_date)}` : ""}</p>
                        <div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${pct}%`, background: p.color }} /></div>
                      </Link>) })}
                    {detail.projects.length === 0 && <p className="text-xs text-muted-foreground">No projects yet for this client.</p>}
                  </div>
                )}

                {detailTab === "tasks" && (
                  <div className="space-y-2">
                    {detail.tasks.map(t => (
                      <Link key={t.id} to="/admin/tasks" className="flex items-center gap-3 rounded-xl border p-3 monday-card">
                        <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: t.project_color || "var(--primary)" }} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{t.title}</span><span className="block text-[11px] text-muted-foreground">{t.project_name ?? "No project"}{t.assignee_name ? ` · ${t.assignee_name}` : " · Unassigned"} · {TASK_STATUSES.find(s => s.id === t.status)?.label ?? t.status}</span></span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", PRIORITY_META[t.priority]?.className)}>{PRIORITY_META[t.priority]?.label}</span>
                        <span className="whitespace-nowrap text-[11px] text-muted-foreground">{t.due_date ? formatDate(t.due_date) : "No date"}</span>
                      </Link>
                    ))}
                    {detail.tasks.length === 0 && <p className="text-xs text-muted-foreground">No tasks for this client yet.</p>}
                  </div>
                )}

                {detailTab === "logs" && (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-2.5">Date</th><th className="p-2.5">VA</th><th className="p-2.5">Description</th><th className="p-2.5">Hours</th><th className="p-2.5">Status</th></tr></thead>
                      <tbody>{detail.logs.map(l => (
                        <tr key={l.id} className="border-b last:border-0"><td className="whitespace-nowrap p-2.5">{formatDate(l.work_date)}</td><td className="whitespace-nowrap p-2.5 font-medium">{l.va_name}</td><td className="max-w-[220px] p-2.5"><span className="line-clamp-2">{l.description_plain}</span></td><td className="p-2.5 font-bold">{Number(l.hours).toFixed(2)}</td><td className="p-2.5 capitalize">{l.status}</td></tr>
                      ))}{detail.logs.length === 0 && <tr><td colSpan={5} className="p-5 text-center text-muted-foreground">No work logs yet.</td></tr>}</tbody>
                    </table>
                  </div>
                )}

                {detailTab === "invoices" && (
                  <div className="space-y-2">
                    {detail.invoices.map(i => (
                      <div key={i.id} className="flex items-center justify-between rounded-xl border p-3 text-xs">
                        <span><span className="font-bold">{i.invoice_number}</span><span className="block text-[11px] text-muted-foreground">{i.period_label} · due {formatDate(i.due_date)}</span></span>
                        <span className="text-right"><span className="font-bold">{showPricing ? formatCurrency(i.amount) : `${i.total_hours} hrs`}</span><span className={cn("block text-[11px] font-semibold capitalize", i.status === "paid" ? "text-green-600" : "text-amber-600")}>{i.status}</span></span>
                      </div>
                    ))}
                    {detail.invoices.length === 0 && <p className="text-xs text-muted-foreground">No invoices yet for this client.</p>}
                  </div>
                )}
              </div>
            </>)}
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg animate-fade-in">
            <h2 className="text-sm font-semibold">
              {modal === "create"
                ? tab === "clients"
                  ? "Create Client"
                  : "Create Sub-client"
                : tab === "clients"
                  ? "Edit Client"
                  : "Edit Sub-client"}
            </h2>

            {tab === "clients" ? (
              <div className="mt-4 space-y-3">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={clientForm.name}
                    onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Billing Type</Label>
                  <Select
                    value={clientForm.billing_type}
                    onChange={(e) =>
                      setClientForm({ ...clientForm, billing_type: e.target.value as "hourly" | "fixed" })
                    }
                  >
                    <option value="hourly">Hourly</option>
                    <option value="fixed">Fixed</option>
                  </Select>
                </div>
                {showPricing && (
                  <div>
                    <Label>Default Rate</Label>
                    <Input
                      type="number"
                      value={clientForm.default_rate}
                      onChange={(e) => setClientForm({ ...clientForm, default_rate: e.target.value })}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div>
                  <Label>Parent Client</Label>
                  <Select
                    value={subForm.client_id}
                    onChange={(e) => setSubForm({ ...subForm, client_id: e.target.value })}
                  >
                    <option value="">Select client</option>
                    {activeClients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Sub-client Name</Label>
                  <Input
                    value={subForm.name}
                    onChange={(e) => setSubForm({ ...subForm, name: e.target.value })}
                  />
                </div>
              </div>
            )}

            {error && <p className="mt-3 text-[11px] text-red-600">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                variant="gold"
                size="sm"
                disabled={
                  tab === "clients"
                    ? !clientForm.name || createClient.isPending || updateClient.isPending
                    : !subForm.client_id || !subForm.name || createSub.isPending || updateSub.isPending
                }
                onClick={() => (tab === "clients" ? saveClient() : saveSub())}
              >
                {modal === "create" ? "Create" : "Update"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
