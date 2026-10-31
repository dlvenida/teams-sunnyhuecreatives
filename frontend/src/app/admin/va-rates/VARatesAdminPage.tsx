import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { Client, VA } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/badge"
import { formatCurrency, roleLabel } from "@/lib/utils"
import { Check, X } from "lucide-react"

interface Compensation {
  va_id: string
  va_name?: string | null
  user_role?: string | null
  compensation_mode: string
  va_package_amount?: string | number | null
  va_package_currency?: string | null
}

interface Draft {
  mode: string
  amount: string
  currency: "PHP" | "USD"
}

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
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [compError, setCompError] = useState("")
  const [form, setForm] = useState({
    va_id: "", client_id: "", pay_type: "hourly" as "hourly" | "package", currency: "PHP" as "PHP" | "USD", amount: "",
  })

  const { data: rates = [] } = useQuery({
    queryKey: ["va-rates-admin", filter],
    queryFn: () => apiFetch<VARate[]>(`/va-rates${filter === "all" ? "" : `?status_filter=${filter}`}`),
  })
  const { data: arrangements } = useQuery({
    queryKey: ["va-compensation"],
    queryFn: () => apiFetch<Compensation[]>("/va-rates/compensation"),
  })
  const arrangementRows = arrangements ?? []
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
  useEffect(() => {
    if (!arrangements) return
    const next: Record<string, Draft> = {}
    for (const row of arrangements) {
      next[row.va_id] = {
        mode: row.compensation_mode || "hourly",
        amount: row.va_package_amount != null ? String(row.va_package_amount) : "",
        currency: row.va_package_currency === "PHP" ? "PHP" : "USD",
      }
    }
    setDrafts(next)
  }, [arrangements])

  const saveComp = useMutation({
    mutationFn: ({ vaId, draft }: { vaId: string; draft: Draft }) =>
      apiFetch(`/va-rates/compensation/${vaId}`, {
        method: "PATCH",
        body: JSON.stringify({
          compensation_mode: draft.mode,
          va_package_amount: draft.amount === "" ? null : parseFloat(draft.amount),
          va_package_currency: draft.currency,
        }),
      }),
    onSuccess: () => {
      setCompError("")
      qc.invalidateQueries({ queryKey: ["va-compensation"] })
    },
    onError: (e) => setCompError(e instanceof Error ? e.message : "Could not save pay arrangement"),
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
        <p className="text-sm text-muted-foreground">One approved rate per VA per client. Approving or overriding replaces any previous approved rate for that pair.</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Pay arrangement</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Hourly is hours × rate. Per-client package is a flat amount for that client in the period. Whole-VA package is one monthly amount for every client. VAs see this as read-only. The Project Manager sets her own amount on Profile; you can still edit it here. One approved rate per VA and client still applies below.
          </p>
          {compError && <p className="text-sm text-red-600">{compError}</p>}
          <div className="space-y-2">
            {arrangementRows.map((row) => {
              const draft = drafts[row.va_id] ?? { mode: row.compensation_mode, amount: "", currency: "USD" as const }
              const needsAmount = draft.mode === "va_package" && (draft.amount === "" || Number.isNaN(parseFloat(draft.amount)))
              return (
                <div key={row.va_id} className="grid items-end gap-2 rounded-xl border p-3 sm:grid-cols-[1.2fr_1fr_120px_110px_auto]">
                  <div>
                    <p className="text-sm font-semibold">{row.va_name || "VA"}</p>
                    <p className="text-[11px] text-muted-foreground">{roleLabel(row.user_role)}</p>
                  </div>
                  <div>
                    <Label>Pay type</Label>
                    <Select
                      value={draft.mode}
                      onChange={(e) => setDrafts({ ...drafts, [row.va_id]: { ...draft, mode: e.target.value } })}
                    >
                      <option value="hourly">Hourly</option>
                      <option value="per_client_package">Fixed package per client</option>
                      <option value="va_package">Fixed package for all clients</option>
                    </Select>
                  </div>
                  <div>
                    <Label>Package amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={draft.amount}
                      disabled={draft.mode !== "va_package"}
                      onChange={(e) => setDrafts({ ...drafts, [row.va_id]: { ...draft, amount: e.target.value } })}
                    />
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Select
                      value={draft.currency}
                      disabled={draft.mode !== "va_package"}
                      onChange={(e) => setDrafts({ ...drafts, [row.va_id]: { ...draft, currency: e.target.value as "PHP" | "USD" } })}
                    >
                      <option value="USD">USD</option>
                      <option value="PHP">PHP</option>
                    </Select>
                  </div>
                  <Button
                    variant="gold"
                    size="sm"
                    disabled={needsAmount || saveComp.isPending}
                    onClick={() => saveComp.mutate({ vaId: row.va_id, draft })}
                  >
                    Save
                  </Button>
                </div>
              )
            })}
            {arrangementRows.length === 0 && <p className="text-xs text-muted-foreground">No VA profiles yet.</p>}
          </div>
        </CardContent>
      </Card>

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
