import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { Client, ClientDetail, ClientFinancialRow, ClientTeamMember, SubClient, VA } from "@/lib/types"
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
  Users,
  X,
} from "lucide-react"
import { useDisplaySettings } from "@/hooks/useDisplaySettings"

type Tab = "clients" | "sub-clients"
type StatusFilter = "all" | "active" | "archived" | "pending"

interface ClientForm {
  name: string
  billing_type: "hourly" | "fixed" | "package_hours"
  default_rate: string
  included_hours?: string
  overage_rate?: string
}

interface SubClientForm {
  client_id: string
  name: string
}

const emptyClient: ClientForm = { name: "", billing_type: "hourly", default_rate: "" }
const emptySub: SubClientForm = { client_id: "", name: "" }

export function ClientsPage() {
  const authUser = getAuthUser()
  const isAuditor = authUser?.role === "auditor"
  const isAdmin = authUser?.role === "admin"
  const readOnly = isAuditor // auditor cannot edit/archive/delete; can propose new clients
  const qc = useQueryClient()
  const { showPricing } = useDisplaySettings()
  const [tab, setTab] = useState<Tab>("clients")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active")
  const [modal, setModal] = useState<"create" | "edit" | "approve" | null>(null)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [approvingClient, setApprovingClient] = useState<Client | null>(null)
  const [editingSub, setEditingSub] = useState<SubClient | null>(null)
  const [viewingId, setViewingId] = useState<string>("")
  const [detailTab, setDetailTab] = useState<"overview" | "projects" | "tasks" | "logs" | "invoices">("overview")
  const [clientForm, setClientForm] = useState<ClientForm>(emptyClient)
  const [subForm, setSubForm] = useState<SubClientForm>(emptySub)
  const [error, setError] = useState("")
  const [teamAddVaId, setTeamAddVaId] = useState("")
  const [teamAddRole, setTeamAddRole] = useState("")
  const [editingTeamRole, setEditingTeamRole] = useState<{ va_id: string; role: string } | null>(null)

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => apiFetch<Client[]>("/clients"),
  })
  const { data: subClients = [] } = useQuery({
    queryKey: ["sub-clients"],
    queryFn: () => apiFetch<SubClient[]>("/clients/sub-clients"),
  })
  const { data: allVas = [] } = useQuery({
    queryKey: ["vas"],
    queryFn: () => apiFetch<VA[]>("/vas"),
    enabled: isAdmin && !!viewingId,
  })
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["client-detail", viewingId],
    queryFn: () => apiFetch<ClientDetail>(`/clients/${viewingId}/detail`),
    enabled: !!viewingId,
  })
  // Admin-only lifetime financials per client (since each client was created)
  const { data: financials = [] } = useQuery({
    queryKey: ["client-financials"],
    queryFn: () => apiFetch<ClientFinancialRow[]>("/clients/financials"),
    enabled: isAdmin,
  })
  const financialMap = useMemo(() => Object.fromEntries(financials.map((f) => [f.client_id, f])), [financials])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["clients"] })
    qc.invalidateQueries({ queryKey: ["sub-clients"] })
  }
  const invalidateDetail = () => qc.invalidateQueries({ queryKey: ["client-detail", viewingId] })

  const saveTeamRole = useMutation({
    mutationFn: ({ va_id, role }: { va_id: string; role: string }) =>
      apiFetch(`/clients/${viewingId}/team/${va_id}`, {
        method: "PUT",
        body: JSON.stringify({ role: role.trim() || "General VA" }),
      }),
    onSuccess: () => {
      invalidateDetail()
      setEditingTeamRole(null)
      setTeamAddVaId("")
      setTeamAddRole("")
    },
  })
  const removeTeamRole = useMutation({
    mutationFn: (va_id: string) => apiFetch(`/clients/${viewingId}/team/${va_id}`, { method: "DELETE" }),
    onSuccess: invalidateDetail,
  })

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c.name])),
    [clients],
  )

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clients.filter((c) => {
      const approval = c.approval_status || "approved"
      if (statusFilter === "active") {
        if (approval === "pending") return false
        if (!c.is_active || approval === "rejected") return false
      }
      if (statusFilter === "archived" && (c.is_active || approval === "pending")) return false
      if (statusFilter === "pending" && approval !== "pending") return false
      if (!q) return true
      return c.name.toLowerCase().includes(q) || c.billing_type.includes(q) || (c.proposed_by_name || "").toLowerCase().includes(q)
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
          default_rate: isAuditor ? null : (clientForm.default_rate ? parseFloat(clientForm.default_rate) : null),
          included_hours: isAuditor ? null : (clientForm.included_hours ? parseFloat(clientForm.included_hours) : null),
          overage_rate: isAuditor ? null : (clientForm.overage_rate ? parseFloat(clientForm.overage_rate) : null),
        }),
      }),
    onSuccess: () => {
      invalidate()
      closeModal()
    },
    onError: (err: Error) => setError(err.message),
  })

  const approveClient = useMutation({
    mutationFn: () =>
      apiFetch(`/clients/${approvingClient!.id}/approve`, {
        method: "POST",
        body: JSON.stringify({
          billing_type: clientForm.billing_type,
          default_rate: clientForm.default_rate ? parseFloat(clientForm.default_rate) : null,
          included_hours: clientForm.included_hours ? parseFloat(clientForm.included_hours) : null,
          overage_rate: clientForm.overage_rate ? parseFloat(clientForm.overage_rate) : null,
        }),
      }),
    onSuccess: () => {
      invalidate()
      qc.invalidateQueries({ queryKey: ["client-financials"] })
      closeModal()
    },
    onError: (err: Error) => setError(err.message),
  })

  const rejectClient = useMutation({
    mutationFn: (id: string) => apiFetch(`/clients/${id}/reject`, { method: "POST" }),
    onSuccess: invalidate,
    onError: (err: Error) => alert(err.message),
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
    setApprovingClient(null)
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

  const openApprove = (client: Client) => {
    setError("")
    setApprovingClient(client)
    setClientForm({
      name: client.name,
      billing_type: client.billing_type,
      default_rate: client.default_rate || "",
    })
    setModal("approve")
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
      included_hours: clientForm.included_hours ? parseFloat(clientForm.included_hours) : null,
      overage_rate: clientForm.overage_rate ? parseFloat(clientForm.overage_rate) : null,
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

  const activeClients = clients.filter((c) => c.is_active && (c.approval_status || "approved") === "approved")
  const pendingCount = clients.filter((c) => c.approval_status === "pending").length
  const canCreate = tab === "clients" ? (isAdmin || isAuditor) : isAdmin

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-base font-semibold">Clients</h1>
          {isAuditor && (
            <p className="text-[11px] text-muted-foreground">
              Propose a new client for admin review. It won’t go live until the admin sets the rate and approves it.
            </p>
          )}
        </div>
        {canCreate && (
          <Button variant="gold" size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            {tab === "clients" ? (isAuditor ? "Propose Client" : "New Client") : "New Sub-client"}
          </Button>
        )}
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
          className="w-40"
        >
          <option value="active">Active</option>
          <option value="pending">Pending review{pendingCount ? ` (${pendingCount})` : ""}</option>
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
                {isAdmin && <><th className="p-3 font-medium">Total Hours</th><th className="p-3 font-medium">Total Earned</th><th className="p-3 font-medium">VA Earned</th><th className="p-3 font-medium">Net</th></>}
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={(showPricing ? 5 : 4) + (isAdmin ? 4 : 0)} className="p-6 text-center text-muted-foreground">
                    No clients found
                  </td>
                </tr>
              ) : (
                filteredClients.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-b last:border-0 hover:bg-primary/[0.04]" onClick={() => { setViewingId(c.id); setDetailTab("overview") }}>
                    <td className="p-3 font-semibold text-primary">{c.name}</td>
                    <td className="p-3 capitalize">{c.billing_type}</td>
                    {showPricing && <td className="p-3">{c.default_rate || "—"}</td>}
                    {isAdmin && (() => { const f = financialMap[c.id]; return (<>
                      <td className="p-3 font-semibold">{f ? `${Number(f.total_hours).toFixed(1)} hrs` : "—"}</td>
                      <td className="p-3">{f ? formatCurrency(f.total_earned) : "—"}</td>
                      <td className="p-3">{f ? formatCurrency(f.va_earned) : "—"}</td>
                      <td className={cn("p-3 font-bold", f && parseFloat(f.net) < 0 ? "text-red-600" : "text-green-700")}>{f ? formatCurrency(f.net) : "—"}</td>
                    </>) })()}
                    <td className="p-3">
                      {c.approval_status === "pending" ? (
                        <Badge variant="default">Pending admin review</Badge>
                      ) : c.approval_status === "rejected" ? (
                        <Badge variant="default">Declined</Badge>
                      ) : (
                        <Badge variant={c.is_active ? "success" : "default"}>
                          {c.is_active ? "Active" : "Archived"}
                        </Badge>
                      )}
                      {c.approval_status === "pending" && c.proposed_by_name && (
                        <span className="mt-1 block text-[10px] text-muted-foreground">by {c.proposed_by_name}</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" title="View everything" onClick={() => { setViewingId(c.id); setDetailTab("overview") }}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {isAdmin && c.approval_status === "pending" && (
                          <>
                            <Button variant="success" size="sm" title="Approve & set rate" onClick={() => openApprove(c)}>
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Decline"
                              onClick={() => {
                                if (confirm(`Decline proposal for "${c.name}"?`)) rejectClient.mutate(c.id)
                              }}
                            >
                              Decline
                            </Button>
                          </>
                        )}
                        {!readOnly && c.approval_status !== "pending" && (
                          <>
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
                          </>
                        )}
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
                        {!readOnly && (
                          <>
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
                          </>
                        )}
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
                    {!readOnly && (
                      <Button size="sm" variant="outline" onClick={() => { const c = clients.find(x => x.id === detail.client.id); if (c) openEditClient(c) }}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                    )}
                    <button onClick={() => setViewingId("")} className="rounded-full p-2 hover:bg-muted"><X className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="mt-3 flex gap-1 overflow-x-auto">
                  {([["overview", "Overview"], ["projects", `Projects (${detail.projects.length})`], ["tasks", `Tasks (${detail.stats.tasks_open} open)`], ["logs", `Logs (${detail.stats.logs_count})`], ...(isAdmin ? [["invoices", `Invoices (${detail.stats.invoices_count})`] as const] : [])] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setDetailTab(id)} className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold", detailTab === id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/60")}>{label}</button>
                  ))}
                </div>
              </div>

              <div className="space-y-4 px-5 py-4">
                {detailTab === "overview" && (<>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {([
                      ["Total Hours", `${detail.stats.total_hours} hrs`, `${detail.stats.hours_this_month} hrs this month`],
                      ["Tasks", `${detail.stats.tasks_open} open`, `${detail.stats.tasks_done} done · ${detail.stats.tasks_overdue} overdue`],
                      ...(isAdmin
                        ? [["Ready to Invoice", `${detail.stats.ready_to_invoice_hours} hrs`, `${detail.stats.invoiced_hours} hrs invoiced`] as const]
                        : []),
                      ["Pending Approval", `${detail.stats.pending_hours} hrs`, `${detail.stats.pending_count} logs waiting`],
                    ] as const).map(([t, v, s]) => (
                      <div key={t} className="rounded-2xl border p-3"><p className="text-[11px] font-semibold text-muted-foreground">{t}</p><p className="mt-1 text-lg font-extrabold leading-none">{v}</p><p className="mt-1 text-[11px] text-muted-foreground">{s}</p></div>
                    ))}
                  </div>
                  {isAdmin && detail.financials && (<>
                    <div className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-4">
                      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Lifetime financials · Admin only</p>
                        <p className="text-[11px] text-muted-foreground">Since client created{detail.financials.since ? ` · ${formatDate(detail.financials.since.slice(0, 10))}` : ""}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {[["Total Hours Spent", `${Number(detail.financials.total_hours).toFixed(1)} hrs`, "Approved + invoiced work"], ["Total Earned", formatCurrency(detail.financials.total_earned), `${detail.financials.invoices_count} invoice(s) billed`], ["Collected", formatCurrency(detail.financials.total_collected), `${formatCurrency(detail.financials.total_outstanding)} outstanding`], ["Virtual Assistant Earned", formatCurrency(detail.financials.va_earned), "VA pay on billable logs"], ["Net (Earned − VA)", formatCurrency(detail.financials.net), detail.financials.profit_margin_pct != null ? `${detail.financials.profit_margin_pct}% margin` : "—"], ["Net Collected", formatCurrency(detail.financials.net_collected), "Collected − VA earned"]].map(([t, v, s]) => (
                          <div key={t} className="rounded-xl border bg-card p-3"><p className="text-[11px] font-semibold text-muted-foreground">{t}</p><p className={cn("mt-1 text-base font-extrabold leading-none", t.startsWith("Net") && parseFloat(t.startsWith("Net (") ? detail.financials!.net : detail.financials!.net_collected) < 0 ? "text-red-600" : "")}>{v}</p><p className="mt-1 text-[11px] text-muted-foreground">{s}</p></div>
                        ))}
                      </div>
                      {detail.financials.by_va.length > 0 && (
                        <div className="mt-3 overflow-x-auto rounded-xl border bg-card">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-2.5">Virtual Assistant</th><th className="p-2.5">Hours</th><th className="p-2.5">VA Earned</th><th className="p-2.5">Logs</th></tr></thead>
                            <tbody>{detail.financials.by_va.map((v) => (
                              <tr key={v.va_id} className="border-b last:border-0"><td className="p-2.5 font-semibold">{v.va_name}</td><td className="p-2.5">{Number(v.hours).toFixed(1)} hrs</td><td className="p-2.5">{formatCurrency(v.va_pay, v.currency === "PHP" ? "PHP" : "USD")}{v.currency ? ` (${v.currency})` : ""}</td><td className="p-2.5">{v.logs}</td></tr>
                            ))}</tbody>
                          </table>
                        </div>
                      )}
                      <p className="mt-2 text-[10px] text-muted-foreground">Total Earned = all invoices billed for this client · VA Earned = pay stored on approved/invoiced time logs (in each VA's currency above) · Net = Total Earned − VA Earned.</p>
                    </div>
                  </>)}
                  {/* Assigned VAs + per-client roles */}
                  <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-rose-50/50 to-card p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
                          <Users className="h-3.5 w-3.5" /> Team on this client
                        </p>
                        <p className="text-xs text-muted-foreground">Each VA can have a different role per client.</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {(detail.team ?? []).length === 0 && (
                        <p className="text-xs text-muted-foreground">No VAs assigned yet. Assign a task or add someone below.</p>
                      )}
                      {(detail.team ?? []).map((m: ClientTeamMember) => (
                        <div key={m.va_id} className="flex flex-wrap items-center gap-2 rounded-xl border bg-white/80 px-3 py-2.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-extrabold text-primary">
                            {m.va_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold">{m.va_name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {m.open_tasks ?? 0} open task{(m.open_tasks ?? 0) === 1 ? "" : "s"}
                              {m.hours != null ? ` · ${Number(m.hours).toFixed(1)} hrs` : ""}
                              {!m.is_active ? " · archived" : ""}
                            </p>
                          </div>
                          {editingTeamRole?.va_id === m.va_id ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Input
                                className="h-8 w-[160px] text-xs"
                                value={editingTeamRole.role}
                                placeholder="e.g. Social Media Manager"
                                onChange={(e) => setEditingTeamRole({ ...editingTeamRole, role: e.target.value })}
                                autoFocus
                              />
                              <Button size="sm" variant="gold" disabled={saveTeamRole.isPending} onClick={() => saveTeamRole.mutate({ va_id: m.va_id, role: editingTeamRole.role })}>Save</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingTeamRole(null)}>Cancel</Button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={cn(
                                "rounded-full px-2.5 py-1 text-[11px] font-bold",
                                m.role ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                              )}>
                                {m.role || "No role set"}
                              </span>
                              {isAdmin && (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => setEditingTeamRole({ va_id: m.va_id, role: m.role || "" })}>
                                    <Pencil className="h-3 w-3" /> Role
                                  </Button>
                                  {m.has_explicit_role && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      title="Clear role"
                                      onClick={() => { if (confirm(`Clear role for ${m.va_name} on this client?`)) removeTeamRole.mutate(m.va_id) }}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-red-600" />
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {isAdmin && (
                      <div className="mt-3 grid gap-2 rounded-xl border border-dashed border-primary/25 bg-primary/[0.03] p-3 sm:grid-cols-[1fr_1fr_auto]">
                        <div>
                          <Label className="text-[10px]">Add VA</Label>
                          <Select value={teamAddVaId} onChange={(e) => setTeamAddVaId(e.target.value)} className="h-9">
                            <option value="">Select VA…</option>
                            {allVas
                              .filter((v) => v.is_active && !(detail.team ?? []).some((m) => m.va_id === v.id && m.has_explicit_role))
                              .map((v) => (
                                <option key={v.id} value={v.id}>{v.name}</option>
                              ))}
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[10px]">Role for this client</Label>
                          <Input
                            className="h-9"
                            placeholder="e.g. Graphic Designer"
                            value={teamAddRole}
                            onChange={(e) => setTeamAddRole(e.target.value)}
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            size="sm"
                            variant="gold"
                            className="w-full"
                            disabled={!teamAddVaId || saveTeamRole.isPending}
                            onClick={() => saveTeamRole.mutate({ va_id: teamAddVaId, role: teamAddRole })}
                          >
                            <Plus className="h-3.5 w-3.5" /> Add
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

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
                    {isAdmin && <Link to={`/admin/reports`}><Button size="sm" variant="gold">Open Report</Button></Link>}
                    <Link to={`/admin/tasks?client=${detail.client.id}`}><Button size="sm" variant="outline">View in Task Board</Button></Link>
                    {isAdmin && <Link to={`/admin/invoices?client=${detail.client.id}`}><Button size="sm" variant="outline">Create Invoice</Button></Link>}
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
              {modal === "approve"
                ? `Approve client · ${approvingClient?.name || ""}`
                : modal === "create"
                  ? tab === "clients"
                    ? (isAuditor ? "Propose Client" : "Create Client")
                    : "Create Sub-client"
                  : tab === "clients"
                    ? "Edit Client"
                    : "Edit Sub-client"}
            </h2>
            {modal === "approve" && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Set the billing rate, then approve. The client goes live only after this step.
                {approvingClient?.proposed_by_name ? ` Proposed by ${approvingClient.proposed_by_name}.` : ""}
              </p>
            )}
            {modal === "create" && isAuditor && tab === "clients" && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                This sends a pending request to the admin. They will set the VA rate and approve before the client appears as live.
              </p>
            )}

            {(tab === "clients" || modal === "approve") ? (
              <div className="mt-4 space-y-3">
                {modal !== "approve" && (
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={clientForm.name}
                      onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                    />
                  </div>
                )}
                <div>
                  <Label>Billing Type</Label>
                  <Select
                    value={clientForm.billing_type}
                    onChange={(e) =>
                      setClientForm({ ...clientForm, billing_type: e.target.value as "hourly" | "fixed" | "package_hours" })
                    }
                  >
                    <option value="hourly">Hourly</option>
                    <option value="fixed">Fixed package</option>
                    <option value="package_hours">Package + included hours</option>
                  </Select>
                </div>
                {(showPricing || modal === "approve") && (
                  <div>
                    <Label>{clientForm.billing_type === "hourly" ? "Default hourly rate" : "Package amount"}</Label>
                    <Input
                      type="number"
                      value={clientForm.default_rate}
                      onChange={(e) => setClientForm({ ...clientForm, default_rate: e.target.value })}
                    />
                  </div>
                )}
                {(showPricing || modal === "approve") && clientForm.billing_type === "package_hours" && (
                  <>
                    <div>
                      <Label>Included hours</Label>
                      <Input type="number" value={clientForm.included_hours || ""} onChange={(e) => setClientForm({ ...clientForm, included_hours: e.target.value })} />
                    </div>
                    <div>
                      <Label>Overage rate</Label>
                      <Input type="number" value={clientForm.overage_rate || ""} onChange={(e) => setClientForm({ ...clientForm, overage_rate: e.target.value })} />
                    </div>
                  </>
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
              {modal === "approve" ? (
                <Button
                  variant="gold"
                  size="sm"
                  disabled={approveClient.isPending || !clientForm.default_rate}
                  onClick={() => approveClient.mutate()}
                >
                  {approveClient.isPending ? "Approving…" : "Approve & go live"}
                </Button>
              ) : (
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
                  {modal === "create" ? (isAuditor && tab === "clients" ? "Send for review" : "Create") : "Update"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
