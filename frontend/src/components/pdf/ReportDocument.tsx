import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import type { ReportResponse, Settings } from "@/lib/types"
import { formatCurrency, formatDate } from "@/lib/utils"

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#1a1a2e" },
  header: { marginBottom: 30 },
  company: { fontSize: 22, fontWeight: "bold", color: "#c9a227" },
  subtitle: { fontSize: 10, color: "#666", marginTop: 4 },
  tableHeader: { flexDirection: "row", backgroundColor: "#1a1a2e", color: "#fff", padding: 8, marginTop: 20 },
  tableRow: { flexDirection: "row", borderBottom: "1px solid #eee", padding: 8 },
  colDate: { width: "18%" },
  colDesc: { width: "42%" },
  colHours: { width: "12%", textAlign: "right" },
  colRate: { width: "14%", textAlign: "right" },
  colAmt: { width: "14%", textAlign: "right" },
  totalBar: { marginTop: 20, backgroundColor: "#1a1a2e", color: "#fff", padding: 12, flexDirection: "row", justifyContent: "space-between" },
  vaHeader: { flexDirection: "row", backgroundColor: "#f5f5f5", padding: 6, marginTop: 12, fontWeight: "bold" },
})

export function ReportDocument({ report, settings }: { report: ReportResponse; settings: Settings }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.company}>{settings.company_name}</Text>
          <Text style={styles.subtitle}>Work Report</Text>
        </View>

        <Text style={{ fontSize: 9, color: "#888" }}>PREPARED FOR</Text>
        <Text style={{ fontSize: 14, fontWeight: "bold", marginBottom: 4 }}>{report.client_name}</Text>
        <Text style={{ color: "#666", marginBottom: 4 }}>Billing Period: {report.period_label}</Text>
        <Text style={{ color: "#666" }}>Generated: {formatDate(report.generated_at)}</Text>

        {(report.by_va ?? []).length > 0 && (
          <View>
            <Text style={{ marginTop: 16, fontWeight: "bold" }}>Totals per VA</Text>
            <View style={styles.vaHeader}>
              <Text style={{ width: "40%" }}>VA</Text>
              <Text style={{ width: "15%", textAlign: "right" }}>Hours</Text>
              {report.show_rate && <Text style={{ width: "20%", textAlign: "right" }}>Rate</Text>}
              {report.show_rate && <Text style={{ width: "25%", textAlign: "right" }}>Total</Text>}
              {!report.show_rate && <Text style={{ width: "45%", textAlign: "right" }}>Entries</Text>}
            </View>
            {(report.by_va ?? []).map((b) => (
              <View key={b.label} style={styles.tableRow}>
                <Text style={{ width: "40%" }}>{b.label}</Text>
                <Text style={{ width: "15%", textAlign: "right" }}>{b.hours}</Text>
                {report.show_rate && (
                  <Text style={{ width: "20%", textAlign: "right" }}>
                    {b.rate != null ? formatCurrency(b.rate) : "—"}
                  </Text>
                )}
                {report.show_rate && (
                  <Text style={{ width: "25%", textAlign: "right" }}>
                    {b.amount != null ? formatCurrency(b.amount) : "—"}
                  </Text>
                )}
                {!report.show_rate && <Text style={{ width: "45%", textAlign: "right" }}>{b.entries}</Text>}
              </View>
            ))}
          </View>
        )}

        <View style={styles.tableHeader}>
          <Text style={styles.colDate}>Date</Text>
          <Text style={styles.colDesc}>Task / Service</Text>
          <Text style={styles.colHours}>Hours</Text>
          {report.show_rate && <Text style={styles.colRate}>Rate</Text>}
          {report.show_rate && <Text style={styles.colAmt}>Amount</Text>}
        </View>

        {report.lines.map((line, i) => (
          <View key={i} style={styles.tableRow}>
            <Text style={styles.colDate}>{formatDate(line.work_date)}</Text>
            <Text style={styles.colDesc}>
              {line.va_name ? `${line.va_name}: ` : ""}
              {line.description}
            </Text>
            <Text style={styles.colHours}>{line.hours}</Text>
            {report.show_rate && <Text style={styles.colRate}>{line.rate != null ? formatCurrency(line.rate) : "—"}</Text>}
            {report.show_rate && <Text style={styles.colAmt}>{formatCurrency(line.amount || 0)}</Text>}
          </View>
        ))}

        <View style={styles.totalBar}>
          <Text>Total Hours</Text>
          <Text style={{ fontWeight: "bold" }}>{report.total_hours} hrs</Text>
        </View>
        {report.show_rate && report.total_amount != null && (
          <View style={[styles.totalBar, { marginTop: 4, backgroundColor: "#c9a227", color: "#1a1a2e" }]}>
            <Text>Grand Total</Text>
            <Text style={{ fontWeight: "bold" }}>{formatCurrency(report.total_amount)}</Text>
          </View>
        )}
      </Page>
    </Document>
  )
}
