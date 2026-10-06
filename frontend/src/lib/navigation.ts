import type { LucideIcon } from "lucide-react"
import {
  LayoutDashboard,
  FileText,
  DollarSign,
  BarChart3,
  Receipt,
  Settings,
  Clock,
  User,
  Building2,
  Users,
  Calendar,
} from "lucide-react"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  keywords?: string[]
}

export const ADMIN_NAV: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, keywords: ["home", "overview", "stats"] },
  { to: "/admin/logs", label: "All Logs", icon: FileText, keywords: ["work logs", "entries", "approve"] },
  { to: "/admin/payroll", label: "VA Payroll", icon: DollarSign, keywords: ["pay", "salary", "php", "usd"] },
  { to: "/admin/reports", label: "Reports", icon: BarChart3, keywords: ["client report", "hours"] },
  { to: "/admin/invoices", label: "Invoices", icon: Receipt, keywords: ["billing", "invoice", "payment"] },
  { to: "/admin/clients", label: "Clients", icon: Building2, keywords: ["sub-clients", "client list", "archive"] },
  { to: "/admin/users", label: "Users", icon: Users, keywords: ["va", "roster", "team", "archive"] },
  { to: "/admin/booking", label: "Booking", icon: Calendar, keywords: ["schedule", "calendly", "appointment"] },
  { to: "/admin/settings", label: "Settings", icon: Settings, keywords: ["company", "payment", "pricing", "hide"] },
  { to: "/admin/profile", label: "Profile", icon: User, keywords: ["account", "theme", "password", "appearance"] },
]

export const VA_NAV: NavItem[] = [
  { to: "/va/time-log", label: "Log Time", icon: Clock, keywords: ["submit", "hours", "work"] },
  { to: "/va/booking", label: "Booking", icon: Calendar, keywords: ["schedule", "appointment"] },
  { to: "/va/profile", label: "Profile", icon: User, keywords: ["account", "theme", "password"] },
]

export function getNavForRole(role: "admin" | "va"): NavItem[] {
  return role === "admin" ? ADMIN_NAV : VA_NAV
}
