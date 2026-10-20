import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Bell, BellOff, CheckCheck, Eraser, ExternalLink, MailOpen, Mail, Search, Trash2,
} from "lucide-react"
import { apiFetch } from "@/lib/api"
import type { NotificationItem, NotificationList } from "@/lib/types"
import { TYPE_META, timeAgo } from "@/components/layout/NotificationsPanel"
import { Card, CardContent } from "@/components/ui/card"
import { StatCard } from "@/components/magicui/stat-card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const TYPE_FILTERS = [
  { id: "all", label: "All" },
  { id: "comment", label: "Comments" },
  { id: "task", label: "Tasks" },
  { id: "log", label: "Time Logs" },
  { id: "clock", label: "Time Clock" },
  { id: "invoice", label: "Invoices" },
  { id: "delegation", label: "Delegation" },
  { id: "system", label: "System" },
] as const

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
}

function fullDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  })
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [type, setType] = useState<string>("all")
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notifications"] })
    qc.invalidateQueries({ queryKey: ["notifications-page"] })
  }

  // Unfiltered pull (for stat cards + per-type counts)
  const { data: all } = useQuery({
    queryKey: ["notifications-page", "all"],
    queryFn: () => apiFetch<NotificationList>("/notifications?limit=200"),
    refetchInterval: 30_000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ["notifications-page", q, type, unreadOnly],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "200" })
      if (q) params.set("q", q)
      if (type !== "all") params.set("type", type)
      if (unreadOnly) params.set("unread_only", "true")
      return apiFetch<NotificationList>(`/notifications?${params.toString()}`)
    },
    refetchInterval: 30_000,
  })

  const markAll = useMutation({ mutationFn: () => apiFetch("/notifications/read-all", { method: "POST" }), onSuccess: invalidate })
  const clearRead = useMutation({ mutationFn: () => apiFetch("/notifications/clear-read", { method: "DELETE" }), onSuccess: invalidate })
  const emptyAll = useMutation({ mutationFn: () => apiFetch("/notifications", { method: "DELETE" }), onSuccess: () => { setSelected(new Set()); invalidate() } })
  const markOne = useMutation({
    mutationFn: (n: NotificationItem) => apiFetch(`/notifications/${n.id}/${n.is_read ? "unread" : "read"}`, { method: "POST" }),
    onSuccess: invalidate,
  })
  const removeOne = useMutation({ mutationFn: (id: string) => apiFetch(`/notifications/${id}`, { method: "DELETE" }), onSuccess: invalidate })
  const bulkRead = useMutation({
    mutationFn: (ids: string[]) => apiFetch("/notifications/bulk-read", { method: "POST", body: JSON.stringify({ ids }) }),
    onSuccess: () => { setSelected(new Set()); invalidate() },
  })
  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => apiFetch("/notifications/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }),
    onSuccess: () => { setSelected(new Set()); invalidate() },
  })

  const items = data?.items ?? []
  const allItems = all?.items ?? []
  const unread = all?.unread ?? 0
  const todayCount = allItems.filter(n => dayLabel(n.created_at) === "Today").length
  const weekCutoff = Date.now() - 7 * 86_400_000
  const weekCount = allItems.filter(n => new Date(n.created_at).getTime() >= weekCutoff).length
  const countFor = (t: string) => (t === "all" ? allItems.length : allItems.filter(n => n.type === t).length)

  const groups = useMemo(() => {
    const map = new Map<string, NotificationItem[]>()
    for (const n of items) {
      const key = dayLabel(n.created_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(n)
    }
    return [...map.entries()]
  }, [items])

  const allVisibleSelected = items.length > 0 && items.every(n => selected.has(n.id))
  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleSelectAll = () => setSelected(allVisibleSelected ? new Set() : new Set(items.map(n => n.id)))

  const openItem = (n: NotificationItem) => {
    if (!n.is_read) markOne.mutate(n)
    if (n.link) navigate(n.link)
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <h1 className="font-display text-xl font-bold">Notifications</h1>
          <p className="text-xs text-muted-foreground">
            Manage everything in one place — comments, task updates, approvals and clock activity. History keeps the last 3 months.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => markAll.mutate()} disabled={unread === 0 || markAll.isPending}>
            <CheckCheck className="mr-1.5 h-4 w-4" /> Mark all read
          </Button>
          <Button
            size="sm" variant="outline"
            onClick={() => { if (confirm("Delete all notifications you've already read?")) clearRead.mutate() }}
            disabled={allItems.every(n => !n.is_read) || clearRead.isPending}
          >
            <Eraser className="mr-1.5 h-4 w-4" /> Clear read
          </Button>
          <Button
            size="sm" variant="outline"
            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={() => { if (confirm("Delete ALL notifications? This empties your notification history.")) emptyAll.mutate() }}
            disabled={allItems.length === 0 || emptyAll.isPending}
          >
            <Trash2 className="mr-1.5 h-4 w-4" /> Empty all
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Unread" value={unread} subtitle={unread === 0 ? "You're all caught up 🎉" : "Needs your attention"} className={unread > 0 ? "border-primary/40" : undefined} />
        <StatCard title="Today" value={todayCount} subtitle="Notifications received today" />
        <StatCard title="This Week" value={weekCount} subtitle="Last 7 days" />
        <StatCard title="Total (3 months)" value={all?.total ?? allItems.length} subtitle="Auto-deleted after 90 days" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search notifications…"
                className="h-9 w-full rounded-full border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <button
              onClick={() => setUnreadOnly(v => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition",
                unreadOnly ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/60",
              )}
            >
              {unreadOnly ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
              Unread only{unread > 0 && ` (${unread})`}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {TYPE_FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setType(f.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  type === f.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/60",
                )}
              >
                {f.label} <span className={cn("ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold", type === f.id ? "bg-white/20" : "bg-muted")}>{countFor(f.id)}</span>
              </button>
            ))}
          </div>

          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} className="h-4 w-4 accent-primary" />
                Select all shown
              </label>
              {selected.size > 0 && (
                <>
                  <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => bulkRead.mutate([...selected])} disabled={bulkRead.isPending}>
                    <MailOpen className="mr-1 h-3.5 w-3.5" /> Mark read
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="h-7 border-red-200 text-xs text-red-600 hover:bg-red-50"
                    onClick={() => { if (confirm(`Delete ${selected.size} selected notification(s)?`)) bulkDelete.mutate([...selected]) }}
                    disabled={bulkDelete.isPending}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete selected
                  </Button>
                </>
              )}
            </div>
          )}

          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading notifications…</p>
          ) : items.length === 0 ? (
            <div className="py-12 text-center">
              <Bell className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-semibold">{unreadOnly ? "You're all caught up 🎉" : "No notifications found"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {q || type !== "all" ? "Try a different search or filter." : "New comments, task assignments, updates, approvals and clock activity will show up here."}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map(([label, group]) => (
                <div key={label}>
                  <div className="mb-2 flex items-center gap-2">
                    <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</h2>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold">{group.length}</span>
                    {group.some(n => !n.is_read) && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                        {group.filter(n => !n.is_read).length} unread
                      </span>
                    )}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border">
                    {group.map(n => {
                      const meta = TYPE_META[n.type] ?? TYPE_META.system
                      const Icon = meta.icon
                      return (
                        <div
                          key={n.id}
                          className={cn(
                            "group flex items-start gap-3 border-b border-border px-3.5 py-3 transition last:border-0 hover:bg-primary/[0.04]",
                            !n.is_read && "bg-primary/[0.05]",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(n.id)}
                            onChange={() => toggleSelect(n.id)}
                            className="mt-2 h-4 w-4 shrink-0 accent-primary"
                            aria-label="Select notification"
                          />
                          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", meta.bg)}>
                            <Icon className="h-4.5 w-4.5" />
                          </span>
                          <button type="button" onClick={() => openItem(n)} className="min-w-0 flex-1 text-left">
                            <span className={cn("block text-sm", n.is_read ? "font-medium" : "font-bold")}>
                              {n.title}
                              {!n.is_read && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-primary align-middle" />}
                            </span>
                            {n.body && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{n.body}</span>}
                            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span className={cn("rounded-full px-2 py-0.5 font-bold", meta.bg)}>{meta.label}</span>
                              <span>{fullDateTime(n.created_at)}</span>
                              <span>·</span>
                              <span>{timeAgo(n.created_at)}</span>
                            </span>
                          </button>
                          <div className="flex shrink-0 items-center gap-1">
                            {n.link && (
                              <button
                                onClick={() => openItem(n)}
                                className="rounded-full p-1.5 text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                                title="Open"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => markOne.mutate(n)}
                              className="rounded-full p-1.5 text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                              title={n.is_read ? "Mark as unread" : "Mark as read"}
                            >
                              {n.is_read ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => removeOne.mutate(n.id)}
                              className="rounded-full p-1.5 text-muted-foreground transition hover:bg-red-50 hover:text-red-600"
                              title="Delete notification"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-center text-[11px] text-muted-foreground">
            Showing {items.length} notification(s) · history is automatically kept for the last 3 months only
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
