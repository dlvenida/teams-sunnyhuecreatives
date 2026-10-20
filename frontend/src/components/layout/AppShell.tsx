import { useState } from "react"
import { Outlet } from "react-router-dom"
import { getAuthUser } from "@/lib/api"
import { getNavForRole } from "@/lib/navigation"
import { Sidebar } from "@/components/layout/Sidebar"
import { TopBar } from "@/components/layout/TopBar"

export function AppShell() {
  const user = getAuthUser()
  const navItems = getNavForRole(user?.role ?? "va")
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="relative flex min-h-screen bg-background">
      <div className="app-orb app-orb-1" /><div className="app-orb app-orb-2" />
      <Sidebar items={navItems} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1600px] flex-1 overflow-auto p-4 sm:p-5">
          <Outlet />
        </main>
        <footer className="px-5 pb-4 text-center text-[10px] text-muted-foreground">Teams.SHC · Sunny Hue Creatives</footer>
      </div>
    </div>
  )
}
