import type { PayrollVA } from "@/lib/types"

export type ActionBucket = "approve" | "pay" | "paid" | "draft"

export function payrollActionBucket(va: PayrollVA): ActionBucket {
  if (va.is_paid) return "paid"
  if (va.timesheet_status === "submitted") return "approve"
  if (va.timesheet_status === "reviewed") return "pay"
  return "draft"
}
