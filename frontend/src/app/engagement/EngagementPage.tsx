import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { apiFetch, apiFetchBlob, getAuthUser } from "@/lib/api"
import { PLATFORM_LABEL, reviewReasonLines, taskNeedsReview, useEngagementAccess, type EngagementBoard, type EngagementTask } from "@/lib/engagement"
import { prepareImage } from "@/lib/imagePrep"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const STATUS_TONE: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-[#F7C6D3] text-[#B8325F]",
  needs_review: "bg-amber-100 text-amber-900",
  target_met: "bg-green-100 text-green-800",
  completed: "bg-green-100 text-green-800",
  target_exceeded: "bg-[#FDF2F5] text-[#B8325F]",
  incomplete: "bg-red-100 text-red-700",
}

function ShotThumb({ id, name }: { id: string; name: string }) {
  const { data } = useQuery({
    queryKey: ["engagement-shot", id],
    queryFn: async () => {
      const blob = await apiFetchBlob(`/engagement/screenshots/${id}/content`)
      return blob ? URL.createObjectURL(blob) : null
    },
  })
  if (!data) return <div className="h-24 rounded-xl bg-[#FDF2F5]" />
  return <img src={data} alt={name} className="h-28 w-full rounded-xl object-cover" />
}

function TaskCard({ task, management }: { task: EngagementTask; management: boolean }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState("")
  const [message, setMessage] = useState("")
  const [targets, setTargets] = useState<Record<string, string>>({})

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const body = new FormData()
      for (const file of Array.from(files)) {
        const prepared = await prepareImage(file).catch(() => ({ file }))
        body.append("files", prepared.file)
      }
      return apiFetch(`/engagement/tasks/${task.task_id}/screenshots`, { method: "POST", body })
    },
    onSuccess: () => { setMessage("Screenshots checked. Totals updated from the screenshots."); qc.invalidateQueries({ queryKey: ["engagement-tasks"] }) },
    onError: (err: Error) => setMessage(err.message),
  })
  const submit = useMutation({
    mutationFn: () => apiFetch(`/engagement/tasks/${task.task_id}/submit`, { method: "POST" }),
    onSuccess: () => { setMessage("Sent for management review. This does not mark the task completed."); qc.invalidateQueries({ queryKey: ["engagement-tasks"] }) },
    onError: (err: Error) => setMessage(err.message),
  })
  const decide = useMutation({
    mutationFn: (input: { path: string; reason: string }) => apiFetch(input.path, { method: "POST", body: JSON.stringify({ reason: input.reason }) }),
    onSuccess: () => { setMessage("Saved. The original check is kept in the history."); qc.invalidateQueries({ queryKey: ["engagement-tasks"] }) },
    onError: (err: Error) => setMessage(err.message),
  })
  const saveTargets = useMutation({
    mutationFn: () => apiFetch("/engagement/targets", {
      method: "PUT",
      body: JSON.stringify({
        client_id: task.client_id,
        platform: task.platform,
        reason,
        dm_min: targets.dm_min ? Number(targets.dm_min) : undefined,
        dm_max: targets.dm_max ? Number(targets.dm_max) : undefined,
        comment_min: targets.comment_min ? Number(targets.comment_min) : undefined,
        comment_max: targets.comment_max ? Number(targets.comment_max) : undefined,
        share_min: targets.share_min ? Number(targets.share_min) : undefined,
        share_max: targets.share_max ? Number(targets.share_max) : undefined,
        account_names: targets.account_names ? targets.account_names.split(",").map((name) => name.trim()).filter(Boolean) : undefined,
      }),
    }),
    onSuccess: () => { setMessage("Targets updated for this client."); qc.invalidateQueries({ queryKey: ["engagement-tasks"] }) },
    onError: (err: Error) => setMessage(err.message),
  })

  function withReason(path: string) {
    if (!reason.trim()) { setMessage("Add a reason first. It is saved with the original result."); return }
    decide.mutate({ path, reason: reason.trim() })
  }

  const reasons = reviewReasonLines(task)
  const waiting = taskNeedsReview(task)
  const alerts = task.alerts.filter((alert) => {
    if (!waiting && !alert.activity_id && (alert.code === "BELOW_TARGET" || alert.code === "UNCLEAR_SCREENSHOT")) return false
    if (reasons.some((line) => line.includes(alert.explanation))) return false
    if (alert.code === "BELOW_TARGET" && reasons.some((line) => /^lacking /i.test(line))) return false
    return true
  })

  return (
    <Card id={`task-${task.task_id}`} className="border-[#F7C6D3]">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="brand-label text-[11px] font-bold uppercase tracking-[0.12em] text-[#B8325F]">{PLATFORM_LABEL[task.platform] || task.platform} · {task.client_name}</p>
            <h2 className="text-2xl text-foreground">{task.title}</h2>
            <p className="text-xs text-muted-foreground">{task.assignee_name} · {task.work_date} · {task.time_logged} · {task.completion_pct}% of the minimum</p>
          </div>
          <span className={cn("rounded-full px-3 py-1 text-xs font-bold", STATUS_TONE[task.status] || STATUS_TONE.needs_review)}>{task.status_label}</span>
        </div>
        {reasons.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold leading-snug text-amber-950">
            {reasons.map((line) => <p key={line}>{line}</p>)}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {task.categories.map((row) => (
            <div key={row.key} className="rounded-2xl bg-[#FDF2F5] p-3">
              <p className="brand-label text-[11px] font-bold uppercase tracking-wide text-[#B8325F]">{row.label}</p>
              <p className="mt-1 text-3xl leading-none text-[#B8325F]">{row.verified}</p>
              <p className="mt-1 text-xs text-muted-foreground">{task.reader_failed ? `Target ${row.min} to ${row.max} · screenshot could not be read` : `Target ${row.min} to ${row.max} · ${row.remaining} still to go · ${row.completion_pct}%`}</p>
              {row.verified > row.max && <p className="text-[11px] font-semibold text-[#B8325F]">Above the daily maximum. The full verified count is kept.</p>}
              <p className="text-[11px] text-muted-foreground">Seen {row.detected} · duplicates {row.duplicates} · not counted {row.invalid} · to review {row.needs_review}</p>
              <div className="mt-2 h-1.5 rounded-full bg-white"><div className="h-1.5 rounded-full bg-[#E8578A]" style={{ width: `${row.completion_pct}%` }} /></div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Approval: {task.approval}. A board status of Done does not complete this check.</p>
        {task.rejection_note && task.approval === "Sent back" && !reasons.some((line) => line.includes(task.rejection_note || "")) && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">Sent back: {task.rejection_note}</p>
        )}
        {alerts.length > 0 && (
          <ul className="space-y-1">
            {alerts.slice(0, 8).map((alert, index) => (
              <li key={`${alert.code}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                <span className="font-bold">{alert.label}.</span> {alert.explanation}
              </li>
            ))}
          </ul>
        )}
        {task.screenshots.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {task.screenshots.map((shot) => (
              <div key={shot.id}>
                <ShotThumb id={shot.id} name={shot.original_name} />
                <p className="mt-1 text-[11px] text-muted-foreground">{shot.extraction_status === "read" ? "Read" : (shot.extraction_note || "Could not be read")}</p>
              </div>
            ))}
          </div>
        )}
        {!management && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="brand-label cursor-pointer rounded-xl bg-[#B8325F] px-3 py-2 text-xs font-bold text-white">
              Upload screenshots
              <input type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(event) => { if (event.target.files?.length) upload.mutate(event.target.files); event.target.value = "" }} />
            </label>
            <Button type="button" variant="outline" onClick={() => submit.mutate()} disabled={submit.isPending}>Submit for review</Button>
          </div>
        )}
        {task.activities.length > 0 && (
          <ul className="space-y-2">
            {task.activities.map((activity) => (
              <li key={activity.id} className="rounded-xl border px-3 py-2 text-xs">
                <p className="font-semibold">{activity.activity_type}{activity.username ? ` · ${activity.username}` : ""} · {activity.status.replaceAll("_", " ")}{activity.counted ? " · counted" : " · not counted"}</p>
                {activity.status === "rejected" ? (
                  <p className="font-semibold text-amber-900">Rejected: {activity.explanation}</p>
                ) : activity.status === "invalid" || activity.status === "duplicate" ? (
                  <p className="font-semibold text-amber-900">{activity.explanation}</p>
                ) : (
                  <p className="text-muted-foreground">{activity.explanation || activity.text || "No extra note"}</p>
                )}
                {management && (
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" variant="success" onClick={() => withReason(`/engagement/activities/${activity.id}/approve`)}>Count it</Button>
                    <Button type="button" size="sm" variant="danger" onClick={() => withReason(`/engagement/activities/${activity.id}/reject`)}>Do not count</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {management && (
          <div className="space-y-2 rounded-2xl border border-[#F7C6D3] p-3">
            <Label>Reason for any change</Label>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this change is right" />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="gold" onClick={() => withReason(`/engagement/tasks/${task.task_id}/approve`)}>Approve task</Button>
              <Button type="button" variant="outline" onClick={() => withReason(`/engagement/tasks/${task.task_id}/reject`)}>Send back</Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {task.platform === "instagram" && (
                <>
                  <Input placeholder="DM minimum" value={targets.dm_min || ""} onChange={(event) => setTargets({ ...targets, dm_min: event.target.value })} />
                  <Input placeholder="DM maximum" value={targets.dm_max || ""} onChange={(event) => setTargets({ ...targets, dm_max: event.target.value })} />
                </>
              )}
              {(task.platform === "instagram" || task.platform === "linkedin") && (
                <>
                  <Input placeholder="Comment minimum" value={targets.comment_min || ""} onChange={(event) => setTargets({ ...targets, comment_min: event.target.value })} />
                  <Input placeholder="Comment maximum" value={targets.comment_max || ""} onChange={(event) => setTargets({ ...targets, comment_max: event.target.value })} />
                </>
              )}
              {task.platform === "facebook" && (
                <>
                  <Input placeholder="Share minimum" value={targets.share_min || ""} onChange={(event) => setTargets({ ...targets, share_min: event.target.value })} />
                  <Input placeholder="Share maximum" value={targets.share_max || ""} onChange={(event) => setTargets({ ...targets, share_max: event.target.value })} />
                </>
              )}
              <Input className="sm:col-span-2" placeholder="Account names on screenshots, separated by commas" value={targets.account_names || ""} onChange={(event) => setTargets({ ...targets, account_names: event.target.value })} />
            </div>
            <Button type="button" variant="outline" onClick={() => { if (!reason.trim()) { setMessage("Add a reason before changing targets."); return } saveTargets.mutate() }}>Save targets for this client</Button>
          </div>
        )}
        {task.audits.length > 0 && management && (
          <ul className="space-y-1 text-[11px] text-muted-foreground">
            {task.audits.slice(0, 5).map((audit) => (
              <li key={audit.id}>{audit.actor_name} · {audit.action.replaceAll("_", " ")} · {audit.reason}{audit.original_result ? ` · original ${audit.original_result.status || "result"}, counted ${audit.original_result.counted ? "yes" : "no"}` : ""}</li>
            ))}
          </ul>
        )}
        {message && <p className="text-xs font-semibold text-[#B8325F]">{message}</p>}
      </CardContent>
    </Card>
  )
}

function ReviewLog({ tasks }: { tasks: EngagementTask[] }) {
  const waiting = [...tasks.filter(taskNeedsReview)]
    .sort((a, b) => (b.latest_at || b.submitted_at || b.rejected_at || "").localeCompare(a.latest_at || a.submitted_at || a.rejected_at || ""))
  return (
    <Card className="border-amber-200">
      <CardContent className="space-y-2 p-4">
        <p className="brand-label text-[11px] font-bold uppercase tracking-[0.12em] text-amber-900">Review log</p>
        <p className="text-xs text-muted-foreground">Newest items are first. Each row says why it needs review.</p>
        {waiting.length === 0 && <p className="text-sm text-muted-foreground">Nothing is waiting for review.</p>}
        <ul className="space-y-1.5">
          {waiting.map((task) => {
            const reasons = reviewReasonLines(task).slice(0, 4)
            return (
            <li key={task.task_id}>
              <a href={`#task-${task.task_id}`} className="block rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <span className="font-semibold">{task.assignee_name} · {task.client_name} · {PLATFORM_LABEL[task.platform] || task.platform}</span>
                {reasons.map((reason) => (
                  <span key={reason} className="mt-1 block text-sm font-semibold leading-snug text-amber-950">{reason}</span>
                ))}
                <span className="mt-0.5 block text-xs text-muted-foreground">{task.work_date}</span>
              </a>
            </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function AccessRoster() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ["engagement-vas"],
    queryFn: () => apiFetch<{ vas: { va_id: string; name: string; enabled: boolean; manual: boolean; has_engagement_tasks: boolean }[] }>("/engagement/vas"),
  })
  const toggle = useMutation({
    mutationFn: (row: { va_id: string; enabled: boolean }) =>
      apiFetch(`/engagement/vas/${row.va_id}`, { method: "PATCH", body: JSON.stringify({ enabled: row.enabled }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engagement-vas"] })
      qc.invalidateQueries({ queryKey: ["engagement-access"] })
      qc.invalidateQueries({ queryKey: ["engagement-tasks"] })
    },
  })
  if (!data) return null
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="brand-label text-[11px] font-bold uppercase tracking-[0.12em] text-[#B8325F]">Who can upload</p>
        <p className="text-xs text-muted-foreground">Virtual Assistants with Instagram, Facebook, or LinkedIn tasks are included. You can turn screenshot check on or off for one person. Pay is not shown here.</p>
        <ul className="space-y-1.5">
          {data.vas.map((row) => (
            <li key={row.va_id} className="flex items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{row.name}{row.has_engagement_tasks ? "" : " · no engagement tasks"}</span>
              <Button type="button" size="sm" variant={row.enabled ? "outline" : "gold"} onClick={() => toggle.mutate({ va_id: row.va_id, enabled: !row.enabled })}>
                {row.enabled ? "On" : "Off"}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function EngagementPage() {
  const user = getAuthUser()
  const access = useEngagementAccess()
  const [params] = useSearchParams()
  const focus = params.get("task")
  const [day, setDay] = useState("")
  const management = user?.role === "admin" || user?.role === "auditor"
  const { data, isLoading, error } = useQuery({
    queryKey: ["engagement-tasks", day],
    queryFn: () => apiFetch<EngagementBoard>(`/engagement/tasks${day ? `?work_date=${day}` : ""}`),
    enabled: access.data?.enabled === true,
  })

  async function download(span: "day" | "week") {
    const when = data?.work_date || day
    const text = await apiFetch<string>(`/engagement/reports/export?span=${span}${when ? `&work_date=${when}` : ""}`)
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }))
    const link = document.createElement("a")
    link.href = url
    link.download = span === "week" ? "engagement-week.csv" : "engagement-day.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  if (access.isLoading || isLoading) return <p className="text-sm text-muted-foreground">Loading screenshot check…</p>
  if (!access.data?.enabled) return <p className="text-sm text-muted-foreground">This page is not available for your account.</p>
  return (
    <div className="shc-brand space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="brand-label text-[11px] font-bold uppercase tracking-[0.14em] text-[#B8325F]">Screenshot check</p>
          <h1 className="text-4xl text-[#B8325F]">Daily engagement evidence</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Upload screenshots on the client task that is already on the board. Verified totals come only from those screenshots. You can go past the daily maximum, and that extra count stays. This does not change clock-in, timesheets, or the task list.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={day || data?.work_date || ""} onChange={(event) => setDay(event.target.value)} className="w-auto" />
          {management && <Button type="button" variant="outline" onClick={() => download("day")}>Export day</Button>}
          {management && <Button type="button" variant="outline" onClick={() => download("week")}>Export week</Button>}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error instanceof Error ? error.message : "Could not load tasks."}</p>}
      {user?.role === "admin" && <AccessRoster />}
      {management && <ReviewLog tasks={data?.tasks ?? []} />}
      {data && data.tasks.length === 0 && (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No Instagram, Facebook, or LinkedIn engagement tasks for this date. The check uses tasks already on the board. It does not create a second task.</CardContent></Card>
      )}
      <div className="space-y-4">
        {data?.tasks.map((task) => (
          <div key={task.task_id} className={focus === task.task_id ? "rounded-3xl ring-2 ring-[#E8578A]" : ""}>
            <TaskCard task={task} management={management && access.data?.scope === "management"} />
          </div>
        ))}
      </div>
    </div>
  )
}
