import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { ArrowRight, ChevronDown, History, Menu, Pause, Play, Square, SwitchCamera, Timer } from "lucide-react"
import { apiFetch, getAuthUser, homeForRole, isImpersonating, startImpersonation } from "@/lib/api"
import type { AppUser, TimeClockEntry } from "@/lib/types"
import { GlobalSearch } from "@/components/layout/GlobalSearch"
import { NotificationsPanel } from "@/components/layout/NotificationsPanel"
import { formatDuration } from "@/components/tasks/task-utils"
import { cn, roleLabel } from "@/lib/utils"

/** Live personal time-clock — clock in, pause, resume, clock out from the header (VA, admin, and auditor). */
function HeaderClock() {
  const qc = useQueryClient()
  const { data: current, dataUpdatedAt } = useQuery({ queryKey: ["topbar-clock"], queryFn: () => apiFetch<TimeClockEntry | null>("/time-clock/current"), refetchInterval: 20_000 })
  const [, setTick] = useState(0)

  // Tick every second while running so the timer counts live
  useEffect(() => {
    if (current?.status !== "running") return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [current?.status])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["topbar-clock"] })
    qc.invalidateQueries({ queryKey: ["clock-current"] })
    qc.invalidateQueries({ queryKey: ["dashboard-overview"] })
  }
  const clockIn = useMutation({ mutationFn: () => apiFetch("/time-clock/clock-in", { method: "POST", body: JSON.stringify({}) }), onSuccess: invalidate })
  const pause = useMutation({ mutationFn: () => apiFetch("/time-clock/pause", { method: "POST" }), onSuccess: invalidate })
  const resume = useMutation({ mutationFn: () => apiFetch("/time-clock/resume", { method: "POST" }), onSuccess: invalidate })
  const clockOut = useMutation({ mutationFn: () => apiFetch("/time-clock/clock-out", { method: "POST", body: JSON.stringify({ create_work_log: true }) }), onSuccess: invalidate })
  const busy = clockIn.isPending || pause.isPending || resume.isPending || clockOut.isPending

  if (!current) {
    return (
      <button
        onClick={() => clockIn.mutate()}
        disabled={busy}
        className="btn-shine flex shrink-0 items-center gap-2 rounded-full bg-green-500 px-3.5 py-1.5 text-[11px] font-bold text-white shadow-sm transition hover:bg-green-600 disabled:opacity-60 sm:px-4 sm:text-xs"
        title="Clock in now"
      >
        <Play className="h-3.5 w-3.5 fill-current" /> Clock In
      </button>
    )
  }

  const running = current.status === "running"
  const elapsed = (current.elapsed_seconds ?? 0) + (running ? Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 1000)) : 0)

  return (
    <div className={cn("flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-3 pr-1.5", running ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50")}>
        <Link to={getAuthUser()?.role === "va" ? "/va/time-clock" : "/admin/time-clock"} className="flex items-center gap-2" title="Open Time Clock">
        <span className={cn("h-2 w-2 rounded-full", running ? "live-dot bg-green-500" : "bg-amber-500")} />
        <span className={cn("hidden text-[11px] font-semibold sm:inline", running ? "text-green-800" : "text-amber-800")}>{running ? "Clocked in" : "Paused"}</span>
        <span className={cn("font-mono text-[11px] font-bold sm:text-xs", running ? "text-green-900" : "text-amber-900")}>{formatDuration(elapsed)}</span>
      </Link>
      {running ? (
        <button onClick={() => pause.mutate()} disabled={busy} className="rounded-full bg-white/80 p-1.5 text-amber-600 shadow-sm transition hover:bg-white disabled:opacity-60" title="Pause"><Pause className="h-3.5 w-3.5" /></button>
      ) : (
        <button onClick={() => resume.mutate()} disabled={busy} className="rounded-full bg-white/80 p-1.5 text-green-600 shadow-sm transition hover:bg-white disabled:opacity-60" title="Resume"><Play className="h-3.5 w-3.5 fill-current" /></button>
      )}
      <button onClick={() => clockOut.mutate()} disabled={busy} className="rounded-full bg-red-500 p-1.5 text-white shadow-sm transition hover:bg-red-600 disabled:opacity-60" title="Clock out & create work log"><Square className="h-3.5 w-3.5 fill-current" /></button>
    </div>
  )
}

/** Team clock for admin/auditor — who's live plus recent clock history. */
function HeaderAdminClock() {
  const [open, setOpen] = useState(false)
  const { data: live = [], dataUpdatedAt } = useQuery({ queryKey: ["topbar-live"], queryFn: () => apiFetch<TimeClockEntry[]>("/time-clock/live"), refetchInterval: 15_000 })
  const { data: all = [] } = useQuery({ queryKey: ["topbar-clock-all"], queryFn: () => apiFetch<TimeClockEntry[]>("/time-clock"), enabled: open, refetchInterval: 30_000 })
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!live.some(e => e.status === "running")) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [live])

  const elapsedOf = (e: TimeClockEntry) => (e.elapsed_seconds ?? 0) + (e.status === "running" ? Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 1000)) : 0)
  const history = all.filter(e => e.status === "completed").slice(0, 6)
  const runningCount = live.filter(e => e.status === "running").length

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold shadow-sm transition sm:text-xs", live.length ? "border-green-300 bg-green-50 text-green-800 hover:bg-green-100" : "border-border bg-card text-muted-foreground hover:bg-muted/50")}
        title="Team time clock — live, logs & history"
      >
        {live.length ? <span className="live-dot h-2 w-2 rounded-full bg-green-500" /> : <Timer className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">Team Clock</span>
        <span className="font-mono font-bold">{live.length ? `${live.length} on clock${runningCount < live.length ? ` · ${live.length - runningCount} paused` : ""}` : "No one in"}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-2xl border bg-card shadow-xl">
            <div className="border-b bg-muted/40 px-4 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-bold"><span className={cn("h-2 w-2 rounded-full", live.length ? "live-dot bg-green-500" : "bg-slate-300")} /> Live now ({live.length})</p>
            </div>
            <div className="max-h-44 overflow-y-auto px-2 py-2">
              {live.map(e => (
                <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted/40">
                  <span className="min-w-0"><span className="block truncate font-semibold">{e.va_name || "VA"}</span><span className="block truncate text-[11px] text-muted-foreground">{e.task_title || e.client_name || "Working"}{e.status === "paused" ? " · paused" : ""}</span></span>
                  <span className={cn("font-mono font-bold", e.status === "paused" ? "text-amber-600" : "text-green-700")}>{formatDuration(elapsedOf(e))}</span>
                </div>
              ))}
              {live.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Nobody is clocked in right now.</p>}
            </div>
            <div className="border-t bg-muted/40 px-4 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-bold"><History className="h-3.5 w-3.5" /> Recent clock history</p>
            </div>
            <div className="max-h-52 overflow-y-auto px-2 py-2">
              {history.map(e => (
                <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted/40">
                  <span className="min-w-0"><span className="block truncate font-semibold">{e.va_name || "VA"} <span className="font-normal text-muted-foreground">· {e.client_name || e.task_title || "General"}</span></span><span className="block text-[11px] text-muted-foreground">{new Date(e.clock_in).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {new Date(e.clock_in).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}{e.clock_out ? ` – ${new Date(e.clock_out).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}</span></span>
                  <span className="font-mono font-bold">{formatDuration(e.duration_seconds ?? e.elapsed_seconds ?? 0)}</span>
                </div>
              ))}
              {history.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No clock history yet.</p>}
            </div>
            <div className="flex border-t">
              <Link to={getAuthUser()?.role === "auditor" ? "/admin/logs" : "/admin/time-clock"} onClick={() => setOpen(false)} className="flex flex-1 items-center justify-center gap-1 px-3 py-2.5 text-xs font-bold text-primary transition hover:bg-primary/5">All logs & history <ArrowRight className="h-3.5 w-3.5" /></Link>
              <Link to="/admin/logs" onClick={() => setOpen(false)} className="flex flex-1 items-center justify-center gap-1 border-l px-3 py-2.5 text-xs font-bold text-primary transition hover:bg-primary/5">Work Logs <ArrowRight className="h-3.5 w-3.5" /></Link>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Admin-only: switch into any VA/auditor account to see exactly their view. */
function AdminUserSwitcher() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data: users = [] } = useQuery({ queryKey: ["switcher-users"], queryFn: () => apiFetch<AppUser[]>("/auth/users"), enabled: open })
  const targets = users.filter((u) => u.is_active && u.role !== "admin")
  const switchTo = async (u: AppUser) => {
    setBusy(true)
    try {
      const user = await startImpersonation(u.id)
      window.location.href = homeForRole(user.role)
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not switch user")
      setBusy(false)
    }
  }
  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-[11px] font-bold text-primary shadow-sm transition hover:bg-primary/10 sm:text-xs" title="Switch user — see what they see">
        <SwitchCamera className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Switch user</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (<>
        <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,300px)] overflow-hidden rounded-2xl border bg-card shadow-xl">
          <p className="border-b bg-muted/40 px-4 py-2.5 text-xs font-bold">View as… (you'll see their exact view)</p>
          <div className="max-h-72 overflow-y-auto p-2">
            {targets.map((u) => (
              <button key={u.id} disabled={busy} onClick={() => void switchTo(u)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-muted/50 disabled:opacity-60">
                <span className="min-w-0"><span className="block truncate font-semibold">{u.name}</span><span className="block truncate text-[11px] text-muted-foreground">{u.email}</span></span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{roleLabel(u.role)}</span>
              </button>
            ))}
            {targets.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">No active VA or project manager accounts to switch into.</p>}
          </div>
          <p className="border-t px-4 py-2 text-[10px] text-muted-foreground">An amber banner will let you exit back to Admin at any time.</p>
        </div>
      </>)}
    </div>
  )
}

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const user = getAuthUser()
  const isAdmin = user?.role === "admin"
  const isStaff = user?.role === "admin" || user?.role === "auditor"
  const { data: current } = useQuery({ queryKey: ["topbar-clock-status"], queryFn: () => apiFetch<TimeClockEntry | null>("/time-clock/current"), enabled: !!user, refetchInterval: 20_000 })

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border/70 bg-card/85 px-2.5 backdrop-blur-xl sm:gap-3 sm:px-4">
      <button className="shrink-0 rounded-lg p-1.5 hover:bg-muted lg:hidden" onClick={onMenu} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
      <div className="flex-1 min-[420px]:hidden" />
      <div className="hidden min-w-0 flex-1 min-[420px]:block">
        <p className="truncate text-[13px] font-semibold">Sunny Hue Creatives <span className="font-normal text-muted-foreground">/ {isAdmin ? "Admin" : user?.role === "auditor" ? "Project Manager" : "My workspace"}</span></p>
        <p className="hidden text-[10px] text-muted-foreground sm:block">{!isAdmin && current ? "You're on the clock — keep going!" : "Let's make today productive"}</p>
      </div>
      {isAdmin && !isImpersonating() && <AdminUserSwitcher />}
      {/* Personal clock for everyone; staff also get the team live/history panel */}
      {!!user && (
        <>
          <HeaderClock />
          {isStaff && <HeaderAdminClock />}
        </>
      )}
      <GlobalSearch className="hidden w-64 max-w-full md:block xl:w-80" />
      <NotificationsPanel />
    </header>
  )
}
