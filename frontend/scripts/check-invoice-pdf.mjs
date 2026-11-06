import { createServer } from "vite"
import { createRequire } from "node:module"
import { writeFileSync } from "node:fs"
import React from "react"
import { pdf } from "@react-pdf/renderer"

const require = createRequire(import.meta.url)
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs").catch(() => import("pdfjs-dist"))

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
})
const { InvoiceDocument } = await vite.ssrLoadModule("/src/components/pdf/InvoiceDocument.tsx")

const settings = {
  company_name: "Sunny Hue Creatives",
  principal_name: "Jane Laurine Venida",
  location: "Dumaguete City, Philippines",
  wise_email: "janelaurine@gmail.com",
  paypal_email: "jane@example.com",
  hide_pricing: false,
  booking_url: "",
  booking_hide_pricing: false,
  default_va_hourly_rate: "0",
}

function invoice(overrides) {
  return {
    id: "inv",
    invoice_number: "SHC-2026-004",
    client_name: "Lauren McLane | Bay Area Luxury Real Estate | eXp Icon Mentor",
    currency: "USD",
    period_label: "Nov 1 – Nov 15, 2026",
    period_start: "2026-11-01",
    period_end: "2026-11-15",
    total_hours: "3.32",
    billing_type: "hourly",
    rate: "10.00",
    amount: "0.00",
    status: "unpaid",
    payment_method: "wise",
    bank_details: "janelaurine@gmail.com",
    payment_terms_days: 7,
    issue_date: "2026-11-06",
    due_date: "2026-11-13",
    include_task_breakdown: false,
    task_breakdown: { service_title: "Social Media VA", groups: [] },
    line_items: [],
    ...overrides,
  }
}

const planning = {
  name: "Content Planning",
  billing: "hourly",
  summary: "Researched current real estate trends - and wrote the November plan.",
  detail: "Nov 3, 2026 - Content Planning - 3.32 hrs\nResearched current real estate trends - and wrote the November plan.",
  client_note: "",
  hours: "3.32",
  rate: "10.00",
  amount: "33.20",
  reference_hours: false,
  tasks: [
    {
      date: "2026-11-03",
      date_label: "Nov 3, 2026",
      name: "Content Planning",
      description: "Researched current real estate trends - and wrote the November plan.",
      hours: "3.32",
      rate: "10.00",
      amount: "33.20",
      reference_only: false,
    },
  ],
}

const pulled = {
  name: "Instagram Engagement",
  billing: "flat",
  summary: "Engaging with posts and stories for the brand.",
  detail: "Instagram package\nNov 5, 2026 - Instagram Engagement - 0.42 hrs logged\nEngaging with posts and stories for the brand.",
  client_note: "Instagram package",
  hours: "0.42",
  rate: null,
  amount: "75.00",
  reference_hours: true,
  tasks: [
    {
      date: "2026-11-05",
      date_label: "Nov 5, 2026",
      name: "Instagram Engagement",
      description: "Engaging with posts and stories for the brand.",
      hours: "0.42",
      rate: null,
      amount: "75.00",
      reference_only: true,
    },
  ],
}

const extra = {
  name: "Rush fee",
  billing: "extra",
  summary: "Rush fee",
  detail: "Rush fee",
  client_note: "",
  hours: "0.00",
  rate: null,
  amount: "12.50",
  reference_hours: false,
  tasks: [],
}

const cases = [
  {
    name: "hourly-off",
    invoice: invoice({
      amount: "33.20",
      total_hours: "3.32",
      include_task_breakdown: false,
      task_breakdown: { service_title: "Social Media VA", groups: [{ ...planning }] },
    }),
    expect: ["Social Media VA", "Content Planning", "November plan", "$33.20", "3.32", "$10.00/hr"],
    reject: ["Full task breakdown on page 2", "Task breakdown", "\u2014", "\u2013"],
  },
  {
    name: "package-only",
    invoice: invoice({
      amount: "75.00",
      total_hours: "0.00",
      rate: "0.00",
      billing_type: "fixed",
      task_breakdown: { service_title: "Social Media VA", groups: [{ ...pulled }] },
    }),
    expect: ["Instagram Engagement", "Engaging with posts", "$75.00", "Instagram package", "reference"],
    reject: ["$4.20", "\u2014", "Full task breakdown on page 2"],
  },
  {
    name: "mixed-detailed-on",
    invoice: invoice({
      amount: "120.70",
      total_hours: "3.32",
      include_task_breakdown: true,
      task_breakdown: { service_title: "Social Media VA", groups: [planning, pulled, extra] },
    }),
    expect: [
      "Social Media VA",
      "Content Planning",
      "Instagram Engagement",
      "Rush fee",
      "$33.20",
      "$75.00",
      "$12.50",
      "$120.70",
      "Full task breakdown on page 2",
      "Task breakdown",
      "Nov 3, 2026",
      "Nov 5, 2026",
      "November plan",
      "Engaging with posts",
      "Content Planning subtotal",
      "3.32 hrs x $10.00/hr",
      "reference only",
      "Grand total",
      "3.32 hrs",
    ],
    reject: ["$4.20", "\u2014", "\u2013", "3.74 hrs"],
  },
  {
    name: "blank-rate",
    invoice: invoice({
      amount: "0.00",
      rate: "0.00",
      total_hours: "3.32",
      include_task_breakdown: false,
      task_breakdown: {
        service_title: "Social Media VA",
        groups: [
          { ...planning, rate: "0.00", amount: "0.00", tasks: [{ ...planning.tasks[0], rate: "0.00", amount: "0.00" }] },
          { ...pulled, amount: "0.00", client_note: "", summary: "Engaging with posts and stories for the brand.", tasks: [{ ...pulled.tasks[0], amount: "0.00" }] },
        ],
      },
    }),
    expect: ["Content Planning", "November plan", "Instagram Engagement", "Engaging with posts", "Social Media VA", "$0.00"],
    reject: ["$10.00/hr", "$4.20", "$33.20", "$75.00", "\u2014"],
  },
]

async function textOf(doc) {
  const blob = await pdf(React.createElement(InvoiceDocument, { invoice: doc, settings })).toBlob()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const loadingTask = pdfjs.getDocument({ data: bytes, disableWorker: true, isEvalSupported: false })
  const loaded = await loadingTask.promise
  const pages = []
  for (let i = 1; i <= loaded.numPages; i += 1) {
    const page = await loaded.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => item.str).join(" "))
  }
  return { pages: loaded.numPages, text: pages.join("\n") }
}

let failed = 0
for (const item of cases) {
  const rendered = await textOf(item.invoice)
  const missing = item.expect.filter((bit) => !rendered.text.includes(bit))
  const present = item.reject.filter((bit) => rendered.text.includes(bit))
  if (missing.length || present.length) {
    failed += 1
    console.error(`FAIL ${item.name} pages=${rendered.pages}`)
    console.error(" missing", missing)
    console.error(" forbidden", present)
    console.error(rendered.text.slice(0, 2000))
  } else {
    console.log(`OK ${item.name} pages=${rendered.pages}`)
  }
  writeFileSync(`/tmp/${item.name}.pdf`, Buffer.from(await (await pdf(React.createElement(InvoiceDocument, { invoice: item.invoice, settings })).toBlob()).arrayBuffer()))
}

await vite.close()
if (failed) process.exit(1)
