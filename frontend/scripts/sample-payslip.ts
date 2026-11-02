/**
 * Renders the labelled example payslip with the bookkeeper HTML/CSS,
 * then prints it to PDF with headless Chrome.
 * Run from frontend/: npx vite-node scripts/sample-payslip.ts
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { renderPayslipHtml } from "../src/lib/payslipHtml"
import type { PayslipModel } from "../src/lib/payslip"

function dataUrl(file: string, mime: string) {
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`
}

const fontCss = `
@font-face { font-family: "Instrument Serif"; src: url("${dataUrl("public/fonts/InstrumentSerif-Italic.ttf", "font/ttf")}") format("truetype"); font-weight: 400; font-style: italic; }
@font-face { font-family: "DM Sans"; src: url("${dataUrl("public/fonts/DMSans.ttf", "font/ttf")}") format("truetype"); font-weight: 100 900; font-style: normal; }
@font-face { font-family: "Montserrat"; src: url("${dataUrl("public/fonts/Montserrat.ttf", "font/ttf")}") format("truetype"); font-weight: 100 900; font-style: normal; }
@font-face { font-family: "Noto Sans"; src: url("${dataUrl("public/fonts/NotoSans-Regular.ttf", "font/ttf")}") format("truetype"); font-weight: 400; font-style: normal; }
`

const slip: PayslipModel = {
  vaName: "Aria Santos (EXAMPLE)",
  currency: "USD",
  payslipDate: "2026-11-01",
  periodStart: "2026-10-16",
  periodEnd: "2026-10-31",
  companyName: "Sunny Hue Creatives",
  location: "Dumaguete City, Philippines",
  paymentLabel: "Wise, aria.example@sunnyhue.test",
  exampleNote: "Example data. Not a real payment",
  totalHours: 7.42,
  totalPay: 79.7,
  clients: [
    {
      name: "The Executive Geek (example client)",
      hours: 2.67,
      rate: 10,
      payType: "hourly",
      amount: 26.7,
      tasks: [
        {
          date: "2026-10-19",
          task: "2027 Calendar Graphic Draft",
          description: "Prepared the initial draft of the 2027 calendar graphic, setting layout, color, and type so the client could review the direction.",
          hours: 0.67,
          amount: 6.7,
        },
        {
          date: "2026-10-22",
          task: "2027 Calendar Graphic Final",
          description: "Built the final 2027 calendar artwork from the approved direction and exported the delivery files.",
          hours: 2,
          amount: 20,
        },
      ],
    },
    {
      name: "EmpowerHQ Consulting (example client)",
      hours: 3.75,
      rate: 12,
      payType: "hourly",
      amount: 45,
      tasks: [
        {
          date: "2026-10-20",
          task: "Inbox and email triage",
          description: "Sorted the client inbox, drafted replies, and flagged two items that needed the founder.",
          hours: 1.5,
          amount: 18,
        },
        {
          date: "2026-10-24",
          task: "Weekly report preparation",
          description: "Pulled the week's metrics into the standing report and wrote the short summary at the top.",
          hours: 2.25,
          amount: 27,
        },
      ],
    },
    {
      name: "Nonprofit Finance Brand (example client)",
      hours: 1,
      rate: 8,
      payType: "hourly",
      amount: 8,
      tasks: [
        {
          date: "2026-10-21",
          task: "Social captions",
          description: "Wrote three captions for the week's educational posts and matched them to the content calendar.",
          hours: 1,
          amount: 8,
        },
      ],
    },
  ],
}

const html = renderPayslipHtml([slip], {
  logoSrc: dataUrl("public/brand/sunnyhue-logo.png", "image/png"),
  fontCss,
})
if (html.includes("\u2014") || html.includes("\u2013")) {
  throw new Error("Payslip HTML still contains an em dash or en dash")
}
const htmlPath = resolve("/tmp/sample-va-payslip.html")
writeFileSync(htmlPath, html)
const outDir = resolve("../artifacts")
mkdirSync(outDir, { recursive: true })
const pdfPath = resolve(outDir, "sample-va-payslip.pdf")
try {
  execFileSync("/usr/local/bin/google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-extensions",
    "--user-data-dir=/tmp/chrome-payslip-profile",
    "--no-pdf-header-footer",
    "--virtual-time-budget=8000",
    `--print-to-pdf=${pdfPath}`,
    htmlPath,
  ], { stdio: "inherit", timeout: 20000 })
} catch (err) {
  // Chrome sometimes stays up after the PDF is written.
  if (!readFileSync(pdfPath).length) throw err
}
console.log(`wrote ${pdfPath}`)
