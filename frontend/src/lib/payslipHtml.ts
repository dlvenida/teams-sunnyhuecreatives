import type { PayslipClient, PayslipModel } from "@/lib/payslip"
import { formatCurrency, formatInvoiceDate } from "@/lib/utils"

/** Bookkeeper invoice standard. No em dashes. US Letter. No overflow:hidden. */
const CSS = `
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body {
    font-family: "DM Sans", "Noto Sans", sans-serif;
    color: #3D2B33;
    font-size: 11px;
    line-height: 1.4;
  }
  .page {
    width: 8.5in;
    min-height: 11in;
    display: flex;
    flex-direction: column;
    background: #ffffff;
    break-after: page;
    page-break-after: always;
  }
  .page:last-child { break-after: auto; page-break-after: auto; }
  .toprule { height: 8px; background: #F7C6D3; }
  .header {
    background: #FDF2F5;
    padding: 14px 0.62in 12px;
  }
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .logo { height: 92px; width: auto; display: block; }
  .dates { text-align: right; }
  .kicker {
    font-family: Montserrat, sans-serif;
    font-weight: 600;
    font-size: 8px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #B8325F;
    margin: 0 0 3px;
  }
  .date-value {
    font-family: "DM Sans", "Noto Sans", sans-serif;
    font-weight: 700;
    font-size: 13px;
    color: #3D2B33;
    margin: 0 0 10px;
  }
  h1 {
    font-family: "Instrument Serif", serif;
    font-style: italic;
    font-weight: 400;
    font-size: 42px;
    line-height: 1;
    color: #E8578A;
    margin: 8px 0 4px;
  }
  .subtitle { margin: 0; font-size: 12px; color: #3D2B33; }
  .agency { margin: 3px 0 0; font-size: 12px; color: #E8578A; }
  .example {
    margin: 8px 0 0;
    font-family: Montserrat, sans-serif;
    font-weight: 600;
    font-size: 9px;
    letter-spacing: 0.04em;
    text-transform: none;
    color: #B8325F;
  }
  .body { padding: 14px 0.62in 6px; flex: 1; }
  .greeting {
    font-family: "Instrument Serif", serif;
    font-style: italic;
    font-weight: 400;
    font-size: 20px;
    color: #B8325F;
    margin: 0 0 6px;
  }
  .lede { margin: 0 0 12px; font-size: 12px; color: #3D2B33; max-width: 6.6in; }
  .banner {
    background: #B57B90;
    color: #ffffff;
    border-radius: 14px;
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin: 0 0 14px;
  }
  .banner-amount {
    font-family: "Instrument Serif", serif;
    font-style: italic;
    font-weight: 400;
    font-size: 36px;
    line-height: 1;
    margin: 0;
    white-space: nowrap;
  }
  .banner-due { margin: 4px 0 0; font-size: 12px; }
  .banner-side { text-align: right; }
  .banner .kicker { color: rgba(255,255,255,0.88); }
  .banner-period { margin: 0; font-size: 15px; font-weight: 700; white-space: nowrap; }
  .parties { display: flex; gap: 36px; margin: 0 0 12px; }
  .party { flex: 1; }
  .party h2 {
    font-family: "Instrument Serif", serif;
    font-style: italic;
    font-weight: 400;
    font-size: 22px;
    color: #E8578A;
    margin: 0 0 8px;
  }
  .party p { margin: 0 0 10px; font-size: 13px; font-weight: 700; white-space: pre-line; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { padding: 10px 10px; vertical-align: top; }
  thead th {
    font-family: Montserrat, sans-serif;
    font-weight: 600;
    font-size: 8px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #B8325F;
    border-bottom: 1px solid #F7C6D3;
    padding-top: 4px;
    padding-bottom: 8px;
  }
  tbody td { border-bottom: 1px solid #F7C6D3; font-size: 12px; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .name { font-weight: 700; font-size: 13px; margin: 0; }
  .sub {
    font-family: "Instrument Serif", serif;
    font-style: italic;
    color: #E8578A;
    font-size: 12px;
    margin: 2px 0 0;
  }
  .total-wrap { text-align: right; margin-top: 16px; }
  .total-amount {
    font-family: "Instrument Serif", serif;
    font-style: italic;
    font-weight: 400;
    font-size: 36px;
    color: #E8578A;
    margin: 2px 0 0;
    white-space: nowrap;
  }
  .total-hint { margin: 4px 0 0; font-size: 11px; color: #3D2B33; }
  .note {
    background: #FDF2F5;
    border-left: 4px solid #E8578A;
    border-radius: 4px;
    padding: 12px 14px;
    margin-top: 12px;
  }
  .note h3 { margin: 4px 0; font-size: 13px; font-weight: 700; }
  .note p { margin: 0; font-size: 11.5px; color: #3D2B33; }
  .footer {
    text-align: center;
    font-size: 9px;
    color: #B8325F;
    padding: 14px 0.62in 16px;
    margin-top: auto;
  }
  .break-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 8px; }
  .break-head h1 { margin: 0; font-size: 36px; }
  .break-meta { text-align: right; font-size: 12px; margin: 0; }
  .client-name {
    font-family: "Instrument Serif", serif;
    font-style: italic;
    font-weight: 400;
    font-size: 20px;
    color: #E8578A;
    margin: 16px 0 4px;
  }
  .task-name { font-weight: 700; margin: 0; font-size: 12.5px; }
  .task-desc { margin: 3px 0 0; font-size: 11px; color: #3D2B33; }
  .subtotal { text-align: right; font-size: 11px; color: #3D2B33; margin: 6px 0 2px; }
  .grand {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-top: 1px solid #F7C6D3;
    margin-top: 16px;
    padding-top: 10px;
  }
  .grand span:first-child {
    font-family: "Instrument Serif", serif;
    font-style: italic;
    font-size: 22px;
    color: #E8578A;
  }
  .grand span:last-child { font-weight: 700; font-size: 14px; white-space: nowrap; }
`

function esc(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\u2014/g, ", ")
    .replace(/\u2013/g, "-")
}

function money(amount: number, currency: string) {
  return esc(formatCurrency(amount, currency === "PHP" ? "PHP" : "USD"))
}

function hours(n: number) {
  return n.toFixed(2)
}

function periodLabel(start: string, end: string) {
  const a = new Date(start + "T00:00:00")
  const b = new Date(end + "T00:00:00")
  const month = a.toLocaleDateString("en-US", { month: "long" })
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${month} ${a.getDate()}-${b.getDate()}, ${b.getFullYear()}`
  }
  const left = a.toLocaleDateString("en-US", { month: "long", day: "numeric" })
  const right = b.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  return `${left} - ${right}`
}

function monthLabel(start: string) {
  return new Date(start + "T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

function shortDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function minusMoney(amount: number, currency: string) {
  return `-${money(amount, currency)}`
}

function deductionLines(client: PayslipClient, currency: string) {
  if (!client.deduction || client.deduction <= 0) return ""
  const packageAmount = client.originalAmount ?? client.amount + client.deduction
  const reason = client.note ? ` (${esc(client.note)})` : ""
  return [
    `<p class="sub">Fixed Package ${money(packageAmount, currency)}</p>`,
    `<p class="sub">Deduction${reason} ${minusMoney(client.deduction, currency)}</p>`,
    `<p class="sub">Pay ${money(client.amount, currency)}</p>`,
  ].join("")
}

function rateText(client: PayslipClient, currency: string) {
  if (client.payType === "package" && client.deduction) return "Fixed Package"
  if (client.payType === "package") return client.adjusted ? "Fixed Package, Adjusted" : "Fixed Package"
  if (client.rate == null) return ""
  return `${money(client.rate, currency)}/hr`
}

function payableClients(slip: PayslipModel) {
  return slip.clients.filter((client) => !client.skipped)
}

function subtotalLine(client: PayslipClient, currency: string) {
  const hrs = `${hours(client.hours)} hrs`
  const amt = money(client.amount, currency)
  if (client.payType === "package" && client.deduction) {
    const packageAmount = client.originalAmount ?? client.amount + client.deduction
    const reason = client.note ? ` (${client.note})` : ""
    return `${client.name} subtotal · ${hrs} · Fixed Package ${money(packageAmount, currency)} · Deduction${reason} -${money(client.deduction, currency)} · Pay ${amt}`
  }
  if (client.payType === "package") {
    const label = client.adjusted ? "Fixed Package, Adjusted" : "Fixed Package"
    const was = client.adjusted && client.originalAmount != null ? ` (was ${money(client.originalAmount, currency)})` : ""
    return `${client.name} subtotal · ${hrs} · ${label} · ${amt}${was}`
  }
  if (client.rate == null) {
    return `${client.name} subtotal · ${hrs} · ${amt}`
  }
  return `${client.name} subtotal · ${hrs} × ${money(client.rate, currency)}/hr · ${amt}`
}

function clientBlurb(client: PayslipClient) {
  const names = [...new Set(client.tasks.map((t) => t.task))].slice(0, 3)
  const extra = client.tasks.length > 3 ? `, +${client.tasks.length - 3} more` : ""
  return names.join(", ") + extra
}

function fontFaceCss(origin: string) {
  const o = origin.replace(/\/$/, "")
  return `
    @font-face { font-family: "Instrument Serif"; src: url("${o}/fonts/InstrumentSerif-Italic.ttf") format("truetype"); font-weight: 400; font-style: italic; }
    @font-face { font-family: "DM Sans"; src: url("${o}/fonts/DMSans.ttf") format("truetype"); font-weight: 100 900; font-style: normal; }
    @font-face { font-family: "Montserrat"; src: url("${o}/fonts/Montserrat.ttf") format("truetype"); font-weight: 100 900; font-style: normal; }
    @font-face { font-family: "Noto Sans"; src: url("${o}/fonts/NotoSans-Regular.ttf") format("truetype"); font-weight: 400; font-style: normal; }
  `
}

export function browserPayslipAssets() {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return {
    logoSrc: `${origin}/brand/sunnyhue-logo.png`,
    fontCss: fontFaceCss(origin),
  }
}

function summaryPage(slip: PayslipModel, logoSrc: string, pageNo: number, pageCount: number) {
  const first = slip.vaName.split(" ")[0]
  const period = periodLabel(slip.periodStart, slip.periodEnd)
  const month = monthLabel(slip.periodStart)
  const visible = payableClients(slip)
  const visibleHours = visible.reduce((sum, client) => sum + client.hours, 0)
  const rows = visible.map((client) => `
    <tr>
      <td>
        <p class="name">${esc(client.name)}</p>
        ${client.deduction ? deductionLines(client, slip.currency) : `<p class="sub">${[
          esc(clientBlurb(client)),
          client.adjusted && client.originalAmount != null ? `was ${money(client.originalAmount, slip.currency)}` : "",
          client.note ? esc(client.note) : "",
        ].filter(Boolean).join(" · ")}</p>`}
      </td>
      <td class="num">${hours(client.hours)}</td>
      <td class="num">${rateText(client, slip.currency)}</td>
      <td class="num">${money(client.amount, slip.currency)}</td>
    </tr>`).join("")
  return `
  <section class="page">
    <div class="toprule"></div>
    <header class="header">
      <div class="header-row">
        <img class="logo" src="${esc(logoSrc)}" alt="Sunny Hue Creatives" />
        <div class="dates">
          <p class="kicker">Payslip date</p>
          <p class="date-value">${esc(formatInvoiceDate(slip.payslipDate))}</p>
          <p class="kicker">Pay period</p>
          <p class="date-value">${esc(period)}</p>
        </div>
      </div>
      <h1>Payslip</h1>
      <p class="subtitle">VA payroll, prepared for ${esc(slip.vaName)}</p>
      <p class="agency">${esc(slip.companyName)} · ${esc(month)}</p>
      ${slip.exampleNote ? `<p class="example">${esc(slip.exampleNote)}</p>` : ""}
    </header>
    <div class="body">
      <p class="greeting">Hi ${esc(first)}! Here's your payslip.</p>
      <p class="lede">This covers ${esc(period)}. Each client is summarized below. The task breakdown, with date, task, description, hours, and amount, is on the next page.</p>
      <div class="banner">
        <div>
          <p class="banner-amount">${money(slip.totalPay, slip.currency)}</p>
          <p class="banner-due">total pay this period</p>
        </div>
        <div class="banner-side">
          <p class="kicker">Pay period</p>
          <p class="banner-period">${esc(period)}</p>
        </div>
      </div>
      <div class="parties">
        <div class="party">
          <h2>Paid to</h2>
          <p class="kicker">Name</p>
          <p>${esc(slip.vaName)}</p>
        </div>
        <div class="party">
          <h2>From</h2>
          <p class="kicker">Business</p>
          <p>${esc(slip.companyName)}
${esc(slip.location)}</p>
        </div>
      </div>
      <p class="kicker">Summary</p>
      <table>
        <colgroup>
          <col style="width:52%" />
          <col style="width:14%" />
          <col style="width:17%" />
          <col style="width:17%" />
        </colgroup>
        <thead>
          <tr>
            <th>Description</th>
            <th class="num">Hours</th>
            <th class="num">Rate</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="total-wrap">
        <p class="kicker">Total</p>
        <p class="total-amount">${money(slip.totalPay, slip.currency)}</p>
        <p class="total-hint">${hours(visibleHours)} hrs · ${esc(slip.currency)} · Task breakdown on the next page</p>
      </div>
      <div class="note">
        <p class="kicker">Note</p>
        <h3>How this payslip is arranged</h3>
        <p>One row per client on this page. Page 2 lists every task: date, task name, description of the work, hours, and amount (hours times the rate for that client).</p>
      </div>
    </div>
    <p class="footer">Payslip · ${esc(slip.vaName)} · ${esc(slip.companyName)} · ${esc(month)} · Page ${pageNo} of ${pageCount}</p>
  </section>`
}

function detailPage(slip: PayslipModel, pageNo: number, pageCount: number) {
  const period = periodLabel(slip.periodStart, slip.periodEnd)
  const month = monthLabel(slip.periodStart)
  const clients = payableClients(slip).map((client) => {
    const tasks = client.tasks.map((task) => `
      <tr>
        <td class="num" style="text-align:left; white-space:nowrap">${esc(shortDate(task.date))}</td>
        <td>
          <p class="task-name">${esc(task.task)}</p>
          ${task.description ? `<p class="task-desc">${esc(task.description)}</p>` : ""}
        </td>
        <td class="num">${hours(task.hours)}</td>
        <td class="num">${client.payType === "package" ? "" : money(task.amount, slip.currency)}</td>
      </tr>`).join("")
    return `
      <h2 class="client-name">${esc(client.name)}</h2>
      <table>
        <colgroup>
          <col style="width:18%" />
          <col style="width:48%" />
          <col style="width:17%" />
          <col style="width:17%" />
        </colgroup>
        <thead>
          <tr>
            <th>Date</th>
            <th>Task</th>
            <th class="num">Hours</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${tasks}</tbody>
      </table>
      <p class="subtotal">${esc(subtotalLine(client, slip.currency))}</p>`
  }).join("")
  const pay = slip.paymentLabel
    ? `Payable to ${slip.vaName}. ${slip.paymentLabel}.`
    : `Payable to ${slip.vaName} from ${slip.companyName}.`
  return `
  <section class="page">
    <div class="toprule"></div>
    <div class="body">
      <div class="break-head">
        <h1>Task breakdown</h1>
        <div>
          <p class="break-meta">${esc(slip.vaName)}</p>
          <p class="break-meta">${esc(period)}</p>
        </div>
      </div>
      ${clients}
      <div class="grand">
        <span>Grand total</span>
        <span>${hours(payableClients(slip).reduce((sum, client) => sum + client.hours, 0))} hrs · ${money(slip.totalPay, slip.currency)}</span>
      </div>
      <div class="note">
        <p class="kicker">Payment</p>
        <h3>Payout details</h3>
        <p>${esc(pay)}</p>
      </div>
    </div>
    <p class="footer">Payslip · ${esc(slip.vaName)} · ${esc(slip.companyName)} · ${esc(month)} · Page ${pageNo} of ${pageCount}</p>
  </section>`
}

export function renderPayslipHtml(
  slips: PayslipModel[],
  assets?: { logoSrc?: string; fontCss?: string },
) {
  const browser = browserPayslipAssets()
  const logoSrc = assets?.logoSrc || browser.logoSrc
  const fontCss = assets?.fontCss || browser.fontCss
  const pageCount = Math.max(slips.length, 1) * 2
  const pages = slips.flatMap((slip, i) => [
    summaryPage(slip, logoSrc, i * 2 + 1, pageCount),
    detailPage(slip, i * 2 + 2, pageCount),
  ]).join("")
  const title = slips.length === 1 ? `Payslip ${slips[0].vaName}` : "VA payslips"
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>${fontCss}\n${CSS}</style>
</head>
<body>
${pages}
</body>
</html>`
}
