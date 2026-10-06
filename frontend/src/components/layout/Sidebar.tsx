import { NavLink } from "react-router-dom"
import { getAuthUser, logout } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { NavItem } from "@/lib/navigation"
import { Button } from "@/components/ui/button"
import { LogOut } from "lucide-react"

interface SidebarProps {
  items: NavItem[]
}

function getInitials(name?: string) {
  if (!name) return "?"
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export function Sidebar({ items }: SidebarProps) {
  const user = getAuthUser()
  const profilePath = user?.role === "admin" ? "/admin/profile" : "/va/profile"

  return (
    <aside className="sticky top-0 flex h-screen w-52 shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-bold tracking-tight text-primary">Teams.SHC</p>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )
            }
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <NavLink
          to={profilePath}
          className={({ isActive }) =>
            cn(
              "mb-2 flex items-center gap-2.5 rounded-lg p-1 transition-colors",
              isActive ? "bg-muted" : "hover:bg-muted/60",
            )
          }
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {getInitials(user?.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-foreground">{user?.name || "User"}</p>
            <p className="truncate text-[10px] capitalize text-muted-foreground">{user?.role || "member"}</p>
          </div>
        </NavLink>
        <Button variant="outline" size="sm" className="h-7 w-full text-xs" onClick={logout}>
          <LogOut className="h-3 w-3" /> Logout
        </Button>
      </div>
    </aside>
  )
}
