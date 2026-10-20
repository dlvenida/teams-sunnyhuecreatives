import { useState, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Search } from "lucide-react"
import { apiFetch, getAuthUser } from "@/lib/api"
import { getNavForRole } from "@/lib/navigation"
import type { Client, Project, TaskItem, WorkLog } from "@/lib/types"
import { cn } from "@/lib/utils"

interface SearchResult {
  id: string
  label: string
  sublabel?: string
  path: string
  type: "page" | "client" | "log" | "task" | "project"
}

export function GlobalSearch({ className }: { className?: string }) {
  const navigate = useNavigate()
  const user = getAuthUser()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isAdmin = user?.role === "admin"

  const { data: clients = [] } = useQuery({
    queryKey: ["search-clients"],
    queryFn: () => apiFetch<Client[]>("/clients"),
    enabled: !!isAdmin && query.length >= 2,
  })

  const { data: logs = [] } = useQuery({
    queryKey: ["search-logs", query],
    queryFn: () => apiFetch<WorkLog[]>(`/work-logs?status=submitted`),
    enabled: !!isAdmin && query.length >= 2,
  })

  const { data: vaLogs = [] } = useQuery({
    queryKey: ["search-va-logs"],
    queryFn: () => apiFetch<WorkLog[]>("/va/work-logs"),
    enabled: !!user && !isAdmin && query.length >= 2,
  })

  const { data: foundTasks = [] } = useQuery({
    queryKey: ["search-tasks", query],
    queryFn: () => apiFetch<TaskItem[]>(`/tasks?search=${encodeURIComponent(query)}`),
    enabled: !!user && query.length >= 2,
  })
  const { data: foundProjects = [] } = useQuery({
    queryKey: ["search-projects"],
    queryFn: () => apiFetch<Project[]>("/projects?include_archived=false"),
    enabled: !!user && query.length >= 2,
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const q = query.toLowerCase().trim()
  const results: SearchResult[] = []

  if (q && user) {
    for (const item of getNavForRole(user.role)) {
      if (
        item.label.toLowerCase().includes(q) ||
        item.keywords?.some((k) => k.includes(q))
      ) {
        results.push({ id: item.to, label: item.label, sublabel: "Page", path: item.to, type: "page" })
      }
    }

    foundTasks.slice(0, 5).forEach((t) =>
      results.push({ id: t.id, label: t.title, sublabel: `Task · ${t.client_name || ""} · ${t.status.replace("_", " ")}`, path: `${isAdmin ? "/admin" : "/va"}/tasks`, type: "task" }),
    )
    foundProjects
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 4)
      .forEach((p) => results.push({ id: p.id, label: p.name, sublabel: `Project · ${p.client_name || ""}`, path: `${isAdmin ? "/admin" : "/va"}/tasks?project=${p.id}`, type: "project" }))

    if (isAdmin) {
      clients
        .filter((c) => c.name.toLowerCase().includes(q))
        .slice(0, 5)
        .forEach((c) =>
          results.push({
            id: c.id,
            label: c.name,
            sublabel: "Client",
            path: "/admin/clients",
            type: "client",
          }),
        )

      logs
        .filter(
          (l) =>
            l.description_plain?.toLowerCase().includes(q) ||
            l.va_name?.toLowerCase().includes(q) ||
            l.client_name?.toLowerCase().includes(q),
        )
        .slice(0, 5)
        .forEach((l) =>
          results.push({
            id: l.id,
            label: l.description_plain?.slice(0, 60) || "Work log",
            sublabel: `${l.va_name} · ${l.client_name}`,
            path: "/admin/logs",
            type: "log",
          }),
        )
    } else {
      vaLogs
        .filter(
          (l) =>
            l.description_plain?.toLowerCase().includes(q) ||
            l.client_name?.toLowerCase().includes(q),
        )
        .slice(0, 5)
        .forEach((l) =>
          results.push({
            id: l.id,
            label: l.description_plain?.slice(0, 60) || "My entry",
            sublabel: `${l.client_name} · ${l.status}`,
            path: "/va/time-log",
            type: "log",
          }),
        )
    }
  }

  const pick = (path: string) => {
    navigate(path)
    setQuery("")
    setOpen(false)
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          placeholder={user ? "Search tasks, projects, clients, logs..." : "Sign in to search..."}
          value={query}
          disabled={!user}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          className="h-8 w-full rounded-lg border border-border bg-input-bg pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
      </div>
      {open && q && user && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-card py-1 shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No results for "{query}"</p>
          ) : (
            results.map((r) => (
              <button
                key={`${r.type}-${r.id}`}
                type="button"
                onClick={() => pick(r.path)}
                className="flex w-full flex-col px-3 py-2 text-left hover:bg-muted"
              >
                <span className="text-xs font-medium text-foreground">{r.label}</span>
                {r.sublabel && <span className="text-[10px] text-muted-foreground">{r.sublabel}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
