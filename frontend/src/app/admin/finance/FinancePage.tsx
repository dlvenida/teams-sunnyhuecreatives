import { OwnerFinancePanel } from "@/components/dashboard/OwnerFinancePanel"

export function FinancePage() {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="px-1 pt-1">
        <h1 className="font-display text-xl font-bold">Earnings & expenses</h1>
        <p className="text-xs text-muted-foreground">
          Client income, VA payroll, and other expenses. Private to Admin. A short version also sits on Today, under the day's status.
        </p>
      </div>
      <OwnerFinancePanel />
    </div>
  )
}
