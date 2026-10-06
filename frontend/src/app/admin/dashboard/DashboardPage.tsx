import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { DashboardSummary } from "@/lib/types"
import { ProfitBar, StatCard } from "@/components/magicui/stat-card"
import { formatCurrency } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { useCssVar } from "@/hooks/useCssVar"
import { useDisplaySettings } from "@/hooks/useDisplaySettings"

import { Check, X } from "lucide-react"

export function DashboardPage() {
  const chartColor = useCssVar("--chart", "#6366f1")
  const { showPricing } = useDisplaySettings()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardSummary>("/dashboard/summary"),
  })

  const approve = useMutation({
    mutationFn: (id: string) => apiFetch(`/work-logs/${id}/approve`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  })

  const reject = useMutation({
    mutationFn: (id: string) => apiFetch(`/work-logs/${id}/reject`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  })

  if (isLoading || !data) return <p>Loading dashboard...</p>

  const profit = parseFloat(data.estimated_profit)

  const profitItems = showPricing
    ? [
        { label: "Total Invoiced", value: formatCurrency(data.total_invoiced) },
        { label: "Paid by Clients", value: formatCurrency(data.paid_by_clients) },
        { label: "Total VA Payout", value: formatCurrency(data.total_va_payout) },
        { label: "Est. Profit", value: formatCurrency(data.estimated_profit), highlight: profit >= 0 },
        { label: "Pending", value: String(data.pending_entries) },
        { label: "Approved Hrs", value: data.approved_hours },
      ]
    : [
        { label: "Pending", value: String(data.pending_entries) },
        { label: "Approved Hrs", value: data.approved_hours },
        { label: "Active Clients", value: String(data.active_clients) },
        { label: "Active VAs", value: String(data.active_vas) },
        { label: "Invoices", value: String(data.invoices_issued) },
        { label: "Unpaid", value: String(data.unpaid_invoices) },
      ]

  return (
    <div className="space-y-6 animate-fade-in">
      <ProfitBar items={profitItems} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Clients" value={data.active_clients} />
        <StatCard title="Invoices Issued" value={data.invoices_issued} subtitle={`${data.unpaid_invoices} unpaid`} />
        {showPricing ? (
          <StatCard title="This Week's VA Pay" value={formatCurrency(data.this_week_va_pay)} />
        ) : (
          <StatCard title="Approved Hours" value={data.approved_hours} subtitle="Pricing hidden" />
        )}
        <StatCard title="Active VAs" value={data.active_vas} />
      </div>

      {data.pending_logs.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-lg font-semibold">Pending Approval</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="p-2">Date</th>
                  <th className="p-2">VA</th>
                  <th className="p-2">Client</th>
                  <th className="p-2">Hours</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.pending_logs.map((log) => (
                  <tr key={log.id} className="border-b">
                    <td className="p-2">{log.work_date}</td>
                    <td className="p-2">{log.va_name}</td>
                    <td className="p-2">{log.client_name}</td>
                    <td className="p-2">{log.hours}</td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="success" onClick={() => approve.mutate(log.id)}>
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => reject.mutate(log.id)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-lg font-semibold">Hours by Client</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.hours_by_client} layout="vertical">
              <XAxis type="number" />
              <YAxis type="category" dataKey="client" width={120} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="hours" fill={chartColor} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-lg font-semibold">VA Pay This Week</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.va_pay_this_week.map((va) => (
              <StatCard
                key={va.va_id}
                title={va.name}
                value={showPricing ? formatCurrency(va.pay, va.currency) : `${va.hours} hrs`}
                subtitle={showPricing ? `${va.hours} hrs` : "Pay hidden"}
              />
            ))}
            {data.va_pay_this_week.length === 0 && <p className="text-sm text-muted-foreground">No approved hours this week.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
