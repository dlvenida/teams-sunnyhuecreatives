import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { Client, VA } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import { Check, X } from "lucide-react"

interface VARate {
  id: string
  va_id: string
  va_name?: string
  client_id: string
  client_name?: string
  pay_type: "hourly" | "package"
  currency: "PHP" | "USD"
  amount: string
  status: "pending" | "approved" | "rejected"
  set_by_admin: boolean
  is_active_approved?: boolean
  created_at: string
}

export function VARatesAdminPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState("pending")
  const [form, setForm] = useState({
    va_id: "", client_id: "", pay_type: "hourly" as "hourly" | "package", currency: "PHP" as "PHP" | "USD", amount: "",
  })

  const { data: rates = [] } = useQuery({
    queryKey: ["va-rates-admin", filter],
    queryFn: () => apiFetch<VARate[]>(`/va-rates${filter === "all" ? "" : `?status_filter=${filter}`}`),
  })
  const { data: vas = [] } = useQuery({ queryKey: ["vas"], queryFn: () => apiFetch<VA[]>("/vas") })
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => apiFetch<Client[]>("/clients") })

  const approve = useMutation({
    mutationFn: (id: string) => apiFetch(`/va-rates/${id}/approve`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["va-rates-admin"] }),
  })
  const reject = useMutation({
    mutationFn: (id: string) => apiFetch(`/va-rates/${id}/reject`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["va-rates-admin"] }),
  })
  const override = useMutation({
    mutationFn: () =>
      apiFetch("/va-rates", {
        method: "POST",
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["va-rates-admin"] })
      setForm({ va_id: "", client_id: "", pay_type: "hourly", currency: "PHP", amount: "" })
    },
  })

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">VA Rates</h1>
        <p className="text-sm text-muted-foreground">Approve VA submissions or set/override rates directly (auto-approved).</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Admin override (auto-approved)</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <Label>VA</Label>
            <Select value={form.va_id} onChange={(e) => setForm({ ...form, va_id: e.target.value })}>
              <option value="">Select…</option>
              {vas.filter((v) => v.is_active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>Client</Label>
            <Select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
              <option value="">Select…</option>
              {clients.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.pay_type} onChange={(e) => setForm({ ...form, pay_type: e.target.value as "hourly" | "package" })}>
              <option value="hourly">Hourly</option>
              <option value="package">Package</option>
            </Select>
          </div>
          <div>
            <Label>Currency</Label>
            <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as "PHP" | "USD" })}>
              <option value="PHP">PHP</option>
              <option value="USD">USD</option>
            </Select>
          </div>
          <div>
            <Label>Amount</Label>
            <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="flex items-end">
            <Button variant="gold" disabled={!form.va_id || !form.client_id || !form.amount || override.isPending} onClick={() => override.mutate()}>
              Set rate
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((s) => (
          <Button key={s} size="sm" variant={filter === s ? "gold" : "outline"} onClick={() => setFilter(s)} className="capitalize">{s}</Button>
        ))}
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="p-3">VA</th>
                <th className="p-3">Client</th>
                <th className="p-3">Type</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-3 font-semibold">{r.va_name}</td>
                  <td className="p-3">{r.client_name}</td>
                  <td className="p-3 capitalize">{r.pay_type}{r.set_by_admin ? " · admin" : ""}</td>
                  <td className="p-3">{formatCurrency(r.amount, r.currency)}</td>
                  <td className="p-3"><StatusBadge status={r.status} /></td>
                  <td className="p-3">
                    {r.status === "pending" && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="success" onClick={() => approve.mutate(r.id)}><Check className="h-3 w-3" /></Button>
                        <Button size="sm" variant="danger" onClick={() => reject.mutate(r.id)}><X className="h-3 w-3" /></Button>
                      </div>
                    )}
                    {r.is_active_approved && <span className="text-[10px] font-bold text-green-600">ACTIVE</span>}
                  </td>
                </tr>
              ))}
              {rates.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No rates in this filter.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
