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
  ReceiptText,
  Building2,
  UsersRound,
  Settings2,
  BellRing,
  CircleUserRound,
  Clock,
  PiggyBank,
} from "lucide-react"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  keywords?: string[]
  section?: string
  color?: string
  /** Extra paths that should light this item, used when several pages share one menu entry. */
  activePaths?: string[]
}

export const ADMIN_NAV: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutGrid, keywords: ["home", "today", "overview"], section: "Today", color: "#f87ca6" },
  { to: "/admin/time-clock", label: "Time Clock", icon: Clock3, keywords: ["clock", "live", "team time", "my clock"], section: "Today", color: "#86efac" },
  { to: "/admin/log-time", label: "Log my time", icon: Clock, keywords: ["submit", "hours", "my hours", "manual"], section: "Today", color: "#fcd34d" },
  { to: "/admin/tasks", label: "Task Board", icon: Columns3, keywords: ["kanban", "monday", "tasks", "board", "task board"], section: "Work", color: "#a78bfa" },
  { to: "/admin/projects", label: "Projects", icon: FolderHeart, keywords: ["project", "client project"], section: "Work", color: "#67e8f9" },
  { to: "/admin/payroll", label: "Timesheets & pay", icon: Wallet, keywords: ["pay", "salary", "php", "usd", "timesheet", "payroll", "va payroll"], section: "Team", color: "#6ee7b7" },
  { to: "/admin/logs", label: "Review logs", icon: ScrollText, keywords: ["work logs", "entries", "approve", "all logs"], section: "Team", color: "#fcd34d" },
  { to: "/admin/va-rates", label: "Team Rates", icon: Tags, keywords: ["rate", "approve", "package", "hourly", "project manager", "salary"], section: "Team", color: "#5eead4" },
  { to: "/admin/invoices", label: "Invoices", icon: ReceiptText, keywords: ["billing", "invoice", "payment"], section: "Money", color: "#fdba74" },
  { to: "/admin/finance", label: "Earnings & expenses", icon: PiggyBank, keywords: ["profit", "owner", "expenses", "earnings", "money"], section: "Money", color: "#f9a8d4" },
  { to: "/admin/reports", label: "Insights", icon: ChartColumn, keywords: ["client report", "hours", "analytics", "activity", "team reports", "inbox"], section: "Insights", color: "#93c5fd", activePaths: ["/admin/reports", "/admin/analytics", "/admin/user-reports"] },
  { to: "/admin/clients", label: "Clients", icon: Building2, keywords: ["sub-clients", "client list", "archive"], section: "Settings", color: "#d8b4fe" },
  { to: "/admin/users", label: "Users", icon: UsersRound, keywords: ["va", "roster", "team", "archive"], section: "Settings", color: "#f9a8d4" },
  { to: "/admin/settings", label: "Company settings", icon: Settings2, keywords: ["company", "payment", "pricing", "hide", "settings"], section: "Settings", color: "#94a3b8" },
  { to: "/notifications", label: "Notifications", icon: BellRing, keywords: ["alerts", "comments", "updates", "unread"], section: "Settings", color: "#f9a8d4" },
  { to: "/admin/profile", label: "Profile", icon: CircleUserRound, keywords: ["account", "theme", "password", "appearance"], section: "Settings", color: "#94a3b8" },
]

export const VA_NAV: NavItem[] = [
  { to: "/va/dashboard", label: "Dashboard", icon: LayoutGrid, keywords: ["home", "today", "overview", "morning"], section: "My Day", color: "#f87ca6" },
  { to: "/va/time-clock", label: "Clock in", icon: Clock3, keywords: ["clock in", "clock out", "timer", "time clock"], section: "My Day", color: "#86efac" },
  { to: "/va/time-log", label: "Log time", icon: Clock, keywords: ["submit", "hours", "work", "log time"], section: "My Day", color: "#fcd34d" },
  { to: "/va/tasks", label: "Task Board", icon: Columns3, keywords: ["kanban", "tasks", "my tasks", "board", "task board"], section: "My Tasks", color: "#a78bfa" },
  { to: "/va/projects", label: "Projects", icon: FolderHeart, keywords: ["project", "client project"], section: "My Tasks", color: "#67e8f9" },
  { to: "/va/payroll", label: "Weekly timesheets", icon: Wallet, keywords: ["pay", "payroll", "timesheet", "earnings", "week"], section: "My Timesheets & Pay", color: "#6ee7b7" },
  { to: "/va/rates", label: "My Rates", icon: Tags, keywords: ["rate", "pay", "hourly", "package"], section: "My Timesheets & Pay", color: "#5eead4" },
  { to: "/va/clients", label: "Clients", icon: Building2, keywords: ["assigned clients", "my clients", "client list"], section: "More", color: "#d8b4fe" },
  { to: "/va/reports", label: "My Reports", icon: Flag, keywords: ["report", "flag", "issue", "report to admin"], section: "More", color: "#f9a8d4" },
  { to: "/notifications", label: "Notifications", icon: BellRing, keywords: ["alerts", "comments", "updates", "unread"], section: "More", color: "#f9a8d4" },
  { to: "/va/notification-preferences", label: "Alert preferences", icon: BellRing, keywords: ["email", "popup", "deadline", "notification preferences"], section: "More", color: "#f9a8d4" },
  { to: "/va/profile", label: "Profile", icon: CircleUserRound, keywords: ["account", "theme", "password"], section: "More", color: "#94a3b8" },
]

export const AUDITOR_NAV: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutGrid, keywords: ["home", "today", "overview", "ops"], section: "Today", color: "#f87ca6" },
  { to: "/admin/time-clock", label: "Time Clock", icon: Clock3, keywords: ["clock", "live", "team time", "my clock"], section: "Today", color: "#86efac" },
  { to: "/admin/log-time", label: "Log my time", icon: Clock, keywords: ["submit", "hours", "my hours", "manual"], section: "Today", color: "#fcd34d" },
  { to: "/admin/my-pay", label: "My Timesheet / My Payslips", icon: Wallet, keywords: ["my pay", "payslip", "salary", "timesheet", "my timesheet"], section: "My Pay", color: "#6ee7b7" },
  { to: "/admin/my-rates", label: "My Rates", icon: Tags, keywords: ["my rate", "hourly", "package", "salary"], section: "My Pay", color: "#5eead4" },
  { to: "/admin/tasks", label: "Task Board", icon: Columns3, keywords: ["tasks", "board", "comments", "task view"], section: "Team Tasks", color: "#a78bfa" },
  { to: "/admin/projects", label: "Projects", icon: FolderHeart, keywords: ["project", "discussion", "meet-ups", "meetups"], section: "Team Tasks", color: "#67e8f9" },
  { to: "/admin/payroll", label: "Timesheet review", icon: Wallet, keywords: ["timesheet", "review", "approve", "hours", "payroll"], section: "Timesheet Review", color: "#6ee7b7" },
  { to: "/admin/logs", label: "Review logs", icon: ScrollText, keywords: ["work logs", "entries", "review", "approve", "all logs"], section: "Timesheet Review", color: "#fcd34d" },
  { to: "/admin/user-reports", label: "Team Reports", icon: Flag, keywords: ["report", "flag", "issue", "inbox", "analytics", "client hours", "activity"], section: "Team Reports", color: "#f9a8d4", activePaths: ["/admin/user-reports", "/admin/reports", "/admin/analytics"] },
  { to: "/admin/clients", label: "Clients", icon: Building2, keywords: ["client list", "propose client", "view client"], section: "People", color: "#d8b4fe" },
  { to: "/admin/users", label: "Users", icon: UsersRound, keywords: ["va", "roster", "team", "profiles"], section: "People", color: "#f9a8d4" },
  { to: "/notifications", label: "Notifications", icon: BellRing, keywords: ["alerts", "comments", "updates", "unread"], section: "People", color: "#f9a8d4" },
  { to: "/admin/profile", label: "Profile", icon: CircleUserRound, keywords: ["account", "theme", "password"], section: "People", color: "#94a3b8" },
]

export function getNavForRole(role: "admin" | "auditor" | "va"): NavItem[] {
  if (role === "admin") return ADMIN_NAV
  if (role === "auditor") return AUDITOR_NAV
  return VA_NAV
}
