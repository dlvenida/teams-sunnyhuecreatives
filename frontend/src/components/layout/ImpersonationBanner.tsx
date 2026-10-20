import { useQueryClient } from "@tanstack/react-query"
import { Eye, LogOut } from "lucide-react"
import { exitImpersonation, getAuthUser, getImpersonationBackup } from "@/lib/api"
import { Button } from "@/components/ui/button"

export function ImpersonationBanner() {
  const qc = useQueryClient()
  const user = getAuthUser()
  const backup = getImpersonationBackup()
  if (!user?.isImpersonating && !backup) return null
  const adminName = user?.impersonatedByName || backup?.user?.name || "Administrator"
  const exit = () => {
    const restored = exitImpersonation()
    qc.clear()
    window.location.href = restored ? "/admin/users" : "/login"
  }
  return (
    <div className="sticky top-14 z-20 flex flex-wrap items-center justify-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <Eye className="h-4 w-4 shrink-0" />
      <span>
        Viewing as <strong>{user?.name || backup?.targetName || "user"}</strong>
        <span className="capitalize"> ({user?.role})</span> — you are seeing exactly what they see. Signed in as admin: {adminName}.
      </span>
      <Button size="sm" variant="gold" className="h-7" onClick={exit}>
        <LogOut className="h-3.5 w-3.5" /> Exit view &amp; back to Admin
      </Button>
    </div>
  )
}
