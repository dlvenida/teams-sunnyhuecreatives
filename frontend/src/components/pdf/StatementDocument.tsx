import { Document, Font, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer"
import { formatStatementMoney } from "@/lib/utils"
import type { Settings } from "@/lib/types"

Font.registerHyphenationCallback((word) => [word])

const COLORS = {
  page: "#fbf4f6",
  band: "#f3d5df",
  banner: "#b67486",
  ink: "#3d2a32",
  muted: "#8a6b76",
  pink: "#c45a7a",
  white: "#ffffff",
  rowBorder: "#edd5de",
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 48,
    paddingHorizontal: 28,
    fontFamily: "NotoSans",
    fontSize: 9,
    color: COLORS.ink,
    backgroundColor: COLORS.page,
  },
  topBand: { position: "absolute", top: 0, left: 0, right: 0, height: 10, backgroundColor: COLORS.band },
  bottomBand: { position: "absolute", bottom: 0, left: 0, right: 0, height: 10, backgroundColor: COLORS.band },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  logo: { width: 64, height: 64, borderRadius: 8 },
  meta: { alignItems: "flex-end", marginTop: 8 },
  metaLabel: { fontSize: 8, color: COLORS.muted, marginBottom: 2 },
  metaValue: { fontSize: 10, color: COLORS.ink, marginBottom: 6 },
  title: { fontFamily: "Times-Italic", fontSize: 26, color: COLORS.pink, marginBottom: 4 },
  subtitle: { fontSize: 10, color: COLORS.muted, marginBottom: 12 },
  banner: {
    backgroundColor: COLORS.banner,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  bannerAmount: { fontSize: 18, fontFamily: "NotoSans", color: COLORS.white },
  bannerDue: { fontSize: 10, color: COLORS.white, marginTop: 2 },
  bannerSide: { fontSize: 10, color: COLORS.white, textAlign: "right" },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  summaryLabel: { fontSize: 9, color: COLORS.muted },
  summaryValue: { fontSize: 9, color: COLORS.ink },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rowBorder,
    paddingBottom: 4,
    marginTop: 10,
    marginBottom: 2,
  },
  th: { fontSize: 7, color: COLORS.muted, textTransform: "uppercase" },
  row: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rowBorder,
    alignItems: "flex-start",
  },
  cell: { fontSize: 8, color: COLORS.ink },
  muted: { fontSize: 7, color: COLORS.muted },
  colDate: { width: "14%" },
  colDesc: { width: "36%" },
  colCat: { width: "14%" },
  colMoney: { width: "12%", textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 28,
    right: 28,
    fontSize: 8,
    color: COLORS.muted,
    textAlign: "center",
  },
})

export type StatementLine = {
  date: string
  description: string
  category: string
  money_in: string | null
  money_out: string | null
  balance: string | null
  original_amount: string | null
  original_currency: string | null
}

export type StatementData = {
  period_start: string
  period_end: string
  display_currency: "PHP" | "USD"
  needs_rate?: boolean
  rate_hint?: string | null
  opening_balance: string
  total_in: string | null
  va_pay: string | null
  business_expenses: string | null
  total_out: string | null
  net: string | null
  lines: StatementLine[]
}

function clean(value: string) {
  return (value || "").replaceAll("\u2014", "-").replaceAll("\u2013", "-").replaceAll("\u2012", "-")
}

function periodLabel(start: string, end: string) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const piece = (iso: string) => {
    const [year, month, day] = iso.slice(0, 10).split("-").map(Number)
    return `${months[(month || 1) - 1]} ${day}, ${year}`
  }
  return `${piece(start)} to ${piece(end)}`
}

function money(amount: string | null, currency: string) {
  if (amount == null || amount === "") return ""
  return formatStatementMoney(amount, currency)
}

export function StatementDocument({
  statement,
  settings,
}: {
  statement: StatementData
  settings?: Pick<Settings, "company_name" | "location" | "principal_name"> | null
}) {
  const currency = statement.display_currency === "PHP" ? "PHP" : "USD"
  const company = settings?.company_name || "Sunny Hue Creatives"
  const logoSrc = typeof window !== "undefined"
    ? `${window.location.origin}/brand/sunnyhue-logo.png`
    : "/brand/sunnyhue-logo.png"
  const period = periodLabel(statement.period_start, statement.period_end)

  return (
    <Document title="Statement of Earnings and Expenses">
      <Page size="A4" style={styles.page}>
        <View style={styles.topBand} fixed />
        <View style={styles.bottomBand} fixed />
        <View style={styles.header}>
          <Image src={logoSrc} style={styles.logo} />
          <View style={styles.meta}>
            <Text style={styles.metaLabel}>Period</Text>
            <Text style={styles.metaValue}>{period}</Text>
            <Text style={styles.metaLabel}>Shown in</Text>
            <Text style={styles.metaValue}>{currency}</Text>
          </View>
        </View>
        <Text style={styles.title}>Statement of Earnings and Expenses</Text>
        <Text style={styles.subtitle}>{company}{settings?.location ? ` · ${clean(settings.location)}` : ""}</Text>
        <View style={styles.banner}>
          <View>
            <Text style={styles.bannerAmount}>{money(statement.net, currency) || "Needs a rate"}</Text>
            <Text style={styles.bannerDue}>Net profit</Text>
          </View>
          <View>
            <Text style={styles.bannerSide}>Money in {money(statement.total_in, currency)}</Text>
            <Text style={styles.bannerSide}>Money out {money(statement.total_out, currency)}</Text>
          </View>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Opening balance</Text>
          <Text style={styles.summaryValue}>{money(statement.opening_balance, currency)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total money in</Text>
          <Text style={styles.summaryValue}>{money(statement.total_in, currency)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>VA pay</Text>
          <Text style={styles.summaryValue}>{money(statement.va_pay, currency)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Business expenses</Text>
          <Text style={styles.summaryValue}>{money(statement.business_expenses, currency)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total money out</Text>
          <Text style={styles.summaryValue}>{money(statement.total_out, currency)}</Text>
        </View>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, styles.colDate]}>Date</Text>
          <Text style={[styles.th, styles.colDesc]}>Description</Text>
          <Text style={[styles.th, styles.colCat]}>Category</Text>
          <Text style={[styles.th, styles.colMoney]}>In</Text>
          <Text style={[styles.th, styles.colMoney]}>Out</Text>
          <Text style={[styles.th, styles.colMoney]}>Balance</Text>
        </View>
        {statement.lines.map((line, index) => (
          <View key={`${line.date}-${index}`} style={styles.row}>
            <Text style={[styles.cell, styles.colDate]}>{line.date}</Text>
            <View style={styles.colDesc}>
              <Text style={styles.cell}>{clean(line.description)}</Text>
              {line.original_amount ? (
                <Text style={styles.muted}>Recorded {money(line.original_amount, line.original_currency || currency)}</Text>
              ) : null}
            </View>
            <Text style={[styles.cell, styles.colCat]}>{line.category}</Text>
            <Text style={[styles.cell, styles.colMoney]}>{money(line.money_in, currency)}</Text>
            <Text style={[styles.cell, styles.colMoney]}>{money(line.money_out, currency)}</Text>
            <Text style={[styles.cell, styles.colMoney]}>{money(line.balance, currency)}</Text>
          </View>
        ))}
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) => `${company} · Statement · Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  )
}
