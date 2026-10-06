import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import type { Invoice, Settings } from "@/lib/types"
import { formatCurrency, formatDate } from "@/lib/utils"

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#1a1a2e" },
  header: { marginBottom: 30 },
  company: { fontSize: 22, fontWeight: "bold", color: "#c9a227" },
  subtitle: { fontSize: 10, color: "#666", marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  label: { fontSize: 9, color: "#888", textTransform: "uppercase" },
  table: { marginTop: 10 },
  tableHeader: { flexDirection: "row", backgroundColor: "#1a1a2e", color: "#fff", padding: 8 },
  tableRow: { flexDirection: "row", borderBottom: "1px solid #eee", padding: 8 },
  colDate: { width: "15%" },
  colDesc: { width: "40%" },
  colHours: { width: "15%", textAlign: "right" },
  colRate: { width: "15%", textAlign: "right" },
  colAmount: { width: "15%", textAlign: "right" },
  totalBox: { marginTop: 20, backgroundColor: "#faf8f5", padding: 15, alignItems: "flex-end" },
  totalDue: { fontSize: 18, fontWeight: "bold", color: "#c9a227" },
  footer: { marginTop: 40, padding: 15, backgroundColor: "#f5f5f5", fontSize: 9, color: "#555" },
})

function paymentFooter(method: string, settings: Settings, bankDetails?: string | null) {
  if (method === "wise") return `Payment via Wise: ${settings.wise_email}`
  if (method === "paypal") return `Payment via PayPal: ${settings.paypal_email}`
  return `Payment via Bank Transfer:\n${bankDetails || ""}`
}

export function InvoiceDocument({
  invoice,
  settings,
  showPricing = true,
}: {
  invoice: Invoice
  settings: Settings
  showPricing?: boolean
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.company}>{settings.company_name}</Text>
          <Text style={styles.subtitle}>{settings.principal_name}, Principal</Text>
          <Text style={styles.subtitle}>{settings.location}</Text>
        </View>

        <View style={styles.row}>
          <View>
            <Text style={styles.label}>Invoice</Text>
            <Text style={{ fontSize: 14, fontWeight: "bold" }}>{invoice.invoice_number}</Text>
          </View>
          <View>
            <Text style={styles.label}>Issue Date</Text>
            <Text>{formatDate(invoice.issue_date)}</Text>
            <Text style={[styles.label, { marginTop: 8 }]}>Due Date</Text>
            <Text>{formatDate(invoice.due_date)}</Text>
          </View>
        </View>

        <View style={{ marginBottom: 20 }}>
          <Text style={styles.label}>Bill To</Text>
          <Text style={{ fontSize: 12, fontWeight: "bold" }}>{invoice.client_name}</Text>
          <Text style={{ color: "#666" }}>{invoice.period_label}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colDate}>Date</Text>
            <Text style={styles.colDesc}>Description</Text>
            <Text style={styles.colHours}>Hours</Text>
            {showPricing && (
              <>
                <Text style={styles.colRate}>Rate</Text>
                <Text style={styles.colAmount}>Amount</Text>
              </>
            )}
          </View>
          {invoice.line_items.map((item, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.colDate}>{formatDate(item.line_date)}</Text>
              <Text style={styles.colDesc}>{item.description}</Text>
              <Text style={styles.colHours}>{item.hours}</Text>
              {showPricing && (
                <>
                  <Text style={styles.colRate}>{formatCurrency(item.rate)}</Text>
                  <Text style={styles.colAmount}>{formatCurrency(item.amount)}</Text>
                </>
              )}
            </View>
          ))}
        </View>

        <View style={styles.totalBox}>
          <Text>Total Hours: {invoice.total_hours}</Text>
          {showPricing && (
            <Text style={styles.totalDue}>Total Due: {formatCurrency(invoice.amount)}</Text>
          )}
        </View>

        <View style={styles.footer}>
          <Text>Payment due within {invoice.payment_terms_days} days of invoice date.</Text>
          <Text style={{ marginTop: 6 }}>{paymentFooter(invoice.payment_method, settings, invoice.bank_details)}</Text>
          <Text style={{ marginTop: 10 }}>Thank you for choosing {settings.company_name}.</Text>
        </View>
      </Page>
    </Document>
  )
}
