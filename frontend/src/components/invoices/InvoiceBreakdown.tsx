import { formatCurrency } from "@/lib/utils"

type Line = {
  description: string
  amount: string | number
  billing_type?: string | null
  line_kind?: string | null
}

function kindOf(line: Line) {
  return line.line_kind || line.billing_type || ""
}

export function InvoiceBreakdown({ lines, currency = "USD" }: { lines: Line[]; currency?: string }) {
  const hourly = lines.filter((line) => kindOf(line) === "hourly_task")
  const rest = lines.filter((line) => kindOf(line) !== "hourly_task")
  const subtotal = hourly.reduce((sum, line) => sum + Number(line.amount || 0), 0)
  const total = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0)
  return (
    <div className="rounded-xl border" aria-label="Invoice preview">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-muted-foreground">
            <th className="p-2.5">Description</th>
            <th className="p-2.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {hourly.map((line, index) => (
            <tr key={`h-${index}`} className="border-b">
              <td className="p-2.5 whitespace-pre-wrap">{line.description}</td>
              <td className="p-2.5 text-right">{formatCurrency(line.amount, currency)}</td>
            </tr>
          ))}
          {hourly.length > 0 && (
            <tr className="border-b bg-muted/20">
              <td className="p-2.5 font-semibold">Hourly subtotal</td>
              <td className="p-2.5 text-right font-semibold">{formatCurrency(subtotal, currency)}</td>
            </tr>
          )}
          {rest.map((line, index) => (
            <tr key={`r-${index}`} className="border-b">
              <td className="p-2.5 whitespace-pre-wrap">{line.description}</td>
              <td className="p-2.5 text-right">{formatCurrency(line.amount, currency)}</td>
            </tr>
          ))}
          <tr>
            <td className="p-2.5 font-semibold">Total</td>
            <td className="p-2.5 text-right font-semibold">{formatCurrency(total, currency)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
