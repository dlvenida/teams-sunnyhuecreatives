import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bell, BellRing, CheckCheck, Clock3, FileText, Handshake, ListTodo, MessageSquareText, Sparkles, Trash2, X } from "lucide-react"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { NotificationItem, NotificationList } from "@/lib/types"
import { resolveNotificationLink } from "@/lib/notificationLink"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const TYPE_META: Record<string, { icon: typeof Bell; bg: string; label: string }> = {
  comment: { icon: MessageSquareText, bg: "bg-pink-100 text-pink-600", label: "Comments" },
  task: { icon: ListTodo, bg: "bg-violet-100 text-violet-600", label: "Tasks" },
  log: { icon: FileText, bg: "bg-amber-100 text-amber-700", label: "Time Logs" },
  clock: { icon: Clock3, bg: "bg-green-100 text-green-700", label: "Time Clock" },
  delegation: { icon: Handshake, bg: "bg-purple-100 text-purple-600", label: "Delegation" },
  invoice: { icon: FileText, bg: "bg-sky-100 text-sky-700", label: "Invoices" },
  system: { icon: Sparkles, bg: "bg-slate-100 text-slate-600", label: "System" },
}
const FILTERS = [
  { id: "all", label: "All" }, { id: "unread", label: "Unread" }, { id: "comment", label: "Comments" },
  { id: "task", label: "Tasks" }, { id: "log", label: "Logs" }, { id: "clock", label: "Clock" },
] as const

export function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return "just now"
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function NotificationsPanel() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = getAuthUser()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<string>("all")
  const ref = useRef<HTMLDivElement>(null)

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<NotificationList>("/notifications"),
    enabled: !!user,
    refetchInterval: 30_000,
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] })
  const markAll = useMutation({ mutationFn: () => apiFetch("/notifications/read-all", { method: "POST" }), onSuccess: invalidate })
  const markOne = useMutation({ mutationFn: (id: string) => apiFetch(`/notifications/${id}/read`, { method: "POST" }), onSuccess: invalidate })
  const removeOne = useMutation({ mutationFn: (id: string) => apiFetch(`/notifications/${id}`, { method: "DELETE" }), onSuccess: invalidate })
  const emptyAll = useMutation({ mutationFn: () => apiFetch("/notifications", { method: "DELETE" }), onSuccess: invalidate })

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  if (!user) {
    return (
      <Button variant="ghost" size="sm" className="relative h-8 w-8 p-0" aria-label="Notifications" disabled>
        <Bell className="h-4 w-4 opacity-50" />
      </Button>
    )
  }

  const unread = data?.unread ?? 0
  const items = (data?.items ?? []).filter(n =>
    filter === "all" ? true : filter === "unread" ? !n.is_read : n.type === filter)

  const openItem = (n: NotificationItem) => {
    if (!n.is_read) markOne.mutate(n.id)
    setOpen(false)
    const path = resolveNotificationLink(n.link)
    if (path) navigate(path)
  }

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="sm" className="relative h-8 w-8 p-0" onClick={() => setOpen(!open)} aria-label="Notifications">
        {unread > 0 ? <BellRing className="h-4 w-4 text-primary" /> : <Bell className="h-4 w-4" />}
        {unread > 0 && (
          <span className="live-dot absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
            <p className="text-xs font-bold text-foreground">Notifications {unread > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">{unread} new</span>}</p>
            <div className="flex items-center gap-1">
              <button onClick={() => markAll.mutate()} disabled={unread === 0} className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold text-primary transition hover:bg-primary/10 disabled:opacity-40" title="Mark all as read">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
              <button
                onClick={() => { if (confirm("Delete ALL notifications? This empties your notification history.")) emptyAll.mutate() }}
                disabled={(data?.total ?? 0) === 0}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-40" title="Delete all notifications"
              >
                <Trash2 className="h-3.5 w-3.5" /> Empty
              </button>
            </div>
          </div>

          <div className="flex gap-1 overflow-x-auto border-b border-border px-2.5 py-2">
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)} className={cn("whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition", filter === f.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/60")}>{f.label}</button>
            ))}
          </div>

          <div className="max-h-[380px] overflow-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="mx-auto h-6 w-6 text-muted-foreground/50" />
                <p className="mt-2 text-xs font-semibold">{filter === "unread" ? "You're all caught up 🎉" : "No notifications here"}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">New comments, task updates, approvals and clock activity will show up here.</p>
              </div>
            ) : (
              items.map(n => {
                const meta = TYPE_META[n.type] ?? TYPE_META.system
                const Icon = meta.icon
                return (
                  <div key={n.id} className={cn("group relative flex w-full gap-2.5 border-b border-border px-3.5 py-2.5 text-left last:border-0 transition hover:bg-primary/[0.04]", !n.is_read && "bg-primary/[0.05]")}>
                    <button type="button" onClick={() => openItem(n)} className="flex min-w-0 flex-1 gap-2.5 text-left">
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", meta.bg)}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0">
                        <span className={cn("block truncate text-xs", n.is_read ? "font-medium" : "font-bold")}>{n.title}</span>
                        {n.body && <span className="block truncate text-[11px] text-muted-foreground">{n.body}</span>}
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">{meta.label} · {timeAgo(n.created_at)}</span>
                      </span>
                    </button>
                    {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    <button onClick={() => removeOne.mutate(n.id)} className="absolute right-2 top-2 hidden rounded-full p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 group-hover:block" title="Delete notification"><X className="h-3 w-3" /></button>
                  </div>
                )
              })
            )}
          </div>

          <button
            type="button"
            onClick={() => { setOpen(false); navigate("/notifications") }}
            className="block w-full border-t border-border bg-muted/40 px-3.5 py-2 text-center text-[11px] font-bold text-primary transition hover:bg-primary/10"
          >
            View all &amp; manage notifications →
          </button>
          <p className="border-t border-border bg-muted/40 px-3.5 py-1.5 text-center text-[10px] text-muted-foreground">
            History keeps the last 3 months · {(data?.total ?? 0)} notification(s)
          </p>
        </div>
      )}
    </div>
  )
}
