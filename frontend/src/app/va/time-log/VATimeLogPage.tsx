import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { Client, Project, SubClient, TaskItem, WorkLog } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/badge"
import { RichTextEditor } from "@/components/lexical/RichTextEditor"
import { calculateHoursFromTimes, formatCurrency } from "@/lib/utils"
import { useDisplaySettings } from "@/hooks/useDisplaySettings"

export function VATimeLogPage() {
  const qc = useQueryClient()
  const { showPricing, default_va_hourly_rate } = useDisplaySettings()
  const [form, setForm] = useState({
    work_date: new Date().toISOString().split("T")[0],
    client_id: "",
    sub_client_id: "",
    project_id: "",
    task_id: "",
    start_time: "09:00",
    end_time: "17:00",
    va_rate: "",
    notes: "",
  })
  const [descriptionLexical, setDescriptionLexical] = useState<Record<string, unknown> | null>(null)
  const [descriptionPlain, setDescriptionPlain] = useState("")
  const [error, setError] = useState("")

  const { data: clients = [] } = useQuery({ queryKey: ["va-clients"], queryFn: () => apiFetch<Client[]>("/va/clients") })
  const { data: subClients = [] } = useQuery({
    queryKey: ["va-sub-clients", form.client_id],
    queryFn: () => apiFetch<SubClient[]>(`/va/sub-clients?client_id=${form.client_id}`),
    enabled: !!form.client_id,
  })
  const { data: logs = [] } = useQuery({ queryKey: ["va-logs"], queryFn: () => apiFetch<WorkLog[]>("/va/work-logs") })
  const { data: myTasks = [] } = useQuery({ queryKey: ["tasks-mine"], queryFn: () => apiFetch<TaskItem[]>("/tasks?mine=true") })
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => apiFetch<Project[]>("/projects?include_archived=false") })

  const hours = calculateHoursFromTimes(form.start_time, form.end_time)
  const rateForSubmit = parseFloat(form.va_rate || default_va_hourly_rate || "75")
  const estimatedPay = (hours * rateForSubmit).toFixed(2)

  useEffect(() => {
    if (!showPricing && !form.va_rate) {
      setForm((f) => ({ ...f, va_rate: default_va_hourly_rate || "75" }))
    }
  }, [showPricing, default_va_hourly_rate, form.va_rate])

  const [editingLog, setEditingLog] = useState<WorkLog | null>(null)
  const [editDesc, setEditDesc] = useState("")
  const [editTimes, setEditTimes] = useState({ start_time: "09:00", end_time: "17:00" })
  const editLog = useMutation({
    mutationFn: () => apiFetch(`/va/work-logs/${editingLog!.id}`, { method: "PATCH", body: JSON.stringify({ description_plain: editDesc, start_time: editTimes.start_time, end_time: editTimes.end_time }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["va-logs"] }); setEditingLog(null) },
    onError: (err) => setError(err instanceof Error ? err.message : "Edit failed"),
  })
  const deleteLog = useMutation({
    mutationFn: (id: string) => apiFetch(`/va/work-logs/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["va-logs"] }),
    onError: (err) => setError(err instanceof Error ? err.message : "Delete failed"),
  })

  const submit = useMutation({
    mutationFn: () => apiFetch("/va/work-logs", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        sub_client_id: form.sub_client_id || null,
        project_id: form.project_id || null,
        task_id: form.task_id || null,
        va_rate: rateForSubmit,
        description_lexical: descriptionLexical,
        description_plain: descriptionPlain,
        notes: form.notes || null,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["va-logs"] })
      qc.invalidateQueries({ queryKey: ["notifications-va-logs"] })
      setDescriptionPlain("")
      setDescriptionLexical(null)
      setError("")
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Submit failed"),
  })

  return (
    <div className="mx-auto max-w-3xl space-y-4 animate-fade-in">
      <div>
        <h1 className="text-base font-semibold">Log Time</h1>
        <p className="text-[11px] text-muted-foreground">Submit your work hours and tasks</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>New Entry</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Date</Label><Input type="date" value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} /></div>
            <div><Label>Client</Label><Select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value, sub_client_id: "" })}><option value="">Select client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            {subClients.length > 0 && <div><Label>Sub-client</Label><Select value={form.sub_client_id} onChange={(e) => setForm({ ...form, sub_client_id: e.target.value })}><option value="">None</option>{subClients.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>}
            <div><Label>Project</Label><Select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}><option value="">No project</option>{projects.filter((p) => !form.client_id || p.client_id === form.client_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
            <div><Label>My Task</Label><Select value={form.task_id} onChange={(e) => { const t = myTasks.find((x) => x.id === e.target.value); setForm({ ...form, task_id: e.target.value, client_id: t ? t.client_id : form.client_id, project_id: (t && t.project_id) || form.project_id }) }}><option value="">No task</option>{myTasks.filter((t) => t.status !== "done").map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select></div>
            <div><Label>Start Time</Label><Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
            <div><Label>End Time</Label><Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
            <div><Label>Total Hours</Label><Input value={`${hours.toFixed(2)} hrs`} disabled /></div>
            {showPricing && (
              <>
                <div><Label>Your Rate (USD/hr)</Label><Input type="number" step="0.01" value={form.va_rate} onChange={(e) => setForm({ ...form, va_rate: e.target.value })} /></div>
                <div><Label>Estimated Pay</Label><Input value={formatCurrency(estimatedPay)} disabled /></div>
              </>
            )}
          </div>
          <div><Label>Task / Service Performed</Label><RichTextEditor onChange={(lex, plain) => { setDescriptionLexical(lex); setDescriptionPlain(plain) }} /></div>
          <div><Label>Notes (optional)</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <Button variant="gold" className="w-full" onClick={() => submit.mutate()} disabled={!form.client_id || !descriptionPlain || submit.isPending}>
            {submit.isPending ? "Submitting..." : "Submit Entry"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Your Entries</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">Date</th><th className="p-2">Client</th><th className="p-2">Time</th><th className="p-2">Hours</th>{showPricing && <><th className="p-2">Rate</th><th className="p-2">Pay</th></>}<th className="p-2">Status</th><th className="p-2"></th></tr></thead>
            <tbody>{logs.map((log) => (
              <tr key={log.id} className="border-b border-border">
                <td className="p-2">{log.work_date}</td>
                <td className="p-2">{log.client_name}{log.task_title && <span className="block text-[10px] text-muted-foreground">{log.task_title}</span>}</td>
                <td className="p-2 whitespace-nowrap">{log.clock_in_at ? `${new Date(log.clock_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–${log.clock_out_at ? new Date(log.clock_out_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "…"}` : `${log.start_time?.slice(0, 5)}–${log.end_time?.slice(0, 5)}`}<span className="block text-[10px] text-muted-foreground">{log.source === "clock" ? "clock" : "manual"}</span></td>
                <td className="p-2">{log.hours}</td>
                {showPricing && <><td className="p-2">{formatCurrency(log.va_rate)}</td><td className="p-2">{formatCurrency(log.va_pay)}</td></>}
                <td className="p-2"><StatusBadge status={log.status} /></td>
                <td className="p-2 whitespace-nowrap">
                  {(log.status === "submitted" || log.status === "rejected") ? <>
                    <button className="underline mr-2" onClick={() => { setEditingLog(log); setEditDesc(log.description_plain); setEditTimes({ start_time: log.start_time?.slice(0, 5) || "09:00", end_time: log.end_time?.slice(0, 5) || "17:00" }) }}>Edit</button>
                    <button className="underline text-red-600" onClick={() => { if (confirm("Delete this log entry?")) deleteLog.mutate(log.id) }}>Delete</button>
                  </> : <span className="text-[10px] text-muted-foreground">locked</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {logs.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">No entries yet. Clock in or submit your first log above.</p>}
        </CardContent>
      </Card>

      {editingLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditingLog(null)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-sm font-semibold mb-3">Edit Log — {editingLog.work_date}</h2>
            <div className="space-y-3">
              <div><Label>Description</Label><Input value={editDesc} onChange={e => setEditDesc(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Start</Label><Input type="time" value={editTimes.start_time} onChange={e => setEditTimes({ ...editTimes, start_time: e.target.value })} /></div>
                <div><Label>End</Label><Input type="time" value={editTimes.end_time} onChange={e => setEditTimes({ ...editTimes, end_time: e.target.value })} /></div>
              </div>
              <p className="text-[11px] text-muted-foreground">Hours & pay recalculate automatically.{editingLog.status === "rejected" ? " Saving resubmits this log." : ""}</p>
              <div className="flex gap-2"><Button variant="gold" className="flex-1" disabled={!editDesc || editLog.isPending} onClick={() => editLog.mutate()}>Save</Button><Button variant="outline" onClick={() => setEditingLog(null)}>Cancel</Button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
