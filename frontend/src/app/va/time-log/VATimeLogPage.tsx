import { useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { Client, Project, SubClient, TaskItem, WorkLog } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/badge"
import { RichTextEditor } from "@/components/lexical/RichTextEditor"
import { calculateHoursFromTimes, formatCurrency, formatDurationLabel, hoursFromDuration, splitHours } from "@/lib/utils"
import { Paperclip, Plus, X } from "lucide-react"
import { LogAttachmentsViewer } from "@/components/logs/LogAttachmentsViewer"

interface ApprovedRate {
  id: string
  pay_type: "hourly" | "package"
  currency: "PHP" | "USD"
  amount: string
}

async function uploadWorkLogFile(logId: string, file: File) {
  const fd = new FormData()
  fd.append("file", file)
  return apiFetch(`/work-logs/${logId}/attachments`, { method: "POST", body: fd })
}

async function uploadTaskCommentFiles(taskId: string, files: File[], note: string) {
  if (!files.length) return
  const ids: string[] = []
  for (const file of files) {
    const fd = new FormData()
    fd.append("file", file)
    const att = await apiFetch<{ id: string }>(`/tasks/${taskId}/comments/attachments`, { method: "POST", body: fd })
    ids.push(att.id)
  }
  await apiFetch(`/tasks/${taskId}/comments`, {
    method: "POST",
    body: JSON.stringify({
      body: note.trim() || `📎 Attached ${files.length} file(s) with time log`,
      attachment_ids: ids,
    }),
  })
}

export function VATimeLogPage() {
  const qc = useQueryClient()
  const role = getAuthUser()?.role
  const isStaff = role === "admin" || role === "auditor"
  const showMoney = role !== "auditor"
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({
    work_date: new Date().toISOString().split("T")[0],
    client_id: "",
    sub_client_id: "",
    project_id: "",
    task_id: "",
    start_time: "09:00",
    end_time: "17:00",
    notes: "",
  })
  const [timeMode, setTimeMode] = useState<"range" | "duration">("range")
  const [duration, setDuration] = useState({ hours: "2", minutes: "30" })
  const [descriptionLexical, setDescriptionLexical] = useState<Record<string, unknown> | null>(null)
  const [descriptionPlain, setDescriptionPlain] = useState("")
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [error, setError] = useState("")
  const [projectModal, setProjectModal] = useState(false)
  const [newProject, setNewProject] = useState({ name: "", description: "", client_id: "" })
  const [projectError, setProjectError] = useState("")

  const { data: clients = [] } = useQuery({
    queryKey: [isStaff ? "clients" : "va-clients"],
    queryFn: () => apiFetch<Client[]>(isStaff ? "/clients?active_only=true" : "/va/clients"),
  })
  const { data: subClients = [] } = useQuery({
    queryKey: ["va-sub-clients", form.client_id],
    queryFn: () => apiFetch<SubClient[]>(`/va/sub-clients?client_id=${form.client_id}`),
    enabled: !!form.client_id,
  })
  const { data: approvedRate } = useQuery({
    queryKey: ["va-rate-client", form.client_id],
    queryFn: () => apiFetch<ApprovedRate | null>(`/va-rates/mine/for-client/${form.client_id}`),
    enabled: !!form.client_id && showMoney,
  })
  const { data: logs = [] } = useQuery({ queryKey: ["va-logs"], queryFn: () => apiFetch<WorkLog[]>("/va/work-logs") })
  const { data: myTasks = [] } = useQuery({ queryKey: ["tasks-mine"], queryFn: () => apiFetch<TaskItem[]>("/tasks?mine=true") })
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => apiFetch<Project[]>("/projects?include_archived=false") })

  const createProject = useMutation({
    mutationFn: () =>
      apiFetch<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: newProject.name.trim(),
          description: newProject.description.trim() || null,
          client_id: newProject.client_id,
        }),
      }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] })
      setForm((f) => ({ ...f, client_id: p.client_id, project_id: p.id }))
      setProjectModal(false)
      setNewProject({ name: "", description: "", client_id: "" })
      setProjectError("")
    },
    onError: (e: Error) => setProjectError(e.message),
  })

  const durationHours = Math.max(0, parseInt(duration.hours || "0", 10) || 0)
  const durationMinutes = Math.max(0, parseInt(duration.minutes || "0", 10) || 0)
  const durationValid = timeMode === "range" || (durationHours <= 24 && durationMinutes <= 59 && hoursFromDuration(durationHours, durationMinutes) > 0 && hoursFromDuration(durationHours, durationMinutes) <= 24)
  const hours = timeMode === "duration" ? hoursFromDuration(durationHours, durationMinutes) : calculateHoursFromTimes(form.start_time, form.end_time)
  const rateAmt = approvedRate ? parseFloat(approvedRate.amount) : null
  const estimatedPay =
    approvedRate?.pay_type === "package"
      ? formatCurrency(approvedRate.amount, approvedRate.currency) + " flat (package)"
      : rateAmt != null
        ? formatCurrency((hours * rateAmt).toFixed(2), approvedRate?.currency)
        : "Set rate in My Rates"

  const [editingLog, setEditingLog] = useState<WorkLog | null>(null)
  const [editDesc, setEditDesc] = useState("")
  const [editTimes, setEditTimes] = useState({ start_time: "09:00", end_time: "17:00" })
  const [editMode, setEditMode] = useState<"range" | "duration">("range")
  const [editDuration, setEditDuration] = useState({ hours: "0", minutes: "0" })
  const [viewingLog, setViewingLog] = useState<WorkLog | null>(null)

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return
    const next = Array.from(list)
    setPendingFiles((prev) => [...prev, ...next])
  }

  const editLog = useMutation({
    mutationFn: () =>
      apiFetch(`/va/work-logs/${editingLog!.id}`, {
        method: "PATCH",
        body: JSON.stringify(
          editMode === "duration"
            ? {
                description_plain: editDesc,
                entry_mode: "duration",
                duration_hours: Math.max(0, parseInt(editDuration.hours || "0", 10) || 0),
                duration_minutes: Math.max(0, parseInt(editDuration.minutes || "0", 10) || 0),
              }
            : { description_plain: editDesc, entry_mode: "range", start_time: editTimes.start_time, end_time: editTimes.end_time },
        ),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["va-logs"] })
      setEditingLog(null)
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Edit failed"),
  })
  const deleteLog = useMutation({
    mutationFn: (id: string) => apiFetch(`/va/work-logs/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["va-logs"] }),
    onError: (err) => setError(err instanceof Error ? err.message : "Delete failed"),
  })

  const submit = useMutation({
    mutationFn: async () => {
      const log = await apiFetch<WorkLog>("/va/work-logs", {
        method: "POST",
        body: JSON.stringify({
          work_date: form.work_date,
          client_id: form.client_id,
          sub_client_id: form.sub_client_id || null,
          project_id: form.project_id || null,
          task_id: form.task_id || null,
          description_lexical: descriptionLexical,
          description_plain: descriptionPlain,
          notes: form.notes || null,
          entry_mode: timeMode,
          ...(timeMode === "duration"
            ? { duration_hours: durationHours, duration_minutes: durationMinutes }
            : { start_time: form.start_time, end_time: form.end_time }),
        }),
      })
      const uploadErrors: string[] = []
      for (const file of pendingFiles) {
        try {
          await uploadWorkLogFile(log.id, file)
        } catch (err) {
          uploadErrors.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`)
        }
      }
      if (form.task_id && pendingFiles.length) {
        try {
          await uploadTaskCommentFiles(form.task_id, pendingFiles, descriptionPlain)
        } catch (err) {
          uploadErrors.push(`Task comment: ${err instanceof Error ? err.message : "attach failed"}`)
        }
      }
      if (uploadErrors.length) {
        throw new Error(`Time log saved, but some attachments failed: ${uploadErrors.join("; ")}`)
      }
      return log
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["va-logs"] })
      qc.invalidateQueries({ queryKey: ["notifications-va-logs"] })
      if (form.task_id) qc.invalidateQueries({ queryKey: ["comments", "task", form.task_id] })
      setDescriptionPlain("")
      setDescriptionLexical(null)
      setPendingFiles([])
      setError("")
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Submit failed"),
  })

  return (
    <div className="mx-auto max-w-3xl space-y-4 animate-fade-in">
      <div>
        <h1 className="text-base font-semibold">Log Time</h1>
        <p className="text-[11px] text-muted-foreground">
          {showMoney
            ? "Rate auto-fills from your approved My Rates profile"
            : "Log your own hours — date, a time range or a duration, and the task or service performed."}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>New Entry</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Date</Label><Input type="date" value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} /></div>
            <div><Label>Client</Label><Select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value, sub_client_id: "" })}><option value="">Select client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            {subClients.length > 0 && <div><Label>Sub-client</Label><Select value={form.sub_client_id} onChange={(e) => setForm({ ...form, sub_client_id: e.target.value })}><option value="">None</option>{subClients.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>}
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <Label>Project</Label>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                  onClick={() => {
                    setProjectError("")
                    setNewProject({ name: "", description: "", client_id: form.client_id || "" })
                    setProjectModal(true)
                  }}
                >
                  <Plus className="h-3 w-3" /> New project
                </button>
              </div>
              <Select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                <option value="">No project</option>
                {projects.filter((p) => !form.client_id || p.client_id === form.client_id).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
              {projects.filter((p) => !form.client_id || p.client_id === form.client_id).length === 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">No projects yet — create one so you can select it when logging time.</p>
              )}
            </div>
            <div>
              <Label>My Task</Label>
              <Select
                value={form.task_id}
                onChange={(e) => {
                  const t = myTasks.find((x) => x.id === e.target.value)
                  setForm({
                    ...form,
                    task_id: e.target.value,
                    client_id: t ? t.client_id : form.client_id,
                    project_id: (t && t.project_id) || form.project_id,
                  })
                }}
              >
                <option value="">No task</option>
                {Array.from(
                  myTasks
                    .filter((t) => t.status !== "done")
                    .slice()
                    .sort((a, b) => (a.client_name || "").localeCompare(b.client_name || "") || (a.project_name || "").localeCompare(b.project_name || "") || a.title.localeCompare(b.title))
                    .reduce((map, t) => {
                      const client = t.client_name || "No client"
                      const list = map.get(client) || []
                      list.push(t)
                      map.set(client, list)
                      return map
                    }, new Map<string, TaskItem[]>()),
                ).map(([client, items]) => (
                  <optgroup key={client} label={client}>
                    {items.map((t) => {
                      const projectName = t.project_name || projects.find((p) => p.id === t.project_id)?.name || "No project"
                      return (
                        <option key={t.id} value={t.id}>
                          {projectName} — {t.title}
                        </option>
                      )
                    })}
                  </optgroup>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>How did you track this time?</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button type="button" className={`rounded-xl border px-3 py-2 text-left text-xs ${timeMode === "range" ? "border-primary bg-primary/10 font-semibold" : "border-border"}`} onClick={() => setTimeMode("range")}>
                  Start and end time
                  <span className="mt-0.5 block font-normal text-muted-foreground">Clock times for this entry</span>
                </button>
                <button type="button" className={`rounded-xl border px-3 py-2 text-left text-xs ${timeMode === "duration" ? "border-primary bg-primary/10 font-semibold" : "border-border"}`} onClick={() => setTimeMode("duration")}>
                  Hours and minutes
                  <span className="mt-0.5 block font-normal text-muted-foreground">Type how long the task took</span>
                </button>
              </div>
            </div>
            {timeMode === "range" ? (
              <>
                <div><Label>Start Time</Label><Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
                <div><Label>End Time</Label><Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
              </>
            ) : (
              <>
                <div><Label>Hours</Label><Input type="number" min={0} max={24} value={duration.hours} onChange={(e) => setDuration({ ...duration, hours: e.target.value })} /></div>
                <div><Label>Minutes</Label><Input type="number" min={0} max={59} value={duration.minutes} onChange={(e) => setDuration({ ...duration, minutes: e.target.value })} /></div>
              </>
            )}
            <div><Label>Total Hours</Label><Input value={timeMode === "duration" ? `${formatDurationLabel(hours)} (${hours.toFixed(2)} hrs)` : `${hours.toFixed(2)} hrs`} disabled /></div>
            {showMoney && (
              <>
                <div><Label>Your Rate</Label><Input value={approvedRate ? `${formatCurrency(approvedRate.amount, approvedRate.currency)}${approvedRate.pay_type === "hourly" ? "/hr" : " flat"}` : "No approved rate — set in My Rates"} disabled /></div>
                <div><Label>Estimated Pay</Label><Input value={estimatedPay} disabled /></div>
              </>
            )}
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <Label>Task / Service Performed</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Paperclip className="h-3.5 w-3.5" /> Attach files
              </Button>
            </div>
            <RichTextEditor onChange={(lex, plain) => { setDescriptionLexical(lex); setDescriptionPlain(plain) }} />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Attach images, PDFs, or any other files here. {form.task_id ? "They are also posted on the selected task as a comment." : "Select a task above to also post them on the task thread."}
            </p>
          </div>
          <div><Label>Notes (optional)</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div>
            <Label>Attachments (any file type, up to 25 MB each)</Label>
            <label
              className="mt-1 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-4 text-xs text-muted-foreground hover:bg-muted/40"
              onDragOver={(e) => { e.preventDefault() }}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
            >
              <Paperclip className="mb-1 h-5 w-5" />
              {pendingFiles.length ? `${pendingFiles.length} file(s) selected — click to add more` : "Drag & drop or click to browse"}
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = "" }}
              />
            </label>
            {pendingFiles.length > 0 && (
              <ul className="mt-2 space-y-1">
                {pendingFiles.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-[11px]">
                    <span className="truncate">{f.name} <span className="text-muted-foreground">({Math.max(1, Math.round(f.size / 1024))} KB)</span></span>
                    <button type="button" className="text-red-600" onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove file">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <Button variant="gold" className="w-full" onClick={() => submit.mutate()} disabled={!form.client_id || !descriptionPlain || !durationValid || submit.isPending}>
            {submit.isPending ? "Submitting..." : "Submit Entry"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Your Entries</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-2">Date</th><th className="p-2">Client</th><th className="p-2">Time</th><th className="p-2">Hours</th>{showMoney && <><th className="p-2">Rate</th><th className="p-2">Pay</th></>}<th className="p-2">Status</th><th className="p-2"></th></tr></thead>
            <tbody>{logs.map((log) => (
              <tr key={log.id} className="border-b border-border">
                <td className="p-2">{log.work_date}</td>
                <td className="p-2">
                  {log.client_name}
                  {log.task_title && <span className="block text-[10px] text-muted-foreground">{log.task_title}</span>}
                  {log.rolled_to_next_payroll && (
                    <span className="mt-0.5 inline-block rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-bold text-amber-900">
                      Rolls to next payroll{log.payable_on ? ` · ${log.payable_on}` : ""}
                    </span>
                  )}
                </td>
                <td className="p-2 whitespace-nowrap">{log.clock_in_at ? `${new Date(log.clock_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}–${log.clock_out_at ? new Date(log.clock_out_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "…"}` : log.entry_mode === "duration" ? formatDurationLabel(log.hours) : `${log.start_time?.slice(0, 5) || "—"}–${log.end_time?.slice(0, 5) || "—"}`}<span className="block text-[10px] text-muted-foreground">{log.source === "clock" ? "clock" : log.entry_mode === "duration" ? "duration" : "manual"}</span></td>
                <td className="p-2">{log.hours}</td>
                {showMoney && <><td className="p-2">{formatCurrency(log.va_rate)}</td><td className="p-2">{formatCurrency(log.va_pay)}</td></>}
                <td className="p-2"><StatusBadge status={log.status} />{(log.attachment_count ?? 0) > 0 && <span className="ml-1 text-[10px] text-muted-foreground">📎{log.attachment_count}</span>}</td>
                <td className="p-2 whitespace-nowrap">
                  {(log.status === "submitted" || log.status === "rejected") ? <>
                    <button className="underline mr-2" onClick={() => { setEditingLog(log); setEditDesc(log.description_plain); setEditMode(log.entry_mode === "duration" ? "duration" : "range"); setEditTimes({ start_time: log.start_time?.slice(0, 5) || "09:00", end_time: log.end_time?.slice(0, 5) || "17:00" }); setEditDuration(splitHours(log.hours)) }}>Edit</button>
                    <button className="underline text-red-600" onClick={() => { if (confirm("Delete this log entry?")) deleteLog.mutate(log.id) }}>Delete</button>
                  </> : <span className="text-[10px] text-muted-foreground">locked</span>}
                  {(log.attachment_count ?? 0) > 0 && <button className="ml-2 underline" onClick={() => setViewingLog(log)}>Files</button>}
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
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={`rounded-xl border px-3 py-2 text-xs ${editMode === "range" ? "border-primary bg-primary/10 font-semibold" : "border-border"}`} onClick={() => setEditMode("range")}>Start and end</button>
                <button type="button" className={`rounded-xl border px-3 py-2 text-xs ${editMode === "duration" ? "border-primary bg-primary/10 font-semibold" : "border-border"}`} onClick={() => setEditMode("duration")}>Hours and minutes</button>
              </div>
              {editMode === "range" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Start</Label><Input type="time" value={editTimes.start_time} onChange={e => setEditTimes({ ...editTimes, start_time: e.target.value })} /></div>
                  <div><Label>End</Label><Input type="time" value={editTimes.end_time} onChange={e => setEditTimes({ ...editTimes, end_time: e.target.value })} /></div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Hours</Label><Input type="number" min={0} max={24} value={editDuration.hours} onChange={e => setEditDuration({ ...editDuration, hours: e.target.value })} /></div>
                  <div><Label>Minutes</Label><Input type="number" min={0} max={59} value={editDuration.minutes} onChange={e => setEditDuration({ ...editDuration, minutes: e.target.value })} /></div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">{showMoney ? "Hours and pay recalculate from your approved rate." : "Hours are saved from the method you pick."}{editingLog.status === "rejected" ? " Saving resubmits this log." : ""}</p>
              <div className="flex gap-2"><Button variant="gold" className="flex-1" disabled={!editDesc || editLog.isPending} onClick={() => editLog.mutate()}>Save</Button><Button variant="outline" onClick={() => setEditingLog(null)}>Cancel</Button></div>
            </div>
          </div>
        </div>
      )}

      {viewingLog && <LogAttachmentsViewer logId={viewingLog.id} onClose={() => setViewingLog(null)} />}

      {projectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setProjectModal(false)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">New project</h2>
              <button type="button" onClick={() => setProjectModal(false)} aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">Create a project for a client. It will appear in this Project dropdown so you can select it when logging time.</p>
            <div className="space-y-3">
              <div>
                <Label>Client *</Label>
                <Select value={newProject.client_id} onChange={(e) => setNewProject({ ...newProject, client_id: e.target.value })}>
                  <option value="">Select client</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div>
                <Label>Project name *</Label>
                <Input value={newProject.name} onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} placeholder="e.g. Weekly newsletter" />
              </div>
              <div>
                <Label>Short description</Label>
                <Textarea value={newProject.description} onChange={(e) => setNewProject({ ...newProject, description: e.target.value })} placeholder="What this project covers…" />
              </div>
              {projectError && <p className="text-[11px] text-red-600">{projectError}</p>}
              <div className="flex gap-2">
                <Button
                  variant="gold"
                  className="flex-1"
                  disabled={!newProject.name.trim() || !newProject.client_id || createProject.isPending}
                  onClick={() => createProject.mutate()}
                >
                  {createProject.isPending ? "Creating…" : "Create project"}
                </Button>
                <Button variant="outline" onClick={() => setProjectModal(false)}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
