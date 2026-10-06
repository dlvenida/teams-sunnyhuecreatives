import { cn } from "@/lib/utils"

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  className?: string
}

export function StatCard({ title, value, subtitle, className }: StatCardProps) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 shadow-sm animate-fade-in", className)}>
      <p className="text-[11px] text-muted-foreground">{title}</p>
      <p className="mt-0.5 text-lg font-bold tracking-tight text-foreground">{value}</p>
      {subtitle && <p className="mt-0.5 text-[10px] text-muted-foreground">{subtitle}</p>}
    </div>
  )
}

export function ProfitBar({ items }: { items: { label: string; value: string; highlight?: boolean }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface p-5 text-surface-foreground md:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="text-center">
          <p className="text-[10px] opacity-70">{item.label}</p>
          <p className={cn("mt-0.5 text-sm font-semibold", item.highlight && "text-primary")}>{item.value}</p>
        </div>
      ))}
    </div>
  )
}
