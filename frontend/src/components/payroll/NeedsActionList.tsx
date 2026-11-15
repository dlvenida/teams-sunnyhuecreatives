import { useState, type ButtonHTMLAttributes } from "react"
import type { PayrollVA } from "@/lib/types"
import { formatCurrency, formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { payrollActionBucket } from "@/components/payroll/payrollAction"

type ActionFilter = "action" | "approve" | "pay" | "paid"

function byName(a: PayrollVA, b: PayrollVA) {
  return a.va_name.localeCompare(b.va_name)
}

function hoursLabel(value?: string | number | null) {
  const hours = Number(value ?? 0)
  return `${Number.isFinite(hours) ? hours.toFixed(2) : "0.00"} hrs`
}

function TapButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-11 min-h-11 w-full items-center justify-center rounded-xl px-2 text-center text-[11px] font-semibold uppercase tracking-wide disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function ActionCard({
  va,
  periodStart,
  periodEnd,
  showPricing,
  isAdmin,
  selfVaId,
  approving,
  returning,
  onView,
  onApprove,
  onReturn,
  onMarkPaid,
  onUndo,
}: {
  va: PayrollVA
  periodStart: string
  periodEnd: string
  showPricing: boolean
  isAdmin: boolean
  selfVaId?: string
  approving: boolean
  returning: boolean
  onView: () => void
  onApprove: () => void
  onReturn: (note: string) => void
  onMarkPaid: () => void
  onUndo: () => void
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState("")
  const bucket = payrollActionBucket(va)
  const own = !!selfVaId && selfVaId === va.va_id
  const start = va.timesheet_period_start || periodStart
  const end = va.timesheet_period_end || periodEnd
  const canApprove = bucket === "approve" && !!va.timesheet_id && !own
  const canReturn = (bucket === "approve" || bucket === "pay") && !!va.timesheet_id && !own
  const canPay = isAdmin && showPricing && bucket === "pay" && (Number(va.total_hours) > 0 || Number(va.total_pay) > 0)
  const status = bucket === "approve"
    ? "Submitted"
    : bucket === "pay"
      ? (showPricing ? "Approved, ready to pay" : "Approved")
      : bucket === "paid"
        ? "Paid"
        : va.timesheet_status === "rejected"
          ? "Returned for fixes"
          : "Not submitted"

  return (
    <article
      data-testid="action-card"
      data-va={va.va_name}
      data-bucket={bucket}
      className="min-w-0 rounded-2xl border border-[#F7C6D3] bg-white p-3 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-lg text-[#B8325F]">{va.va_name}</h3>
        <span className="shrink-0 rounded-full bg-[#FDF2F5] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#B8325F]">
          {status}
        </span>
      </div>
      <p className="mt-1 text-sm text-[#43303a]">{formatDate(start)} to {formatDate(end)}</p>
      <p className="mt-1 text-sm font-semibold">{hoursLabel(va.total_hours)}</p>
      {showPricing && va.total_pay != null && (
        <p data-testid="pay-amount" className="mt-0.5 text-xl text-[#B8325F]">{formatCurrency(va.total_pay, va.currency)}</p>
      )}
      {own && bucket !== "paid" && bucket !== "draft" && (
        <p className="mt-2 text-xs text-[#43303a]">An Admin reviews this timesheet.</p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <TapButton className="border border-[#F7C6D3] bg-white text-[#B8325F]" onClick={onView} aria-label={`View ${va.va_name}`}>
          View
        </TapButton>
        {canApprove && (
          <TapButton
            className="bg-[#E8578A] text-white"
            disabled={approving}
            aria-label={`Approve ${va.va_name}`}
            onClick={onApprove}
          >
            {approving ? "Approving" : "Approve"}
          </TapButton>
        )}
        {canReturn && !noteOpen && (
          <TapButton
            className={cn("border border-[#B8325F] bg-white text-[#B8325F]", !canPay && "col-span-2")}
            aria-label={`Return for fixes ${va.va_name}`}
            onClick={() => setNoteOpen(true)}
          >
            Return for fixes
          </TapButton>
        )}
        {canPay && (
          <TapButton className="col-span-2 bg-[#B8325F] text-white" aria-label={`Mark Paid ${va.va_name}`} onClick={onMarkPaid}>
            Mark Paid
          </TapButton>
        )}
        {isAdmin && bucket === "paid" && va.run_id && (
          <TapButton className="border border-[#F7C6D3] bg-white text-[#B8325F]" aria-label={`Undo Paid ${va.va_name}`} onClick={onUndo}>
            Undo Paid
          </TapButton>
        )}
      </div>
      {noteOpen && canReturn && (
        <div className="mt-2 space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-[#B8325F]" htmlFor={`return-${va.va_id}`}>
            Note for the VA (optional)
          </label>
          <textarea
            id={`return-${va.va_id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What should the VA fix?"
            rows={2}
            className="min-h-11 w-full rounded-xl border border-[#F7C6D3] bg-white px-3 py-2 text-base"
          />
          <div className="grid grid-cols-2 gap-2">
            <TapButton
              className="border border-[#B8325F] bg-[#B8325F] text-white"
              disabled={returning}
              onClick={() => onReturn(note)}
            >
              {returning ? "Returning" : "Return for fixes"}
            </TapButton>
            <TapButton className="border border-[#F7C6D3] bg-white text-[#B8325F]" onClick={() => setNoteOpen(false)}>
              Cancel
            </TapButton>
          </div>
        </div>
      )}
    </article>
  )
}

export function NeedsActionList({
  vas,
  periodStart,
  periodEnd,
  showPricing,
  isAdmin,
  selfVaId,
  loading,
  approvingId,
  returningId,
  onView,
  onApprove,
  onReturn,
  onMarkPaid,
  onUndo,
}: {
  vas: PayrollVA[]
  periodStart: string
  periodEnd: string
  showPricing: boolean
  isAdmin: boolean
  selfVaId?: string
  loading?: boolean
  approvingId?: string | null
  returningId?: string | null
  onView: (vaId: string) => void
  onApprove: (timesheetId: string) => void
  onReturn: (timesheetId: string, note: string) => void
  onMarkPaid: (va: PayrollVA) => void
  onUndo: (runId: string) => void
}) {
  const [filter, setFilter] = useState<ActionFilter>("action")
  const approve = vas.filter((va) => payrollActionBucket(va) === "approve").sort(byName)
  const pay = vas.filter((va) => payrollActionBucket(va) === "pay").sort(byName)
  const paid = vas.filter((va) => payrollActionBucket(va) === "paid").sort(byName)
  const drafts = vas.filter((va) => payrollActionBucket(va) === "draft").sort(byName)
  const visible = filter === "approve" ? approve : filter === "pay" ? pay : filter === "paid" ? paid : [...approve, ...pay]
  const empty = filter === "approve"
    ? "No timesheets to approve."
    : filter === "pay"
      ? (showPricing ? "No approved timesheets are waiting for pay." : "No approved timesheets.")
      : filter === "paid"
        ? "No paid timesheets in this period."
        : "Nothing needs your action in this period."

  const chip = (id: ActionFilter, label: string, testId: string) => (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={filter === id}
      onClick={() => setFilter((current) => (current === id ? "action" : id))}
      className={cn(
        "h-11 min-h-11 rounded-full border px-3 text-[11px] font-semibold uppercase tracking-wide",
        filter === id ? "border-[#B8325F] bg-[#B8325F] text-white" : "border-[#F7C6D3] bg-white text-[#B8325F]",
      )}
    >
      {label}
    </button>
  )

  return (
    <section
      id="needs-action"
      data-testid="needs-action"
      className="shc-brand min-w-0 rounded-2xl border border-[#F7C6D3] bg-[#FDF2F5] p-3 sm:p-4"
    >
      <p className="brand-label text-[11px] font-semibold uppercase tracking-[0.14em] text-[#B8325F]">Timesheets</p>
      <h2 className="text-2xl text-[#B8325F]">Needs your action</h2>
      <p className="mt-1 text-sm">
        {showPricing
          ? "Submitted timesheets come first. Approved and unpaid timesheets follow."
          : "Submitted timesheets come first. Approved timesheets follow."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Timesheet filters">
        {chip("approve", `To approve (${approve.length})`, "filter-approve")}
        {showPricing
          ? chip("pay", `To pay (${pay.length})`, "filter-pay")
          : chip("pay", `Approved (${pay.length})`, "filter-pay")}
        {chip("paid", `Paid (${paid.length})`, "filter-paid")}
      </div>
      {loading && <p className="mt-3 text-sm">Loading timesheets.</p>}
      {!loading && visible.length === 0 && (
        <p className="mt-3 rounded-xl border border-[#F7C6D3] bg-white px-3 py-4 text-sm">{empty}</p>
      )}
      <div className="mt-3 grid gap-2 lg:grid-cols-2" data-testid="action-list">
        {visible.map((va) => (
          <ActionCard
            key={va.va_id}
            va={va}
            periodStart={periodStart}
            periodEnd={periodEnd}
            showPricing={showPricing}
            isAdmin={isAdmin}
            selfVaId={selfVaId}
            approving={approvingId === va.timesheet_id}
            returning={returningId === va.timesheet_id}
            onView={() => onView(va.va_id)}
            onApprove={() => va.timesheet_id && onApprove(va.timesheet_id)}
            onReturn={(note) => va.timesheet_id && onReturn(va.timesheet_id, note)}
            onMarkPaid={() => onMarkPaid(va)}
            onUndo={() => va.run_id && onUndo(va.run_id)}
          />
        ))}
      </div>
      {filter !== "paid" && paid.length > 0 && (
        <details className="mt-3 rounded-2xl border border-[#F7C6D3] bg-white">
          <summary className="min-h-11 cursor-pointer list-none px-3 py-3 text-sm font-semibold uppercase tracking-wide text-[#B8325F]">
            Paid ({paid.length})
          </summary>
          <div className="grid gap-2 p-3 pt-0 lg:grid-cols-2">
            {paid.map((va) => (
              <ActionCard
                key={va.va_id}
                va={va}
                periodStart={periodStart}
                periodEnd={periodEnd}
                showPricing={showPricing}
                isAdmin={isAdmin}
                selfVaId={selfVaId}
                approving={false}
                returning={false}
                onView={() => onView(va.va_id)}
                onApprove={() => undefined}
                onReturn={() => undefined}
                onMarkPaid={() => onMarkPaid(va)}
                onUndo={() => va.run_id && onUndo(va.run_id)}
              />
            ))}
          </div>
        </details>
      )}
      {drafts.length > 0 && (
        <details className="mt-3 rounded-2xl border border-[#F7C6D3] bg-white" data-testid="drafts">
          <summary className="min-h-11 cursor-pointer list-none px-3 py-3 text-sm font-semibold uppercase tracking-wide text-[#B8325F]">
            Not submitted and returned ({drafts.length})
          </summary>
          <div className="grid gap-2 p-3 pt-0 lg:grid-cols-2">
            {drafts.map((va) => (
              <ActionCard
                key={va.va_id}
                va={va}
                periodStart={periodStart}
                periodEnd={periodEnd}
                showPricing={showPricing}
                isAdmin={isAdmin}
                selfVaId={selfVaId}
                approving={false}
                returning={false}
                onView={() => onView(va.va_id)}
                onApprove={() => undefined}
                onReturn={() => undefined}
                onMarkPaid={() => onMarkPaid(va)}
                onUndo={() => va.run_id && onUndo(va.run_id)}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
