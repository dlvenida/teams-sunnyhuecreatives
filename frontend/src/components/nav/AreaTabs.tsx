import { Link, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"

function TabRow({ tabs }: { tabs: { to: string; label: string }[] }) {
  const { pathname } = useLocation()
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => {
        const on = pathname === t.to
        return (
          <Link
            key={t.to}
            to={t.to}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-bold transition",
              on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted/60",
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}

/** Own entry vs the team list. Same hours, two jobs. */
export function TimeAreaTabs() {
  return (
    <TabRow
      tabs={[
        { to: "/admin/log-time", label: "Log my time" },
        { to: "/admin/logs", label: "Review logs" },
      ]}
    />
  )
}

/**
 * One insights area. Client hours, team activity, and the team inbox
 * used to be three lookalike sidebar items.
 */
export function InsightsTabs() {
  return (
    <TabRow
      tabs={[
        { to: "/admin/reports", label: "Client hours" },
        { to: "/admin/analytics", label: "Team activity" },
        { to: "/admin/user-reports", label: "Team inbox" },
      ]}
    />
  )
}
