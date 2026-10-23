import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer"
import type { Invoice, InvoiceLineItem, Settings } from "@/lib/types"
import {
  formatCurrency,
  formatInvoiceDate,
  formatInvoiceRate,
  formatInvoiceTotal,
} from "@/lib/utils"

const COLORS = {
  page: "#fbf4f6",
  band: "#f3d5df",
  banner: "#b67486",
  ink: "#3d2a32",
  muted: "#8a6b76",
  pink: "#c45a7a",
  white: "#ffffff",
  rowBorder: "#edd5de",
  payBg: "#f8e8ee",
  payBorder: "#c45a7a",
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: COLORS.ink,
    backgroundColor: COLORS.page,
  },
  topBand: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 10,
    backgroundColor: COLORS.band,
  },
  bottomBand: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 10,
    backgroundColor: COLORS.band,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  logo: { width: 72, height: 72, borderRadius: 8 },
  titleBlock: { marginTop: 4, marginBottom: 14 },
  title: {
    fontFamily: "Times-Italic",
    fontSize: 36,
    color: COLORS.pink,
    marginBottom: 4,
  },
  subtitle: { fontSize: 10, color: COLORS.muted },
  meta: { alignItems: "flex-end", marginTop: 8 },
  metaLabel: { fontSize: 8, color: COLORS.muted, marginBottom: 2 },
  metaValue: { fontSize: 10, color: COLORS.ink, marginBottom: 8 },
  banner: {
    backgroundColor: COLORS.banner,
    borderRadius: 10,
    paddingVertical: 16,
    paddingHorizontal: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 22,
  },
  bannerAmount: { fontSize: 22, fontFamily: "Times-Bold", color: COLORS.white },
  bannerDue: { fontSize: 11, color: COLORS.white, marginTop: 2 },
  bannerPeriodLabel: { fontSize: 9, color: "rgba(255,255,255,0.85)", textAlign: "right" },
  bannerPeriod: { fontSize: 12, color: COLORS.white, marginTop: 3, textAlign: "right" },
  parties: { flexDirection: "row", marginBottom: 22, gap: 24 },
  partyCol: { flex: 1 },
  partyTitle: {
    fontFamily: "Times-Italic",
    fontSize: 14,
    color: COLORS.pink,
    marginBottom: 8,
  },
  partyLabel: {
    fontSize: 7,
    color: COLORS.pink,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  partyValue: { fontSize: 11, color: COLORS.ink, marginBottom: 8 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rowBorder,
    paddingBottom: 6,
    marginBottom: 4,
  },
  th: {
    fontSize: 8,
    color: COLORS.muted,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  colDesc: { width: "55%" },
  colRate: { width: "22%", textAlign: "right" },
  colAmt: { width: "23%", textAlign: "right" },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rowBorder,
    alignItems: "flex-start",
  },
  rowTitle: { fontSize: 11, color: COLORS.ink, marginBottom: 3 },
  rowSub: { fontSize: 8, color: COLORS.muted, lineHeight: 1.35 },
  rowRate: { fontSize: 10, color: COLORS.ink, textAlign: "right" },
  rowAmt: { fontSize: 10, color: COLORS.ink, textAlign: "right" },
  totalBlock: { alignItems: "flex-end", marginTop: 18, marginBottom: 20 },
  totalLabel: {
    fontSize: 8,
    color: COLORS.muted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  totalValue: { fontFamily: "Times-Bold", fontSize: 22, color: COLORS.ink },
  payBox: {
    backgroundColor: COLORS.payBg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.payBorder,
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  payTitle: { fontSize: 10, color: COLORS.ink, marginBottom: 4 },
  payBody: { fontSize: 9, color: COLORS.muted, lineHeight: 1.45 },
  footer: { fontSize: 8, color: COLORS.muted, textAlign: "center", marginTop: 8 },
})

function paymentCopy(method: string, settings: Settings, bankDetails?: string | null) {
  if (method === "wise") {
    return `Please send payment via Wise to ${settings.wise_email || bankDetails || "—"}.`
  }
  if (method === "paypal") {
    return `Please send payment via PayPal to ${settings.paypal_email || bankDetails || "—"}.`
  }
  return `Please send payment via bank transfer:\n${bankDetails || "Details on request."}`
}

function lineParts(item: InvoiceLineItem) {
  const parts = (item.description || "").split("\n")
  return { title: parts[0] || "Services", sub: parts.slice(1).join(" ").trim() }
}

function rateLabel(item: InvoiceLineItem, billingType: string) {
  const desc = (item.description || "").toLowerCase()
  if (billingType === "hourly" || desc.includes("va services") || desc.includes("overage")) {
    return formatInvoiceRate(item.rate)
  }
  return formatCurrency(item.rate)
}

function dueLabel(invoice: Invoice) {
  if (!invoice.payment_terms_days || invoice.payment_terms_days === 0) return "Due upon receipt"
  return formatInvoiceDate(invoice.due_date)
}

export function InvoiceDocument({
  invoice,
  settings,
}: {
  invoice: Invoice
  settings: Settings
  showPricing?: boolean
}) {
  const logoSrc =
    typeof window !== "undefined"
      ? `${window.location.origin}/brand/sunnyhue-logo.png`
      : "/brand/sunnyhue-logo.png"

  const priced = (invoice.line_items || []).filter((li) => Number(li.amount) > 0)
  const lines = priced.length > 0 ? priced : invoice.line_items || []

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.topBand} fixed />
        <View style={styles.bottomBand} fixed />

        <View style={styles.header}>
          <Image src={logoSrc} style={styles.logo} />
          <View style={styles.meta}>
            <Text style={styles.metaLabel}>Invoice date</Text>
            <Text style={styles.metaValue}>{formatInvoiceDate(invoice.issue_date)}</Text>
            <Text style={styles.metaLabel}>Due date</Text>
            <Text style={styles.metaValue}>{dueLabel(invoice)}</Text>
          </View>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.title}>Invoice</Text>
          <Text style={styles.subtitle}>
            Social media VA services · Prepared for {invoice.client_name}
          </Text>
        </View>

        <View style={styles.banner}>
          <View>
            <Text style={styles.bannerAmount}>{formatCurrency(invoice.amount)}</Text>
            <Text style={styles.bannerDue}>due this period</Text>
          </View>
          <View>
            <Text style={styles.bannerPeriodLabel}>Service period</Text>
            <Text style={styles.bannerPeriod}>{invoice.period_label}</Text>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.partyCol}>
            <Text style={styles.partyTitle}>Billed to</Text>
            <Text style={styles.partyLabel}>Client</Text>
            <Text style={styles.partyValue}>{invoice.client_name}</Text>
          </View>
          <View style={styles.partyCol}>
            <Text style={styles.partyTitle}>Paid to</Text>
            <Text style={styles.partyLabel}>Name</Text>
            <Text style={styles.partyValue}>{settings.principal_name}</Text>
            <Text style={styles.partyLabel}>Business</Text>
            <Text style={styles.partyValue}>
              {settings.company_name}
              {settings.location ? `\n${settings.location}` : ""}
            </Text>
          </View>
        </View>

        <View style={styles.tableHeader}>
          <Text style={[styles.th, styles.colDesc]}>Description</Text>
          <Text style={[styles.th, styles.colRate]}>Rate</Text>
          <Text style={[styles.th, styles.colAmt]}>Amount</Text>
        </View>

        {lines.map((item) => {
          const { title, sub } = lineParts(item)
          // Never show timesheet / hour-log details on the client invoice — only service copy.
          const serviceSub = sub && !/hrs|mins|logged/i.test(sub) ? sub : ""
          return (
            <View key={item.id} style={styles.tableRow} wrap={false}>
              <View style={styles.colDesc}>
                <Text style={styles.rowTitle}>{title}</Text>
                {!!serviceSub && <Text style={styles.rowSub}>{serviceSub}</Text>}
              </View>
              <Text style={[styles.rowRate, styles.colRate]}>
                {rateLabel(item, invoice.billing_type)}
              </Text>
              <Text style={[styles.rowAmt, styles.colAmt]}>{formatCurrency(item.amount)}</Text>
            </View>
          )
        })}

        <View style={styles.totalBlock}>
          <Text style={styles.totalLabel}>Total due</Text>
          <Text style={styles.totalValue}>{formatInvoiceTotal(invoice.amount)}</Text>
        </View>

        <View style={styles.payBox}>
          <Text style={styles.payTitle}>
            {invoice.payment_method === "wise"
              ? "Wise"
              : invoice.payment_method === "paypal"
                ? "PayPal"
                : "Bank transfer"}
          </Text>
          <Text style={styles.payBody}>
            {paymentCopy(invoice.payment_method, settings, invoice.bank_details)}
          </Text>
        </View>

        <Text style={styles.footer}>
          {settings.company_name} · Invoice {invoice.invoice_number} · {invoice.period_label}
        </Text>
      </Page>
    </Document>
  )
}
