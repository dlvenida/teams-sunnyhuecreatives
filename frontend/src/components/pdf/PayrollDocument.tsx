import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import type { PayrollResponse, Settings } from "@/lib/types"
import { formatCurrency, formatDate, formatInvoiceDate } from "@/lib/utils"
import { PDF_FONT } from "@/lib/pdfFonts"

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: PDF_FONT, fontSize: 10, color: "#3d2a32", backgroundColor: "#fbf4f6" },
  header: { marginBottom: 20 },
  company: { fontSize: 16, color: "#c45a7a" },
  vaSection: { marginTop: 20, marginBottom: 10 },
  vaName: { fontSize: 12, fontWeight: "bold", backgroundColor: "#f3d5df", padding: 8, borderRadius: 4 },
  tableHeader: { flexDirection: "row", backgroundColor: "#1a1a2e", color: "#fff", padding: 6, marginTop: 6 },
  tableRow: { flexDirection: "row", borderBottom: "1px solid #eee", padding: 6, fontSize: 9 },
  col: { flex: 1 },
  subtotal: { flexDirection: "row", justifyContent: "flex-end", padding: 8, fontWeight: "bold" },
  grandTotal: { marginTop: 20, backgroundColor: "#1a1a2e", color: "#fff", padding: 12 },
  clientRow: { flexDirection: "row", paddingVertical: 3, fontSize: 9 },
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
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.company}>{settings.company_name} — VA Payroll Report</Text>
          {payroll.vas.length === 1 && (
            <Text style={{ fontSize: 18, color: "#3d2a32", marginTop: 8 }}>{payroll.vas[0].va_name}</Text>
          )}
          <Text style={{ color: "#8a6b76", marginTop: 4 }}>
            Date range: {formatInvoiceDate(payroll.period_start)} – {formatInvoiceDate(payroll.period_end)}
          </Text>
          <Text style={{ color: "#8a6b76" }}>CONFIDENTIAL — Internal Use Only</Text>
        </View>

        {payroll.vas.map((va) => (
          <View key={va.va_id} style={styles.vaSection} wrap={false}>
            <Text style={styles.vaName}>
              {va.va_name} ({va.currency}) —{" "}
              {showPricing ? formatCurrency(va.total_pay, va.currency) : `${va.total_hours} hrs`} | {va.total_hours} hrs |{" "}
              {va.entry_count} entries
            </Text>

            {(va.by_client ?? []).length > 0 && (
              <View style={{ marginTop: 6, marginBottom: 4 }}>
                <Text style={{ fontSize: 9, fontWeight: "bold", marginBottom: 2 }}>By client</Text>
                {(va.by_client ?? []).map((c) => (
                  <View key={c.label} style={styles.clientRow}>
                    <Text style={{ width: "50%" }}>{c.label}</Text>
                    <Text style={{ width: "25%", textAlign: "right" }}>{c.hours} hrs</Text>
                    {showPricing && (
                      <Text style={{ width: "25%", textAlign: "right" }}>{formatCurrency(c.pay, va.currency)}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            <View style={styles.tableHeader}>
              <Text style={[styles.col, { width: "14%" }]}>Date</Text>
              <Text style={[styles.col, { width: "18%" }]}>Client</Text>
              <Text style={[styles.col, { width: showPricing ? "34%" : "58%" }]}>Description</Text>
              <Text style={[styles.col, { width: "10%", textAlign: "right" }]}>Hours</Text>
              {showPricing && (
                <>
                  <Text style={[styles.col, { width: "12%", textAlign: "right" }]}>Rate</Text>
                  <Text style={[styles.col, { width: "12%", textAlign: "right" }]}>Pay</Text>
                </>
              )}
            </View>
            {va.entries.map((e) => (
              <View key={e.id} style={styles.tableRow}>
                <Text style={[styles.col, { width: "14%" }]}>{formatDate(e.work_date)}</Text>
                <Text style={[styles.col, { width: "18%" }]}>{e.client_name}</Text>
                <Text style={[styles.col, { width: showPricing ? "34%" : "58%" }]}>{e.description}</Text>
                <Text style={[styles.col, { width: "10%", textAlign: "right" }]}>{e.hours}</Text>
                {showPricing && (
                  <>
                    <Text style={[styles.col, { width: "12%", textAlign: "right" }]}>{formatCurrency(e.rate, va.currency)}</Text>
                    <Text style={[styles.col, { width: "12%", textAlign: "right" }]}>{formatCurrency(e.pay, va.currency)}</Text>
                  </>
                )}
              </View>
            ))}
            {showPricing && (
              <View style={styles.subtotal}>
                <Text>
                  Subtotal {va.va_name}: {formatCurrency(va.total_pay, va.currency)} ({va.total_hours} hrs)
                </Text>
              </View>
            )}
          </View>
        ))}

        {showPricing && (
          <View style={styles.grandTotal}>
            <Text>Total PHP Payout: {formatCurrency(payroll.total_php, "PHP")}</Text>
            <Text style={{ marginTop: 4 }}>Total USD Payout: {formatCurrency(payroll.total_usd, "USD")}</Text>
          </View>
        )}
      </Page>
    </Document>
  )
}
