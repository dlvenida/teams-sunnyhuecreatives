import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { TeamActivity, VA } from "@/lib/types"
import type { UserProfile } from "@/lib/profile"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatCard } from "@/components/magicui/stat-card"
import { cn, formatDate } from "@/lib/utils"
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Activity, Eye, ShieldCheck, Siren } from "lucide-react"
import { useCssVar } from "@/hooks/useCssVar"

const STATUS_META = {
  inactive: { label: "No activity", pill: "border-red-200 bg-red-100 text-red-700", bar: "bg-red-400" },
  low: { label: "Low activity", pill: "border-amber-200 bg-amber-100 text-amber-800", bar: "bg-amber-400" },
  active: { label: "Active", pill: "border-green-200 bg-green-100 text-green-700", bar: "bg-green-400" },
  idle: { label: "Available", pill: "border-slate-200 bg-slate-100 text-slate-600", bar: "bg-slate-300" },
} as const

function initials(name: string) { return name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() }

export function AnalyticsPage() {
  const qc = useQueryClient()
  const me = getAuthUser()
  const isAdmin = me?.role === "admin"
  const chartColor = useCssVar("--chart", "#ec4899")

  const { data: activity, isLoading } = useQuery({
    queryKey: ["team-activity"],
    queryFn: () => apiFetch<TeamActivity>("/dashboard/activity"),
    refetchInterval: 60_000,
  })
  const { data: allVas = [] } = useQuery({ queryKey: ["vas"], queryFn: () => apiFetch<VA[]>("/vas") })
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/profile/me"), staleTime: 60_000 })
  const { data: appUsers = [] } = useQuery({
    queryKey: ["app-users"],
    queryFn: () => apiFetch<{ id: string; name: string; role: string; va_id?: string | null }[]>("/auth/users"),
  })
  const auditorCandidates = [
    ...(profile ? [{ id: profile.id, label: `${profile.display_name} (Admin)` }] : []),
    ...appUsers.filter(u => u.role === "auditor").map(u => ({ id: u.id, label: `${u.name} (Project Manager)` })),
    ...allVas.filter(v => v.user_id).map(v => ({ id: v.user_id!, label: `${v.name} (VA)` })),
  ]

  const setAuditor = useMutation({
    mutationFn: (data: { vaId: string; auditor: string | null }) =>
      apiFetch(`/vas/${data.vaId}/reviewer`, { method: "PATCH", body: JSON.stringify({ reviewer_user_id: data.auditor }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-activity"] }); qc.invalidateQueries({ queryKey: ["vas"] }) },
  })

  const members = activity?.members ?? []
  const flagged = members.filter(m => m.status === "inactive" || m.status === "low")
  const teamHoursWeek = members.reduce((s, m) => s + Number(m.hours_week || 0), 0)
  const teamHoursToday = members.reduce((s, m) => s + Number(m.hours_today || 0), 0)
  const overdueTotal = members.reduce((s, m) => s + m.overdue, 0)
  const chartData = members.map(m => ({ name: m.name.split(" ")[0], hours: Number(m.hours_week || 0) }))

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <h1 className="font-display text-xl font-bold">Analytics</h1>
          <p className="text-xs text-muted-foreground">
            {isAdmin
              ? "Monitor every VA — who is active, who is low, and who has assigned clients but no logs today or this week. Assign a Project Manager to watch each VA."
              : "Your project manager workspace: watch VA activity, spot no-log days early, and keep the team moving. Read-only by design."}
          </p>
        </div>
        {activity && <p className="rounded-full border bg-card px-3 py-1.5 text-xs font-semibold">Week of {formatDate(activity.week_start)} – {formatDate(activity.week_end)}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Team Hours This Week" value={`${teamHoursWeek.toFixed(2)} hrs`} subtitle={`${teamHoursToday.toFixed(2)} hrs today`} />
        <StatCard title="No Activity" value={activity?.counts.inactive ?? 0} subtitle="Assigned work, zero logs this week" className="border-red-200/70" />
        <StatCard title="Low Activity" value={activity?.counts.low ?? 0} subtitle="Few hours or overdue work" className="border-amber-200/70" />
        <StatCard title="Overdue Tasks" value={overdueTotal} subtitle={`${activity?.counts.active ?? 0} active · ${activity?.counts.idle ?? 0} available for work`} />
      </div>

      {flagged.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4">
          <p className="mb-2 flex items-center gap-2 text-xs font-extrabold text-red-800"><Siren className="h-4 w-4" /> Needs attention — {flagged.length} member(s)</p>
          <div className="flex flex-wrap gap-2">
            {flagged.map(m => (
              <span key={m.va_id} className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700">
                {m.name}: {m.reasons.join(" · ") || STATUS_META[m.status].label}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-red-700/80">Admins, all Project Managers, and each VA's assigned Project Manager are notified once a day while someone stays inactive.</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-1">
          <CardHeader className="pb-2"><CardTitle>Hours by VA — This Week</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={chartData} layout="vertical"><XAxis type="number" tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => [`${v} hrs`, "This week"]} /><Bar dataKey="hours" fill={chartColor} radius={[0, 6, 6, 0]} /></BarChart>
            </ResponsiveContainer>
            {chartData.length === 0 && <p className="text-xs text-muted-foreground">No VA users yet.</p>}
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> Activity Board — Who's Doing What</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {isLoading && <p className="p-4 text-sm text-muted-foreground">Checking team activity…</p>}
            <table className="w-full text-xs">
              <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-3">Member</th><th className="p-3">Status</th><th className="p-3">Assigned Clients</th><th className="p-3">Tasks</th><th className="p-3">Hours Today / Week</th><th className="p-3">Last Active</th><th className="p-3"><span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Project Manager</span></th></tr></thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.va_id} className={cn("border-b last:border-0 hover:bg-primary/[0.03]", m.status === "inactive" && "bg-red-50/50")}>
                    <td className="p-3"><span className="flex items-center gap-2"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-extrabold text-primary">{initials(m.name)}</span><span><span className="block font-bold">{m.name}</span><span className="block text-[10px] text-muted-foreground">{m.clock_status ? (m.clock_status === "paused" ? "⏸ Paused on clock" : "⏱ On the clock") : m.email}</span></span></span></td>
                    <td className="p-3">
                      <span className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold", STATUS_META[m.status].pill)}>{STATUS_META[m.status].label}</span>
                      {m.reasons.length > 0 && <span className="mt-1 block max-w-[170px] text-[10px] leading-snug text-muted-foreground">{m.reasons.join(" · ")}</span>}
                    </td>
                    <td className="p-3"><span className="flex max-w-[230px] flex-wrap gap-1">
                      {m.assigned_clients.map(c => (
                        <Link key={c.client_id} to="/admin/clients" className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", c.no_activity_week ? "bg-red-100 text-red-700" : "bg-muted hover:bg-primary/10")} title={`${c.open_tasks} open tasks · ${c.hours_week}h this week${c.last_log_date ? ` · last log ${c.last_log_date}` : " · never logged"}`}>
                          {c.name} · {c.hours_week}h{c.no_activity_week ? " ⚠" : ""}
                        </Link>
                      ))}
                      {m.assigned_clients.length === 0 && <span className="text-muted-foreground">No assigned clients</span>}
                    </span></td>
                    <td className="whitespace-nowrap p-3">{m.open_tasks} open{m.overdue > 0 && <span className="block font-bold text-red-600">{m.overdue} overdue</span>}{m.due_today > 0 && <span className="block text-amber-600">{m.due_today} due today</span>}</td>
                    <td className="whitespace-nowrap p-3"><span className="font-bold">{m.hours_today}h</span> today · <span className="font-bold">{m.hours_week}h</span> week<span className={cn("mt-1 block h-1.5 w-24 rounded-full bg-slate-100")}><span className={cn("block h-1.5 rounded-full", STATUS_META[m.status].bar)} style={{ width: `${Math.min(100, Number(m.hours_week) * 2.5)}%` }} /></span><span className="mt-0.5 block text-[10px] text-muted-foreground">{m.logs_week} log(s) this week</span></td>
                    <td className="whitespace-nowrap p-3 text-muted-foreground">{m.last_activity ? formatDate(m.last_activity) : "Never"}</td>
                    <td className="p-3">
                      {isAdmin ? (
                        <>
                          <select
                            value={m.reviewer_user_id ?? ""}
                            onChange={(e) => setAuditor.mutate({ vaId: m.va_id, auditor: e.target.value || null })}
                            className="h-8 max-w-[160px] rounded-lg border bg-card px-2 text-[11px] font-medium"
                            title="Assign a Project Manager to review this VA"
                          >
                            <option value="">No project manager</option>
                            {auditorCandidates.filter(c => c.id !== m.user_id).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                          </select>
                          {m.reviewer_name && <span className="mt-1 block text-[10px] text-muted-foreground">Project Manager: {m.reviewer_name}</span>}
                        </>
                      ) : (
                        <span className="text-[11px] font-medium text-muted-foreground">{m.reviewer_name ? `Project Manager: ${m.reviewer_name}` : "No project manager assigned"}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {members.length === 0 && !isLoading && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No VA users yet. Add them in Users → Virtual Assistant.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <p className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground"><Eye className="h-3.5 w-3.5" /> How it works: a VA with assigned clients/tasks but <b>no logs today and no logs this week</b> is flagged red. Under 8h this week (or overdue work) is low. No assignments = available for new work. Project Managers see this board read-only; only Administrators can assign a project manager, approve logs, or change tasks.</p>
    </div>
  )
}
