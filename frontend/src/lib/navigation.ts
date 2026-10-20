import type { LucideIcon } from "lucide-react"
import {
  LayoutDashboard,
  FileText,
  DollarSign,
  BarChart3,
  LineChart,
  Receipt,
  Settings,
  Clock,
  User,
  Building2,
  Users,
  Calendar,
  KanbanSquare,
  FolderKanban,
  Timer,
  Bell,
} from "lucide-react"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  keywords?: string[]
  section?: string
  color?: string
}

export const ADMIN_NAV: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, keywords: ["home", "overview", "stats"], section: "Workspace", color: "#ec4899" },
  { to: "/admin/tasks", label: "Task Board", icon: KanbanSquare, keywords: ["kanban", "monday", "tasks", "board", "task board"], section: "Workspace", color: "#8b5cf6" },
  { to: "/admin/projects", label: "Projects", icon: FolderKanban, keywords: ["project", "client project"], section: "Workspace", color: "#06b6d4" },
  { to: "/admin/time-clock", label: "Time Clock", icon: Timer, keywords: ["clock", "live", "team time"], section: "Workspace", color: "#22c55e" },
  { to: "/admin/logs", label: "All Logs", icon: FileText, keywords: ["work logs", "entries", "approve"], section: "Operations", color: "#f59e0b" },
  { to: "/admin/payroll", label: "VA Payroll", icon: DollarSign, keywords: ["pay", "salary", "php", "usd"], section: "Operations", color: "#10b981" },
  { to: "/admin/reports", label: "Reports", icon: BarChart3, keywords: ["client report", "hours"], section: "Operations", color: "#3b82f6" },
  { to: "/admin/analytics", label: "Analytics", icon: LineChart, keywords: ["auditor", "activity", "monitor", "low activity", "team analytics"], section: "Operations", color: "#0ea5e9" },
  { to: "/admin/invoices", label: "Invoices", icon: Receipt, keywords: ["billing", "invoice", "payment"], section: "Operations", color: "#f97316" },
  { to: "/admin/clients", label: "Clients", icon: Building2, keywords: ["sub-clients", "client list", "archive"], section: "Manage", color: "#a855f7" },
  { to: "/admin/users", label: "Users", icon: Users, keywords: ["va", "roster", "team", "archive"], section: "Manage", color: "#ec4899" },
  { to: "/admin/booking", label: "Booking", icon: Calendar, keywords: ["schedule", "calendly", "appointment"], section: "Manage", color: "#06b6d4" },
  { to: "/admin/settings", label: "Settings", icon: Settings, keywords: ["company", "payment", "pricing", "hide"], section: "System", color: "#64748b" },
  { to: "/notifications", label: "Notifications", icon: Bell, keywords: ["alerts", "comments", "updates", "unread"], section: "System", color: "#f43f5e" },
  { to: "/admin/profile", label: "Profile", icon: User, keywords: ["account", "theme", "password", "appearance"], section: "System", color: "#64748b" },
]

export const VA_NAV: NavItem[] = [
  { to: "/va/dashboard", label: "Dashboard", icon: LayoutDashboard, keywords: ["home", "today", "overview", "morning"], section: "Workspace", color: "#ec4899" },
  { to: "/va/tasks", label: "Task Board", icon: KanbanSquare, keywords: ["kanban", "tasks", "my tasks", "board", "task board"], section: "Workspace", color: "#8b5cf6" },
  { to: "/va/projects", label: "Projects", icon: FolderKanban, keywords: ["project", "client project"], section: "Workspace", color: "#06b6d4" },
  { to: "/va/time-clock", label: "Time Clock", icon: Timer, keywords: ["clock in", "clock out", "timer"], section: "Workspace", color: "#22c55e" },
  { to: "/va/time-log", label: "Log Time", icon: Clock, keywords: ["submit", "hours", "work"], section: "Workspace", color: "#f59e0b" },
  { to: "/va/booking", label: "Booking", icon: Calendar, keywords: ["schedule", "appointment"], section: "Manage", color: "#06b6d4" },
  { to: "/notifications", label: "Notifications", icon: Bell, keywords: ["alerts", "comments", "updates", "unread"], section: "System", color: "#f43f5e" },
  { to: "/va/profile", label: "Profile", icon: User, keywords: ["account", "theme", "password"], section: "System", color: "#64748b" },
]

export const AUDITOR_NAV: NavItem[] = [
  { to: "/admin/analytics", label: "Analytics", icon: LineChart, keywords: ["auditor", "activity", "monitor", "low activity"], section: "Workspace", color: "#0ea5e9" },
  { to: "/admin/logs", label: "All Logs", icon: FileText, keywords: ["work logs", "entries", "review"], section: "Operations", color: "#f59e0b" },
  { to: "/admin/clients", label: "Clients", icon: Building2, keywords: ["client list", "view client"], section: "Manage", color: "#a855f7" },
  { to: "/notifications", label: "Notifications", icon: Bell, keywords: ["alerts", "comments", "updates", "unread"], section: "System", color: "#f43f5e" },
  { to: "/admin/profile", label: "Profile", icon: User, keywords: ["account", "theme", "password"], section: "System", color: "#64748b" },
]

export function getNavForRole(role: "admin" | "auditor" | "va"): NavItem[] {
  if (role === "admin") return ADMIN_NAV
  if (role === "auditor") return AUDITOR_NAV
  return VA_NAV
}
