import { useState } from "react"
import { OwnerFinancePanel } from "@/components/dashboard/OwnerFinancePanel"
import { StatementView } from "@/components/dashboard/StatementView"
import { Button } from "@/components/ui/button"

export function FinancePage() {
  const [view, setView] = useState<"earnings" | "statement">("earnings")
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <h1 className="font-display text-xl font-bold">Earnings & expenses</h1>
          <p className="text-xs text-muted-foreground">
            Client income in USD and PHP, VA payroll, and expenses for the dates you pick. Private to Admin. A short version also sits on Today, under the day's status.
          </p>
        </div>
        <div className="flex gap-2" role="tablist" aria-label="Earnings views">
          <Button type="button" size="sm" variant={view === "earnings" ? "gold" : "outline"} onClick={() => setView("earnings")}>Earnings</Button>
          <Button type="button" size="sm" variant={view === "statement" ? "gold" : "outline"} onClick={() => setView("statement")}>Statement</Button>
        </div>
      </div>
      {view === "statement" ? <StatementView /> : <OwnerFinancePanel />}
    </div>
  )
}
