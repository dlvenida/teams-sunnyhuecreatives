import { useState } from "react"
import { Outlet } from "react-router-dom"
import { getAuthUser } from "@/lib/api"
import { getNavForRole } from "@/lib/navigation"
import { Sidebar } from "@/components/layout/Sidebar"
import { TopBar } from "@/components/layout/TopBar"
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner"

export function AppShell() {
  const user = getAuthUser()
  const navItems = getNavForRole(user?.role ?? "va")
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="relative flex min-h-screen w-full min-w-0 overflow-x-clip bg-background">
      <div className="app-orb app-orb-1" /><div className="app-orb app-orb-2" />
      <Sidebar items={navItems} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <ImpersonationBanner />
        <main className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 overflow-x-clip p-3 sm:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
