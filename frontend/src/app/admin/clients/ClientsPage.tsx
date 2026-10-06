import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { Client, SubClient } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  Archive,
  ArchiveRestore,
  Building2,
  Layers,
  Pencil,
  Plus,
  Search,
  Trash2,
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
  const qc = useQueryClient()
  const { showPricing } = useDisplaySettings()
  const [tab, setTab] = useState<Tab>("clients")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active")
  const [modal, setModal] = useState<"create" | "edit" | null>(null)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [editingSub, setEditingSub] = useState<SubClient | null>(null)
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
        <Button variant="gold" size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          {tab === "clients" ? "New Client" : "New Sub-client"}
        </Button>
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
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{c.name}</td>
                    <td className="p-3 capitalize">{c.billing_type}</td>
                    {showPricing && <td className="p-3">{c.default_rate || "—"}</td>}
                    <td className="p-3">
                      <Badge variant={c.is_active ? "success" : "default"}>
                        {c.is_active ? "Active" : "Archived"}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
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
