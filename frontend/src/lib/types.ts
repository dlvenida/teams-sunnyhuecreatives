export interface Client {
  id: string
  name: string
  billing_type: "hourly" | "fixed"
  default_rate: string | null
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
  created_at: string
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
  billing_type: "hourly" | "fixed"
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
  billing_type: "hourly" | "fixed"
  can_generate: boolean
  message: string
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
  }[]
}

export interface ReportResponse {
  client_name: string
  period_label: string
  period_start: string
  period_end: string
  generated_at: string
  show_rate: boolean
  lines: { work_date: string; description: string; hours: string; rate?: string; amount?: string }[]
  total_hours: string
  total_amount?: string | null
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
}
