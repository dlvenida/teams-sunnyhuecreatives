import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import { formatCurrency, formatDate, formatInvoiceDate } from "@/lib/utils"
import { PDF_FONT } from "@/lib/pdfFonts"

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: PDF_FONT, fontSize: 10, color: "#3d2a32", backgroundColor: "#fbf4f6" },
  header: { marginBottom: 20 },
  company: { fontSize: 16, color: "#c45a7a", marginBottom: 8 },
  vaName: { fontSize: 20, color: "#3d2a32", marginBottom: 4 },
  period: { fontSize: 12, color: "#8a6b76" },
  tableHeader: { flexDirection: "row", backgroundColor: "#b67486", color: "#fff", padding: 6, marginTop: 12 },
  tableRow: { flexDirection: "row", borderBottom: "1px solid #edd5de", padding: 6, fontSize: 9 },
  col: { flex: 1 },
  section: { marginTop: 16 },
  totalBar: { marginTop: 16, backgroundColor: "#b67486", color: "#fff", padding: 12, borderRadius: 6 },
})

export interface VAEarningsPdfData {
  va_name?: string | null
  currency: string
  date_from?: string | null
  date_to?: string | null
  company_name: string
  range?: { hours: string; earned: string; entries: number; currency: string } | null
  by_client: { client_name: string; hours: string; earned: string; pay_type: string; currency: string }[]
  entries: {
    work_date: string
    client_name: string
    description: string
    hours: string
    rate: string
    pay: string
    project_name?: string | null
    task_title?: string | null
  }[]
}

export function VAEarningsDocument({ data }: { data: VAEarningsPdfData }) {
  const period =
    data.date_from && data.date_to
      ? `${formatInvoiceDate(data.date_from)} – ${formatInvoiceDate(data.date_to)}`
      : "Selected range"
  const currency = (data.range?.currency || data.currency) as "PHP" | "USD"

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.company}>{data.company_name} — VA Payroll Timesheet</Text>
          <Text style={styles.vaName}>{data.va_name || "VA"}</Text>
          <Text style={styles.period}>Date range: {period}</Text>
        </View>

        <View style={styles.section}>
          <Text style={{ fontWeight: "bold", marginBottom: 6 }}>Earnings by Client</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.col, { width: "40%" }]}>Client</Text>
            <Text style={[styles.col, { width: "15%" }]}>Type</Text>
            <Text style={[styles.col, { width: "15%", textAlign: "right" }]}>Hours</Text>
            <Text style={[styles.col, { width: "30%", textAlign: "right" }]}>Earned</Text>
          </View>
          {data.by_client.map((c) => (
            <View key={c.client_name} style={styles.tableRow}>
              <Text style={[styles.col, { width: "40%" }]}>{c.client_name}</Text>
              <Text style={[styles.col, { width: "15%" }]}>{c.pay_type}</Text>
              <Text style={[styles.col, { width: "15%", textAlign: "right" }]}>{c.hours}</Text>
              <Text style={[styles.col, { width: "30%", textAlign: "right" }]}>
                {formatCurrency(c.earned, (c.currency || currency) as "PHP" | "USD")}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={{ fontWeight: "bold", marginBottom: 6 }}>Entry Detail</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.col, { width: "14%" }]}>Date</Text>
            <Text style={[styles.col, { width: "18%" }]}>Client</Text>
            <Text style={[styles.col, { width: "34%" }]}>Description</Text>
            <Text style={[styles.col, { width: "10%", textAlign: "right" }]}>Hours</Text>
            <Text style={[styles.col, { width: "12%", textAlign: "right" }]}>Rate</Text>
            <Text style={[styles.col, { width: "12%", textAlign: "right" }]}>Pay</Text>
          </View>
          {data.entries.map((e, i) => (
            <View key={`${e.work_date}-${i}`} style={styles.tableRow}>
              <Text style={[styles.col, { width: "14%" }]}>{formatDate(e.work_date)}</Text>
              <Text style={[styles.col, { width: "18%" }]}>{e.client_name}</Text>
              <Text style={[styles.col, { width: "34%" }]}>{e.description || e.task_title || "—"}</Text>
              <Text style={[styles.col, { width: "10%", textAlign: "right" }]}>{e.hours}</Text>
              <Text style={[styles.col, { width: "12%", textAlign: "right" }]}>{formatCurrency(e.rate, currency)}</Text>
              <Text style={[styles.col, { width: "12%", textAlign: "right" }]}>{formatCurrency(e.pay, currency)}</Text>
            </View>
          ))}
          {data.entries.length === 0 && (
            <Text style={{ marginTop: 8, color: "#8a6b76" }}>No approved entries in this range.</Text>
          )}
        </View>

        {data.range && (
          <View style={styles.totalBar}>
            <Text>
              Range total: {formatCurrency(data.range.earned, currency)} · {data.range.hours} hrs ·{" "}
              {data.range.entries} entries
            </Text>
          </View>
        )}
      </Page>
    </Document>
  )
}
