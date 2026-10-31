import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { WorkLog, Client, VA } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input, Label, Select } from "@/components/ui/input"
import { StatCard } from "@/components/magicui/stat-card"
import { cn, formatCurrency, formatDate, formatDurationLabel } from "@/lib/utils"
import { Check, X, Pencil, Trash2, Download, Search, Clock3, Hand, Paperclip } from "lucide-react"
import { useDisplaySettings } from "@/hooks/useDisplaySettings"
import { LogAttachmentsViewer } from "@/components/logs/LogAttachmentsViewer"

const STATUS_META: Record<string, { label: string; dot: string; pill: string }> = {
  submitted: { label: "Submitted", dot: "bg-amber-500", pill: "bg-amber-100 text-amber-800 border-amber-200" },
  approved: { label: "Approved", dot: "bg-green-500", pill: "bg-green-100 text-green-800 border-green-200" },
  rejected: { label: "Rejected", dot: "bg-red-500", pill: "bg-red-100 text-red-700 border-red-200" },
  invoiced: { label: "Invoiced", dot: "bg-violet-500", pill: "bg-violet-100 text-violet-800 border-violet-200" },
}
const PRESETS = [
  { id: "all", label: "All time" }, { id: "today", label: "Today" }, { id: "this_week", label: "This week" },
  { id: "last_week", label: "Last week" }, { id: "this_month", label: "This month" }, { id: "custom", label: "Custom range" },
] as const

function presetRange(id: string): { from: string; to: string } {
  const t = new Date(); const iso = (d: Date) => d.toISOString().slice(0, 10)
  if (id === "today") return { from: iso(t), to: iso(t) }
  if (id === "this_week" || id === "last_week") {
    const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7) - (id === "last_week" ? 7 : 0))
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { from: iso(mon), to: iso(sun) }
  }
  if (id === "this_month") { const s = new Date(t.getFullYear(), t.getMonth(), 1); const e = new Date(t.getFullYear(), t.getMonth() + 1, 0); return { from: iso(s), to: iso(e) } }
  return { from: "", to: "" }
}
function initials(name: string) { return (name || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() }
function dayLabel(dateStr: string) {
  const today = new Date().toISOString().slice(0, 10)
  const y = new Date(); y.setDate(y.getDate() - 1)
  if (dateStr === today) return "Today"
  if (dateStr === y.toISOString().slice(0, 10)) return "Yesterday"
  return formatDate(dateStr)
}

export function LogsPage() {
  const isAuditor = getAuthUser()?.role === "auditor"
  const readOnly = false // auditors can approve/edit logs (non-money); money columns still hidden via showPricing
  const qc = useQueryClient()
  const { showPricing } = useDisplaySettings()
  const [filters, setFilters] = useState({ client_id: "", va_id: "", status: "", date_from: "", date_to: "" })
  const [preset, setPreset] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [groupBy, setGroupBy] = useState("date")
  const [sort, setSort] = useState("newest")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<WorkLog | null>(null)
  const [editForm, setEditForm] = useState({ description_plain: "", hours: "", va_rate: "", status: "", start_time: "", end_time: "" })
  const [viewingAtts, setViewingAtts] = useState<string | null>(null)

  const params = new URLSearchParams()
  if (filters.client_id) params.set("client_id", filters.client_id)
  if (filters.va_id) params.set("va_id", filters.va_id)
  if (filters.status) params.set("status", filters.status)
  if (filters.date_from) params.set("date_from", filters.date_from)
  if (filters.date_to) params.set("date_to", filters.date_to)

  const { data: logs = [], isLoading } = useQuery({ queryKey: ["work-logs", filters], queryFn: () => apiFetch<WorkLog[]>(`/work-logs?${params}`) })
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => apiFetch<Client[]>("/clients") })
  const { data: vas = [] } = useQuery({ queryKey: ["vas"], queryFn: () => apiFetch<VA[]>("/vas") })

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["work-logs"] }); qc.invalidateQueries({ queryKey: ["dashboard-overview"] }); qc.invalidateQueries({ queryKey: ["report-clients"] }) }
  const approve = useMutation({ mutationFn: (id: string) => apiFetch(`/work-logs/${id}/approve`, { method: "POST" }), onSuccess: invalidate })
  const reject = useMutation({ mutationFn: (id: string) => apiFetch(`/work-logs/${id}/reject`, { method: "POST" }), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => apiFetch(`/work-logs/${id}`, { method: "DELETE" }), onSuccess: invalidate })
  const update = useMutation({
    mutationFn: (data: { id: string; body: Record<string, unknown> }) => apiFetch(`/work-logs/${data.id}`, { method: "PATCH", body: JSON.stringify(data.body) }),
    onSuccess: () => { invalidate(); setEditing(null) },
  })

  const bulk = async (action: "approve" | "reject" | "delete") => {
    const ids = [...selected]
    await Promise.all(ids.map(id => action === "delete" ? remove.mutateAsync(id) : action === "approve" ? approve.mutateAsync(id) : reject.mutateAsync(id)))
    setSelected(new Set())
  }

  const handleExport = async () => {
    const csv = await apiFetch<string>(`/work-logs/export?${params}`)
    const blob = new Blob([csv], { type: "text/csv" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "work-logs.csv"; a.click(); URL.revokeObjectURL(a.href)
  }

  const counts = useMemo(() => {
    const by = (s: string) => logs.filter(l => l.status === s)
    return {
      total: logs.reduce((s, l) => s + Number(l.hours || 0), 0),
      submitted: by("submitted"), approved: by("approved"), invoiced: by("invoiced"), rejected: by("rejected"),
      sum: (arr: WorkLog[]) => arr.reduce((s, l) => s + Number(l.hours || 0), 0),
    }
  }, [logs])

  const shown = useMemo(() => {
    let out = logs.filter(l => !search || `${l.description_plain} ${l.va_name} ${l.client_name} ${l.task_title ?? ""} ${l.project_name ?? ""}`.toLowerCase().includes(search.toLowerCase()))
    out = [...out].sort((a, b) => sort === "oldest" ? a.work_date.localeCompare(b.work_date) : sort === "hours" ? Number(b.hours) - Number(a.hours) : b.work_date.localeCompare(a.work_date))
    return out
  }, [logs, search, sort])

  const groups = useMemo(() => {
    const map = new Map<string, WorkLog[]>()
    for (const l of shown) {
      const key = groupBy === "va" ? (l.va_name ?? "Unassigned") : groupBy === "client" ? (l.client_name ?? "No client") : groupBy === "status" ? STATUS_META[l.status]?.label ?? l.status : groupBy === "none" ? "All logs" : dayLabel(l.work_date)
      map.set(key, [...(map.get(key) ?? []), l])
    }
    return [...map.entries()]
  }, [shown, groupBy])

  const selectedHours = logs.filter(l => selected.has(l.id)).reduce((s, l) => s + Number(l.hours || 0), 0)
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const openEdit = (log: WorkLog) => {
    setEditing(log)
    setEditForm({
      description_plain: log.description_plain,
      hours: log.hours,
      va_rate: log.va_rate,
      status: log.status,
      start_time: log.start_time?.slice(0, 5) || "09:00",
      end_time: log.end_time?.slice(0, 5) || "17:00",
    })
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <h1 className="font-display text-xl font-bold">All Logs</h1>
          <p className="text-xs text-muted-foreground">{showPricing ? "Every VA time log — approve what's submitted, spot the clock-ins, and keep payroll & reports clean." : "Every VA time log — approve what's submitted and spot the clock-ins. Hours only."}</p>
        </div>
        <Button variant="outline" onClick={handleExport}><Download className="h-4 w-4" /> Export CSV</Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Hours Shown" value={`${counts.total.toFixed(2)} hrs`} subtitle={`${logs.length} entries in view`} />
        <StatCard title="Pending Approval" value={`${counts.sum(counts.submitted).toFixed(2)} hrs`} subtitle={`${counts.submitted.length} logs waiting on you`} />
        <StatCard title="Approved" value={`${counts.sum(counts.approved).toFixed(2)} hrs`} subtitle={showPricing ? "Ready for reports & payroll" : "Approved hours"} />
        <StatCard title="Invoiced" value={`${counts.sum(counts.invoiced).toFixed(2)} hrs`} subtitle={`${counts.rejected.length} rejected in view`} />
      </div>

      {/* Monday-style toolbar */}
      <Card><CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {[{ id: "", label: "All" }, ...Object.entries(STATUS_META).map(([id, m]) => ({ id, label: m.label }))].map(t => {
            const n = t.id ? logs.filter(l => l.status === t.id).length : logs.length
            const active = filters.status === t.id
            return (
              <button key={t.id || "all"} onClick={() => setFilters({ ...filters, status: t.id })} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition", active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted/60")}>
                {t.id && <span className={cn("h-2 w-2 rounded-full", STATUS_META[t.id].dot)} />}{t.label}
                <span className={cn("rounded-full px-1.5 text-[10px] font-bold", active ? "bg-white/25" : "bg-muted")}>{n}</span>
              </button>
            )
          })}
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search description, task, VA, client…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div><Label>Client</Label><Select value={filters.client_id} onChange={(e) => setFilters({ ...filters, client_id: e.target.value })}><option value="">All clients</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
          <div><Label>VA</Label><Select value={filters.va_id} onChange={(e) => setFilters({ ...filters, va_id: e.target.value })}><option value="">All VAs</option>{vas.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></div>
          <div><Label>Period</Label><Select value={preset} onChange={(e) => { const p = e.target.value; setPreset(p); if (p !== "custom") { const r = presetRange(p); setFilters(f => ({ ...f, date_from: r.from, date_to: r.to })) } }}>{PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></div>
          <div><Label>Group by</Label><Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}><option value="date">Date</option><option value="va">VA</option><option value="client">Client</option><option value="status">Status</option><option value="none">No grouping</option></Select></div>
          <div><Label>Sort</Label><Select value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="hours">Most hours</option></Select></div>
        </div>
        {preset === "custom" && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div><Label>From</Label><Input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} /></div>
            <div><Label>To</Label><Input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} /></div>
          </div>
        )}
      </CardContent></Card>

      {/* Bulk action bar */}
      {!readOnly && selected.size > 0 && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <span className="font-bold">{selected.size} selected · {selectedHours.toFixed(2)} hrs</span>
          <Button size="sm" variant="success" onClick={() => bulk("approve")}><Check className="h-3 w-3" /> Approve all</Button>
          <Button size="sm" variant="danger" onClick={() => bulk("reject")}><X className="h-3 w-3" /> Reject all</Button>
          {!isAuditor && <Button size="sm" variant="outline" onClick={() => bulk("delete")}><Trash2 className="h-3 w-3" /> Delete</Button>}
          <button className="ml-auto font-semibold text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {/* Grouped Monday table */}
      <div className="overflow-x-auto rounded-2xl border bg-card">
        {isLoading && <p className="p-6 text-sm text-muted-foreground">Loading logs…</p>}
        {!isLoading && shown.length === 0 && <div className="p-10 text-center"><p className="text-sm font-semibold">No logs match</p><p className="mt-1 text-xs text-muted-foreground">Try clearing the search or choosing a wider period.</p></div>}
        {groups.map(([label, items]) => (
          <div key={label}>
            {groupBy !== "none" && (
              <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
                <p className="text-xs font-extrabold">{label}</p>
                <p className="text-[11px] font-semibold text-muted-foreground">{items.length} entries · {items.reduce((s, l) => s + Number(l.hours || 0), 0).toFixed(2)} hrs</p>
              </div>
            )}
            <table className="w-full text-sm">
              {groupBy === "none" && <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-3 w-8"></th><th className="p-3">Date</th><th className="p-3">VA</th><th className="p-3">Client / Project</th><th className="p-3">Description</th><th className="p-3">Time</th><th className="p-3">Hours</th>{showPricing && <th className="p-3">Pay</th>}<th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr></thead>}
              <tbody>
                {items.map(log => (
                  <tr key={log.id} className={cn("border-b transition hover:bg-primary/[0.03]", selected.has(log.id) && "bg-primary/[0.05]")}>
                    <td className="p-3">{!readOnly && <input type="checkbox" className="accent-[var(--primary)]" checked={selected.has(log.id)} onChange={() => toggle(log.id)} />}</td>
                    <td className="whitespace-nowrap p-3 text-xs font-medium">{formatDate(log.work_date)}</td>
                    <td className="p-3"><span className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-extrabold text-primary">{initials(log.va_name ?? "?")}</span><span className="whitespace-nowrap text-xs font-semibold">{log.va_name}</span></span></td>
                    <td className="p-3 text-xs"><span className="font-medium">{log.client_name}</span>{log.sub_client_name && <span className="text-muted-foreground"> / {log.sub_client_name}</span>}{log.project_name && <span className="block text-[11px] text-muted-foreground">{log.project_name}</span>}</td>
                    <td className="max-w-xs p-3 text-xs">
                      <span className="line-clamp-2">{log.description_plain}</span>
                      {log.notes && <span className="mt-1 block line-clamp-2 text-[11px] text-amber-800">💬 {log.notes}</span>}
                      {log.task_title && <span className="block text-[11px] text-muted-foreground">Task: {log.task_title}</span>}
                    </td>
                    <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">
                      {log.clock_in_at ? `${new Date(log.clock_in_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} → ${log.clock_out_at ? new Date(log.clock_out_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "…"}` : log.entry_mode === "duration" ? formatDurationLabel(log.hours) : `${log.start_time?.slice(0, 5) || "—"}–${log.end_time?.slice(0, 5) || "—"}`}
                      <span className={cn("ml-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", log.source === "clock" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600")}>{log.source === "clock" ? <><Clock3 className="h-2.5 w-2.5" /> Clock</> : <><Hand className="h-2.5 w-2.5" /> Manual</>}</span>
                    </td>
                    <td className="p-3 text-xs font-extrabold">{Number(log.hours).toFixed(2)}</td>
                    {showPricing && <td className="whitespace-nowrap p-3 text-xs">{formatCurrency(log.va_pay)}</td>}
                    <td className="p-3"><span className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold", STATUS_META[log.status]?.pill)}>{STATUS_META[log.status]?.label ?? log.status}</span></td>
                    <td className="p-3"><div className="flex justify-end gap-1">
                      {!readOnly && log.status === "submitted" && <><Button size="sm" variant="success" title="Approve" onClick={() => approve.mutate(log.id)}><Check className="h-3 w-3" /></Button><Button size="sm" variant="danger" title="Reject" onClick={() => reject.mutate(log.id)}><X className="h-3 w-3" /></Button></>}
                      {!readOnly && <Button size="sm" variant="ghost" title="Edit" onClick={() => openEdit(log)}><Pencil className="h-3 w-3" /></Button>}
                      {!readOnly && !isAuditor && log.status !== "invoiced" && <Button size="sm" variant="ghost" title="Delete" onClick={() => { if (confirm("Delete this log?")) remove.mutate(log.id) }}><Trash2 className="h-3 w-3" /></Button>}
                      {(log.attachment_count ?? 0) > 0 && (
                        <Button size="sm" variant="ghost" title="View attachments" onClick={() => setViewingAtts(log.id)}>
                          <Paperclip className="h-3 w-3" />{log.attachment_count}
                        </Button>
                      )}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {shown.length > 0 && (
          <div className="flex flex-wrap justify-between gap-2 bg-muted/40 px-3 py-2.5 text-xs font-bold">
            <span>{shown.length} entries shown</span>
            <span>Total: {shown.reduce((s, l) => s + Number(l.hours || 0), 0).toFixed(2)} hrs{showPricing ? ` · ${formatCurrency(shown.reduce((s, l) => s + Number(l.va_pay || 0), 0))} pay` : ""}</span>
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-card p-6" onClick={e => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-semibold">Edit Log Entry</h2>
            <p className="mb-4 text-xs text-muted-foreground">{editing.va_name} · {editing.client_name} · {formatDate(editing.work_date)} · {Number(editing.hours).toFixed(2)} hrs</p>
            <div className="space-y-3">
              <div><Label>Description</Label><Input value={editForm.description_plain} onChange={(e) => setEditForm({ ...editForm, description_plain: e.target.value })} /></div>
              {editing.notes && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <span className="font-bold">VA comments: </span>{editing.notes}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Start</Label><Input type="time" value={editForm.start_time} onChange={(e) => setEditForm({ ...editForm, start_time: e.target.value })} /></div>
                <div><Label>End</Label><Input type="time" value={editForm.end_time} onChange={(e) => setEditForm({ ...editForm, end_time: e.target.value })} /></div>
                {showPricing && <div><Label>VA Rate</Label><Input type="number" step="0.01" value={editForm.va_rate} onChange={(e) => setEditForm({ ...editForm, va_rate: e.target.value })} /></div>}
                <div><Label>Status</Label><Select value={editForm.status} disabled={isAuditor && editForm.status === "invoiced"} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option>{(!isAuditor || editForm.status === "invoiced") && <option value="invoiced">Invoiced</option>}</Select></div>
              </div>
              <p className="text-[11px] text-muted-foreground">{showPricing ? "Hours and pay recalculate from start/end and rate." : "Hours recalculate from start and end."}</p>
              <Button variant="outline" size="sm" onClick={() => setViewingAtts(editing.id)}>
                View attachments ({editing.attachment_count ?? 0})
              </Button>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button variant="gold" onClick={() => update.mutate({
                  id: editing.id,
                  body: {
                    description_plain: editForm.description_plain,
                    start_time: editForm.start_time,
                    end_time: editForm.end_time,
                    ...(showPricing ? { va_rate: parseFloat(editForm.va_rate) } : {}),
                    status: editForm.status,
                  },
                })}>Save</Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {viewingAtts && <LogAttachmentsViewer logId={viewingAtts} onClose={() => setViewingAtts(null)} />}
    </div>
  )
}
