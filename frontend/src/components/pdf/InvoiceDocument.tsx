import { Document, Font, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer"

Font.registerHyphenationCallback((word) => [word])
import type { Invoice, InvoiceLineItem, InvoiceTaskGroup, InvoiceTaskRow, Settings } from "@/lib/types"
import {
  formatCurrency,
  formatInvoiceDate,
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
    paddingBottom: 48,
    paddingHorizontal: 36,
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
    marginBottom: 14,
  },
  logo: { width: 64, height: 64, borderRadius: 8 },
  titleBlock: { marginTop: 2, marginBottom: 12 },
  title: {
    fontFamily: "Times-Italic",
    fontSize: 32,
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
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  bannerAmount: { fontSize: 22, fontFamily: "Times-Bold", color: COLORS.white },
  bannerDue: { fontSize: 11, color: COLORS.white, marginTop: 2 },
  bannerPeriodLabel: { fontSize: 9, color: "rgba(255,255,255,0.85)", textAlign: "right" },
  bannerPeriod: { fontSize: 12, color: COLORS.white, marginTop: 3, textAlign: "right" },
  parties: { flexDirection: "row", marginBottom: 16, gap: 24 },
  partyCol: { flex: 1 },
  partyTitle: {
    fontFamily: "Times-Italic",
    fontSize: 14,
    color: COLORS.pink,
    marginBottom: 6,
  },
  partyLabel: {
    fontSize: 7,
    color: COLORS.pink,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  partyValue: { fontSize: 11, color: COLORS.ink, marginBottom: 8 },
  sectionLabel: {
    fontSize: 8,
    color: COLORS.pink,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rowBorder,
    paddingBottom: 6,
    marginBottom: 2,
  },
  th: {
    fontSize: 8,
    color: COLORS.muted,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  colDesc: { width: "46%" },
  colHours: { width: "14%", textAlign: "right" },
  colRate: { width: "20%", textAlign: "right" },
  colAmt: { width: "20%", textAlign: "right" },
  colDate: { width: "18%" },
  colTask: { width: "40%" },
  colHours2: { width: "14%", textAlign: "right" },
  colRate2: { width: "14%", textAlign: "right" },
  colAmt2: { width: "14%", textAlign: "right" },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rowBorder,
    alignItems: "flex-start",
  },
  rowTitle: { fontSize: 11, color: COLORS.ink, marginBottom: 2 },
  rowSub: { fontSize: 8, color: COLORS.muted, lineHeight: 1.35 },
  rowRate: { fontSize: 10, color: COLORS.ink, textAlign: "right" },
  rowAmt: { fontSize: 10, color: COLORS.ink, textAlign: "right" },
  refNote: { fontSize: 7, color: COLORS.muted, textAlign: "right", marginTop: 2 },
  totalBlock: { alignItems: "flex-end", marginTop: 14, marginBottom: 8 },
  totalLabel: {
    fontSize: 8,
    color: COLORS.muted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  totalValue: { fontFamily: "Times-Bold", fontSize: 22, color: COLORS.ink },
  pageNote: { fontSize: 9, color: COLORS.pink, textAlign: "right", marginBottom: 12 },
  payBox: {
    backgroundColor: COLORS.payBg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.payBorder,
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  payTitle: { fontSize: 10, color: COLORS.ink, marginBottom: 4 },
  payBody: { fontSize: 9, color: COLORS.muted, lineHeight: 1.45 },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 36,
    right: 36,
    fontSize: 8,
    color: COLORS.muted,
    textAlign: "center",
  },
  breakTitle: {
    fontFamily: "Times-Italic",
    fontSize: 26,
    color: COLORS.pink,
    marginBottom: 4,
  },
  groupHead: {
    marginTop: 12,
    marginBottom: 4,
    fontSize: 12,
    color: COLORS.ink,
  },
  subtotal: {
    marginTop: 4,
    marginBottom: 8,
    fontSize: 9,
    color: COLORS.ink,
    textAlign: "right",
  },
  grand: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.rowBorder,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  grandLabel: { fontSize: 11, color: COLORS.ink },
  grandValue: { fontSize: 11, fontFamily: "Times-Bold", color: COLORS.ink },
})

function paymentCopy(method: string, settings: Settings, bankDetails?: string | null) {
  if (method === "wise") {
    return `Please send payment via Wise to ${settings.wise_email || bankDetails || "the email on file"}.`
  }
  if (method === "paypal") {
    return `Please send payment via PayPal to ${settings.paypal_email || bankDetails || "the email on file"}.`
  }
  return `Please send payment via bank transfer:\n${bankDetails || "Details on request."}`
}

function cleanInvoiceText(value: string) {
  return (value || "").replaceAll("\u2014", "-").replaceAll("\u2013", "-").replaceAll("\u2012", "-")
}

function dueLabel(invoice: Invoice) {
  if (!invoice.payment_terms_days || invoice.payment_terms_days === 0) return "Due upon receipt"
  return formatInvoiceDate(invoice.due_date)
}

function symbol(currency: string) {
  return currency === "PHP" ? "₱" : "$"
}

function money(amount: string | number | null | undefined, currency: string) {
  if (amount == null || amount === "") return ""
  return formatCurrency(amount, currency)
}

function hoursText(hours: string | number | null | undefined) {
  const num = Number(hours ?? 0)
  if (Number.isNaN(num)) return "0.00"
  return num.toFixed(2)
}

function rateText(rate: string | number | null | undefined, currency: string, flat: boolean) {
  if (flat) return "Flat"
  const num = Number(rate ?? 0)
  if (Number.isNaN(num)) return ""
  return `${symbol(currency)}${num.toFixed(2)}/hr`
}

function visibleGroups(invoice: Invoice): InvoiceTaskGroup[] | null {
  const groups = invoice.task_breakdown?.groups
  if (!groups || groups.length === 0) return null
  const kept = groups.filter((group) => {
    const text = `${group.name || ""} ${group.summary || ""} ${group.detail || ""} ${group.client_note || ""}`.trim()
    const amount = Number(group.amount || 0)
    const hours = Number(group.hours || 0)
    return text.length > 0 || amount !== 0 || hours > 0
  })
  return kept.length > 0 ? kept : null
}

function visibleLines(invoice: Invoice): InvoiceLineItem[] {
  return (invoice.line_items || []).filter((line) => {
    const text = (line.description || "").trim()
    const amount = Number(line.amount)
    const hours = Number(line.hours)
    return text.length > 0 || amount !== 0 || hours > 0
  })
}

function summaryBody(group: InvoiceTaskGroup, detailed: boolean) {
  if (detailed) {
    return cleanInvoiceText(group.summary || group.client_note || "")
  }
  return cleanInvoiceText([group.client_note, group.detail].filter(Boolean).join("\n"))
}

function subtotalLine(group: InvoiceTaskGroup, currency: string) {
  const amount = money(group.amount || 0, currency)
  if (group.reference_hours || group.billing === "flat") {
    const hrs = Number(group.hours || 0)
    const ref = hrs > 0 ? `${hoursText(group.hours)} hrs logged, reference only · ` : ""
    return `${group.name} subtotal · ${ref}${amount}`
  }
  return `${group.name} subtotal · ${hoursText(group.hours)} hrs x ${rateText(group.rate, currency, false)} · ${amount}`
}

function billableHours(groups: InvoiceTaskGroup[]) {
  const cents = groups.reduce((sum, group) => {
    if (group.reference_hours || group.billing === "flat") return sum
    const hours = Number(group.hours || 0)
    if (Number.isNaN(hours)) return sum
    return sum + Math.round(hours * 100)
  }, 0)
  return cents / 100
}

function taskAmount(task: InvoiceTaskRow, currency: string) {
  if (task.amount == null || task.amount === "") return ""
  return money(task.amount, currency)
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
      : new URL("../../../public/brand/sunnyhue-logo.png", import.meta.url).pathname

  const currency = invoice.currency || "USD"
  const groups = visibleGroups(invoice)
  const detailed = Boolean(invoice.include_task_breakdown) && Boolean(groups?.some((group) => (group.tasks || []).length > 0))
  const serviceTitle = cleanInvoiceText(invoice.task_breakdown?.service_title || "")
  const subtitle = serviceTitle
    ? `${serviceTitle} · Prepared for ${invoice.client_name}`
    : `Social media VA services · Prepared for ${invoice.client_name}`
  const lines = groups ? null : visibleLines(invoice)
  const footer = `${settings.company_name} · Invoice ${invoice.invoice_number} · ${cleanInvoiceText(invoice.period_label)}`

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
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <View style={styles.banner}>
          <View>
            <Text style={styles.bannerAmount}>{formatCurrency(invoice.amount, currency)}</Text>
            <Text style={styles.bannerDue}>due this period</Text>
          </View>
          <View>
            <Text style={styles.bannerPeriodLabel}>Service period</Text>
            <Text style={styles.bannerPeriod}>{cleanInvoiceText(invoice.period_label)}</Text>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.partyCol}>
            <Text style={styles.partyTitle}>Billed to</Text>
            <Text style={styles.partyLabel}>Client</Text>
            <Text style={styles.partyValue}>
              {invoice.client_name}
              {invoice.one_off_business ? `\n${invoice.one_off_business}` : ""}
              {invoice.one_off_address ? `\n${invoice.one_off_address}` : ""}
            </Text>
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

        <Text style={styles.sectionLabel}>Summary</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, styles.colDesc]}>Description</Text>
          <Text style={[styles.th, styles.colHours]}>Hours</Text>
          <Text style={[styles.th, styles.colRate]}>Rate</Text>
          <Text style={[styles.th, styles.colAmt]}>Amount</Text>
        </View>

        {groups
          ? groups.map((group, index) => {
              const body = summaryBody(group, detailed)
              const parts = body ? body.split("\n") : []
              const flat = Boolean(group.reference_hours) || group.billing === "flat"
              return (
                <View key={`${group.name}-${index}`} style={styles.tableRow}>
                  <View style={styles.colDesc}>
                    <Text style={styles.rowTitle}>{cleanInvoiceText(group.name || "Services")}</Text>
                    {parts.map((line, lineIndex) => (
                      <Text key={lineIndex} style={styles.rowSub}>{line || " "}</Text>
                    ))}
                  </View>
                  <View style={styles.colHours}>
                    <Text style={styles.rowRate}>{hoursText(group.hours)}</Text>
                    {flat && Number(group.hours || 0) > 0 ? <Text style={styles.refNote}>reference</Text> : null}
                  </View>
                  <Text style={[styles.rowRate, styles.colRate]}>{rateText(group.rate, currency, flat)}</Text>
                  <Text style={[styles.rowAmt, styles.colAmt]}>{money(group.amount || 0, currency)}</Text>
                </View>
              )
            })
          : (lines || []).map((item) => {
              const typed = cleanInvoiceText(item.description || "")
              const parts = typed ? typed.split("\n") : ["Services"]
              const hourly = item.line_kind === "entered_hours" || item.line_kind === "actual_hours" || item.line_kind === "hourly" || (!item.line_kind && invoice.billing_type === "hourly")
              return (
                <View key={item.id} style={styles.tableRow}>
                  <View style={styles.colDesc}>
                    {parts.map((line, index) => (
                      <Text key={index} style={index === 0 ? styles.rowTitle : styles.rowSub}>{line || " "}</Text>
                    ))}
                  </View>
                  <Text style={[styles.rowRate, styles.colHours]}>{hoursText(item.hours)}</Text>
                  <Text style={[styles.rowRate, styles.colRate]}>
                    {hourly ? rateText(item.rate, currency, false) : Number(item.amount) !== 0 || typed ? "Flat" : ""}
                  </Text>
                  <Text style={[styles.rowAmt, styles.colAmt]}>{money(item.amount, currency)}</Text>
                </View>
              )
            })}

        <View style={styles.totalBlock}>
          <Text style={styles.totalLabel}>Total due</Text>
          <Text style={styles.totalValue}>{formatInvoiceTotal(invoice.amount).replace("$", symbol(currency))}</Text>
        </View>
        {detailed ? <Text style={styles.pageNote}>Full task breakdown on page 2</Text> : null}

        <View style={styles.payBox}>
          <Text style={styles.payTitle}>
            {invoice.payment_method === "wise" ? "Wise" : invoice.payment_method === "paypal" ? "PayPal" : "Bank transfer"}
          </Text>
          <Text style={styles.payBody}>{paymentCopy(invoice.payment_method, settings, invoice.bank_details)}</Text>
        </View>

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) => `${footer} · Page ${pageNumber} of ${totalPages}`}
        />
      </Page>

      {detailed && groups ? (
        <Page size="A4" style={styles.page}>
          <View style={styles.topBand} fixed />
          <View style={styles.bottomBand} fixed />
          <Text style={styles.breakTitle}>Task breakdown</Text>
          <Text style={styles.subtitle}>
            {invoice.client_name}
            {invoice.one_off_business ? ` · ${invoice.one_off_business}` : ""}
          </Text>
          <Text style={[styles.subtitle, { marginTop: 2, marginBottom: 8 }]}>{cleanInvoiceText(invoice.period_label)}</Text>

          {groups.map((group, index) => {
            const tasks = group.tasks || []
            if (tasks.length === 0) return null
            const flat = Boolean(group.reference_hours) || group.billing === "flat"
            return (
              <View key={`${group.name}-detail-${index}`}>
                <Text style={styles.groupHead}>{cleanInvoiceText(group.name)}</Text>
                {group.client_note ? <Text style={[styles.rowSub, { marginBottom: 4 }]}>{cleanInvoiceText(group.client_note)}</Text> : null}
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, styles.colDate]}>Date</Text>
                  <Text style={[styles.th, styles.colTask]}>Task</Text>
                  <Text style={[styles.th, styles.colHours2]}>Hours</Text>
                  <Text style={[styles.th, styles.colRate2]}>Rate</Text>
                  <Text style={[styles.th, styles.colAmt2]}>Amount</Text>
                </View>
                {tasks.map((task, taskIndex) => (
                  <View key={`${task.date}-${taskIndex}`} style={styles.tableRow}>
                    <Text style={[styles.rowSub, styles.colDate, { color: COLORS.ink }]}>{task.date_label || task.date || ""}</Text>
                    <View style={styles.colTask}>
                      <Text style={styles.rowTitle}>{cleanInvoiceText(task.name || group.name)}</Text>
                      {cleanInvoiceText(task.description || "").split("\n").filter((line) => line.trim()).map((line, lineIndex) => (
                        <Text key={lineIndex} style={styles.rowSub}>{line}</Text>
                      ))}
                      {task.reference_only ? <Text style={styles.rowSub}>Hours are a reference only and are not an extra charge.</Text> : null}
                    </View>
                    <Text style={[styles.rowRate, styles.colHours2]}>{hoursText(task.hours)}</Text>
                    <Text style={[styles.rowRate, styles.colRate2]}>{rateText(task.rate ?? group.rate, currency, flat || Boolean(task.reference_only))}</Text>
                    <Text style={[styles.rowAmt, styles.colAmt2]}>{taskAmount(task, currency)}</Text>
                  </View>
                ))}
                <Text style={styles.subtotal}>{subtotalLine(group, currency)}</Text>
              </View>
            )
          })}

          <View style={styles.grand}>
            <Text style={styles.grandLabel}>Grand total</Text>
            <Text style={styles.grandValue}>
              {billableHours(groups) > 0 ? `${hoursText(billableHours(groups))} hrs · ` : ""}
              {money(invoice.amount, currency)}
            </Text>
          </View>

          <Text
            style={styles.footer}
            fixed
            render={({ pageNumber, totalPages }) => `${footer} · Page ${pageNumber} of ${totalPages}`}
          />
        </Page>
      ) : null}
    </Document>
  )
}
