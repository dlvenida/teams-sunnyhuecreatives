import type { PayrollVA } from "@/lib/types"
import { groupByWeek } from "@/lib/weeks"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Wallet, X } from "lucide-react"

function timesheetState(va: PayrollVA): { label: string; className: string } {
  if (va.timesheet_status === "reviewed") return { label: "Timesheet approved", className: "bg-green-100 text-green-800" }
  if (va.timesheet_status === "rejected") return { label: "Timesheet rejected", className: "bg-rose-100 text-rose-800" }
  if (va.timesheet_submitted) return { label: "Pending approval", className: "bg-amber-200 text-amber-950" }
  return { label: "Timesheet not submitted", className: "bg-rose-100 text-rose-700" }
}

function money(amount: string | number | null | undefined, currency: string) {
  if (amount == null || amount === "") return "—"
  return formatCurrency(amount, currency)
}

/**
 * One person's timesheet, opened from that person's card.
 * Admin sees weekly rows with rate and pay, plus Mark Paid.
 * Project Managers see the same weeks and hours, with money omitted.
 */
export function PersonTimesheet({
  va,
  periodStart,
  periodEnd,
  showMoney,
  onClose,
  onMarkPaid,
  markPaidPending,
  markPaidDisabled,
  markPaidTitle,
  onUndoPaid,
  onOpenApproval,
}: {
  va: PayrollVA
  periodStart: string
  periodEnd: string
  showMoney: boolean
  onClose: () => void
  onMarkPaid?: () => void
  markPaidPending?: boolean
  markPaidDisabled?: boolean
  markPaidTitle?: string
  onUndoPaid?: () => void
  onOpenApproval?: () => void
}) {
  const entries = va.entries ?? []
  const weeks = groupByWeek(entries, (entry) => entry.work_date)
  const status = timesheetState(va)
  const hasPackage = showMoney && (va.by_client ?? []).some((row) => row.pay_type === "package")
  const currency = va.currency === "USD" ? "USD" : "PHP"

  return (
    <section
      id="person-timesheet"
      aria-label={`${va.va_name} timesheet`}
      className="mt-3 scroll-mt-24 space-y-3 rounded-2xl border border-primary/30 bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">This person's timesheet</p>
          <h2 className="font-display text-lg font-bold">{va.va_name}</h2>
          <p className="text-xs text-muted-foreground">
            {formatDate(periodStart)} to {formatDate(periodEnd)}
            {" · "}
            {showMoney
              ? "Arranged by week: date, client, task, hours, rate, and pay."
              : "Arranged by week: date, client, task, and hours."}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${status.className}`}>{status.label}</span>
            {va.is_paid ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800">Paid</span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Unpaid</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-extrabold leading-none">{showMoney ? money(va.total_pay, currency) : `${va.total_hours} hrs`}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {va.total_hours} hrs · {va.entry_count} entries
          </p>
          <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={onClose}>
            <X className="h-3.5 w-3.5" /> Close
          </Button>
        </div>
      </div>

      {showMoney && hasPackage && (
        <p className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground">
          Week rows are logged hours. Period pay matches this person’s card and includes a fixed package when they have one.
        </p>
      )}
      {Number(va.pending_hours ?? 0) > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          {va.pending_hours} hrs are still submitted and are not in this timesheet until those logs are approved.
        </p>
      )}

      {weeks.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {weeks.map((week) => (
            <button
              key={week.id}
              type="button"
              onClick={() => document.getElementById(`person-${va.va_id}-${week.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary hover:bg-primary/15"
            >
              {week.label}
            </button>
          ))}
        </div>
      )}

      {weeks.length === 0 && (
        <p className="rounded-xl border bg-muted/30 p-6 text-center text-sm text-muted-foreground">No time logs in this period.</p>
      )}

      {weeks.map((week) => {
        const hours = week.items.reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
        const pay = week.items.reduce((sum, entry) => sum + Number(entry.pay || 0), 0)
        return (
          <Card key={week.id} id={`person-${va.va_id}-${week.id}`} className="scroll-mt-24">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
                <span>{week.label}</span>
                <span className="text-xs font-semibold text-muted-foreground">
                  {hours.toFixed(2)} hrs{showMoney ? ` · ${money(pay, currency)}` : ""}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="p-3">Date</th>
                    <th className="p-3">Client</th>
                    <th className="p-3">Task</th>
                    <th className="p-3">Hours</th>
                    {showMoney && <th className="p-3">Rate</th>}
                    {showMoney && <th className="p-3">Pay</th>}
                  </tr>
                </thead>
                <tbody>
                  {week.items.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0 align-top">
                      <td className="whitespace-nowrap p-3">{formatDate(entry.work_date)}</td>
                      <td className="p-3 font-medium">{entry.client_name}</td>
                      <td className="max-w-xs p-3">
                        <span className="font-bold">{entry.task_name || entry.task_title || "Logged work"}</span>
                        {entry.description && <span className="mt-0.5 block text-[11px] text-muted-foreground">{entry.description}</span>}
                      </td>
                      <td className="p-3 font-bold">{entry.hours}</td>
                      {showMoney && <td className="p-3">{money(entry.rate, currency)}</td>}
                      {showMoney && <td className="p-3 font-semibold">{money(entry.pay, currency)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )
      })}

      {(showMoney && (onMarkPaid || onUndoPaid)) || onOpenApproval ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            {showMoney
              ? onMarkPaid
                ? "Pay from here. Mark Paid uses the same review as the button on this person’s card."
                : "This period is already marked paid."
              : "Open approval details to approve or reject this timesheet."}
          </p>
          <div className="flex flex-wrap gap-2">
            {onOpenApproval && (
              <Button type="button" size="sm" variant="outline" onClick={onOpenApproval}>
                Approval details
              </Button>
            )}
            {showMoney && onUndoPaid && (
              <Button type="button" size="sm" variant="outline" onClick={onUndoPaid}>Undo Paid</Button>
            )}
            {showMoney && onMarkPaid && (
              <Button
                type="button"
                size="sm"
                variant="success"
                disabled={markPaidPending || markPaidDisabled}
                title={markPaidTitle}
                onClick={onMarkPaid}
              >
                <Wallet className="h-3.5 w-3.5" /> Mark Paid
              </Button>
            )}
          </div>
        </div>
      ) : null}
      {showMoney && onMarkPaid && markPaidDisabled && markPaidTitle && (
        <p className="text-[11px] text-muted-foreground">{markPaidTitle}</p>
      )}
    </section>
  )
}
