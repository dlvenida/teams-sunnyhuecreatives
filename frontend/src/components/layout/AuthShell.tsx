import { Outlet } from "react-router-dom"
import { LoginBackground } from "@/components/layout/LoginBackground"

/** Login shell — no header, animated background only. */
export function AuthShell() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <LoginBackground />
      <div className="relative z-10 w-full max-w-sm">
        <Outlet />
        <p className="mt-4 text-center text-[10px] text-muted-foreground">Teams - Sunny Hue Creative - Developed by DLV IT Solutions</p>
      </div>
    </div>
  )
}
