import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { Client, Project, TaskItem, TimeClockEntry } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDuration } from "@/components/tasks/task-utils"
import { Pause, Play, Square, Timer } from "lucide-react"

function useTick(active: boolean) {
  const [, setN] = useState(0)
  useEffect(() => { if (!active) return; const i = setInterval(() => setN(n => n + 1), 1000); return () => clearInterval(i) }, [active])
}
export function TimeClockPage() {
  const qc = useQueryClient()
  const isAdmin = getAuthUser()?.role === "admin"
  const [taskId, setTaskId] = useState("")
  const [clientId, setClientId] = useState("")
  const [projectId, setProjectId] = useState("")
  const [notes, setNotes] = useState("")
  const [outDesc, setOutDesc] = useState("")
  const [outComment, setOutComment] = useState("")
  const [createLog, setCreateLog] = useState(true)
  const [quickComment, setQuickComment] = useState("")
  const [error, setError] = useState("")
  const [baseElapsed, setBaseElapsed] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)

  const { data: current } = useQuery({ queryKey: ["clock-current"], queryFn: () => apiFetch<TimeClockEntry | null>("/time-clock/current"), enabled: !isAdmin, refetchInterval: 15000 })
  const { data: history = [] } = useQuery({ queryKey: ["clock-history"], queryFn: () => apiFetch<TimeClockEntry[]>("/time-clock/my-history"), enabled: !isAdmin })
  const { data: live = [] } = useQuery({ queryKey: ["clock-live"], queryFn: () => apiFetch<TimeClockEntry[]>("/time-clock/live"), enabled: isAdmin, refetchInterval: 10000 })
  const { data: allEntries = [] } = useQuery({ queryKey: ["clock-all"], queryFn: () => apiFetch<TimeClockEntry[]>("/time-clock"), enabled: isAdmin })
  const { data: tasks = [] } = useQuery({ queryKey: ["tasks-mine"], queryFn: () => apiFetch<TaskItem[]>("/tasks?mine=true"), enabled: !isAdmin })
  const { data: clients = [] } = useQuery({ queryKey: ["va-clients"], queryFn: () => apiFetch<Client[]>("/va/clients"), enabled: !isAdmin })
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => apiFetch<Project[]>("/projects?include_archived=false"), enabled: !isAdmin })

  useEffect(() => { if (current) { setBaseElapsed(current.elapsed_seconds); setStartedAt(Date.now()) } else { setStartedAt(null); setBaseElapsed(0) } }, [current])
  const ticking = !!current && current.status === "running"
  useTick(ticking)
  const displaySecs = current ? (ticking && startedAt ? baseElapsed + Math.floor((Date.now() - startedAt) / 1000) : baseElapsed) : 0

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["clock-current"] }); qc.invalidateQueries({ queryKey: ["clock-history"] }); qc.invalidateQueries({ queryKey: ["clock-live"] }); qc.invalidateQueries({ queryKey: ["clock-all"] }); qc.invalidateQueries({ queryKey: ["va-logs"] }); qc.invalidateQueries({ queryKey: ["tasks"] }) }
  const act = useMutation({
    mutationFn: (action: string) => {
      if (action === "clock-in") return apiFetch("/time-clock/clock-in", { method: "POST", body: JSON.stringify({ task_id: taskId || null, client_id: clientId || null, project_id: projectId || null, notes: notes || null }) })
      if (action === "clock-out") return apiFetch("/time-clock/clock-out", { method: "POST", body: JSON.stringify({ notes: notes || null, create_work_log: createLog, description: outDesc || null, comment: outComment || null }) })
      return apiFetch(`/time-clock/${action}`, { method: "POST", body: JSON.stringify({}) })
    },
    onSuccess: () => { invalidate(); setError("") }, onError: (e: Error) => setError(e.message),
  })

  const selectedTask = tasks.find(t => t.id === taskId)
  const activeTaskId = current?.task_id || taskId
  const { data: taskComments = [] } = useQuery({ queryKey: ["clock-task-comments", activeTaskId], queryFn: () => apiFetch<{ id: string; author_name: string; body: string; created_at: string }[]>(`/tasks/${activeTaskId}/comments`), enabled: !isAdmin && !!activeTaskId })
  const postComment = useMutation({ mutationFn: () => apiFetch(`/tasks/${activeTaskId}/comments`, { method: "POST", body: JSON.stringify({ body: quickComment }) }), onSuccess: () => { setQuickComment(""); qc.invalidateQueries({ queryKey: ["clock-task-comments"] }) } })

  if (isAdmin) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div><h1 className="text-base font-semibold tracking-tight">Time Clock — Team</h1><p className="text-xs text-muted-foreground">Live sessions and recorded clock history. Clock-outs automatically create work logs.</p></div>
        <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" /> Live now ({live.length})</CardTitle></CardHeader>
          <CardContent>{live.length === 0 ? <p className="text-xs text-muted-foreground">Nobody is clocked in right now.</p> : <div className="grid gap-2 sm:grid-cols-2">{live.map(e => <div key={e.id} className="rounded-lg border p-3"><div className="text-xs font-semibold">{e.va_name}</div><div className="text-[11px] text-muted-foreground">{e.task_title || e.client_name || "General work"} · {e.status}</div><div className="mt-1 font-mono text-lg">{formatDuration(e.elapsed_seconds)}</div><div className="text-[11px] text-muted-foreground">In: {new Date(e.clock_in).toLocaleString()}</div></div>)}</div>}</CardContent></Card>
        <HistoryTable entries={allEntries} showVa />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4 animate-fade-in">
      <div><h1 className="text-base font-semibold tracking-tight">Time Clock</h1><p className="text-xs text-muted-foreground">Clock in when you start, clock out when you finish — your time is recorded automatically as a work log.</p></div>
      <Card className="overflow-hidden">
        <CardContent className="p-5 text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10"><Timer className="h-7 w-7 text-primary" /></div>
          <div className="font-mono text-4xl font-bold tracking-wider">{formatDuration(displaySecs)}</div>
          <p className="text-xs text-muted-foreground">{current ? `${current.status === "paused" ? "Paused" : "Working"} on ${current.task_title || current.client_name || "General work"} · since ${new Date(current.clock_in).toLocaleTimeString()}` : "Not clocked in"}</p>
          {!current ? (
            <div className="mx-auto max-w-md space-y-3 text-left">
              <div><Label>My task (optional — picks client/project automatically)</Label><Select value={taskId} onChange={e => { setTaskId(e.target.value); const t = tasks.find(x => x.id === e.target.value); if (t) { setClientId(t.client_id); setProjectId(t.project_id || "") } }}><option value="">General / choose below</option>{tasks.map(t => <option key={t.id} value={t.id}>{t.title} — {t.client_name}</option>)}</Select></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Client</Label><Select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Select client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
                <div><Label>Project</Label><Select value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">No project</option>{projects.filter(p => !clientId || p.client_id === clientId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
              </div>
              <div><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="What are you working on?" /></div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <Button variant="gold" className="w-full" disabled={act.isPending || (!selectedTask && !clientId)} onClick={() => act.mutate("clock-in")}><Play className="h-4 w-4" /> Clock In</Button>
              {!selectedTask && !clientId && <p className="text-[11px] text-muted-foreground text-center">Pick a task or a client to clock in.</p>}
            </div>
          ) : (
            <div className="mx-auto max-w-md space-y-3 text-left">
              <div><Label>What did you work on? (becomes your log description)</Label><Input value={outDesc} onChange={e => setOutDesc(e.target.value)} placeholder={current.task_title || "Describe the work…"} /></div>
              <div><Label>Comment for the task thread (optional)</Label><Input value={outComment} onChange={e => setOutComment(e.target.value)} placeholder="Progress update for admin / team…" /></div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={createLog} onChange={e => setCreateLog(e.target.checked)} /> Create a work log from this session (recommended)</label>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {current.status === "running" ? <Button variant="outline" onClick={() => act.mutate("pause")} disabled={act.isPending}><Pause className="h-4 w-4" /> Pause</Button> : <Button variant="outline" onClick={() => act.mutate("resume")} disabled={act.isPending}><Play className="h-4 w-4" /> Resume</Button>}
                <Button variant="gold" onClick={() => act.mutate("clock-out")} disabled={act.isPending}><Square className="h-4 w-4" /> Clock Out{createLog ? " & Log Time" : ""}</Button>
              </div>
            </div>
          )}
          {current && error && <p className="text-xs text-red-600">{error}</p>}
        </CardContent>
      </Card>

      {activeTaskId && (
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Task Comments</CardTitle></CardHeader><CardContent className="space-y-2">
          {taskComments.map(c => <div key={c.id} className="rounded-lg border p-2.5"><div className="text-[11px] text-muted-foreground">{c.author_name} · {new Date(c.created_at).toLocaleString()}</div><p className="text-xs mt-0.5">{c.body}</p></div>)}
          {taskComments.length === 0 && <p className="text-xs text-muted-foreground">No comments on this task yet — leave the first update.</p>}
          <div className="flex gap-2"><Input value={quickComment} onChange={e => setQuickComment(e.target.value)} placeholder="Add a comment…" onKeyDown={e => { if (e.key === "Enter" && quickComment.trim()) postComment.mutate() }} /><Button variant="gold" size="sm" disabled={!quickComment.trim() || postComment.isPending} onClick={() => postComment.mutate()}>Post</Button></div>
        </CardContent></Card>
      )}
      <HistoryTable entries={history} />
    </div>
  )
}

function HistoryTable({ entries, showVa }: { entries: TimeClockEntry[]; showVa?: boolean }) {
  const totalSecs = entries.filter(e => e.status === "completed").reduce((s, e) => s + (e.duration_seconds || 0), 0)
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Clock History <span className="font-normal text-muted-foreground">· {(totalSecs / 3600).toFixed(2)}h completed</span></CardTitle></CardHeader>
      <CardContent className="overflow-x-auto p-0"><table className="w-full text-xs">
        <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground">{showVa && <th className="p-3">VA</th>}<th className="p-3">Task / Client</th><th className="p-3">Clock In</th><th className="p-3">Clock Out</th><th className="p-3">Duration</th><th className="p-3">Status</th><th className="p-3">Log</th></tr></thead>
        <tbody>{entries.map(e => <tr key={e.id} className="border-b">{showVa && <td className="p-3">{e.va_name}</td>}<td className="p-3">{e.task_title || "—"}<span className="text-muted-foreground">{e.client_name ? ` · ${e.client_name}` : ""}</span></td><td className="p-3">{new Date(e.clock_in).toLocaleString()}</td><td className="p-3">{e.clock_out ? new Date(e.clock_out).toLocaleString() : "—"}</td><td className="p-3 font-mono">{formatDuration(e.duration_seconds ?? e.elapsed_seconds)}</td><td className="p-3 capitalize">{e.status}</td><td className="p-3">{e.work_log_id ? "✓ logged" : "—"}</td></tr>)}
        {entries.length === 0 && <tr><td colSpan={showVa ? 7 : 6} className="p-6 text-center text-muted-foreground">No clock entries yet.</td></tr>}</tbody></table></CardContent></Card>
  )
}
