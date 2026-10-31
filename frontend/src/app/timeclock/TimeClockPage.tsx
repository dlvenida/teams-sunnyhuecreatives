import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { Client, Project, TaskItem, TimeClockAdjustment, TimeClockCorrectionRequest, TimeClockEntry } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDuration } from "@/components/tasks/task-utils"
import { roleLabel } from "@/lib/utils"
import { History, Pause, Pencil, Play, Square, Timer, X } from "lucide-react"

function toLocalInput(iso?: string | null) {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtDT(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"
}

function useTick(active: boolean) {
  const [, setN] = useState(0)
  useEffect(() => { if (!active) return; const i = setInterval(() => setN(n => n + 1), 1000); return () => clearInterval(i) }, [active])
}

export function TimeClockPage() {
  const qc = useQueryClient()
  const role = getAuthUser()?.role
  const isAdmin = role === "admin"
  const isAuditor = role === "auditor"
  const isStaff = isAdmin || isAuditor
  const canEdit = isAdmin || isAuditor
  const [staffTab, setStaffTab] = useState<"mine" | "team">("mine")
  const showMine = !isStaff || staffTab === "mine"
  const showTeam = isStaff && staffTab === "team"
  const [taskId, setTaskId] = useState("")
  const [clientId, setClientId] = useState("")
  const [projectId, setProjectId] = useState("")
  const [notes, setNotes] = useState("")
  const [outDesc, setOutDesc] = useState("")
  const [outComment, setOutComment] = useState("")
  const [createLog, setCreateLog] = useState(true)
  const [quickComment, setQuickComment] = useState("")
  const [error, setError] = useState("")
  const [adjusting, setAdjusting] = useState<TimeClockEntry | null>(null)
  const [adjForm, setAdjForm] = useState({ clock_in: "", clock_out: "", notes: "", reason: "" })
  const [adjError, setAdjError] = useState("")
  const [adjRequestId, setAdjRequestId] = useState<string | null>(null)
  const [requesting, setRequesting] = useState<TimeClockEntry | null>(null)
  const [reqForm, setReqForm] = useState({ clock_in: "", clock_out: "", notes: "", reason: "" })
  const [reqError, setReqError] = useState("")
  const [baseElapsed, setBaseElapsed] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)

  const { data: current } = useQuery({ queryKey: ["clock-current"], queryFn: () => apiFetch<TimeClockEntry | null>("/time-clock/current"), enabled: showMine, refetchInterval: 15000 })
  const { data: history = [] } = useQuery({ queryKey: ["clock-history"], queryFn: () => apiFetch<TimeClockEntry[]>("/time-clock/my-history"), enabled: showMine })
  const { data: live = [] } = useQuery({ queryKey: ["clock-live"], queryFn: () => apiFetch<TimeClockEntry[]>("/time-clock/live"), enabled: showTeam, refetchInterval: 10000 })
  const { data: allEntries = [] } = useQuery({ queryKey: ["clock-all"], queryFn: () => apiFetch<TimeClockEntry[]>("/time-clock"), enabled: showTeam })
  const { data: tasks = [] } = useQuery({ queryKey: ["tasks-mine"], queryFn: () => apiFetch<TaskItem[]>("/tasks?mine=true"), enabled: showMine })
  const { data: clients = [] } = useQuery({
    queryKey: [isStaff ? "clients" : "va-clients"],
    queryFn: () => apiFetch<Client[]>(isStaff ? "/clients?active_only=true" : "/va/clients"),
    enabled: showMine,
  })
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => apiFetch<Project[]>("/projects?include_archived=false"), enabled: showMine })
  const { data: adjustments = [] } = useQuery({ queryKey: ["clock-adjustments"], queryFn: () => apiFetch<TimeClockAdjustment[]>("/time-clock/adjustments"), enabled: showTeam })
  const { data: correctionRequests = [] } = useQuery({
    queryKey: ["clock-correction-requests"],
    queryFn: () => apiFetch<TimeClockCorrectionRequest[]>("/time-clock/correction-requests?status_filter=pending"),
    enabled: showTeam,
  })
  const { data: myRequests = [] } = useQuery({
    queryKey: ["my-clock-correction-requests"],
    queryFn: () => apiFetch<TimeClockCorrectionRequest[]>("/time-clock/my-correction-requests"),
    enabled: showMine,
  })

  useEffect(() => { if (current) { setBaseElapsed(current.elapsed_seconds); setStartedAt(Date.now()) } else { setStartedAt(null); setBaseElapsed(0) } }, [current])
  const ticking = !!current && current.status === "running"
  useTick(ticking)
  const displaySecs = current ? (ticking && startedAt ? baseElapsed + Math.floor((Date.now() - startedAt) / 1000) : baseElapsed) : 0

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["clock-current"] })
    qc.invalidateQueries({ queryKey: ["clock-history"] })
    qc.invalidateQueries({ queryKey: ["clock-live"] })
    qc.invalidateQueries({ queryKey: ["clock-all"] })
    qc.invalidateQueries({ queryKey: ["va-logs"] })
    qc.invalidateQueries({ queryKey: ["tasks"] })
    qc.invalidateQueries({ queryKey: ["clock-correction-requests"] })
    qc.invalidateQueries({ queryKey: ["my-clock-correction-requests"] })
    qc.invalidateQueries({ queryKey: ["clock-adjustments"] })
  }
  const act = useMutation({
    mutationFn: (action: string) => {
      if (action === "clock-in") return apiFetch("/time-clock/clock-in", { method: "POST", body: JSON.stringify({ task_id: taskId || null, client_id: clientId || null, project_id: projectId || null, notes: notes || null }) })
      if (action === "clock-out") return apiFetch("/time-clock/clock-out", { method: "POST", body: JSON.stringify({ notes: notes || null, create_work_log: createLog, description: outDesc || null, comment: outComment || null }) })
      return apiFetch(`/time-clock/${action}`, { method: "POST", body: JSON.stringify({}) })
    },
    onSuccess: () => { invalidate(); setError("") }, onError: (e: Error) => setError(e.message),
  })

  const openAdjust = (e: TimeClockEntry, fromRequest?: TimeClockCorrectionRequest) => {
    setAdjError("")
    setAdjusting(e)
    setAdjRequestId(fromRequest?.id || e.pending_correction_request_id || null)
    setAdjForm({
      clock_in: toLocalInput(fromRequest?.proposed_clock_in || e.clock_in),
      clock_out: toLocalInput(fromRequest?.proposed_clock_out || e.clock_out),
      notes: fromRequest?.proposed_notes || e.notes || "",
      reason: fromRequest ? `Approved VA revision: ${fromRequest.reason}` : "",
    })
  }
  const saveAdjust = useMutation({
    mutationFn: () => apiFetch(`/time-clock/${adjusting!.id}/adjust`, {
      method: "PATCH",
      body: JSON.stringify({
        clock_in: adjForm.clock_in ? new Date(adjForm.clock_in).toISOString() : null,
        clock_out: adjusting!.status === "completed" && adjForm.clock_out ? new Date(adjForm.clock_out).toISOString() : null,
        notes: adjForm.notes || null,
        reason: adjForm.reason,
        correction_request_id: adjRequestId,
      }),
    }),
    onSuccess: () => { setAdjusting(null); setAdjRequestId(null); invalidate(); qc.invalidateQueries({ queryKey: ["work-logs"] }) },
    onError: (e: Error) => setAdjError(e.message),
  })

  const openRequest = (e: TimeClockEntry) => {
    setReqError("")
    setRequesting(e)
    setReqForm({ clock_in: toLocalInput(e.clock_in), clock_out: toLocalInput(e.clock_out), notes: e.notes || "", reason: "" })
  }
  const saveRequest = useMutation({
    mutationFn: () => apiFetch(`/time-clock/${requesting!.id}/correction-request`, {
      method: "POST",
      body: JSON.stringify({
        proposed_clock_in: reqForm.clock_in ? new Date(reqForm.clock_in).toISOString() : null,
        proposed_clock_out: requesting!.status === "completed" && reqForm.clock_out ? new Date(reqForm.clock_out).toISOString() : null,
        proposed_notes: reqForm.notes || null,
        reason: reqForm.reason,
      }),
    }),
    onSuccess: () => { setRequesting(null); invalidate() },
    onError: (e: Error) => setReqError(e.message),
  })
  const cancelRequest = useMutation({
    mutationFn: (id: string) => apiFetch(`/time-clock/correction-requests/${id}/cancel`, { method: "POST" }),
    onSuccess: () => invalidate(),
  })

  const adjustModal = adjusting && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAdjusting(null)}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Edit time clock entry</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {adjusting.va_name ? `${adjusting.va_name} · ` : ""}{adjusting.task_title || adjusting.client_name || "General work"} · {adjusting.status}
              {adjusting.work_log_id ? " · linked work log will be updated" : ""}
            </p>
          </div>
          <button onClick={() => setAdjusting(null)} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        {adjusting.original_clock_in && (
          <p className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
            Original recorded: {fmtDT(adjusting.original_clock_in)} → {fmtDT(adjusting.original_clock_out)}
          </p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div><Label>Clock in</Label><Input type="datetime-local" value={adjForm.clock_in} onChange={e => setAdjForm({ ...adjForm, clock_in: e.target.value })} /></div>
          <div><Label>Clock out {adjusting.status !== "completed" && <span className="font-normal text-muted-foreground">(clock out first)</span>}</Label><Input type="datetime-local" disabled={adjusting.status !== "completed"} value={adjForm.clock_out} onChange={e => setAdjForm({ ...adjForm, clock_out: e.target.value })} /></div>
        </div>
        <div className="mt-3"><Label>Notes</Label><Input value={adjForm.notes} onChange={e => setAdjForm({ ...adjForm, notes: e.target.value })} placeholder="Session notes" /></div>
        <div className="mt-3"><Label>Reason for edit *</Label><Input value={adjForm.reason} onChange={e => setAdjForm({ ...adjForm, reason: e.target.value })} placeholder="e.g. Corrected clock-out per VA request" /></div>
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-900">The original times stay visible on the entry. Your name, role, and this reason are recorded. An approved work log returns to Submitted for re-approval.</p>
        {adjError && <p className="mt-2 text-xs text-red-600">{adjError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setAdjusting(null)}>Cancel</Button>
          <Button variant="gold" size="sm" disabled={adjForm.reason.trim().length < 3 || !adjForm.clock_in || saveAdjust.isPending} onClick={() => saveAdjust.mutate()}>
            {saveAdjust.isPending ? "Saving…" : "Save edit"}
          </Button>
        </div>
      </div>
    </div>
  )

  const requestModal = requesting && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRequesting(null)}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Request time revision</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {requesting.task_title || requesting.client_name || "General work"} · current {fmtDT(requesting.clock_in)} → {fmtDT(requesting.clock_out)}
            </p>
          </div>
          <button onClick={() => setRequesting(null)} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">An admin or project manager will review and edit the entry for you. Your current times stay recorded until they approve the change.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div><Label>Correct clock in</Label><Input type="datetime-local" value={reqForm.clock_in} onChange={e => setReqForm({ ...reqForm, clock_in: e.target.value })} /></div>
          <div><Label>Correct clock out</Label><Input type="datetime-local" value={reqForm.clock_out} onChange={e => setReqForm({ ...reqForm, clock_out: e.target.value })} /></div>
        </div>
        <div className="mt-3"><Label>Notes (optional)</Label><Input value={reqForm.notes} onChange={e => setReqForm({ ...reqForm, notes: e.target.value })} /></div>
        <div className="mt-3"><Label>What needs fixing? *</Label><Input value={reqForm.reason} onChange={e => setReqForm({ ...reqForm, reason: e.target.value })} placeholder="e.g. Forgot to clock out — left at 5:10pm" /></div>
        {reqError && <p className="mt-2 text-xs text-red-600">{reqError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setRequesting(null)}>Cancel</Button>
          <Button variant="gold" size="sm" disabled={reqForm.reason.trim().length < 3 || saveRequest.isPending} onClick={() => saveRequest.mutate()}>
            {saveRequest.isPending ? "Sending…" : "Send request"}
          </Button>
        </div>
      </div>
    </div>
  )

  const selectedTask = tasks.find(t => t.id === taskId)
  const activeTaskId = current?.task_id || taskId
  const { data: taskComments = [] } = useQuery({ queryKey: ["clock-task-comments", activeTaskId], queryFn: () => apiFetch<{ id: string; author_name: string; body: string; created_at: string }[]>(`/tasks/${activeTaskId}/comments`), enabled: showMine && !!activeTaskId })
  const postComment = useMutation({ mutationFn: () => apiFetch(`/tasks/${activeTaskId}/comments`, { method: "POST", body: JSON.stringify({ body: quickComment }) }), onSuccess: () => { setQuickComment(""); qc.invalidateQueries({ queryKey: ["clock-task-comments"] }) } })

  const staffTabs = isStaff && (
    <div className="flex flex-wrap gap-1.5">
      {([["mine", "My clock"], ["team", "Team"]] as const).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => setStaffTab(id)}
          className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${staffTab === id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted/60"}`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  if (showTeam) {
    return (<>
      {adjustModal}
      <div className="w-full space-y-4 animate-fade-in">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Time Clock — Team</h1>
            <p className="text-xs text-muted-foreground">Live sessions, revision requests from VAs, and edit history. Original times stay visible after any edit.</p>
          </div>
          {staffTabs}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" /> Live now ({live.length})</CardTitle></CardHeader>
            <CardContent>{live.length === 0 ? <p className="text-xs text-muted-foreground">Nobody is clocked in right now.</p> : <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{live.map(e => <div key={e.id} className="rounded-lg border p-3"><div className="text-xs font-semibold">{e.va_name}</div><div className="text-[11px] text-muted-foreground">{e.task_title || e.client_name || "General work"} · {e.status}</div><div className="mt-1 font-mono text-lg">{formatDuration(e.elapsed_seconds)}</div><div className="text-[11px] text-muted-foreground">In: {new Date(e.clock_in).toLocaleString()}</div></div>)}</div>}</CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Pending revision requests ({correctionRequests.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {correctionRequests.length === 0 && <p className="text-xs text-muted-foreground">No open revision requests. When a VA flags a wrong clock-in, clock-out, or date, it appears here for you to edit.</p>}
              {correctionRequests.map(r => {
                const entry = allEntries.find(e => e.id === r.entry_id)
                return (
                  <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs">
                    <p className="font-semibold">{r.va_name || "VA"} <span className="font-normal text-muted-foreground">· {r.task_title || r.client_name || "General"} · {fmtDT(r.created_at)}</span></p>
                    <p className="mt-1 text-muted-foreground">Current: {fmtDT(r.current_clock_in)} → {fmtDT(r.current_clock_out)}</p>
                    <p className="text-muted-foreground">Requested: {fmtDT(r.proposed_clock_in)} → {fmtDT(r.proposed_clock_out)}</p>
                    <p className="mt-1"><span className="font-semibold">Reason:</span> {r.reason}</p>
                    {canEdit && entry && (
                      <div className="mt-2">
                        <Button size="sm" variant="gold" onClick={() => openAdjust(entry, r)}><Pencil className="h-3.5 w-3.5" /> Edit entry</Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <HistoryTable entries={allEntries} showVa onAdjust={canEdit ? openAdjust : undefined} />

          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><History className="h-4 w-4 text-primary" /> Recent edits ({adjustments.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {adjustments.slice(0, 20).map(a => (
                <div key={a.id} className="rounded-xl border p-3 text-xs">
                  <p className="font-semibold">{a.va_name || "VA"} <span className="font-normal text-muted-foreground">· edited by {a.adjusted_by_name} ({a.adjusted_by_role}) · {fmtDT(a.created_at)}{a.work_log_synced ? " · work log updated" : ""}</span></p>
                  <p className="mt-1 text-muted-foreground">{fmtDT(a.before?.clock_in as string)} → {fmtDT(a.after?.clock_in as string)} in · {fmtDT(a.before?.clock_out as string)} → {fmtDT(a.after?.clock_out as string)} out</p>
                  <p className="mt-1"><span className="font-semibold">Reason:</span> {a.reason}</p>
                </div>
              ))}
              {adjustments.length === 0 && <p className="text-xs text-muted-foreground">No edits yet.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>)
  }

  return (
    <div className="w-full space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">{isStaff ? "Time Clock — My hours" : "Time Clock"}</h1>
          <p className="text-xs text-muted-foreground">
            {isStaff
              ? "Clock in and out for your own work. Switch to Team to manage VA sessions and revision requests."
              : "Clock in when you start, clock out when you finish. If a time is wrong, request a revision — an admin or project manager will edit it for you."}
          </p>
        </div>
        {staffTabs}
      </div>
      <div className="space-y-4">
        <div className="min-w-0 space-y-4">
          <Card className="overflow-hidden">
            <CardContent className="p-4 sm:p-5">
              <div className="grid items-center gap-5 md:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
                <div className="space-y-2 text-center md:border-r md:pr-5">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10"><Timer className="h-7 w-7 text-primary" /></div>
                  <div className="whitespace-nowrap font-mono font-bold tracking-wider" style={{ fontSize: "clamp(1.9rem, 4vw, 3.1rem)" }}>{formatDuration(displaySecs)}</div>
                  <p className="text-xs text-muted-foreground">{current ? `${current.status === "paused" ? "Paused" : "Working"} on ${current.task_title || current.client_name || "General work"} · since ${new Date(current.clock_in).toLocaleTimeString()}` : "Not clocked in"}</p>
                </div>
                <div className="min-w-0">
                  {!current ? (
                    <div className="w-full space-y-3 text-left">
                      <div>
                        <Label>My task (optional — picks client/project automatically)</Label>
                        <Select
                          value={taskId}
                          onChange={(e) => {
                            setTaskId(e.target.value)
                            const t = tasks.find((x) => x.id === e.target.value)
                            if (t) { setClientId(t.client_id); setProjectId(t.project_id || "") }
                          }}
                        >
                          <option value="">General / choose below</option>
                          {Array.from(
                            tasks
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
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div><Label>Client</Label><Select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Select client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
                        <div><Label>Project</Label><Select value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">No project</option>{projects.filter(p => !clientId || p.client_id === clientId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1"><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="What are you working on?" /></div>
                        <Button variant="gold" className="w-full shrink-0 sm:w-auto sm:px-8" disabled={act.isPending || (!selectedTask && !clientId)} onClick={() => act.mutate("clock-in")}><Play className="h-4 w-4" /> Clock In</Button>
                      </div>
                      {error && <p className="text-xs text-red-600">{error}</p>}
                      {!selectedTask && !clientId && <p className="text-[11px] text-muted-foreground">Pick a task or a client to clock in.</p>}
                    </div>
                  ) : (
                    <div className="w-full space-y-3 text-left">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div><Label>What did you work on? (becomes your log description)</Label><Input value={outDesc} onChange={e => setOutDesc(e.target.value)} placeholder={current.task_title || "Describe the work…"} /></div>
                        <div><Label>Comment for the task thread (optional)</Label><Input value={outComment} onChange={e => setOutComment(e.target.value)} placeholder="Progress update for admin / team…" /></div>
                      </div>
                      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={createLog} onChange={e => setCreateLog(e.target.checked)} /> Create a work log from this session (recommended)</label>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {current.status === "running" ? <Button variant="outline" onClick={() => act.mutate("pause")} disabled={act.isPending}><Pause className="h-4 w-4" /> Pause</Button> : <Button variant="outline" onClick={() => act.mutate("resume")} disabled={act.isPending}><Play className="h-4 w-4" /> Resume</Button>}
                        <Button variant="gold" onClick={() => act.mutate("clock-out")} disabled={act.isPending}><Square className="h-4 w-4" /> Clock Out{createLog ? " & Log Time" : ""}</Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {current && error && <p className="mt-3 text-xs text-red-600">{error}</p>}
            </CardContent>
          </Card>

          {activeTaskId && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Task Comments</CardTitle></CardHeader><CardContent className="space-y-2">
              {taskComments.map(c => <div key={c.id} className="rounded-lg border p-2.5"><div className="text-[11px] text-muted-foreground">{c.author_name} · {new Date(c.created_at).toLocaleString()}</div><p className="text-xs mt-0.5">{c.body}</p></div>)}
              {taskComments.length === 0 && <p className="text-xs text-muted-foreground">No comments on this task yet — leave the first update.</p>}
              <div className="flex gap-2"><Input value={quickComment} onChange={e => setQuickComment(e.target.value)} placeholder="Add a comment…" onKeyDown={e => { if (e.key === "Enter" && quickComment.trim()) postComment.mutate() }} /><Button variant="gold" size="sm" disabled={!quickComment.trim() || postComment.isPending} onClick={() => postComment.mutate()}>Post</Button></div>
            </CardContent></Card>
          )}

          {myRequests.some(r => r.status === "pending") && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Your pending revision requests</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {myRequests.filter(r => r.status === "pending").map(r => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-xs">
                    <div>
                      <p className="font-semibold">{r.task_title || r.client_name || "General"} · {fmtDT(r.created_at)}</p>
                      <p className="text-muted-foreground">Requested {fmtDT(r.proposed_clock_in)} → {fmtDT(r.proposed_clock_out)} · {r.reason}</p>
                    </div>
                    <Button size="sm" variant="outline" disabled={cancelRequest.isPending} onClick={() => cancelRequest.mutate(r.id)}>Cancel</Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
        <div className="min-w-0">
          <HistoryTable entries={history} onRequest={openRequest} />
        </div>
      </div>
      {requestModal}
    </div>
  )
}

function HistoryTable({
  entries,
  showVa,
  onAdjust,
  onRequest,
}: {
  entries: TimeClockEntry[]
  showVa?: boolean
  onAdjust?: (e: TimeClockEntry) => void
  onRequest?: (e: TimeClockEntry) => void
}) {
  const totalSecs = entries.filter(e => e.status === "completed").reduce((s, e) => s + (e.duration_seconds || 0), 0)
  const manage = !!(onAdjust || onRequest)
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Clock History <span className="font-normal text-muted-foreground">· {(totalSecs / 3600).toFixed(2)}h completed</span></CardTitle></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-muted-foreground">
              {showVa && <th className="p-3">VA</th>}
              <th className="p-3">Task / Client</th>
              <th className="p-3">Clock In</th>
              <th className="p-3">Clock Out</th>
              <th className="p-3">Duration</th>
              <th className="p-3">Status</th>
              <th className="p-3">Log</th>
              {manage && <th className="p-3 text-right">Manage</th>}
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} className="border-b align-top">
                {showVa && <td className="p-3">{e.va_name}</td>}
                <td className="p-3">
                  {e.task_title || "—"}
                  <span className="text-muted-foreground">{e.client_name ? ` · ${e.client_name}` : ""}</span>
                  {e.is_adjusted && (
                    <p className="mt-1 text-[10px] text-amber-800">
                      Edited by {e.last_adjusted_by_name || "staff"}
                      {e.last_adjusted_by_role ? ` (${roleLabel(e.last_adjusted_by_role)})` : ""}
                      {e.last_adjusted_at ? ` · ${fmtDT(e.last_adjusted_at)}` : ""}
                      {e.last_adjustment_reason ? ` · ${e.last_adjustment_reason}` : ""}
                    </p>
                  )}
                  {e.original_clock_in && e.is_adjusted && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Original: {fmtDT(e.original_clock_in)} → {fmtDT(e.original_clock_out)}
                    </p>
                  )}
                </td>
                <td className="p-3">{new Date(e.clock_in).toLocaleString()}</td>
                <td className="p-3">{e.clock_out ? new Date(e.clock_out).toLocaleString() : "—"}</td>
                <td className="p-3 font-mono">{formatDuration(e.duration_seconds ?? e.elapsed_seconds)}</td>
                <td className="p-3 capitalize">
                  {e.status}
                  {e.is_adjusted && (
                    <span className="ml-1.5 whitespace-nowrap rounded-full border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold normal-case text-amber-800" title={e.last_adjustment_reason || "Edited"}>
                      Edited{e.adjustment_count ? ` ×${e.adjustment_count}` : ""}
                    </span>
                  )}
                  {e.pending_correction_request_id && (
                    <span className="ml-1.5 whitespace-nowrap rounded-full border border-sky-200 bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold normal-case text-sky-800">
                      Revision pending
                    </span>
                  )}
                </td>
                <td className="p-3">{e.work_log_id ? "✓ logged" : "—"}</td>
                {manage && (
                  <td className="p-3 text-right">
                    {onAdjust && (
                      <Button size="sm" variant="ghost" title="Edit this entry" onClick={() => onAdjust(e)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                    )}
                    {onRequest && e.status === "completed" && !e.pending_correction_request_id && (
                      <Button size="sm" variant="ghost" title="Request a revision" onClick={() => onRequest(e)}>
                        <Pencil className="h-3.5 w-3.5" /> Request revision
                      </Button>
                    )}
                    {onRequest && e.pending_correction_request_id && (
                      <span className="text-[10px] text-muted-foreground">Awaiting review</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={(showVa ? 7 : 6) + (manage ? 1 : 0)} className="p-6 text-center text-muted-foreground">No clock entries yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
