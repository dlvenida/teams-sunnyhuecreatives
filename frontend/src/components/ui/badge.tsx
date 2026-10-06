import { cn } from "@/lib/utils"

interface BadgeProps {
  children: React.ReactNode
  variant?: "default" | "success" | "warning" | "danger" | "php" | "usd"
  className?: string
}

const variants = {
  default: "bg-muted text-muted-foreground",
  success: "bg-green-100 text-green-800",
  warning: "bg-orange-100 text-orange-800",
  danger: "bg-red-100 text-red-800",
  php: "bg-blue-100 text-blue-800",
  usd: "bg-emerald-100 text-emerald-800",
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", variants[variant], className)}>
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeProps["variant"]> = {
    submitted: "warning",
    approved: "success",
    rejected: "danger",
    invoiced: "default",
    unpaid: "warning",
    paid: "success",
  }
  return <Badge variant={map[status] || "default"}>{status}</Badge>
}
