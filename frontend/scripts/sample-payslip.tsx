/**
 * Renders a labelled example VA payslip (not live payroll) for review.
 * Run: npx vite-node scripts/sample-payslip.tsx
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { Font, pdf } from "@react-pdf/renderer"
import { PayslipDocument } from "../src/components/pdf/PayslipDocument"
import type { PayslipModel } from "../src/lib/payslip"

Font.register({
  family: "NotoSans",
  src: resolve("public/fonts/NotoSans-Regular.ttf"),
})

const slip: PayslipModel = {
  vaName: "Aria Santos (EXAMPLE)",
  currency: "USD",
  payslipDate: "2026-11-01",
  periodStart: "2026-10-16",
  periodEnd: "2026-10-31",
  companyName: "Sunny Hue Creatives",
  location: "Dumaguete City, Philippines",
  paymentLabel: "Wise · aria.example@sunnyhue.test",
  exampleNote: "EXAMPLE DATA — not a real payment. Sample tasks, rates, and amounts for layout review.",
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

const blob = await pdf(<PayslipDocument slips={[slip]} />).toBlob()
const bytes = Buffer.from(await blob.arrayBuffer())
const outDir = resolve("../artifacts")
mkdirSync(outDir, { recursive: true })
const out = resolve(outDir, "sample-va-payslip.pdf")
writeFileSync(out, bytes)
console.log(`wrote ${out} (${bytes.length} bytes)`)
