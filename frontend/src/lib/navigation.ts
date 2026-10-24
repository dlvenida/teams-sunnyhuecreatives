import type { LucideIcon } from "lucide-react"
import {
  LayoutGrid,
  Columns3,
  FolderHeart,
  Clock3,
  ScrollText,
  Wallet,
  Tags,
  ChartColumn,
  Flag,
  ChartSpline,
  ReceiptText,
  Building2,
  UsersRound,
  Settings2,
  BellRing,
  CircleUserRound,
  Clock,
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
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutGrid, keywords: ["home", "overview", "stats"], section: "Workspace", color: "#f87ca6" },
  { to: "/admin/tasks", label: "Task Board", icon: Columns3, keywords: ["kanban", "monday", "tasks", "board", "task board"], section: "Workspace", color: "#a78bfa" },
  { to: "/admin/projects", label: "Projects", icon: FolderHeart, keywords: ["project", "client project"], section: "Workspace", color: "#67e8f9" },
  { to: "/admin/time-clock", label: "Time Clock", icon: Clock3, keywords: ["clock", "live", "team time"], section: "Workspace", color: "#86efac" },
  { to: "/admin/logs", label: "All Logs", icon: ScrollText, keywords: ["work logs", "entries", "approve"], section: "Operations", color: "#fcd34d" },
  { to: "/admin/payroll", label: "VA Payroll", icon: Wallet, keywords: ["pay", "salary", "php", "usd", "timesheet"], section: "Operations", color: "#6ee7b7" },
  { to: "/admin/va-rates", label: "VA Rates", icon: Tags, keywords: ["rate", "approve", "package", "hourly"], section: "Operations", color: "#5eead4" },
  { to: "/admin/reports", label: "Reports", icon: ChartColumn, keywords: ["client report", "hours"], section: "Operations", color: "#93c5fd" },
  { to: "/admin/user-reports", label: "Team Reports", icon: Flag, keywords: ["report", "flag", "issue", "va report", "inbox"], section: "Operations", color: "#f9a8d4" },
  { to: "/admin/analytics", label: "Analytics", icon: ChartSpline, keywords: ["auditor", "activity", "monitor", "low activity", "team analytics"], section: "Operations", color: "#7dd3fc" },
  { to: "/admin/invoices", label: "Invoices", icon: ReceiptText, keywords: ["billing", "invoice", "payment"], section: "Operations", color: "#fdba74" },
  { to: "/admin/clients", label: "Clients", icon: Building2, keywords: ["sub-clients", "client list", "archive"], section: "Manage", color: "#d8b4fe" },
  { to: "/admin/users", label: "Users", icon: UsersRound, keywords: ["va", "roster", "team", "archive"], section: "Manage", color: "#f9a8d4" },
  { to: "/admin/settings", label: "Settings", icon: Settings2, keywords: ["company", "payment", "pricing", "hide"], section: "System", color: "#94a3b8" },
  { to: "/notifications", label: "Notifications", icon: BellRing, keywords: ["alerts", "comments", "updates", "unread"], section: "System", color: "#f9a8d4" },
  { to: "/admin/profile", label: "Profile", icon: CircleUserRound, keywords: ["account", "theme", "password", "appearance"], section: "System", color: "#94a3b8" },
]

export const VA_NAV: NavItem[] = [
  { to: "/va/dashboard", label: "Dashboard", icon: LayoutGrid, keywords: ["home", "today", "overview", "morning"], section: "Workspace", color: "#f87ca6" },
  { to: "/va/tasks", label: "Task Board", icon: Columns3, keywords: ["kanban", "tasks", "my tasks", "board", "task board"], section: "Workspace", color: "#a78bfa" },
  { to: "/va/projects", label: "Projects", icon: FolderHeart, keywords: ["project", "client project"], section: "Workspace", color: "#67e8f9" },
  { to: "/va/time-clock", label: "Time Clock", icon: Clock3, keywords: ["clock in", "clock out", "timer"], section: "Workspace", color: "#86efac" },
  { to: "/va/time-log", label: "Log Time", icon: Clock, keywords: ["submit", "hours", "work"], section: "Workspace", color: "#fcd34d" },
  { to: "/va/payroll", label: "My Payroll", icon: Wallet, keywords: ["pay", "payroll", "timesheet", "earnings", "report"], section: "Manage", color: "#6ee7b7" },
  { to: "/va/rates", label: "My Rates", icon: Tags, keywords: ["rate", "pay", "hourly", "package"], section: "Manage", color: "#5eead4" },
  { to: "/va/clients", label: "Clients", icon: Building2, keywords: ["assigned clients", "my clients", "client list"], section: "Manage", color: "#d8b4fe" },
  { to: "/va/reports", label: "My Reports", icon: Flag, keywords: ["report", "flag", "issue", "report to admin", "auditor"], section: "Manage", color: "#f9a8d4" },
  { to: "/notifications", label: "Notifications", icon: BellRing, keywords: ["alerts", "comments", "updates", "unread"], section: "System", color: "#f9a8d4" },
  { to: "/va/profile", label: "Profile", icon: CircleUserRound, keywords: ["account", "theme", "password"], section: "System", color: "#94a3b8" },
]

export const AUDITOR_NAV: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutGrid, keywords: ["home", "overview", "ops"], section: "Workspace", color: "#f87ca6" },
  { to: "/admin/tasks", label: "Task Board", icon: Columns3, keywords: ["tasks", "board", "comments", "task view"], section: "Workspace", color: "#a78bfa" },
  { to: "/admin/projects", label: "Projects", icon: FolderHeart, keywords: ["project", "discussion", "meet-ups", "meetups"], section: "Workspace", color: "#67e8f9" },
  { to: "/admin/time-clock", label: "Time Clock", icon: Clock3, keywords: ["clock", "live", "team time"], section: "Workspace", color: "#86efac" },
  { to: "/admin/logs", label: "All Logs", icon: ScrollText, keywords: ["work logs", "entries", "review"], section: "Operations", color: "#fcd34d" },
  { to: "/admin/payroll", label: "VA Payroll", icon: Wallet, keywords: ["timesheet", "review", "approve"], section: "Operations", color: "#6ee7b7" },
  { to: "/admin/user-reports", label: "Team Reports", icon: Flag, keywords: ["report", "flag", "issue", "va report", "inbox"], section: "Operations", color: "#f9a8d4" },
  { to: "/admin/clients", label: "Clients", icon: Building2, keywords: ["client list", "propose client", "view client"], section: "Manage", color: "#d8b4fe" },
  { to: "/notifications", label: "Notifications", icon: BellRing, keywords: ["alerts", "comments", "updates", "unread"], section: "System", color: "#f9a8d4" },
  { to: "/admin/profile", label: "Profile", icon: CircleUserRound, keywords: ["account", "theme", "password"], section: "System", color: "#94a3b8" },
]

export function getNavForRole(role: "admin" | "auditor" | "va"): NavItem[] {
  if (role === "admin") return ADMIN_NAV
  if (role === "auditor") return AUDITOR_NAV
  return VA_NAV
}
