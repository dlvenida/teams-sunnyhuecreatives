import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { Client } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"

interface VARate {
  id: string
  va_id: string
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

export function VARatesPage() {
  const qc = useQueryClient()
  const [form, setForm] = useState({ client_id: "", pay_type: "hourly" as "hourly" | "package", currency: "PHP" as "PHP" | "USD", amount: "" })
  const [error, setError] = useState("")

  const { data: clients = [] } = useQuery({ queryKey: ["va-clients"], queryFn: () => apiFetch<Client[]>("/va/clients") })
  const { data: rates = [] } = useQuery({ queryKey: ["va-rates-mine"], queryFn: () => apiFetch<VARate[]>("/va-rates/mine") })

  const submit = useMutation({
    mutationFn: () =>
      apiFetch("/va-rates/mine", {
        method: "POST",
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["va-rates-mine"] })
      setForm({ client_id: "", pay_type: "hourly", currency: "PHP", amount: "" })
      setError("")
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Submit failed"),
  })

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">My Rates</h1>
        <p className="text-sm text-muted-foreground">Set your pay per client. Pending until Jane approves. Your previously approved rate stays active meanwhile.</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Submit / update a rate</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label>Client</Label>
            <Select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
              <option value="">Select…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>Pay type</Label>
            <Select value={form.pay_type} onChange={(e) => setForm({ ...form, pay_type: e.target.value as "hourly" | "package" })}>
              <option value="hourly">Hourly</option>
              <option value="package">Package (flat)</option>
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
            <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={form.pay_type === "hourly" ? "e.g. 185" : "e.g. 3000"} />
          </div>
          <div className="flex items-end">
            <Button variant="gold" disabled={!form.client_id || !form.amount || submit.isPending} onClick={() => submit.mutate()}>
              Submit for approval
            </Button>
          </div>
          {error && <p className="col-span-full text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Your rates</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="p-3">Client</th>
                <th className="p-3">Type</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Status</th>
                <th className="p-3">Active</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-3 font-semibold">{r.client_name}</td>
                  <td className="p-3 capitalize">{r.pay_type}</td>
                  <td className="p-3">{formatCurrency(r.amount, r.currency)}{r.pay_type === "hourly" ? "/hr" : " flat"}</td>
                  <td className="p-3"><StatusBadge status={r.status} /></td>
                  <td className="p-3">{r.is_active_approved ? "Yes" : "—"}</td>
                </tr>
              ))}
              {rates.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No rates yet. Submit one above.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
