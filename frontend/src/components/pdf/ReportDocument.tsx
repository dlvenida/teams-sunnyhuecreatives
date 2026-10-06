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
  colDate: { width: "20%" },
  colDesc: { width: "50%" },
  colHours: { width: "15%", textAlign: "right" },
  colRate: { width: "15%", textAlign: "right" },
  totalBar: { marginTop: 20, backgroundColor: "#1a1a2e", color: "#fff", padding: 12, flexDirection: "row", justifyContent: "space-between" },
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

        <View style={styles.tableHeader}>
          <Text style={styles.colDate}>Date</Text>
          <Text style={styles.colDesc}>Task / Service</Text>
          <Text style={styles.colHours}>Hours</Text>
          {report.show_rate && <Text style={styles.colRate}>Amount</Text>}
        </View>

        {report.lines.map((line, i) => (
          <View key={i} style={styles.tableRow}>
            <Text style={styles.colDate}>{formatDate(line.work_date)}</Text>
            <Text style={styles.colDesc}>{line.description}</Text>
            <Text style={styles.colHours}>{line.hours}</Text>
            {report.show_rate && <Text style={styles.colRate}>{formatCurrency(line.amount || 0)}</Text>}
          </View>
        ))}

        <View style={styles.totalBar}>
          <Text>Total Hours</Text>
          <Text style={{ fontWeight: "bold" }}>{report.total_hours} hrs</Text>
        </View>
        {report.show_rate && report.total_amount && (
          <View style={[styles.totalBar, { marginTop: 4, backgroundColor: "#c9a227", color: "#1a1a2e" }]}>
            <Text>Grand Total</Text>
            <Text style={{ fontWeight: "bold" }}>{formatCurrency(report.total_amount)}</Text>
          </View>
        )}
      </Page>
    </Document>
  )
}
