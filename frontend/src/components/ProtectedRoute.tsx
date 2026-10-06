import { Navigate, Outlet } from "react-router-dom"
import { getAuthUser } from "@/lib/api"

export function ProtectedRoute({ role }: { role?: "admin" | "va" }) {
  const user = getAuthUser()
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) {
    return <Navigate to={user.role === "admin" ? "/admin/dashboard" : "/va/time-log"} replace />
  }
  return <Outlet />
}
