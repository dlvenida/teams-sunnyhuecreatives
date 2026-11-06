import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { Client } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import { Check, X } from "lucide-react"

interface PayablePerson {
  va_id: string
  name: string
  role: string
  role_label: string
}

interface VARate {
  id: string
  va_id: string
  va_name?: string
  person_role?: string | null
  client_id: string
  client_name?: string
  pay_type: "hourly" | "package"
  payment_frequency?: "monthly" | "biweekly" | null
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
    va_id: "", client_id: "", pay_type: "hourly" as "hourly" | "package", payment_frequency: "biweekly" as "monthly" | "biweekly", currency: "PHP" as "PHP" | "USD", amount: "",
  })

  const { data: rates = [] } = useQuery({
    queryKey: ["va-rates-admin", filter],
    queryFn: () => apiFetch<VARate[]>(`/va-rates${filter === "all" ? "" : `?status_filter=${filter}`}`),
  })
  const { data: people = [] } = useQuery({ queryKey: ["team-rate-people"], queryFn: () => apiFetch<PayablePerson[]>("/va-rates/people") })
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => apiFetch<Client[]>("/clients") })

  const approve = useMutation({
    mutationFn: (id: string) => apiFetch(`/va-rates/${id}/approve`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["va-rates-admin"] }),
  })
  const reject = useMutation({
    mutationFn: (id: string) => apiFetch(`/va-rates/${id}/reject`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["va-rates-admin"] }),
  })
  const setFrequency = useMutation({
    mutationFn: ({ id, payment_frequency }: { id: string; payment_frequency: "monthly" | "biweekly" }) =>
      apiFetch(`/va-rates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ payment_frequency }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["va-rates-admin"] }),
  })
  const override = useMutation({
    mutationFn: () =>
      apiFetch("/va-rates", {
        method: "POST",
        body: JSON.stringify({
          va_id: form.va_id,
          client_id: form.client_id,
          pay_type: form.pay_type,
          currency: form.currency,
          amount: parseFloat(form.amount),
          payment_frequency: form.pay_type === "package" ? form.payment_frequency : null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["va-rates-admin"] })
      setForm({ va_id: "", client_id: "", pay_type: "hourly", payment_frequency: "biweekly", currency: "PHP", amount: "" })
    },
  })

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Team Rates</h1>
        <p className="text-sm text-muted-foreground">One approved rate per person per client. Project Managers use this same form as VAs: hourly or package, PHP or USD, and monthly or bi-weekly. Approving or overriding replaces any previous approved rate for that pair.</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Admin override (auto-approved)</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <Label>Person</Label>
            <Select value={form.va_id} onChange={(e) => setForm({ ...form, va_id: e.target.value })}>
              <option value="">Select…</option>
              {people.map((person) => <option key={person.va_id} value={person.va_id}>{person.name} · {person.role_label}</option>)}
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
            <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={form.pay_type === "package" ? "Monthly amount, e.g. 2000" : "e.g. 250"} />
          </div>
          {form.pay_type === "package" && (
            <div className="sm:col-span-2 lg:col-span-6">
              <Label>Payment frequency</Label>
              <Select value={form.payment_frequency} onChange={(e) => setForm({ ...form, payment_frequency: e.target.value as "monthly" | "biweekly" })}>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">Amount is the full monthly package. Bi-weekly is the Sunny Hue standard: about half is paid on the 1st–15th and about half on the 16th–end. A PHP 2,000 package pays PHP 1,000 on each half. Monthly pays the full amount once, on the 1st–15th. New package rates default to Bi-weekly. A package rate saved with no frequency stays Monthly until you change it here.</p>
            </div>
          )}
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
                <th className="p-3">Person</th>
                <th className="p-3">Client</th>
                <th className="p-3">Type</th>
                <th className="p-3">Frequency</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-3 font-semibold">{r.va_name}{r.person_role === "Project Manager" ? " · Project Manager" : ""}</td>
                  <td className="p-3">{r.client_name}</td>
                  <td className="p-3 capitalize">{r.pay_type}{r.set_by_admin ? " · admin" : ""}</td>
                  <td className="p-3">
                    {r.pay_type === "package" ? (
                      <Select
                        aria-label={`Payment frequency for ${r.va_name || "this person"} and ${r.client_name || "this client"}`}
                        className="w-32"
                        value={r.payment_frequency === "biweekly" ? "biweekly" : "monthly"}
                        title={r.payment_frequency ? undefined : "No frequency was saved. This rate stays Monthly until you choose Bi-weekly."}
                        disabled={setFrequency.isPending}
                        onChange={(e) => setFrequency.mutate({ id: r.id, payment_frequency: e.target.value as "monthly" | "biweekly" })}
                      >
                        <option value="biweekly">Bi-weekly</option>
                        <option value="monthly">Monthly</option>
                      </Select>
                    ) : "—"}
                  </td>
                  <td className="p-3">{formatCurrency(r.amount, r.currency)}{r.pay_type === "package" ? "/month" : "/hr"}</td>
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
              {rates.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No rates in this filter.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
