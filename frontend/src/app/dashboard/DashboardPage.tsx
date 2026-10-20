import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { DashboardOverview, DashboardSummary, TaskItem } from "@/lib/types"
import type { UserProfile } from "@/lib/profile"
import { formatDate } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TASK_STATUSES, PRIORITY_META, formatDuration } from "@/components/tasks/task-utils"
import { AlertTriangle, ArrowRight, CalendarDays, Check, CheckCircle2, ClipboardList, Flame, Lightbulb, ListTodo, Play, Sparkles, Sun, Sunrise, Sunset, Timer, X } from "lucide-react"
import { cn } from "@/lib/utils"

const QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Focus is a matter of deciding what not to do.", author: "John Carmack" },
  { text: "Small progress is still progress.", author: "Unknown" },
  { text: "Done is better than perfect.", author: "Sheryl Sandberg" },
  { text: "Your future is created by what you do today, not tomorrow.", author: "Robert Kiyosaki" },
  { text: "Discipline is choosing what you want most over what you want now.", author: "Abraham Lincoln" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Quality means doing it right when no one is looking.", author: "Henry Ford" },
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
]

function greeting() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return { label: "Good Morning", Icon: Sunrise, emoji: "☀️", emojiClass: "emoji-sun" }
  if (h >= 12 && h < 17) return { label: "Good Afternoon", Icon: Sun, emoji: "🌤️", emojiClass: "emoji-float" }
  if (h >= 17 && h < 21) return { label: "Good Evening", Icon: Sunset, emoji: "🌇", emojiClass: "emoji-float" }
  return { label: "Good Night", Icon: Sunset, emoji: "🌙", emojiClass: "emoji-moon" }
}
function quoteOfDay() {
  const now = new Date(); const start = new Date(now.getFullYear(), 0, 0)
  return QUOTES[Math.floor((now.getTime() - start.getTime()) / 86400000) % QUOTES.length]
}
function statusLabel(s: string) { return TASK_STATUSES.find(x => x.id === s)?.label || s }

interface Advice { emoji: string; title: string; text: string; tone: "primary" | "warn" | "danger" | "calm" }
function buildAdvice(o: DashboardOverview, isAdmin: boolean): Advice[] {
  const h = new Date().getHours()
  const c = o.counts
  const night = h >= 21 || h < 5
  const morning = h >= 5 && h < 12
  const afternoon = h >= 12 && h < 17
  const evening = h >= 17 && h < 21
  const out: Advice[] = []
  const tomorrowFirst = o.tomorrow_tasks?.[0]

  if (night) {
    out.push({ emoji: "🌙", tone: "calm", title: "It's late — time to wind down", text: `You've logged ${o.hours_today}h today and finished ${c.done_this_week} task(s) this week. Sleep early tonight${tomorrowFirst ? ` — tomorrow starts with “${tomorrowFirst.title}”${tomorrowFirst.due_date ? "" : ""} for ${tomorrowFirst.client_name}` : " — tomorrow's board is light, enjoy the slow start"}. A rested brain tomorrow beats one more tired hour tonight.` })
    out.push({ emoji: "🌅", tone: "primary", title: "Tomorrow at a glance", text: o.tomorrow_tasks?.length ? `${o.tomorrow_tasks.length} task(s) due tomorrow: ${o.tomorrow_tasks.slice(0, 3).map(t => t.title).join(" · ")}. Lay out what you need tonight so the morning is just execution.` : "Nothing is due tomorrow. Use the morning to pull one backlog item forward and get ahead of the week." })
    if (c.overdue) out.push({ emoji: "🧹", tone: "warn", title: "Don't sleep on the overdue list", text: `${c.overdue} overdue item(s) are waiting. Don't work on them now — just pick the one you'll clear first tomorrow and let the rest wait.` })
    if (!isAdmin && o.live_clock.length) out.push({ emoji: "⏰", tone: "danger", title: "You're still clocked in!", text: "Your clock is still running. Clock out now so today's hours are logged correctly — future you says thanks." })
    return out.slice(0, 3)
  }
  if (morning) {
    out.push({ emoji: "🎯", tone: "primary", title: "Your focus plan", text: c.due_today ? `Start with the ${c.due_today} task(s) due today${o.estimated_hours_today && Number(o.estimated_hours_today) ? ` (~${o.estimated_hours_today}h estimated)` : ""}. Do the hardest one first while your energy is highest.` : "Nothing due today — perfect day to clear backlog and get ahead. Pick one To Do and finish it end-to-end." })
    if (c.overdue) out.push({ emoji: "🚨", tone: "danger", title: "Clear one overdue first", text: `${c.overdue} overdue item(s). Knocking out just one before lunch changes the whole feel of the day.` })
  }
  if (afternoon) {
    out.push({ emoji: "⚡", tone: "primary", title: "Midday check-in", text: `${c.in_progress} in progress, ${c.due_today} due today, ${o.hours_today}h logged so far. If a task has been 'in progress' all day, split it or ask for help — stuck is information.` })
    if (c.blocked) out.push({ emoji: "🧱", tone: "warn", title: "Unblock something", text: `${c.blocked} blocked task(s). One message to the right person now can save a whole day tomorrow.` })
  }
  if (evening) {
    out.push({ emoji: "🏁", tone: "primary", title: "Land the day well", text: `Finish what's closest to done, update your task comments, and make sure your time is logged (${o.hours_today}h so far today). Tomorrow's list writes itself when today is closed properly.` })
    if (tomorrowFirst) out.push({ emoji: "🌇", tone: "calm", title: "Tomorrow's first move", text: `“${tomorrowFirst.title}” (${tomorrowFirst.client_name}) is due tomorrow. A 2-minute look now means a fast start in the morning.` })
  }
  if (isAdmin && o.team_load?.length) {
    const top = o.team_load[0]
    const free = o.team_load[o.team_load.length - 1]
    if (top.open >= 5) out.push({ emoji: "👥", tone: "warn", title: `${top.name} is loaded`, text: `${top.name} has ${top.open} open task(s)${top.overdue ? `, ${top.overdue} overdue` : ""}. ${free && free.name !== top.name ? `Consider moving one to ${free.name} (${free.open} open) to balance the week.` : "Consider redistributing before adding more."}` })
    if (c.unassigned) out.push({ emoji: "🙋", tone: "warn", title: "Unassigned work is invisible work", text: `${c.unassigned} task(s) have no owner. Assign them today — unowned tasks are the ones that slip.` })
  }
  if (!isAdmin && !o.live_clock.length && (morning || afternoon)) {
    out.push({ emoji: "⏱️", tone: "calm", title: "Clock in, don't reconstruct later", text: "Start the clock when you start working — your log writes itself at clock-out, times and all. No more end-of-day timesheet guessing." })
  }
  out.push({ emoji: "💡", tone: "calm", title: "Work smarter", text: morning ? "Time-box: 50 minutes focused, 10 minutes break. Check comments between boxes, not during." : afternoon ? "Batch the small stuff: comments, updates, and quick replies in one 15-minute sweep instead of all day." : "Write tomorrow's top 3 before you log off. Starting decided is starting fast." })
  return out.slice(0, 3)
}
function MiniTask({ t, base }: { t: TaskItem; base: string }) {
  const overdue = t.due_date && t.due_date < new Date().toISOString().slice(0, 10) && t.status !== "done"
  return (
    <Link to={`${base}/tasks`} className="flex items-center gap-3 rounded-xl border p-3 monday-card bg-card">
      <span className="h-9 w-1.5 rounded-full shrink-0" style={{ background: t.project_color || "var(--primary)" }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{t.title}</span>
        <span className="block text-[11px] text-muted-foreground">{t.client_name}{t.assignee_name ? ` · ${t.assignee_name}` : ""} · {statusLabel(t.status)}</span>
      </span>
      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", PRIORITY_META[t.priority].className)}>{PRIORITY_META[t.priority].label}</span>
      <span className={cn("text-[11px] whitespace-nowrap", overdue && "font-bold text-red-600")}>{t.due_date ? formatDate(t.due_date) : "No date"}</span>
    </Link>
  )
}

export function DashboardPage() {
  const qc = useQueryClient()
  const user = getAuthUser()
  const isAdmin = user?.role === "admin"
  const base = isAdmin ? "/admin" : "/va"
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/profile/me"), staleTime: 60_000 })
  const firstName = (profile?.display_name || user?.name || "there").split(" ")[0]
  const { label: greetLabel, Icon: GreetIcon, emoji, emojiClass } = greeting()
  const quote = useMemo(quoteOfDay, [])

  const { data: overview, isLoading: ovLoading } = useQuery({ queryKey: ["dashboard-overview"], queryFn: () => apiFetch<DashboardOverview>("/dashboard/overview"), refetchInterval: 30_000 })
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => apiFetch<DashboardSummary>("/dashboard/summary"), enabled: isAdmin })
  const approve = useMutation({ mutationFn: (id: string) => apiFetch(`/work-logs/${id}/approve`, { method: "POST" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["dashboard-overview"] }) } })
  const reject = useMutation({ mutationFn: (id: string) => apiFetch(`/work-logs/${id}/reject`, { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }) })

  if (ovLoading || !overview) return <p className="text-sm text-muted-foreground">Loading your day…</p>
  const c = overview.counts

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Hero — open, no box */}
      <div className="px-1 pt-2 sm:px-2">
        <p className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em] text-primary"><GreetIcon className="h-4 w-4" /> {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <h1 className="whitespace-nowrap font-extrabold leading-[1.05] tracking-tight" style={{ fontSize: "clamp(1.9rem, 4vw, 2.9rem)" }}>{greetLabel}, <span className="gradient-text">{firstName}</span> <span className={cn("inline-block", emojiClass)} aria-hidden="true">{emoji}</span><span className="emoji-wave inline-block" aria-hidden="true">👋</span></h1>
          <div className="flex gap-6 pb-1 text-center sm:gap-8">
            {[{ label: "Due today", v: c.due_today, icon: CalendarDays }, { label: "Overdue", v: c.overdue, icon: AlertTriangle }, { label: "Done this week", v: c.done_this_week, icon: CheckCircle2 }].map(s => (
              <div key={s.label}>
                <s.icon className={cn("mx-auto h-5 w-5", s.label === "Overdue" && c.overdue > 0 ? "text-red-500" : "text-primary")} />
                <div className={cn("mt-1 text-3xl font-extrabold leading-none", s.label === "Overdue" && c.overdue > 0 && "text-red-600")}>{s.v}</div>
                <div className="mt-1 text-[11px] font-medium text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 max-w-3xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Quote of the day</p>
          <p className="mt-1 flex items-start gap-2.5 text-lg font-medium leading-snug"><Sparkles className="mt-1 h-4.5 w-4.5 shrink-0 text-primary" /><span>“{quote.text}” <span className="whitespace-nowrap text-sm text-muted-foreground">— {quote.author}</span></span></p>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to={`${base}/tasks`}><Button variant="gold" size="lg"><ListTodo className="h-4 w-4" /> Open Task Board</Button></Link>
          {!isAdmin && <Link to="/va/time-clock"><Button variant="outline" size="lg"><Play className="h-4 w-4" /> Clock In</Button></Link>}
          <Link to={`${base}/projects`}><Button variant="outline" size="lg">Projects <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
        </div>
      </div>

      {/* Smart advice — time & workload aware */}
      <div>
        <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><Lightbulb className="h-3.5 w-3.5 text-primary" /> Smart advice for {greetLabel.replace("Good ", "").toLowerCase()}</p>
        <div className="grid gap-3 lg:grid-cols-3">
          {buildAdvice(overview, isAdmin).map((a, i) => (
            <div key={i} className={cn("monday-card rounded-2xl border p-4", a.tone === "danger" && "border-red-200 bg-red-50/70", a.tone === "warn" && "border-amber-200 bg-amber-50/70", a.tone === "calm" && "border-primary/25 bg-primary/[0.04]", a.tone === "primary" && "bg-card")}>
              <p className="flex items-center gap-2 text-[13px] font-bold"><span className="text-base">{a.emoji}</span>{a.title}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{a.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* What to prepare */}
        <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary" /> What to Prepare Today</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {overview.prepare.map((item, i) => <label key={i} className="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-xs hover:bg-muted/40"><input type="checkbox" className="mt-0.5 accent-[var(--primary)]" /><span>{item}</span></label>)}
            {overview.prepare.length === 0 && <p className="text-xs text-muted-foreground">You're all caught up. Review the board for what's next.</p>}
          </CardContent></Card>

        {/* Today's tasks */}
        <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Flame className="h-4 w-4 text-primary" /> Current Tasks — Today</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {overview.today_tasks.map(t => <MiniTask key={t.id} t={t} base={base} />)}
            {overview.today_tasks.length === 0 && <p className="text-xs text-muted-foreground">Nothing due today. Pull something from the backlog below.</p>}
            <Link className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" to={`${base}/tasks`}>View full Task Board <ArrowRight className="h-3 w-3" /></Link>
          </CardContent></Card>

        {/* Needs attention */}
        <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" /> Needs Attention {overview.needs_attention.length > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">{overview.needs_attention.length}</span>}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {overview.needs_attention.map((a, i) => <Link key={i} to={a.link} className={cn("block rounded-xl border p-3 monday-card", a.severity === "high" ? "border-red-200 bg-red-50/70" : "border-amber-200 bg-amber-50/70")}><p className="text-xs font-semibold">{a.title}</p><p className="text-[11px] text-muted-foreground">{a.detail}</p></Link>)}
            {overview.needs_attention.length === 0 && <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs"><CheckCircle2 className="mr-1 inline h-4 w-4 text-green-600" /> All clear — nothing overdue, blocked, or waiting.</div>}
            {overview.live_clock.length > 0 && <div className="pt-1"><p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"><Timer className="h-3.5 w-3.5" /> Live clock</p>{overview.live_clock.map(e => <div key={e.id} className="mb-1.5 flex items-center justify-between rounded-lg border px-2.5 py-2 text-[11px]"><span><span className="live-dot mr-1.5 inline-block h-2 w-2 rounded-full bg-green-500" />{isAdmin ? `${e.va_name} · ` : ""}{e.task_title || e.client_name || "Working"}</span><span className="font-mono font-bold">{formatDuration(e.elapsed_seconds)}</span></div>)}</div>}
          </CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle>Coming Up — Next 7 Days</CardTitle></CardHeader><CardContent className="space-y-2">
          {overview.upcoming.map(t => <MiniTask key={t.id} t={t} base={base} />)}{overview.upcoming.length === 0 && <p className="text-xs text-muted-foreground">No deadlines in the next 7 days.</p>}
        </CardContent></Card>
        {/* Projects */}
        <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle>Projects at a Glance</CardTitle></CardHeader><CardContent className="space-y-3">
          {overview.projects.map(p => { const pct = p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0; return (
            <Link key={p.id} to={`${base}/tasks?project=${p.id}`} className="block rounded-xl border p-3 monday-card"><div className="flex justify-between text-xs"><span className="font-semibold">{p.name}</span><span className="text-muted-foreground">{pct}%</span></div>
              <div className="mt-1 text-[11px] text-muted-foreground">{p.client_name} · {p.cadence} · {p.task_done}/{p.task_total} done</div>
              <div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: p.color }} /></div></Link>) })}
          {overview.projects.length === 0 && <p className="text-xs text-muted-foreground">No active projects yet.</p>}
        </CardContent></Card>
        {isAdmin ? (
          <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle>Team Load — Who's Busy</CardTitle></CardHeader><CardContent className="space-y-2">
            {(overview.team_load ?? []).map(v => (
              <div key={v.name} className="flex items-center gap-3 text-xs">
                <span className="w-20 truncate font-semibold">{v.name}</span>
                <span className="h-2 flex-1 rounded-full bg-slate-100"><span className={cn("block h-2 rounded-full", v.overdue ? "bg-red-400" : v.open >= 5 ? "bg-amber-400" : "bg-green-400")} style={{ width: `${Math.min(100, v.open * 14)}%` }} /></span>
                <span className="whitespace-nowrap text-muted-foreground">{v.open} open{v.overdue ? ` · ${v.overdue} overdue` : ""}{v.due_today ? ` · ${v.due_today} today` : ""}</span>
              </div>
            ))}
            {(overview.team_load ?? []).length === 0 && <p className="text-xs text-muted-foreground">No open tasks assigned yet.</p>}
            <p className="pt-1 text-[11px] text-muted-foreground">Balance the board: move work from red/amber to green before assigning new tasks.</p>
          </CardContent></Card>
        ) : (
          <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle>Tomorrow</CardTitle></CardHeader><CardContent className="space-y-2">
            {(overview.tomorrow_tasks ?? []).map(t => <MiniTask key={t.id} t={t} base={base} />)}
            {(overview.tomorrow_tasks ?? []).length === 0 && <p className="text-xs text-muted-foreground">Nothing due tomorrow. A calm start — pull one thing forward if you finish early today.</p>}
          </CardContent></Card>
        )}
      </div>

      {isAdmin && data && data.pending_logs.length > 0 && (
          <Card><CardHeader className="pb-2"><CardTitle>Pending Approval ({data.pending_logs.length})</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full text-xs">
            <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-3">Date</th><th className="p-3">VA</th><th className="p-3">Client</th><th className="p-3">Hours</th><th className="p-3">Actions</th></tr></thead>
            <tbody>{data.pending_logs.map(log => <tr key={log.id} className="border-b"><td className="p-3">{log.work_date}</td><td className="p-3">{log.va_name}</td><td className="p-3">{log.client_name}</td><td className="p-3">{log.hours}</td><td className="p-3"><div className="flex gap-1"><Button size="sm" variant="success" onClick={() => approve.mutate(log.id)}><Check className="h-3 w-3" /></Button><Button size="sm" variant="danger" onClick={() => reject.mutate(log.id)}><X className="h-3 w-3" /></Button></div></td></tr>)}</tbody></table></CardContent></Card>
      )}
    </div>
  )
}
