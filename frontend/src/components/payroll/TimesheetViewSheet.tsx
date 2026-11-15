import type { ReactNode } from "react"
import type { PayrollVA } from "@/lib/types"
import { formatDate } from "@/lib/utils"
import { PersonTimesheet } from "@/components/payroll/PersonTimesheet"

/** Existing week-by-client timesheet, shown over the list so the cards stay put. */
export function TimesheetViewSheet({
  va,
  periodStart,
  periodEnd,
  showMoney,
  onClose,
  onEdit,
  actions,
}: {
  va: PayrollVA
  periodStart: string
  periodEnd: string
  showMoney: boolean
  onClose: () => void
  onEdit: (entry: PayrollVA["entries"][number]) => void
  actions: ReactNode
}) {
  const hours = Number(va.total_hours || 0)
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Timesheet for ${va.va_name}`}
        data-testid="timesheet-sheet"
        className="flex h-[100dvh] w-full max-w-3xl flex-col bg-[#FDF2F5] shadow-xl sm:h-[min(92dvh,860px)] sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#F7C6D3] bg-white px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-2xl text-[#B8325F]">{va.va_name}</h2>
            <p className="text-sm">{formatDate(periodStart)} to {formatDate(periodEnd)}</p>
            <p className="text-sm font-semibold">{hours.toFixed(2)} hrs</p>
          </div>
          <button type="button" className="h-11 min-h-11 shrink-0 rounded-xl border border-[#F7C6D3] bg-white px-3 text-[11px] font-semibold uppercase tracking-wide text-[#B8325F]" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <PersonTimesheet va={va} showMoney={showMoney} onEdit={onEdit} />
        </div>
        <div className="sticky bottom-0 border-t border-[#F7C6D3] bg-white p-3">
          {actions}
        </div>
      </div>
    </div>
  )
}
