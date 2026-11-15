import { useState, type ButtonHTMLAttributes } from "react"
import type { PayrollVA } from "@/lib/types"
import { formatCurrency, formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { payrollActionBucket } from "@/components/payroll/payrollAction"
import { resolvePackagePay, type PackageChoice } from "@/lib/packageHalf"

const RETURN_NOTES = ["Missing entries", "Wrong hours", "Add task details", "Please fix and resubmit"]

type PackageRow = {
  clientId: string
  name: string
  choice: PackageChoice
  amount: number
}

type HourlyRow = {
  clientId: string
  name: string
  hours: number
  rate: number
  pay: number
}

function packageRows(va: PayrollVA, periodStart: string, periodEnd: string): PackageRow[] {
  return (va.by_client ?? []).flatMap((row) => {
    if (row.pay_type !== "package" || !row.client_id) return []
    const monthly = Number(row.monthly_amount ?? 0)
    const calculated = Number(row.calculated_pay ?? row.pay ?? 0)
    if (row.skipped) return [{ clientId: row.client_id, name: row.label, choice: "skip" as const, amount: 0 }]
    const resolved = resolvePackagePay({
      monthly,
      calculated,
      periodStart,
      periodEnd,
      overrideAmount: Number(row.pay ?? calculated),
    })
    return [{ clientId: row.client_id, name: row.label, choice: resolved.choice, amount: resolved.amount }]
  })
}

function hourlyRows(va: PayrollVA): HourlyRow[] {
  const rows = (va.by_client ?? []).flatMap((row) => {
    if (row.pay_type === "package") return []
    const hours = Number(row.hours || 0)
    if (hours <= 0 && Number(row.pay || 0) <= 0) return []
    return [{
      clientId: row.client_id || "",
      name: row.label,
      hours,
      rate: Number(row.rate || 0),
      pay: Number(row.pay || 0),
    }]
  })
  if (rows.length > 0 || (va.by_client ?? []).some((row) => row.pay_type === "package")) return rows
  if (!va.entries.length) return []
  const rate = Number(va.entries.find((entry) => Number(entry.rate) > 0)?.rate || 0)
  return [{
    clientId: "",
    name: va.entries[0]?.client_name || "Hourly",
    hours: Number(va.total_hours || 0),
    rate,
    pay: Number(va.total_pay || 0),
  }]
}

type ActionFilter = "action" | "approve" | "pay" | "paid"

function byName(a: PayrollVA, b: PayrollVA) {
  return a.va_name.localeCompare(b.va_name)
}

function hoursLabel(value?: string | number | null) {
  const hours = Number(value ?? 0)
  return `${Number.isFinite(hours) ? hours.toFixed(2) : "0.00"} hrs`
}

export function ReturnSheet({
  name,
  noteId,
  note,
  busy,
  onNote,
  onClose,
  onSend,
}: {
  name: string
  noteId: string
  note: string
  busy?: boolean
  onNote: (note: string) => void
  onClose: () => void
  onSend: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Return ${name} for fixes`}
        data-testid="return-sheet"
        className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-xl text-[#B8325F]">Return for fixes</h3>
        <p className="mt-1 text-sm">{name}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {RETURN_NOTES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={note === item}
              className={cn(
                "min-h-11 rounded-full border px-3 text-[11px] font-semibold uppercase tracking-wide",
                note === item ? "border-[#B8325F] bg-[#B8325F] text-white" : "border-[#F7C6D3] bg-white text-[#B8325F]",
              )}
              onClick={() => onNote(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-[#B8325F]" htmlFor={`return-${noteId}`}>
          Note for the VA (optional)
        </label>
        <textarea
          id={`return-${noteId}`}
          value={note}
          onChange={(event) => onNote(event.target.value)}
          rows={2}
          className="mt-1 min-h-11 w-full rounded-xl border border-[#F7C6D3] bg-white px-3 py-2 text-base"
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <TapButton className="bg-[#B8325F] text-white" disabled={busy || !note.trim()} onClick={onSend}>
            {busy ? "Sending" : "Send back"}
          </TapButton>
          <TapButton className="border border-[#F7C6D3] bg-white text-[#B8325F]" onClick={onClose}>
            Cancel
          </TapButton>
        </div>
      </div>
    </div>
  )
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
  onPackageChoice,
  onPackageAmount,
  onChangeRate,
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
  onPackageChoice: (clientId: string, choice: "half" | "full" | "skip") => void
  onPackageAmount: (clientId: string, amount: number) => void
  onChangeRate: (clientId: string, rate: number) => void
}) {
  const [returnOpen, setReturnOpen] = useState(false)
  const [note, setNote] = useState("")
  const [amountFor, setAmountFor] = useState<string | null>(null)
  const [amountDraft, setAmountDraft] = useState("")
  const [rateFor, setRateFor] = useState<string | null>(null)
  const [rateDraft, setRateDraft] = useState("")
  const packages = packageRows(va, periodStart, periodEnd)
  const hourly = hourlyRows(va)
  const locked = !!va.is_paid
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
      {showPricing && packages.map((row) => (
        <div key={row.clientId} className="mt-3" data-testid="package-pay">
          <p className="text-[11px] font-semibold text-muted-foreground">{row.name}</p>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5" role="group" aria-label={`${row.name} package pay`}>
            {([
              ["half", "Half month"],
              ["full", "Full month"],
              ["skip", "Skip"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={row.choice === id}
                disabled={locked}
                className={cn(
                  "min-h-11 rounded-full px-1.5 text-[13px] font-semibold leading-tight",
                  row.choice === id ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground",
                )}
                onClick={() => onPackageChoice(row.clientId, id)}
              >
                {label}
              </button>
            ))}
          </div>
          {!locked && amountFor !== row.clientId && (
            <button type="button" className="mt-1 min-h-11 text-[11px] font-semibold text-primary underline" onClick={() => { setAmountFor(row.clientId); setAmountDraft(row.amount.toFixed(2)) }}>
              Change amount
            </button>
          )}
          {amountFor === row.clientId && (
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              aria-label={`${row.name} amount this period`}
              className="mt-1 h-11 w-full max-w-[9rem] rounded-lg border border-border bg-white px-2 text-base"
              value={amountDraft}
              onChange={(event) => setAmountDraft(event.target.value)}
              onBlur={() => {
                const parsed = Number(amountDraft)
                if (Number.isFinite(parsed) && parsed >= 0) onPackageAmount(row.clientId, parsed)
                setAmountFor(null)
              }}
            />
          )}
        </div>
      ))}
      {showPricing && hourly.map((row) => (
        <div key={`${row.clientId}-${row.name}`} className="mt-3" data-testid="hourly-pay">
          <p className="text-sm">
            {formatCurrency(row.rate, va.currency)} x {row.hours.toFixed(2)} hrs = {formatCurrency(row.pay, va.currency)}
          </p>
          {!locked && rateFor !== `${row.clientId}:${row.name}` && (
            <button type="button" className="min-h-11 text-[11px] font-semibold text-primary underline" onClick={() => { setRateFor(`${row.clientId}:${row.name}`); setRateDraft(row.rate ? row.rate.toFixed(2) : "") }}>
              Change rate
            </button>
          )}
          {rateFor === `${row.clientId}:${row.name}` && (
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              aria-label={`Change rate for ${va.va_name}`}
              className="mt-1 h-11 w-full max-w-[9rem] rounded-lg border border-border bg-white px-2 text-base"
              value={rateDraft}
              onChange={(event) => setRateDraft(event.target.value)}
              onBlur={() => {
                const parsed = Number(rateDraft)
                if (Number.isFinite(parsed) && parsed >= 0) onChangeRate(row.clientId, parsed)
                setRateFor(null)
              }}
            />
          )}
        </div>
      ))}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <TapButton className="border border-[#F7C6D3] bg-white text-[#B8325F]" onClick={onView} aria-label={`View timesheet ${va.va_name}`}>
          View timesheet
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
        {canReturn && (
          <TapButton
            className={cn("border border-[#B8325F] bg-white text-[#B8325F]", !canPay && "col-span-2")}
            aria-label={`Return for fixes ${va.va_name}`}
            onClick={() => setReturnOpen(true)}
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
      {returnOpen && (
        <ReturnSheet
          name={va.va_name}
          noteId={va.va_id}
          note={note}
          busy={returning}
          onNote={setNote}
          onClose={() => setReturnOpen(false)}
          onSend={() => onReturn(note.trim())}
        />
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
  onPackageChoice,
  onPackageAmount,
  onChangeRate,
  onSetAllHalf,
  showSetAllHalf,
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
  onPackageChoice: (va: PayrollVA, clientId: string, choice: "half" | "full" | "skip") => void
  onPackageAmount: (va: PayrollVA, clientId: string, amount: number) => void
  onChangeRate: (va: PayrollVA, clientId: string, rate: number) => void
  onSetAllHalf?: () => void
  showSetAllHalf?: boolean
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
      <h2 className="text-2xl text-[#B8325F]">Needs your action</h2>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Timesheet filters">
        {chip("approve", `To approve (${approve.length})`, "filter-approve")}
        {showPricing
          ? chip("pay", `To pay (${pay.length})`, "filter-pay")
          : chip("pay", `Approved (${pay.length})`, "filter-pay")}
        {chip("paid", `Paid (${paid.length})`, "filter-paid")}
      </div>
      {showSetAllHalf && onSetAllHalf && (
        <button type="button" className="mt-3 h-11 min-h-11 w-full rounded-xl bg-[#E8578A] px-3 text-[11px] font-semibold uppercase tracking-wide text-white" onClick={onSetAllHalf}>
          Set all packages to half
        </button>
      )}
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
            onPackageChoice={(clientId, choice) => onPackageChoice(va, clientId, choice)}
            onPackageAmount={(clientId, amount) => onPackageAmount(va, clientId, amount)}
            onChangeRate={(clientId, rate) => onChangeRate(va, clientId, rate)}
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
            onPackageChoice={(clientId, choice) => onPackageChoice(va, clientId, choice)}
            onPackageAmount={(clientId, amount) => onPackageAmount(va, clientId, amount)}
            onChangeRate={(clientId, rate) => onChangeRate(va, clientId, rate)}
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
            onPackageChoice={(clientId, choice) => onPackageChoice(va, clientId, choice)}
            onPackageAmount={(clientId, amount) => onPackageAmount(va, clientId, amount)}
            onChangeRate={(clientId, rate) => onChangeRate(va, clientId, rate)}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
