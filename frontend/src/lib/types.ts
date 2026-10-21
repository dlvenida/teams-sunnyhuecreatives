export interface Client {
  id: string
  name: string
  billing_type: "hourly" | "fixed" | "package_hours"
  default_rate: string | null
  is_active: boolean
}

export interface ClientPackage {
  id: string
  client_id: string
  name: string
  billing_type: "hourly" | "fixed" | "package_hours"
  amount: string
  included_hours?: string | null
  overage_rate?: string | null
  currency: "PHP" | "USD"
  is_default: boolean
  is_active: boolean
}

export interface SubClient {
  id: string
  client_id: string
  name: string
  is_active: boolean
}

export interface VA {
  id: string
  name: string
  currency: "PHP" | "USD"
  is_active: boolean
  email?: string
  user_id?: string
  reviewer_user_id?: string | null
  reviewer_name?: string | null
}

export interface AppUser {
  id: string; email: string; name: string
  role: "admin" | "auditor" | "va" | string
  is_active: boolean; va_id?: string | null; auditing_count: number
}

export interface TeamActivityMember {
  va_id: string; user_id: string; name: string; email?: string | null
  reviewer_user_id?: string | null; reviewer_name?: string | null
  status: "inactive" | "low" | "active" | "idle"
  reasons: string[]
  assigned_clients: { client_id: string; name: string; open_tasks: number; hours_week: string; last_log_date?: string | null; no_activity_week: boolean }[]
  open_tasks: number; overdue: number; due_today: number; in_progress: number
  hours_today: string; hours_week: string; logs_today: number; logs_week: number
  clock_status?: string | null; last_activity?: string | null
}
export interface TeamActivity {
  week_start: string; week_end: string; today: string
  members: TeamActivityMember[]
  counts: { inactive: number; low: number; active: number; idle: number }
}

export interface WorkLog {
  id: string
  work_date: string
  va_id: string
  va_name?: string
  client_id: string
  client_name?: string
  sub_client_id?: string | null
  sub_client_name?: string | null
  description_lexical?: Record<string, unknown> | null
  description_plain: string
  start_time: string
  end_time: string
  hours: string
  va_rate: string
  va_pay: string
  notes?: string | null
  status: "submitted" | "approved" | "rejected" | "invoiced"
  invoice_id?: string | null
  project_id?: string | null
  project_name?: string | null
  task_id?: string | null
  task_title?: string | null
  clock_in_at?: string | null
  clock_out_at?: string | null
  source?: string
  created_at: string
  attachment_count?: number
}

export interface Invoice {
  id: string
  invoice_number: string
  client_id: string
  client_name?: string
  period_label: string
  period_start: string
  period_end: string
  total_hours: string
  billing_type: "hourly" | "fixed" | "package_hours"
  rate: string
  amount: string
  status: "unpaid" | "paid"
  payment_method: "wise" | "paypal" | "bank_transfer"
  bank_details?: string | null
  payment_terms_days: number
  issue_date: string
  due_date: string
  paid_at?: string | null
  line_items: InvoiceLineItem[]
}

export interface InvoiceLineItem {
  id: string
  line_date: string
  description: string
  hours: string
  rate: string
  amount: string
}

export interface InvoicePreview {
  period_label: string
  period_start: string
  period_end: string
  approved_entries: number
  submitted_entries: number
  total_hours: string
  estimated_amount: string | null
  billing_type: "hourly" | "fixed" | "package_hours"
  can_generate: boolean
  message: string
  included_hours?: string | null
  overage_hours?: string | null
  overage_amount?: string | null
}

export interface DashboardSummary {
  total_invoiced: string
  paid_by_clients: string
  total_va_payout: string
  estimated_profit: string
  pending_entries: number
  approved_hours: string
  active_clients: number
  invoices_issued: number
  unpaid_invoices: number
  this_week_va_pay: string
  active_vas: number
  hours_by_client: { client: string; hours: number }[]
  va_pay_this_week: { va_id: string; name: string; currency: string; pay: number; hours: number }[]
  pending_logs: WorkLog[]
}

export interface PayrollResponse {
  period_start: string
  period_end: string
  vas: PayrollVA[]
  total_php: string
  total_usd: string
  total_hours?: string
  total_pending_hours?: string
}

export interface PayrollVA {
  va_id: string
  va_name: string
  currency: "PHP" | "USD"
  total_hours: string
  total_pay: string
  entry_count: number
  entries: {
    id: string
    work_date: string
    client_name: string
    description: string
    hours: string
    rate: string
    pay: string
    project_name?: string | null
    task_title?: string | null
    source?: string
    status?: string
  }[]
  pending_hours?: string
  pending_count?: number
  days_worked?: number
  avg_hours_per_day?: string
  clock_hours?: string
  manual_hours?: string
  tasks_done?: number
  by_client?: { label: string; hours: string; pay: string }[]
  daily?: { work_date: string; hours: string }[]
  prev_hours?: string
  prev_pay?: string
  change_pct?: number | null
  payment_label?: string | null
  is_paid?: boolean
  run_id?: string | null
}

export interface PayrollRun {
  id: string; va_id: string; va_name?: string | null
  period_start: string; period_end: string
  total_hours: string; total_pay: string; currency: string
  method?: string | null; notes?: string | null; paid_at: string
}

export interface ReportLineItem {
  work_date: string; description: string; hours: string; rate?: string; amount?: string
  va_name?: string | null; sub_client_name?: string | null; project_name?: string | null; task_title?: string | null
  source?: string; start_time?: string | null; end_time?: string | null
}
export interface ReportBreakdown { label: string; hours: string; entries: number }
export interface ReportResponse {
  client_name: string
  period_label: string
  period_start: string
  period_end: string
  generated_at: string
  show_rate: boolean
  lines: ReportLineItem[]
  total_hours: string
  total_amount?: string | null
  by_va?: ReportBreakdown[]
  by_project?: ReportBreakdown[]
  by_sub_client?: ReportBreakdown[]
  by_day?: { work_date: string; hours: string }[]
  pending_hours?: string
  pending_count?: number
  tasks_done?: number
  days_worked?: number
}
export interface ReportClientSummary {
  client_id: string; client_name: string; billing_type: string; is_active: boolean
  billable_hours: string; entries: number; pending_hours: string; pending_count: number
  ready_to_invoice_hours: string; invoiced_hours: string; amount?: string | null
  va_names: string[]; last_activity?: string | null
  invoice_number?: string | null; invoice_status?: string | null
  prev_period_hours: string; change_pct?: number | null
}
export interface ReportClientsResponse {
  period_label: string; period_start: string; period_end: string; show_rate: boolean
  clients: ReportClientSummary[]; total_hours: string; total_pending_hours: string
}

export type ProjectStatus = "active" | "on_hold" | "completed" | "archived"
export type Cadence = "weekly" | "biweekly" | "monthly"
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "blocked"
export type TaskPriority = "low" | "medium" | "high" | "urgent"
export type ClockStatus = "running" | "paused" | "completed"

export interface Project {
  id: string
  client_id: string
  client_name?: string | null
  sub_client_id?: string | null
  sub_client_name?: string | null
  name: string
  description?: string | null
  color: string
  status: ProjectStatus
  cadence: Cadence
  start_date?: string | null
  due_date?: string | null
  task_total: number
  task_done: number
  task_in_progress: number
  total_hours: string
  created_at?: string | null
}

export interface TaskItem {
  id: string
  title: string
  description?: string | null
  client_id: string
  client_name?: string | null
  sub_client_id?: string | null
  sub_client_name?: string | null
  project_id?: string | null
  project_name?: string | null
  project_color?: string | null
  assignee_va_id?: string | null
  assignee_name?: string | null
  status: TaskStatus
  priority: TaskPriority
  start_date?: string | null
  due_date?: string | null
  estimated_hours?: string | null
  logged_hours: string
  position: number
  tags?: string[] | null
  checklist?: { text: string; done: boolean }[] | null
  completed_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface MentionRef { user_id: string; name: string }
export interface CommentAttachment {
  id: string; comment_id?: string | null; original_name: string
  link_url?: string | null; provider?: string | null; kind?: "image" | "link" | string
  size_bytes: number; original_size: number
  width?: number | null; height?: number | null; original_width?: number | null; original_height?: number | null
  format: string; storage_backend: "bucket" | "local" | string; is_annotation: boolean
  annotated_from_id?: string | null; created_at?: string | null; url: string
}
export interface ReactionSummary { emoji: string; count: number; users: string[]; reacted_by_me: boolean }
export interface TaskComment {
  id: string
  task_id?: string | null
  project_id?: string | null
  author_user_id: string
  author_name: string
  author_role: string
  body: string
  parent_id?: string | null
  mentions: MentionRef[]
  is_pinned: boolean
  edited_at?: string | null
  created_at: string
  reactions: ReactionSummary[]
  attachments: CommentAttachment[]
}
export type ProjectComment = TaskComment
export interface TeamMember { user_id: string; name: string; role: string; va_id?: string | null }
export interface ProjectMeetup {
  id: string; project_id: string; title: string; notes?: string | null
  starts_at: string; ends_at?: string | null; location?: string | null
  attendees: MentionRef[]; created_by_name: string; created_at?: string | null
}
export interface StorageStatus {
  bucket_enabled: boolean; backend: string; note: string
  image_policy: { accepted: string[]; max_original_mb: number; max_edge_px: number; stored_format: string; avif_quality: number }
}

export interface TaskStats {
  total: number
  by_status: Record<string, number>
  overdue: number
  due_today: number
  unassigned: number
}

export interface TimeClockEntry {
  id: string
  va_id: string
  va_name?: string | null
  task_id?: string | null
  task_title?: string | null
  client_id?: string | null
  client_name?: string | null
  project_id?: string | null
  project_name?: string | null
  work_log_id?: string | null
  clock_in: string
  clock_out?: string | null
  duration_seconds?: number | null
  elapsed_seconds: number
  status: ClockStatus
  notes?: string | null
  is_adjusted?: boolean
  adjustment_count?: number
  last_adjusted_at?: string | null
  last_adjustment_reason?: string | null
  created_at?: string | null
}

export interface TimeClockAdjustment {
  id: string
  entry_id: string
  va_id: string
  va_name?: string | null
  adjusted_by_name: string
  adjusted_by_role: string
  reason: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  work_log_synced: boolean
  created_at?: string | null
}

export interface VAAssignedClient {
  client_id: string
  name: string
  billing_type: string
  is_active: boolean
  total_tasks: number
  open_tasks: number
  done_tasks: number
  overdue_tasks: number
  hours: string
  pending_hours: string
  logs: number
  last_log_date?: string | null
  next_due?: string | null
  sub_clients: string[]
  projects: { id: string; name: string; color: string; status: string; task_total: number; task_done: number }[]
  tasks: { id: string; title: string; status: string; priority: string; due_date?: string | null; project_name?: string | null }[]
}

export interface UserReport {
  id: string
  reporter_user_id: string
  reporter_va_id?: string | null
  reporter_name: string
  reporter_role: string
  category: "client" | "task" | "time_clock" | "payroll" | "technical" | "general" | string
  title: string
  body: string
  client_id?: string | null
  client_name?: string | null
  project_id?: string | null
  project_name?: string | null
  task_id?: string | null
  task_title?: string | null
  status: "open" | "acknowledged" | "resolved" | string
  admin_note?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ClientFinancials {
  since?: string | null
  total_hours: string
  total_earned: string
  total_collected: string
  total_outstanding: string
  va_earned: string
  net: string
  net_collected: string
  profit_margin_pct?: number | null
  invoices_count: number
  invoices_paid: number
  invoices_unpaid_count: number
  by_va: { va_id: string; va_name: string; currency: string; hours: string; va_pay: string; logs: number }[]
}
export interface ClientFinancialRow {
  client_id: string; client_name: string; is_active: boolean; created_at?: string | null
  total_hours: string; total_earned: string; total_collected: string; total_outstanding: string
  va_earned: string; net: string; net_collected: string; invoices_count: number
}

export interface UserDetail {
  profile: {
    user_id: string; va_id?: string | null; name: string; email: string; role: string; is_active: boolean
    currency?: string | null; created_at?: string | null; display_name?: string | null; phone?: string | null
    address?: string | null; job_title?: string | null; bio?: string | null; timezone?: string | null
    skills?: string[]; hire_date?: string | null; status_message?: string | null
    linkedin_url?: string | null; portfolio_url?: string | null; wise_email?: string | null
    has_profile_photo: boolean; reviewer_name?: string | null
    reviewing: { va_id: string; name: string }[]
  }
  stats: {
    total_hours: string; total_va_pay: string; hours_this_week: string; pending_hours: string
    logs_count: number; pending_count: number; tasks_total: number; tasks_open: number; tasks_done: number
    tasks_overdue: number; clients_count: number; projects_count: number; clock_sessions: number
    clock_hours: string; last_activity?: string | null
  }
  assigned_clients: { client_id: string; name: string; is_active: boolean; open_tasks: number; done_tasks: number; total_tasks: number; hours: string; va_pay: string; logs: number; last_log_date?: string | null }[]
  assigned_projects: { id: string; name: string; color: string; status: string; cadence: string; client_id: string; client_name?: string | null; sub_client_name?: string | null; task_total: number; task_done: number; hours: string; due_date?: string | null }[]
  tasks: TaskItem[]
  time_logs: WorkLog[]
  clock_history: TimeClockEntry[]
  timeline: { kind: string; at: string; date_label: string; title: string; detail: string; status: string }[]
  history: { id: string; action: string; description: string; path?: string | null; method?: string | null; created_at?: string | null }[]
}

export interface ClientDetail {
  financials?: ClientFinancials
  client: { id: string; name: string; billing_type: string; default_rate?: string | null; is_active: boolean; created_at?: string | null }
  stats: {
    total_hours: string; hours_this_month: string; pending_hours: string; pending_count: number
    invoiced_hours: string; ready_to_invoice_hours: string; logs_count: number
    tasks_total: number; tasks_open: number; tasks_done: number; tasks_overdue: number
    invoices_count: number; invoices_unpaid: number; va_names: string[]; last_activity?: string | null
  }
  sub_clients: { id: string; name: string; is_active: boolean; hours: string; logs: number; tasks: number }[]
  projects: { id: string; name: string; status: string; cadence: string; color: string; sub_client_name?: string | null; task_total: number; task_done: number; hours: string; due_date?: string | null }[]
  tasks: TaskItem[]
  logs: WorkLog[]
  invoices: { id: string; invoice_number: string; period_label: string; total_hours: string; amount: string; status: string; issue_date: string; due_date: string; paid_at?: string | null }[]
}

export interface NotificationItem {
  id: string
  type: "comment" | "task" | "log" | "clock" | "invoice" | "delegation" | "system" | string
  title: string
  body?: string | null
  link?: string | null
  is_read: boolean
  created_at: string
}
export interface NotificationList { items: NotificationItem[]; unread: number; total: number }

export interface DashboardOverview {
  role: string
  today: string
  week_start: string
  week_end: string
  counts: { total_tasks: number; todo: number; in_progress: number; in_review: number; done: number; blocked: number; overdue: number; due_today: number; unassigned: number; done_this_week: number }
  hours_today: string
  hours_this_week: string
  today_tasks: TaskItem[]
  backlog: TaskItem[]
  upcoming: TaskItem[]
  needs_attention: { type: string; severity: string; title: string; detail: string; link: string }[]
  prepare: string[]
  live_clock: TimeClockEntry[]
  tomorrow_tasks?: TaskItem[]
  estimated_hours_today?: string
  team_load?: { name: string; open: number; overdue: number; due_today: number }[]
  projects: Project[]
  recent_comments: { id: string; task_id: string; author_name: string; body: string; created_at?: string | null }[]
}

export interface Settings {
  company_name: string
  principal_name: string
  location: string
  wise_email: string
  paypal_email: string
  hide_pricing: boolean
  booking_url: string
  booking_hide_pricing: boolean
  default_va_hourly_rate: string
  resend_api_key?: string
  resend_from_email?: string
  admin_notify_email?: string
}

export interface EmailTemplate {
  id: string; key: string; name: string; subject: string; body_html: string
  cta_label?: string | null; cta_url?: string | null; variables: string[]; is_active: boolean; updated_at?: string | null
}
export interface EmailLog {
  id: string; template_key?: string | null; to_email: string; subject: string
  status: "sent" | "failed" | "skipped" | string; error?: string | null; created_at: string
}
export interface ActivityLog {
  id: string; user_id?: string | null; user_name: string; user_role?: string | null
  action: string; description: string; path?: string | null; method?: string | null; created_at: string
}
