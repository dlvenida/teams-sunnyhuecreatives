import { Navigate, Outlet } from "react-router-dom"
import { getAuthUser } from "@/lib/api"

const HOME: Record<string, string> = { admin: "/admin/dashboard", auditor: "/admin/analytics", va: "/va/dashboard" }

export function ProtectedRoute({ role }: { role?: string | string[] }) {
  const user = getAuthUser()
  if (!user) return <Navigate to="/login" replace />
  const allowed = role ? (Array.isArray(role) ? role : [role]) : []
  if (allowed.length && !allowed.includes(user.role)) {
    return <Navigate to={HOME[user.role] ?? "/login"} replace />
  }
  return <Outlet />
}
