import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { AppUser, VA } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  Archive,
  ArchiveRestore,
  Plus,
  Search,
  Trash2,
  UserCircle,
} from "lucide-react"

type StatusFilter = "all" | "active" | "archived"

interface UserForm {
  name: string
  email: string
  password: string
  currency: "PHP" | "USD"
}

const emptyForm: UserForm = { name: "", email: "", password: "", currency: "PHP" }

export function UsersPage() {
  const qc = useQueryClient()
  const [roleTab, setRoleTab] = useState<"va" | "auditor" | "admin">("va")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active")
  const [modal, setModal] = useState<"create" | "edit" | null>(null)
  const [editing, setEditing] = useState<VA | null>(null)
  const [form, setForm] = useState<UserForm>(emptyForm)
  const [newPassword, setNewPassword] = useState("")
  const [error, setError] = useState("")

  const { data: users = [] } = useQuery({
    queryKey: ["vas"],
    queryFn: () => apiFetch<VA[]>("/vas"),
  })
  const { data: appUsers = [] } = useQuery({
    queryKey: ["app-users"],
    queryFn: () => apiFetch<AppUser[]>("/auth/users"),
  })
  const roleUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return appUsers.filter((u) => {
      if (u.role !== roleTab) return false
      if (statusFilter === "active" && !u.is_active) return false
      if (statusFilter === "archived" && u.is_active) return false
      if (!q) return true
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    })
  }, [appUsers, roleTab, search, statusFilter])

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["vas"] }); qc.invalidateQueries({ queryKey: ["app-users"] }) }
  const createAppUser = useMutation({
    mutationFn: () => apiFetch("/auth/users", { method: "POST", body: JSON.stringify({ name: form.name, email: form.email, password: form.password, role: roleTab, currency: form.currency }) }),
    onSuccess: () => { invalidate(); closeModal() },
    onError: (err: Error) => setError(err.message),
  })
  const toggleAppUser = useMutation({
    mutationFn: (data: { id: string; is_active: boolean }) => apiFetch(`/auth/users/${data.id}`, { method: "PATCH", body: JSON.stringify({ is_active: data.is_active }) }),
    onSuccess: invalidate,
    onError: (err: Error) => alert(err.message),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (statusFilter === "active" && !u.is_active) return false
      if (statusFilter === "archived" && u.is_active) return false
      if (!q) return true
      return u.name.toLowerCase().includes(q) || (u.email?.toLowerCase().includes(q) ?? false)
    })
  }, [users, search, statusFilter])

  const createUser = useMutation({
    mutationFn: () =>
      apiFetch("/auth/va-users", {
        method: "POST",
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      invalidate()
      closeModal()
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateUser = useMutation({
    mutationFn: (data: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/vas/${data.id}`, { method: "PATCH", body: JSON.stringify(data.body) }),
    onSuccess: invalidate,
    onError: (err: Error) => alert(err.message),
  })

  const [delegateTarget, setDelegateTarget] = useState<VA | null>(null)
  const [delegateTo, setDelegateTo] = useState("")
  const [delegateSummary, setDelegateSummary] = useState("")
  const { data: preview } = useQuery({
    queryKey: ["delegation-preview", delegateTarget?.id],
    queryFn: () => apiFetch<{ va_name: string; tasks_total: number; tasks_open: number; tasks_done: number; work_logs: number; clock_entries: number; active_clock: number; tasks_by_client: Record<string, number>; clients: string[] }>(`/vas/${delegateTarget!.id}/delegation-preview`),
    enabled: !!delegateTarget,
  })
  const delegateDelete = useMutation({
    mutationFn: () => apiFetch(`/vas/${delegateTarget!.id}/delegate-and-delete`, { method: "POST", body: JSON.stringify({ delegate_to_va_id: delegateTo, include_done_tasks: true, transfer_logs: true }) }),
    onSuccess: (res: unknown) => {
      const r = res as { deleted: string; delegated_to: string; tasks: number; work_logs: number }
      setDelegateSummary(`${r.deleted} deleted — ${r.tasks} task(s) and ${r.work_logs} work log(s) synced to ${r.delegated_to}. They were emailed the handover.`)
      setDelegateTarget(null)
      qc.invalidateQueries()
    },
    onError: (err: Error) => setError(err.message),
  })
  const targets = users.filter((u) => u.is_active && u.id !== delegateTarget?.id)

  const closeModal = () => {
    setModal(null)
    setEditing(null)
    setForm(emptyForm)
    setNewPassword("")
    setError("")
  }

  const openCreate = () => {
    setError("")
    setForm(emptyForm)
    setModal("create")
  }

  const openEdit = (user: VA) => {
    setError("")
    setEditing(user)
    setForm({
      name: user.name,
      email: user.email || "",
      password: "",
      currency: user.currency,
    })
    setNewPassword("")
    setModal("edit")
  }

  const save = async () => {
    if (modal === "create") {
      if (roleTab !== "va") { createAppUser.mutate(); return }
      createUser.mutate()
      return
    }
    if (!editing) return
    try {
      setError("")
      await apiFetch(`/vas/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: form.name, email: form.email, currency: form.currency }),
      })
      if (newPassword.length >= 8) {
        await apiFetch(`/vas/${editing.id}/reset-password`, {
          method: "POST",
          body: JSON.stringify({ password: newPassword }),
        })
      }
      invalidate()
      closeModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed")
    }
  }

  const archiveUser = (user: VA) => updateUser.mutate({ id: user.id, body: { is_active: false } })
  const restoreUser = (user: VA) => updateUser.mutate({ id: user.id, body: { is_active: true } })

  const isSaving = createUser.isPending || updateUser.isPending || createAppUser.isPending

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Users</h1>
          <p className="text-xs text-muted-foreground">Administrator runs the app · Auditor monitors VA activity (read-only) · Virtual Assistants do the work.</p>
        </div>
        <Button variant="gold" size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> New {roleTab === "va" ? "Virtual Assistant" : roleTab === "auditor" ? "Auditor" : "Administrator"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {([["admin", "Administrator", appUsers.filter(u => u.role === "admin").length], ["auditor", "Auditor", appUsers.filter(u => u.role === "auditor").length], ["va", "Virtual Assistant", users.length]] as const).map(([id, label, count]) => (
          <button key={id} onClick={() => setRoleTab(id)} className={cn("rounded-full border px-3.5 py-1.5 text-xs font-bold transition", roleTab === id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted/60")}>
            {label} <span className={cn("ml-1 rounded-full px-1.5 text-[10px]", roleTab === id ? "bg-white/25" : "bg-muted")}>{count}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by name or email..."
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

      {roleTab !== "va" ? (
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-muted-foreground">
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Role</th>
              <th className="p-3 font-medium">{roleTab === "auditor" ? "Auditing" : "Access"}</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {roleUsers.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No {roleTab === "auditor" ? "auditors" : "administrators"} found. Create one with the button above.</td></tr>
            ) : roleUsers.map((u) => (
              <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="p-3 font-semibold">{u.name}</td>
                <td className="p-3 text-primary">{u.email}</td>
                <td className="p-3"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold capitalize", u.role === "admin" ? "bg-primary/10 text-primary" : "bg-sky-100 text-sky-700")}>{u.role}</span></td>
                <td className="p-3 text-muted-foreground">{u.role === "auditor" ? `${u.auditing_count} VA(s) assigned in Analytics` : "Full access"}</td>
                <td className="p-3"><Badge variant={u.is_active ? "success" : "default"}>{u.is_active ? "Active" : "Archived"}</Badge></td>
                <td className="p-3"><div className="flex justify-end gap-1">
                  {u.is_active ? (
                    <Button variant="ghost" size="sm" title="Archive" onClick={() => toggleAppUser.mutate({ id: u.id, is_active: false })}><Archive className="h-3.5 w-3.5" /></Button>
                  ) : (
                    <Button variant="ghost" size="sm" title="Restore" onClick={() => toggleAppUser.mutate({ id: u.id, is_active: true })}><ArchiveRestore className="h-3.5 w-3.5" /></Button>
                  )}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">{roleTab === "auditor" ? "Auditors sign in to the Analytics board to monitor VA activity — they cannot approve logs, edit tasks, or change payroll. Assign them per-VA in Analytics." : "Administrators have full access to every page, including payroll, invoices, and settings."}</p>
      </div>
      ) : (
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-muted-foreground">
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Currency</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  No users found
                </td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3 font-medium">{u.name}</td>
                  <td className="p-3 text-primary">{u.email}</td>
                  <td className="p-3">
                    <Badge variant={u.currency === "PHP" ? "php" : "usd"}>{u.currency}</Badge>
                  </td>
                  <td className="p-3">
                    <Badge variant={u.is_active ? "success" : "default"}>
                      {u.is_active ? "Active" : "Archived"}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" title="Edit profile" onClick={() => openEdit(u)}>
                        <UserCircle className="h-3.5 w-3.5" />
                      </Button>
                      {u.is_active ? (
                        <Button variant="ghost" size="sm" title="Archive" onClick={() => archiveUser(u)}>
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" title="Restore" onClick={() => restoreUser(u)}>
                          <ArchiveRestore className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Delete & delegate"
                        onClick={() => { setDelegateTarget(u); setDelegateTo(""); setError(""); setDelegateSummary("") }}
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

      {delegateSummary && (
        <div className="rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-xs text-green-900">{delegateSummary}</div>
      )}

      {delegateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDelegateTarget(null)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold">Delete {delegateTarget.name} — delegate everything first</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">All tasks, work logs, clock history, and comments transfer to the new owner and sync to their board instantly. The new owner gets a handover email.</p>
            {preview ? (
              <div className="mt-3 space-y-2 rounded-xl border bg-muted/30 p-3 text-xs">
                <div className="flex justify-between"><span>Tasks</span><strong>{preview.tasks_total} ({preview.tasks_open} open · {preview.tasks_done} done)</strong></div>
                <div className="flex justify-between"><span>Work logs</span><strong>{preview.work_logs}</strong></div>
                <div className="flex justify-between"><span>Clock entries</span><strong>{preview.clock_entries}{preview.active_clock ? ` · ${preview.active_clock} live (will be ended)` : ""}</strong></div>
                {Object.entries(preview.tasks_by_client).length > 0 && (
                  <div className="border-t pt-2">
                    <p className="mb-1 font-semibold">Tasks per client</p>
                    {Object.entries(preview.tasks_by_client).map(([client, n]) => <div key={client} className="flex justify-between text-[11px]"><span>{client}</span><span>{n}</span></div>)}
                  </div>
                )}
                {preview.tasks_total === 0 && preview.work_logs === 0 && <p className="text-muted-foreground">This user owns nothing — they can be deleted directly, but choosing a delegate is harmless.</p>}
              </div>
            ) : <p className="mt-3 text-xs text-muted-foreground">Loading ownership…</p>}
            <div className="mt-3">
              <Label>Delegate everything to *</Label>
              <Select value={delegateTo} onChange={(e) => setDelegateTo(e.target.value)}>
                <option value="">Select an active user</option>
                {targets.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </Select>
              {targets.length === 0 && <p className="mt-1 text-[11px] text-red-600">No other active users. Create another user first, or archive instead.</p>}
            </div>
            {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDelegateTarget(null)}>Cancel</Button>
              <Button variant="danger" size="sm" disabled={!delegateTo || delegateDelete.isPending} onClick={() => { if (confirm(`Transfer everything from ${delegateTarget.name} and delete them? This cannot be undone.`)) delegateDelete.mutate() }}>
                {delegateDelete.isPending ? "Transferring…" : "Delegate & Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg animate-fade-in">
            <h2 className="text-sm font-semibold">
              {modal === "create" ? `Create ${roleTab === "va" ? "Virtual Assistant" : roleTab === "auditor" ? "Auditor" : "Administrator"}` : "Edit Profile"}
            </h2>

            <div className="mt-4 space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              {(roleTab === "va" || modal === "edit") && <div>
                <Label>Currency</Label>
                <Select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value as "PHP" | "USD" })}
                >
                  <option value="PHP">PHP</option>
                  <option value="USD">USD</option>
                </Select>
              </div>}
              {modal === "create" ? (
                <div>
                  <Label>Temporary Password</Label>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    minLength={8}
                  />
                </div>
              ) : (
                <div>
                  <Label>Reset Password (optional)</Label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Leave blank to keep current"
                    minLength={8}
                  />
                </div>
              )}
            </div>

            {error && <p className="mt-3 text-[11px] text-red-600">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                variant="gold"
                size="sm"
                disabled={
                  !form.name ||
                  !form.email ||
                  (modal === "create" && form.password.length < 8) ||
                  isSaving
                }
                onClick={() => void save()}
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
