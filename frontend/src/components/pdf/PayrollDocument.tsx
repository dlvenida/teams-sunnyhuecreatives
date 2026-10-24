import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer"
import type { PayrollResponse, Settings } from "@/lib/types"
import { formatCurrency, formatInvoiceDate, formatInvoiceTotal } from "@/lib/utils"
import { PDF_FONT } from "@/lib/pdfFonts"

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
    fontFamily: PDF_FONT,
    fontSize: 10,
    color: COLORS.ink,
    backgroundColor: COLORS.page,
  },
  topBand: { position: "absolute", top: 0, left: 0, right: 0, height: 10, backgroundColor: COLORS.band },
  bottomBand: { position: "absolute", bottom: 0, left: 0, right: 0, height: 10, backgroundColor: COLORS.band },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  logo: { width: 72, height: 72, borderRadius: 8 },
  titleBlock: { marginTop: 4, marginBottom: 10 },
  title: { fontFamily: "Times-Italic", fontSize: 34, color: COLORS.pink, marginBottom: 4 },
  subtitle: { fontSize: 10, color: COLORS.muted },
  agency: { fontSize: 11, color: COLORS.pink, marginTop: 6 },
  greeting: { fontFamily: "Times-Italic", fontSize: 14, color: COLORS.ink, marginTop: 12, marginBottom: 4 },
  greetingSub: { fontSize: 10, color: COLORS.muted, marginBottom: 16 },
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
  partyTitle: { fontFamily: "Times-Italic", fontSize: 14, color: COLORS.pink, marginBottom: 8 },
  partyLabel: { fontSize: 7, color: COLORS.pink, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 },
  partyValue: { fontSize: 11, color: COLORS.ink, marginBottom: 8 },
  tableHeader: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.rowBorder, paddingBottom: 6, marginBottom: 4 },
  th: { fontSize: 8, color: COLORS.muted, letterSpacing: 0.6, textTransform: "uppercase" },
  colDesc: { width: "55%" },
  colRate: { width: "22%", textAlign: "right" },
  colAmt: { width: "23%", textAlign: "right" },
  tableRow: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.rowBorder, alignItems: "flex-start" },
  rowTitle: { fontSize: 11, color: COLORS.ink, marginBottom: 3 },
  rowSub: { fontSize: 8, color: COLORS.muted, lineHeight: 1.35 },
  rowRate: { fontSize: 10, color: COLORS.ink, textAlign: "right" },
  rowAmt: { fontSize: 10, color: COLORS.ink, textAlign: "right" },
  totalBlock: { alignItems: "flex-end", marginTop: 18, marginBottom: 20 },
  totalLabel: { fontSize: 8, color: COLORS.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 },
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
  vaBreak: { marginTop: 28 },
})

export function PayrollDocument({
  payroll,
  settings,
  showPricing = true,
}: {
  payroll: PayrollResponse
  settings: Settings
  showPricing?: boolean
}) {
  const period = `${formatInvoiceDate(payroll.period_start)} – ${formatInvoiceDate(payroll.period_end)}`
  const monthLabel = new Date(payroll.period_start + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })
  const logoSrc =
    typeof window !== "undefined"
      ? `${window.location.origin}/brand/sunnyhue-logo.png`
      : "/brand/sunnyhue-logo.png"

  return (
    <Document>
      {payroll.vas.map((va) => {
        const total = showPricing ? formatCurrency(va.total_pay, va.currency) : `${va.total_hours} hrs`
        const first = va.va_name.split(" ")[0]
        const lines =
          (va.by_client ?? []).length > 0
            ? (va.by_client ?? []).map((c) => ({
                title: `${c.label} · VA services`,
                sub: period,
                rate: showPricing ? formatCurrency(c.pay, va.currency) : "—",
                amount: showPricing ? formatCurrency(c.pay, va.currency) : `${c.hours} hrs`,
              }))
            : va.entries.map((e) => ({
                title: e.client_name || "Services",
                sub: period,
                rate: showPricing ? formatCurrency(e.rate, va.currency) : "—",
                amount: showPricing ? formatCurrency(e.pay, va.currency) : `${e.hours} hrs`,
              }))

        return (
          <Page key={va.va_id} size="A4" style={styles.page}>
            <View style={styles.topBand} fixed />
            <View style={styles.bottomBand} fixed />

            <View style={styles.header}>
              <Image src={logoSrc} style={styles.logo} />
            </View>

            <View style={styles.titleBlock}>
              <Text style={styles.title}>Payroll Report</Text>
              <Text style={styles.subtitle}>Bi-weekly payroll · Prepared for {va.va_name}</Text>
              <Text style={styles.agency}>
                {settings.company_name} · {monthLabel}
              </Text>
            </View>

            <Text style={styles.greeting}>Hi {first}! Here’s your payroll report.</Text>
            <Text style={styles.greetingSub}>
              Thank you for your beautiful work this period — you make Sunny Hue shine. 💕
            </Text>

            <View style={styles.banner}>
              <View>
                <Text style={styles.bannerAmount}>{total}</Text>
                <Text style={styles.bannerDue}>earned this period</Text>
              </View>
              <View>
                <Text style={styles.bannerPeriodLabel}>Service period</Text>
                <Text style={styles.bannerPeriod}>{period}</Text>
              </View>
            </View>

            <View style={styles.parties}>
              <View style={styles.partyCol}>
                <Text style={styles.partyTitle}>Billed to</Text>
                <Text style={styles.partyLabel}>Name</Text>
                <Text style={styles.partyValue}>{settings.principal_name || "Jane Laurine Venida"}</Text>
                <Text style={styles.partyLabel}>Business</Text>
                <Text style={styles.partyValue}>
                  {settings.company_name}
                  {settings.location ? `\n${settings.location}` : "\nDumaguete City, Philippines"}
                </Text>
              </View>
              <View style={styles.partyCol}>
                <Text style={styles.partyTitle}>Paid to</Text>
                <Text style={styles.partyLabel}>Team member</Text>
                <Text style={styles.partyValue}>{va.va_name}</Text>
              </View>
            </View>

            <View style={styles.tableHeader}>
              <Text style={[styles.th, styles.colDesc]}>Description</Text>
              <Text style={[styles.th, styles.colRate]}>Rate</Text>
              <Text style={[styles.th, styles.colAmt]}>Amount</Text>
            </View>

            {lines.map((line, i) => (
              <View key={i} style={styles.tableRow} wrap={false}>
                <View style={styles.colDesc}>
                  <Text style={styles.rowTitle}>{line.title}</Text>
                  <Text style={styles.rowSub}>{line.sub}</Text>
                </View>
                <Text style={[styles.rowRate, styles.colRate]}>{line.rate}</Text>
                <Text style={[styles.rowAmt, styles.colAmt]}>{line.amount}</Text>
              </View>
            ))}

            <View style={styles.totalBlock}>
              <Text style={styles.totalLabel}>Total due</Text>
              <Text style={styles.totalValue}>
                {showPricing
                  ? formatInvoiceTotal(va.total_pay).replace("USD", va.currency)
                  : `${va.total_hours} hrs`}
              </Text>
            </View>

            <View style={styles.payBox}>
              <Text style={styles.payTitle}>Payment</Text>
              <Text style={styles.payBody}>
                {va.payment_label
                  ? `Payout via ${va.payment_label}.`
                  : "Your payroll for this period will be sent via your saved payment method."}{" "}
                Questions? Message Jane anytime — we’re so grateful for you!
              </Text>
            </View>

            <Text style={styles.footer}>
              {settings.company_name} · Payroll · {va.va_name} · {period}
            </Text>
          </Page>
        )
      })}
    </Document>
  )
}
