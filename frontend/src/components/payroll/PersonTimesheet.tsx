import type { PayrollVA } from "@/lib/types"
import { groupByWeek } from "@/lib/weeks"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type Entry = PayrollVA["entries"][number]

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function money(amount: number, currency: string) {
  return formatCurrency(round2(amount), currency)
}

function isPackageClient(va: PayrollVA, clientName: string) {
  return (va.by_client ?? []).some((row) => row.label === clientName && row.pay_type === "package")
}

function taskLabel(entry: Entry) {
  return (entry.task_name || entry.task_title || "").trim() || "Logged work"
}

function taskNote(entry: Entry) {
  const duration = entry.entry_mode === "duration" || (!entry.start_time && !entry.end_time)
  let description = (entry.description || "").trim()
  if (duration && description && !/entered as duration/i.test(description)) {
    description = `${description} (entered as duration)`
  } else if (duration && !description) {
    description = "Entered as duration."
  }
  const task = taskLabel(entry)
  if (!description || description === task) return ""
  return description
}

function clientGroups(va: PayrollVA) {
  const currency = va.currency === "USD" ? "USD" : "PHP"
  const weeks = groupByWeek(va.entries ?? [], (entry) => entry.work_date).map((week) => {
    const buckets = new Map<string, Entry[]>()
    for (const entry of week.items) {
      const name = entry.client_name || "Client"
      const list = buckets.get(name) ?? []
      list.push(entry)
      buckets.set(name, list)
    }
    const clients = [...buckets.entries()]
      .map(([name, items]) => {
        const sorted = items.slice().sort((a, b) => a.work_date.localeCompare(b.work_date) || taskLabel(a).localeCompare(taskLabel(b)))
        const packaged = isPackageClient(va, name)
        return {
          name,
          packaged,
          items: sorted,
          hours: round2(sorted.reduce((sum, entry) => sum + Number(entry.hours || 0), 0)),
          pay: packaged ? 0 : round2(sorted.reduce((sum, entry) => sum + Number(entry.pay || 0), 0)),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    const hours = round2(clients.reduce((sum, client) => sum + client.hours, 0))
    const pay = round2(clients.reduce((sum, client) => sum + (client.packaged ? 0 : client.pay), 0))
    const hourly = clients.some((client) => !client.packaged)
    return { ...week, clients, hours, pay, hourly }
  })
  const hours = round2(weeks.reduce((sum, week) => sum + week.hours, 0))
  const pay = round2(weeks.reduce((sum, week) => sum + week.pay, 0))
  const hourly = weeks.some((week) => week.hourly)
  return { weeks, hours, pay, hourly, currency }
}

/**
 * One person's logs: week first, then the clients inside that week.
 * Admin sees rate and pay. Project Managers see hours and tasks only.
 */
export function PersonTimesheet({
  va,
  showMoney,
  onEdit,
}: {
  va: PayrollVA
  showMoney: boolean
  onEdit: (entry: Entry) => void
}) {
  const grouped = clientGroups(va)

  if (grouped.weeks.length === 0) {
    return <p className="text-sm text-muted-foreground">No time logs in this period.</p>
  }

  return (
    <div className="space-y-4">
      {grouped.weeks.map((week) => (
        <div key={week.id} id={`person-${va.va_id}-${week.id}`} className="overflow-hidden rounded-2xl border">
          <div className="flex flex-wrap items-baseline justify-between gap-2 bg-primary/10 px-3 py-2">
            <h3 className="font-display text-sm font-bold">{week.label}</h3>
            <p className="text-xs font-extrabold">
              {week.hours.toFixed(2)} hrs
              {showMoney && week.hourly ? ` · ${money(week.pay, grouped.currency)}` : ""}
            </p>
          </div>
          {week.clients.map((client) => (
            <div key={client.name} className="border-t">
              <div className="flex flex-wrap items-baseline justify-between gap-2 bg-primary/5 px-3 py-2">
                <p className="font-display text-sm font-bold text-primary">{client.name}</p>
                <p className="text-xs font-semibold">
                  {client.hours.toFixed(2)} hrs
                  {showMoney && !client.packaged ? ` · ${money(client.pay, grouped.currency)}` : ""}
                  {showMoney && client.packaged ? " · Fixed package" : ""}
                </p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-[10px] font-bold uppercase tracking-wide text-primary">
                    <th className="p-2">Date</th>
                    <th className="p-2">Task</th>
                    <th className="p-2">Hours</th>
                    {showMoney && !client.packaged && <th className="p-2">Rate</th>}
                    {showMoney && !client.packaged && <th className="p-2">Pay</th>}
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {client.items.map((entry) => {
                    const note = taskNote(entry)
                    return (
                      <tr key={entry.id} className="border-b last:border-0 align-top">
                        <td className="whitespace-nowrap p-2">{formatDate(entry.work_date)}</td>
                        <td className="p-2">
                          <span className="font-bold">{taskLabel(entry)}</span>
                          {note && <span className="mt-0.5 block text-[11px] text-muted-foreground">{note}</span>}
                        </td>
                        <td className="p-2 font-bold">{round2(Number(entry.hours || 0)).toFixed(2)}</td>
                        {showMoney && !client.packaged && <td className="p-2">{entry.rate == null || entry.rate === "" ? "—" : formatCurrency(entry.rate, grouped.currency)}</td>}
                        {showMoney && !client.packaged && <td className="p-2 font-semibold">{entry.pay == null || entry.pay === "" ? "—" : formatCurrency(entry.pay, grouped.currency)}</td>}
                        <td className="p-2 text-right">
                          <Button size="sm" variant="ghost" onClick={() => onEdit(entry)}>Edit</Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
      <p className="text-right text-sm font-extrabold">
        All weeks · {grouped.hours.toFixed(2)} hrs
        {showMoney && grouped.hourly ? ` · ${money(grouped.pay, grouped.currency)}` : ""}
      </p>
    </div>
  )
}
