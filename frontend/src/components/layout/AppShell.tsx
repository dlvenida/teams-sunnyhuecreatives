import { Outlet } from "react-router-dom"
import { getAuthUser } from "@/lib/api"
import { getNavForRole } from "@/lib/navigation"
import { Sidebar } from "@/components/layout/Sidebar"
import { TopBar } from "@/components/layout/TopBar"

export function AppShell() {
  const user = getAuthUser()
  const navItems = getNavForRole(user?.role === "admin" ? "admin" : "va")

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar items={navItems} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
