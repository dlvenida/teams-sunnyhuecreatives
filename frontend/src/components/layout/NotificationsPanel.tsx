import { useState, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Bell } from "lucide-react"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { DashboardSummary, WorkLog } from "@/lib/types"
import { Button } from "@/components/ui/button"

export function NotificationsPanel() {
  const navigate = useNavigate()
  const user = getAuthUser()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isAdmin = user?.role === "admin"

  const { data: dashboard } = useQuery({
    queryKey: ["notifications-dashboard"],
    queryFn: () => apiFetch<DashboardSummary>("/dashboard/summary"),
    enabled: !!user && isAdmin,
    refetchInterval: 60_000,
  })

  const { data: vaLogs = [] } = useQuery({
    queryKey: ["notifications-va-logs"],
    queryFn: () => apiFetch<WorkLog[]>("/va/work-logs"),
    enabled: !!user && !isAdmin,
    refetchInterval: 60_000,
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
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

  const adminItems =
    dashboard?.pending_logs.map((log) => ({
      id: log.id,
      title: `Pending: ${log.va_name}`,
      body: `${log.client_name} · ${log.hours} hrs`,
      path: "/admin/logs",
    })) ?? []

  const vaItems = vaLogs
    .filter((l) => l.status === "submitted" || l.status === "approved" || l.status === "rejected")
    .slice(0, 8)
    .map((log) => ({
      id: log.id,
      title: log.status === "submitted" ? "Awaiting review" : `Entry ${log.status}`,
      body: `${log.client_name} · ${log.work_date}`,
      path: "/va/time-log",
    }))

  const items = isAdmin ? adminItems : vaItems
  const count = items.length

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="relative h-8 w-8 p-0"
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-card shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-semibold text-foreground">Notifications</p>
          </div>
          <div className="max-h-72 overflow-auto">
            {items.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">No new notifications</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    navigate(item.path)
                    setOpen(false)
                  }}
                  className="flex w-full flex-col border-b border-border px-3 py-2 text-left last:border-0 hover:bg-muted"
                >
                  <span className="text-xs font-medium text-foreground">{item.title}</span>
                  <span className="text-[10px] text-muted-foreground">{item.body}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
