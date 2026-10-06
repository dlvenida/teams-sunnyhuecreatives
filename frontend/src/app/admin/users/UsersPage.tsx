import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { VA } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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

  const invalidate = () => qc.invalidateQueries({ queryKey: ["vas"] })

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

  const deleteUser = useMutation({
    mutationFn: (id: string) => apiFetch(`/vas/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (err: Error) => alert(err.message),
  })

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

  const isSaving = createUser.isPending || updateUser.isPending

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-base font-semibold">Users</h1>
        <Button variant="gold" size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> New User
        </Button>
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
                        title="Delete"
                        onClick={() => {
                          if (confirm(`Permanently delete "${u.name}"?`)) deleteUser.mutate(u.id)
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

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg animate-fade-in">
            <h2 className="text-sm font-semibold">
              {modal === "create" ? "Create User" : "Edit Profile"}
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
              <div>
                <Label>Currency</Label>
                <Select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value as "PHP" | "USD" })}
                >
                  <option value="PHP">PHP</option>
                  <option value="USD">USD</option>
                </Select>
              </div>
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
