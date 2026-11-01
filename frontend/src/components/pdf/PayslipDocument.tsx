import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import type { PayslipClient, PayslipModel } from "@/lib/payslip"
import { formatInvoiceDate, formatPdfCurrency } from "@/lib/utils"
import { PDF_FONT } from "@/lib/pdfFonts"

const COLORS = {
  page: "#ffffff",
  header: "#fdeef3",
  band: "#f3d5df",
  banner: "#b67486",
  ink: "#2b2426",
  muted: "#8a6b76",
  pink: "#c45a7a",
  pinkDeep: "#a84868",
  line: "#f0d5df",
  payBg: "#fdf2f6",
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 46,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: COLORS.ink,
    backgroundColor: COLORS.page,
  },
  headerWash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 168,
    backgroundColor: COLORS.header,
  },
  topBand: { position: "absolute", top: 0, left: 0, right: 0, height: 8, backgroundColor: COLORS.band },
  bottomBand: { position: "absolute", bottom: 0, left: 0, right: 0, height: 8, backgroundColor: COLORS.band },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  wordmark: { fontFamily: "Times-Italic", fontSize: 22, color: COLORS.pink },
  wordmarkSub: { fontSize: 8, color: COLORS.pinkDeep, letterSpacing: 1.4, marginTop: 1 },
  meta: { alignItems: "flex-end" },
  kicker: {
    fontSize: 7,
    color: COLORS.pink,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  metaValue: { fontSize: 11, color: COLORS.ink, marginBottom: 8, fontFamily: "Helvetica-Bold" },
  title: { fontFamily: "Times-Italic", fontSize: 34, color: COLORS.pink, marginTop: 8 },
  subtitle: { fontSize: 9, color: COLORS.muted, marginTop: 2 },
  agency: { fontSize: 9, color: COLORS.pink, marginTop: 2 },
  example: { fontSize: 8, color: COLORS.pinkDeep, marginTop: 4, letterSpacing: 0.6 },
  greeting: { fontFamily: "Times-Italic", fontSize: 13, color: COLORS.pinkDeep, marginTop: 16, marginBottom: 4 },
  greetingBody: { fontSize: 9, color: COLORS.ink, lineHeight: 1.4, marginBottom: 14 },
  banner: {
    backgroundColor: COLORS.banner,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  bannerAmount: { fontSize: 22, fontFamily: PDF_FONT, color: "#ffffff" },
  bannerDue: { fontSize: 10, color: "#ffffff", marginTop: 2 },
  bannerPeriod: { fontSize: 12, color: "#ffffff", marginTop: 3, textAlign: "right" },
  parties: { flexDirection: "row", marginBottom: 16, gap: 28 },
  partyCol: { flex: 1 },
  partyTitle: { fontFamily: "Times-Italic", fontSize: 14, color: COLORS.pink, marginBottom: 6 },
  partyValue: { fontSize: 11, color: COLORS.ink, marginBottom: 8 },
  summaryLabel: { marginBottom: 6 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    paddingBottom: 5,
    marginBottom: 2,
  },
  th: { fontSize: 7, color: COLORS.pink, letterSpacing: 1.2, textTransform: "uppercase" },
  row: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    alignItems: "flex-start",
  },
  rowTitle: { fontSize: 11, color: COLORS.ink, marginBottom: 2 },
  rowSub: { fontSize: 8, fontFamily: "Times-Italic", color: COLORS.pink, lineHeight: 1.3 },
  num: { fontSize: 10, fontFamily: PDF_FONT, color: COLORS.ink, textAlign: "right" },
  colDesc: { width: "46%" },
  colHours: { width: "16%", textAlign: "right" },
  colRate: { width: "18%", textAlign: "right" },
  colAmt: { width: "20%", textAlign: "right" },
  totalBlock: { alignItems: "flex-end", marginTop: 14 },
  totalValue: { fontFamily: "Times-Italic", fontSize: 26, color: COLORS.pink },
  totalHint: { fontSize: 8, color: COLORS.muted, marginTop: 2 },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 40,
    right: 40,
    fontSize: 7.5,
    color: COLORS.pink,
    textAlign: "center",
  },
  breakTitle: { fontFamily: "Times-Italic", fontSize: 26, color: COLORS.pink },
  breakMeta: { fontSize: 9, color: COLORS.muted, textAlign: "right" },
  clientHead: { fontFamily: "Times-Italic", fontSize: 14, color: COLORS.pink, marginTop: 14, marginBottom: 4 },
  taskDate: { width: "18%", fontSize: 9, color: COLORS.ink },
  taskBody: { width: "50%" },
  taskName: { fontSize: 10, fontFamily: "Helvetica-Bold", color: COLORS.ink, marginBottom: 2 },
  taskDesc: { fontSize: 8, color: COLORS.muted, lineHeight: 1.35 },
  taskHours: { width: "14%", textAlign: "right" },
  taskAmt: { width: "18%", textAlign: "right" },
  subtotal: { fontSize: 8, color: COLORS.muted, textAlign: "right", marginTop: 4, marginBottom: 2 },
  grandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    marginTop: 12,
    paddingTop: 8,
  },
  grandLabel: { fontFamily: "Times-Italic", fontSize: 16, color: COLORS.pink },
  grandValue: { fontSize: 12, fontFamily: PDF_FONT, color: COLORS.ink },
  payBox: {
    backgroundColor: COLORS.payBg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.pink,
    borderRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 16,
  },
  payTitle: { fontSize: 10, color: COLORS.ink, marginTop: 2, marginBottom: 2 },
  payBody: { fontSize: 8.5, color: COLORS.muted, lineHeight: 1.4 },
})

function money(amount: number, currency: string) {
  return formatPdfCurrency(amount, currency === "PHP" ? "PHP" : "USD")
}

function hoursLabel(hours: number) {
  return hours.toFixed(2)
}

function rateText(client: PayslipClient, currency: string) {
  if (client.rate == null) return "—"
  if (client.payType === "package") return `${money(client.rate, currency)} flat`
  return `${money(client.rate, currency)}/hr`
}

function subtotalLine(client: PayslipClient, currency: string) {
  const hrs = `${hoursLabel(client.hours)} hrs`
  const amt = money(client.amount, currency)
  if (client.payType === "package") {
    return `${client.name} subtotal · ${hrs} · ${amt}`
  }
  if (client.rate != null) {
    return `${client.name} subtotal · ${hrs} × ${money(client.rate, currency)}/hr · ${amt}`
  }
  return `${client.name} subtotal · ${hrs} · ${amt}`
}

function clientBlurb(client: PayslipClient) {
  const names = [...new Set(client.tasks.map((t) => t.task))].slice(0, 3)
  const extra = client.tasks.length > 3 ? ` · +${client.tasks.length - 3} more` : ""
  return names.join(", ") + extra
}

function periodLabel(start: string, end: string) {
  const a = new Date(start + "T00:00:00")
  const b = new Date(end + "T00:00:00")
  const left = a.toLocaleDateString("en-US", { month: "long", day: "numeric" })
  const right = b.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${a.toLocaleDateString("en-US", { month: "long" })} ${a.getDate()}–${b.getDate()}, ${b.getFullYear()}`
  }
  return `${left} – ${right}`
}

export function PayslipDocument({ slips }: { slips: PayslipModel[] }) {
  return (
    <Document>
      {slips.map((slip) => {
        const first = slip.vaName.split(" ")[0]
        const period = periodLabel(slip.periodStart, slip.periodEnd)
        const monthLabel = new Date(slip.periodStart + "T00:00:00").toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        })
        const footerBase = `Payslip · ${slip.vaName} · ${slip.companyName} · ${monthLabel}`
        return [
          <Page key={`${slip.vaName}-summary`} size="LETTER" style={styles.page}>
            <View style={styles.headerWash} />
            <View style={styles.topBand} />
            <View style={styles.bottomBand} />
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.wordmark}>sunnyhue.</Text>
                <Text style={styles.wordmarkSub}>CREATIVES</Text>
              </View>
              <View style={styles.meta}>
                <Text style={styles.kicker}>Payslip date</Text>
                <Text style={styles.metaValue}>{formatInvoiceDate(slip.payslipDate)}</Text>
                <Text style={styles.kicker}>Pay period</Text>
                <Text style={styles.metaValue}>{period}</Text>
              </View>
            </View>
            <Text style={styles.title}>Payslip</Text>
            <Text style={styles.subtitle}>VA payroll · Prepared for {slip.vaName}</Text>
            <Text style={styles.agency}>{slip.companyName} · {monthLabel}</Text>
            {slip.exampleNote ? <Text style={styles.example}>{slip.exampleNote}</Text> : null}

            <Text style={styles.greeting}>Hi {first}! Here's your payslip.</Text>
            <Text style={styles.greetingBody}>
              This covers {period}. Each client is summarized here. The task-by-task breakdown — date, task, description, hours, and amount — is on the next page.
            </Text>

            <View style={styles.banner}>
              <View>
                <Text style={styles.bannerAmount}>{money(slip.totalPay, slip.currency)}</Text>
                <Text style={styles.bannerDue}>total pay this period</Text>
              </View>
              <View>
                <Text style={[styles.kicker, { color: "rgba(255,255,255,0.85)", textAlign: "right" }]}>Pay period</Text>
                <Text style={styles.bannerPeriod}>{period}</Text>
              </View>
            </View>

            <View style={styles.parties}>
              <View style={styles.partyCol}>
                <Text style={styles.partyTitle}>Paid to</Text>
                <Text style={styles.kicker}>Name</Text>
                <Text style={styles.partyValue}>{slip.vaName}</Text>
              </View>
              <View style={styles.partyCol}>
                <Text style={styles.partyTitle}>From</Text>
                <Text style={styles.kicker}>Business</Text>
                <Text style={styles.partyValue}>{slip.companyName}{"\n"}{slip.location}</Text>
              </View>
            </View>

            <Text style={[styles.kicker, styles.summaryLabel]}>Summary</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, styles.colDesc]}>Description</Text>
              <Text style={[styles.th, styles.colHours]}>Hours</Text>
              <Text style={[styles.th, styles.colRate]}>Rate</Text>
              <Text style={[styles.th, styles.colAmt]}>Amount</Text>
            </View>
            {slip.clients.map((client) => (
              <View key={client.name} style={styles.row} wrap={false}>
                <View style={styles.colDesc}>
                  <Text style={styles.rowTitle}>{client.name}</Text>
                  <Text style={styles.rowSub}>{clientBlurb(client)}</Text>
                </View>
                <Text style={[styles.num, styles.colHours]}>{hoursLabel(client.hours)}</Text>
                <Text style={[styles.num, styles.colRate]}>{rateText(client, slip.currency)}</Text>
                <Text style={[styles.num, styles.colAmt]}>{money(client.amount, slip.currency)}</Text>
              </View>
            ))}

            <View style={styles.totalBlock}>
              <Text style={styles.kicker}>Total</Text>
              <Text style={styles.totalValue}>{money(slip.totalPay, slip.currency)}</Text>
              <Text style={styles.totalHint}>
                {hoursLabel(slip.totalHours)} hrs · {slip.currency} · Task breakdown on the next page
              </Text>
            </View>

            <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `${footerBase} · Page ${pageNumber} of ${totalPages}`} />
          </Page>,

          <Page key={`${slip.vaName}-detail`} size="LETTER" style={styles.page}>
            <View style={styles.topBand} />
            <View style={styles.bottomBand} />
            <View style={styles.headerRow}>
              <Text style={styles.breakTitle}>Task breakdown</Text>
              <View>
                <Text style={styles.breakMeta}>{slip.vaName}</Text>
                <Text style={styles.breakMeta}>{period}</Text>
              </View>
            </View>

            {slip.clients.map((client) => (
              <View key={client.name}>
                <Text style={styles.clientHead}>{client.name}</Text>
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, styles.taskDate]}>Date</Text>
                  <Text style={[styles.th, styles.taskBody]}>Task</Text>
                  <Text style={[styles.th, styles.taskHours]}>Hours</Text>
                  <Text style={[styles.th, styles.taskAmt]}>Amount</Text>
                </View>
                {client.tasks.map((task, i) => (
                  <View key={`${client.name}-${i}`} style={styles.row} wrap={false}>
                    <Text style={styles.taskDate}>
                      {new Date(task.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </Text>
                    <View style={styles.taskBody}>
                      <Text style={styles.taskName}>{task.task}</Text>
                      {!!task.description && <Text style={styles.taskDesc}>{task.description}</Text>}
                    </View>
                    <Text style={[styles.num, styles.taskHours]}>{hoursLabel(task.hours)}</Text>
                    <Text style={[styles.num, styles.taskAmt]}>
                      {client.payType === "package" ? "—" : money(task.amount, slip.currency)}
                    </Text>
                  </View>
                ))}
                <Text style={styles.subtotal}>{subtotalLine(client, slip.currency)}</Text>
              </View>
            ))}

            <View style={styles.grandRow} wrap={false}>
              <Text style={styles.grandLabel}>Grand total</Text>
              <Text style={styles.grandValue}>{hoursLabel(slip.totalHours)} hrs · {money(slip.totalPay, slip.currency)}</Text>
            </View>

            <View style={styles.payBox} wrap={false}>
              <Text style={styles.kicker}>Payment</Text>
              <Text style={styles.payTitle}>{slip.paymentLabel ? "Payout details" : "From Sunny Hue Creatives"}</Text>
              <Text style={styles.payBody}>
                {slip.paymentLabel
                  ? `Payable to ${slip.vaName}. ${slip.paymentLabel}.`
                  : `Payable to ${slip.vaName} from ${slip.companyName}.`}
              </Text>
            </View>

            <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `${footerBase} · Page ${pageNumber} of ${totalPages}`} />
          </Page>,
        ]
      })}
    </Document>
  )
}
