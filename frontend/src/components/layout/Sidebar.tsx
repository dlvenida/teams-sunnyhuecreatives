import { useEffect, useState } from "react"
import { NavLink } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { apiFetch, apiFetchBlob, getAuthUser, logout, setAuthUser } from "@/lib/api"
import type { UserProfile } from "@/lib/profile"
import { cn, roleLabel } from "@/lib/utils"
import type { NavItem } from "@/lib/navigation"
import { Button } from "@/components/ui/button"
import { ChevronsUpDown, LogOut, Sparkles, X } from "lucide-react"

function getInitials(name?: string) {
  if (!name) return "?"
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
}

export function Sidebar({ items, mobileOpen = false, onClose }: { items: NavItem[]; mobileOpen?: boolean; onClose?: () => void }) {
  const user = getAuthUser()
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/profile/me"), staleTime: 60_000 })
  const profilePath = user?.role === "va" ? "/va/profile" : "/admin/profile"

  useEffect(() => {
    // Always show icon + text labels — never collapse to icon-only.
    localStorage.removeItem("sidebar-collapsed")
  }, [])

  useEffect(() => {
    if (profile && user && profile.display_name && profile.display_name !== user.name) {
      setAuthUser({ ...user, name: profile.display_name })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.display_name])

  useEffect(() => {
    let revoke: string | null = null
    if (profile?.has_profile_photo) {
      apiFetchBlob("/profile/photo").then((blob) => { if (blob) { revoke = URL.createObjectURL(blob); setPhotoUrl(revoke) } })
    } else setPhotoUrl(null)
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [profile?.has_profile_photo])

  const displayName = profile?.display_name || user?.name || "User"
  const subLine = profile?.job_title || profile?.email || (user?.role === "admin" ? "Admin" : "Virtual Assistant")

  const sections: [string, NavItem[]][] = []
  for (const item of items) {
    const name = item.section || "Main"
    const found = sections.find(([s]) => s === name)
    if (found) found[1].push(item); else sections.push([name, [item]])
  }

  const content = (
    <div className="flex h-full w-60 flex-col bg-card">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg" style={{ boxShadow: "0 8px 20px -6px var(--primary)" }}>
          <Sparkles className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="gradient-text truncate text-[15px] font-extrabold tracking-tight">Teams.SHC</p>
          <p className="text-[10px] capitalize text-muted-foreground">{user?.role === "admin" ? "Admin workspace" : user?.role === "auditor" ? "Project Manager workspace" : "VA workspace"}</p>
        </div>
        {mobileOpen && <button className="lg:hidden" onClick={onClose} aria-label="Close menu"><X className="h-5 w-5" /></button>}
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 pb-3">
        {sections.map(([section, navItems]) => (
          <div key={section}>
            <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/80">{section}</p>
            <div className="space-y-0.5">
              {navItems.map(({ to, label, icon: Icon, color }) => (
                <NavLink key={to} to={to} onClick={onClose}
                  className={({ isActive }) => cn(
                    "group flex items-center gap-2.5 rounded-2xl px-2.5 py-2 text-[13px] font-medium transition-all",
                    isActive ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:bg-muted hover:text-foreground hover:translate-x-0.5",
                  )}
                >
                  {({ isActive }) => (<>
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-110"
                      style={isActive ? { background: "rgb(255 255 255 / .22)" } : { background: `${color || "#ec4899"}22`, color: color || "var(--primary)" }}
                    >
                      <Icon className="h-4 w-4 stroke-[1.75]" />
                    </span>
                    <span className="truncate">{label}</span>
                  </>)}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <NavLink to={profilePath} onClick={onClose} title="View profile" className={({ isActive }) => cn("group mb-2 flex items-center gap-2.5 rounded-2xl border p-2 transition-all", isActive ? "border-primary/40 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/60")}>
          <span className="relative shrink-0">
            {photoUrl ? <img src={photoUrl} alt={displayName} className="h-10 w-10 rounded-full object-cover ring-2 ring-primary/30" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-primary-foreground ring-2 ring-primary/30">{getInitials(displayName)}</span>}
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-green-500" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold leading-tight">{displayName}</span>
            <span className="block truncate text-[10px] leading-tight text-muted-foreground">{subLine}</span>
            <span className="mt-1 inline-flex items-center gap-1">
              <span className="rounded-full bg-primary px-1.5 py-px text-[9px] font-bold tracking-wide text-primary-foreground">{roleLabel(profile?.role || user?.role)}</span>
              {profile?.status_message && <span className="max-w-[90px] truncate text-[9px] text-muted-foreground">{profile.status_message}</span>}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:scale-110" />
        </NavLink>
        <Button variant="outline" size="sm" className="h-8 w-full rounded-xl text-xs" onClick={logout}>
          <LogOut className="h-3.5 w-3.5" /> Logout
        </Button>
      </div>
    </div>
  )

  return (
    <>
      <aside className="sticky top-0 z-30 hidden h-screen w-60 shrink-0 border-r border-border/70 shadow-sm lg:block">{content}</aside>
      {mobileOpen && <div className="fixed inset-0 z-50 flex lg:hidden"><div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} /><div className="relative shadow-2xl">{content}</div></div>}
    </>
  )
}
