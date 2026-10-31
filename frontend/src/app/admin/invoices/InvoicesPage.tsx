import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { Client, Invoice, InvoicePreview, ReportClientsResponse, Settings } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { StatusBadge } from "@/components/ui/badge"
import { StatCard } from "@/components/magicui/stat-card"
import { buttonVariants } from "@/components/ui/button"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import { InvoiceDocument } from "@/components/pdf/InvoiceDocument"
import { ReactPdfViewer } from "@/components/pdf-viewer/ReactPdfViewer"
import { generatePdfBlob } from "@/lib/pdf"
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Eye,
  FileDown,
  FileSpreadsheet,
  Plus,
  Receipt,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import { useDisplaySettings } from "@/hooks/useDisplaySettings"

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i).toLocaleString("en", { month: "long" }),
}))

type BillingOption = "hourly" | "fixed" | "retainer" | "manual"

const BILLING_OPTIONS: { value: BillingOption; label: string }[] = [
  { value: "hourly", label: "Hourly" },
  { value: "fixed", label: "Fixed Monthly Package" },
  { value: "retainer", label: "Retainer" },
  { value: "manual", label: "Custom / Manual" },
]

function optionFromClientBilling(billing: string | null | undefined): BillingOption {
  if (billing === "fixed") return "fixed"
  if (billing === "package_hours") return "retainer"
  return "hourly"
}

function apiBillingType(option: BillingOption): "hourly" | "fixed" | "package_hours" {
  if (option === "hourly") return "hourly"
  if (option === "retainer") return "package_hours"
  return "fixed"
}

export function InvoicesPage() {
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "unpaid" | "overdue">("all")
  const [form, setForm] = useState({
    client_id: "",
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    cutoff: 30,
    billing_option: "hourly" as BillingOption,
    rate: "",
    included_hours: "",
    overage_rate: "",
    invoice_number: "",
    payment_method: "wise" as "wise" | "paypal" | "bank_transfer",
    bank_details: "",
    payment_terms_days: 7,
    service_description: "",
  })
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null)
  const [detail, setDetail] = useState<Invoice | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [pdfFilename, setPdfFilename] = useState("invoice.pdf")
  const [generateError, setGenerateError] = useState("")
  const [generateSuccess, setGenerateSuccess] = useState("")
  const [extractedHours, setExtractedHours] = useState<number | null>(null)
  const [amountManual, setAmountManual] = useState(false)
  const [amountDraft, setAmountDraft] = useState("")
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState("")
  const { showPricing } = useDisplaySettings()

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => apiFetch<Client[]>("/clients"),
  })
  const activeClients = useMemo(() => clients.filter((c) => c.is_active), [clients])

  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => apiFetch<Invoice[]>("/invoices"),
  })
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<Settings>("/settings"),
  })

  const rateNum = parseFloat(form.rate)
  const effectiveRate = rateNum
  const previewEnabled = !!form.client_id && !Number.isNaN(effectiveRate) && effectiveRate > 0

  const { data: packages = [], isFetched: packagesFetched } = useQuery({
    queryKey: ["client-packages", form.client_id],
    queryFn: () => apiFetch<import("@/lib/types").ClientPackage[]>(`/clients/${form.client_id}/packages`),
    enabled: !!form.client_id,
  })

  const apiBilling = apiBillingType(form.billing_option)
  const autoAmount =
    extractedHours != null && !Number.isNaN(rateNum)
      ? (Math.round(extractedHours * rateNum * 100) / 100).toFixed(2)
      : null
  const amountValue = amountManual ? amountDraft : (autoAmount ?? "")
  const amountToSend =
    extractedHours != null && amountValue !== "" && !Number.isNaN(parseFloat(amountValue))
      ? parseFloat(amountValue)
      : null

  const { data: periodPreview, isFetching: previewLoading } = useQuery({
    queryKey: ["invoice-preview", form.client_id, form.year, form.month, form.cutoff, form.billing_option, form.rate, form.included_hours, form.overage_rate],
    queryFn: () => {
      const qs = new URLSearchParams({
        client_id: form.client_id,
        year: String(form.year),
        month: String(form.month),
        cutoff: String(form.cutoff),
        billing_type: apiBilling,
        rate: form.rate,
      })
      if (form.included_hours) qs.set("included_hours", form.included_hours)
      if (form.overage_rate) qs.set("overage_rate", form.overage_rate)
      return apiFetch<InvoicePreview>(`/invoices/preview?${qs}`)
    },
    enabled: previewEnabled,
  })

  const appliedUrlClient = useRef<string | null>(null)
  useEffect(() => {
    const client = searchParams.get("client")
    if (!client || activeClients.length === 0) return
    if (appliedUrlClient.current === client) return
    const c = activeClients.find((x) => x.id === client)
    if (!c) return
    appliedUrlClient.current = client
    setForm((f) => ({
      ...f,
      client_id: client,
      month: Number(searchParams.get("month") || f.month),
      year: Number(searchParams.get("year") || f.year),
      cutoff: Number(searchParams.get("cutoff") || f.cutoff),
      billing_option: optionFromClientBilling(c.billing_type),
      rate: c.default_rate || f.rate,
    }))
  }, [searchParams, activeClients])

  useEffect(() => {
    apiFetch<{ invoice_number: string }>(`/invoices/next-number?year=${form.year}`)
      .then((d) => setForm((f) => ({ ...f, invoice_number: d.invoice_number })))
      .catch(() => {})
  }, [form.year])

  useEffect(() => {
    setExtractedHours(null)
    setAmountManual(false)
    setAmountDraft("")
  }, [form.client_id, form.year, form.month, form.cutoff])

  useEffect(() => {
    if (!packagesFetched || !form.client_id || form.billing_option !== "retainer") return
    if (form.included_hours || form.overage_rate) return
    const def = packages.find((p) => p.is_default && p.is_active) ?? packages.find((p) => p.is_active)
    if (!def || (!def.included_hours && !def.overage_rate)) return
    setForm((f) => {
      if (f.client_id !== form.client_id || f.billing_option !== "retainer") return f
      if (f.included_hours || f.overage_rate) return f
      return {
        ...f,
        included_hours: def.included_hours || "",
        overage_rate: def.overage_rate || "",
        rate: f.rate || def.amount || "",
      }
    })
  }, [packagesFetched, packages, form.client_id, form.billing_option, form.included_hours, form.overage_rate])

  useEffect(() => {
    if (!settings) return
    if (form.payment_method === "wise" && settings.wise_email && !form.bank_details) {
      setForm((f) => ({ ...f, bank_details: settings.wise_email }))
    }
    if (form.payment_method === "paypal" && settings.paypal_email && !form.bank_details) {
      setForm((f) => ({ ...f, bank_details: settings.paypal_email }))
    }
  }, [form.payment_method, settings])

  const onClientChange = (clientId: string) => {
    const c = activeClients.find((x) => x.id === clientId)
    const rate = c?.default_rate || ""
    setForm((f) => ({
      ...f,
      client_id: clientId,
      billing_option: optionFromClientBilling(c?.billing_type),
      rate,
      included_hours: "",
      overage_rate: "",
    }))
    setGenerateError("")
    setGenerateSuccess("")
    setExtractError("")
  }

  const extractLogs = async () => {
    if (!form.client_id) {
      setExtractError("Select a client first.")
      return
    }
    setExtracting(true)
    setExtractError("")
    try {
      const qs = new URLSearchParams({
        client_id: form.client_id,
        year: String(form.year),
        month: String(form.month),
        cutoff: String(form.cutoff),
      })
      const data = await apiFetch<{
        description: string
        total_hours: string | number
        entry_count?: number
      }>(`/invoices/extract?${qs}`)
      const hours = typeof data.total_hours === "number" ? data.total_hours : parseFloat(data.total_hours)
      if (data.entry_count === 0) {
        setExtractError("No time logs for this client and period.")
        setExtractedHours(null)
        setAmountManual(false)
        setAmountDraft("")
        return
      }
      const hoursLabel = Number.isNaN(hours) ? String(data.total_hours) : hours.toFixed(2)
      const description = data.description ?? ""
      const block = description ? `${description}\n\nTotal hours: ${hoursLabel}` : `Total hours: ${hoursLabel}`
      setForm((f) => {
        const existing = f.service_description
        if (!existing.trim()) return { ...f, service_description: block }
        const trimmedEnd = existing.replace(/\s+$/, "")
        if (trimmedEnd.endsWith(block)) return f
        return { ...f, service_description: `${trimmedEnd}\n\n${block}` }
      })
      setExtractedHours(Number.isNaN(hours) ? 0 : hours)
      setAmountManual(false)
      setAmountDraft("")
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Could not extract time logs")
    } finally {
      setExtracting(false)
    }
  }

  const generate = useMutation({
    mutationFn: () =>
      apiFetch<Invoice>("/invoices/generate", {
        method: "POST",
        body: JSON.stringify({
          client_id: form.client_id,
          year: form.year,
          month: form.month,
          cutoff: form.cutoff,
          billing_type: apiBilling,
          rate: rateNum,
          invoice_number: form.invoice_number || null,
          payment_method: form.payment_method,
          bank_details: form.bank_details || null,
          payment_terms_days: form.payment_terms_days,
          package_id: null,
          included_hours: form.billing_option === "retainer" && form.included_hours ? parseFloat(form.included_hours) : null,
          overage_rate: form.billing_option === "retainer" && form.overage_rate ? parseFloat(form.overage_rate) : null,
          service_description: form.service_description.trim() || null,
          ...(amountToSend != null && form.service_description.trim()
            ? { amount: amountToSend.toFixed(2) }
            : {}),
        }),
      }),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ["invoices"] })
      qc.invalidateQueries({ queryKey: ["invoice-preview"] })
      setPreviewInvoice(inv)
      setGenerateSuccess(`Invoice ${inv.invoice_number} created${showPricing ? ` — ${formatCurrency(inv.amount)}` : ""}`)
      setGenerateError("")
      apiFetch<{ invoice_number: string }>(`/invoices/next-number?year=${form.year}`).then((d) =>
        setForm((f) => ({ ...f, invoice_number: d.invoice_number })),
      )
    },
    onError: (err: Error) => {
      setGenerateError(err.message)
      setGenerateSuccess("")
    },
  })

  const markPaid = useMutation({
    mutationFn: (id: string) => apiFetch(`/invoices/${id}/mark-paid`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoices"] }); setDetail(null) },
  })
  const markUnpaid = useMutation({
    mutationFn: (id: string) => apiFetch(`/invoices/${id}/mark-unpaid`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoices"] }); setDetail(null) },
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/invoices/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  })
  const saveLine = useMutation({
    mutationFn: ({ invoiceId, lineId, description }: { invoiceId: string; lineId: string; description: string }) =>
      apiFetch<Invoice>(`/invoices/${invoiceId}/line-items/${lineId}`, {
        method: "PATCH",
        body: JSON.stringify({ description }),
      }),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ["invoices"] })
      setDetail(inv)
      setPreviewInvoice(inv)
    },
  })

  const buildPdf = async (inv: Invoice) => {
    if (!settings) return null
    return generatePdfBlob(
      <InvoiceDocument invoice={inv} settings={settings} />,
    )
  }
  /** View in the React PDF viewer (view + download inside the viewer). */
  const exportPdf = async (inv: Invoice) => {
    const blob = await buildPdf(inv)
    if (!blob) return
    setPdfFilename(`${inv.invoice_number}.pdf`)
    setPdfBlob(blob)
  }
  /** Download immediately to send to the client, without opening the viewer. */
  const downloadPdf = async (inv: Invoice) => {
    const blob = await buildPdf(inv)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `${inv.invoice_number}.pdf`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const isOverdue = (inv: Invoice) => inv.status === "unpaid" && inv.due_date < todayStr
  const daysOverdue = (inv: Invoice) => Math.floor((new Date(todayStr).getTime() - new Date(inv.due_date).getTime()) / 86400000)
  const overdueInvoices = invoices.filter(isOverdue)

  const { data: readyList } = useQuery({
    queryKey: ["invoices-ready"],
    queryFn: () => apiFetch<ReportClientsResponse>(`/reports/clients?year=${new Date().getFullYear()}&month=${new Date().getMonth() + 1}&cutoff=30&show_rate=false`),
  })
  const readyClients = (readyList?.clients ?? []).filter(c => Number(c.ready_to_invoice_hours) > 0 && !c.invoice_number)

  const exportCsv = () => {
    const rows = [["Invoice #", "Client", "Period", "Issued", "Due", "Hours", "Amount", "Status", "Paid at"],
      ...filteredInvoices.map(i => [i.invoice_number, i.client_name ?? "", i.period_label, i.issue_date, i.due_date, i.total_hours, i.amount, isOverdue(i) ? "overdue" : i.status, i.paid_at ?? ""])]
    const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" })
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "invoices.csv"; a.click(); URL.revokeObjectURL(a.href)
  }

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase()
    return invoices.filter((inv) => {
      if (statusFilter === "paid" && inv.status !== "paid") return false
      if (statusFilter === "unpaid" && inv.status !== "unpaid") return false
      if (statusFilter === "overdue" && !isOverdue(inv)) return false
      if (!q) return true
      return (
        inv.invoice_number.toLowerCase().includes(q) ||
        (inv.client_name?.toLowerCase().includes(q) ?? false) ||
        inv.period_label.toLowerCase().includes(q)
      )
    })
  }, [invoices, search, statusFilter])

  const totalBilled = invoices.reduce((s, i) => s + parseFloat(i.amount), 0)
  const totalPaid = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + parseFloat(i.amount), 0)
  const totalUnpaid = totalBilled - totalPaid

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="font-display text-base font-semibold">Invoices</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">Generate client invoices anytime — independent of VA timesheet / payroll approval. Customize service descriptions before sending.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {showPricing ? (
          <>
            <StatCard title="Total Billed" value={formatCurrency(totalBilled)} subtitle={`${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`} />
            <StatCard title="Total Paid" value={formatCurrency(totalPaid)} subtitle="Collected" className="border-green-200/60" />
            <StatCard title="Total Unpaid" value={formatCurrency(totalUnpaid)} subtitle="Outstanding" className="border-amber-200/60" />
            <StatCard title="Overdue" value={formatCurrency(overdueInvoices.reduce((s, i) => s + parseFloat(i.amount), 0))} subtitle={`${overdueInvoices.length} invoice(s) past due`} className="border-red-200/70" />
          </>
        ) : (
          <>
            <StatCard title="Invoices" value={invoices.length} subtitle="Pricing hidden" />
            <StatCard title="Unpaid" value={invoices.filter((i) => i.status === "unpaid").length} />
            <StatCard title="Paid" value={invoices.filter((i) => i.status === "paid").length} />
            <StatCard title="Overdue" value={overdueInvoices.length} subtitle="Past due — follow up" className="border-red-200/70" />
          </>
        )}
      </div>

      {readyClients.length > 0 && (
        <div className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-4">
          <p className="mb-2 flex items-center gap-2 text-xs font-extrabold"><Receipt className="h-4 w-4 text-primary" /> Ready to invoice this month</p>
          <div className="flex flex-wrap gap-2">
            {readyClients.map(c => (
              <button key={c.client_id} onClick={() => { onClientChange(c.client_id); window.scrollTo({ top: 0, behavior: "smooth" }) }} className="monday-card rounded-full border bg-card px-3 py-1.5 text-xs font-semibold">
                {c.client_name} · <span className="text-primary">{c.ready_to_invoice_hours} hrs</span> →
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Approved work that hasn't been invoiced yet. Click a client to load it into the generator.</p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Invoice Generator</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>Client</Label>
            <Select value={form.client_id} onChange={(e) => onClientChange(e.target.value)}>
              <option value="">Select client</option>
              {activeClients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Month</Label>
            <Select value={form.month} onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Year</Label>
            <Input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Cutoff</Label>
            <Select value={form.cutoff} onChange={(e) => setForm({ ...form, cutoff: Number(e.target.value) })}>
              <option value={15}>1st – 15th</option>
              <option value={30}>16th – end</option>
            </Select>
          </div>
          <div>
            <Label>Billing</Label>
            <Select
              value={form.billing_option}
              onChange={(e) => {
                const billing_option = e.target.value as BillingOption
                setForm({
                  ...form,
                  billing_option,
                  included_hours: billing_option === "retainer" ? form.included_hours : "",
                  overage_rate: billing_option === "retainer" ? form.overage_rate : "",
                })
              }}
            >
              {BILLING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </div>
          {form.billing_option === "retainer" && (
            <>
              <div>
                <Label>Included hours</Label>
                <Input type="number" step="0.01" value={form.included_hours} onChange={(e) => setForm({ ...form, included_hours: e.target.value })} />
              </div>
              <div>
                <Label>Overage rate ($/hr)</Label>
                <Input type="number" step="0.01" value={form.overage_rate} onChange={(e) => setForm({ ...form, overage_rate: e.target.value })} placeholder="0.00" />
              </div>
            </>
          )}
          <div>
            <Label>
              {extractedHours != null || form.billing_option === "hourly"
                ? "Rate per hour ($)"
                : form.billing_option === "retainer"
                  ? "Retainer amount ($)"
                  : form.billing_option === "manual"
                    ? "Amount ($)"
                    : "Package amount ($)"}
            </Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
              placeholder={extractedHours != null || form.billing_option === "hourly" ? "e.g. 13.00" : "e.g. 100.00"}
            />
            {form.billing_option === "manual" && extractedHours == null && (
              <p className="mt-1 text-[10px] text-muted-foreground">Billed as entered. Time logs are not required.</p>
            )}
          </div>
          {extractedHours != null && (
            <div>
              <Label>Amount ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amountValue}
                onChange={(e) => {
                  setAmountManual(true)
                  setAmountDraft(e.target.value)
                }}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {autoAmount
                  ? `${extractedHours.toFixed(2)} hrs × ${formatCurrency(rateNum)} = ${formatCurrency(autoAmount)}`
                  : "Enter a rate. Amount = hours × rate."}
                {amountManual && amountValue !== (autoAmount ?? "")
                  ? ` Invoice amount is ${amountValue ? formatCurrency(amountValue) : "blank"}.`
                  : ""}
              </p>
            </div>
          )}
          <div>
            <Label>Invoice #</Label>
            <Input value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} />
            <p className="mt-1 text-[10px] text-muted-foreground">Auto-filled as SHC-YYYY-NNN. You can edit it.</p>
          </div>
          <div>
            <Label>Payment terms</Label>
            <Select value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: Number(e.target.value) })}>
              <option value={7}>Net 7 days</option>
              <option value={14}>Net 14 days</option>
              <option value={30}>Net 30 days</option>
            </Select>
          </div>
          <div>
            <Label>Payment method</Label>
            <Select
              value={form.payment_method}
              onChange={(e) => {
                const method = e.target.value as typeof form.payment_method
                const details =
                  method === "wise" ? settings?.wise_email || "" :
                  method === "paypal" ? settings?.paypal_email || "" : ""
                setForm({ ...form, payment_method: method, bank_details: details })
              }}
            >
              <option value="wise">Wise</option>
              <option value="paypal">PayPal</option>
              <option value="bank_transfer">Bank transfer</option>
            </Select>
          </div>
          {form.payment_method === "bank_transfer" && (
            <div className="sm:col-span-2 lg:col-span-4">
              <Label>Bank details</Label>
              <Textarea value={form.bank_details} onChange={(e) => setForm({ ...form, bank_details: e.target.value })} placeholder="Account name, bank, routing..." rows={2} />
            </div>
          )}
          <div className="sm:col-span-2 lg:col-span-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <Label>Service description (appears on the client PDF)</Label>
              <Button type="button" variant="outline" size="sm" disabled={!form.client_id || extracting} onClick={() => { void extractLogs() }}>
                {extracting ? "Extracting..." : "Extract from time logs"}
              </Button>
            </div>
            <Textarea
              value={form.service_description}
              onChange={(e) => setForm({ ...form, service_description: e.target.value })}
              placeholder={"Hint only — e.g. Social Media VA Services — Melaleuca & Elite Vitality"}
              rows={5}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Extract copies each time log as written, plus a total-hours line. Edit it before generating. Leave blank to use “Social Media VA Services — [period]” (never “Engagement Package”). The grey hint text never appears on the invoice.
            </p>
            {extractError && (
              <p className="mt-1 text-[11px] text-amber-700">{extractError}</p>
            )}
          </div>
        </div>

        {previewEnabled && (
          <div className={`mt-4 rounded-lg border px-3 py-2.5 text-xs ${periodPreview?.can_generate ? "border-green-300/60 bg-green-50/80 text-green-900" : "border-amber-300/60 bg-amber-50/80 text-amber-950"}`}>
            {previewLoading ? (
              <span>Checking approved entries...</span>
            ) : periodPreview ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium">{periodPreview.period_label}</p>
                  <p>
                    {form.billing_option === "manual"
                      ? (periodPreview.can_generate
                        ? "Custom / manual invoice — time logs are not required. Extract descriptions if you want them on the PDF, then set the amount."
                        : "Enter an amount to generate. Time logs are not required.")
                      : periodPreview.message}
                  </p>
                  {amountToSend != null && form.service_description.trim() && (
                    <p className="text-[11px]">
                      Invoice amount {formatCurrency(amountToSend)} ({extractedHours?.toFixed(2)} hrs × rate). Edit the amount or the description before generating.
                    </p>
                  )}
                      {periodPreview.approved_entries > 0 && (
                    <p className="text-[11px] opacity-80">
                      {periodPreview.approved_entries} entries · {periodPreview.total_hours} hrs
                      {showPricing && periodPreview.estimated_amount != null && ` · Est. ${formatCurrency(periodPreview.estimated_amount)}`}
                    </p>
                  )}
                </div>
                {!periodPreview.can_generate && periodPreview.submitted_entries > 0 && (
                  <Link to="/admin/logs?status=submitted" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    Review logs →
                  </Link>
                )}
              </div>
            ) : null}
          </div>
        )}

        {generateError && (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-red-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {generateError}
          </p>
        )}
        {generateSuccess && (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {generateSuccess}
          </p>
        )}

        <Button
          variant="gold"
          className="mt-4"
          disabled={!previewEnabled || !periodPreview?.can_generate || generate.isPending}
          onClick={() => generate.mutate()}
        >
          <Receipt className="h-3.5 w-3.5" />
          {generate.isPending ? "Generating..." : "Generate invoice"}
        </Button>
      </div>

      {previewInvoice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium">
            Latest: {previewInvoice.invoice_number}{showPricing ? ` — ${formatCurrency(previewInvoice.amount)}` : ""}
          </span>
          <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportPdf(previewInvoice)}>
            <Eye className="h-3.5 w-3.5" /> View PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadPdf(previewInvoice)}>
            <FileDown className="h-3.5 w-3.5" /> Download
          </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Invoice history</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-8 w-44 pl-8" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="h-8 w-28">
              <option value="all">All</option>
              <option value="unpaid">Unpaid</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
            </Select>
            <Button size="sm" variant="outline" onClick={exportCsv}><FileSpreadsheet className="h-3.5 w-3.5" /> CSV</Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="p-3 font-medium">Invoice #</th>
                <th className="p-3 font-medium">Client</th>
                <th className="p-3 font-medium">Period</th>
                <th className="p-3 font-medium">Due</th>
                <th className="p-3 font-medium">Hours</th>
                {showPricing && <th className="p-3 font-medium">Amount</th>}
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={showPricing ? 8 : 7} className="p-8 text-center text-muted-foreground">
                    {invoices.length === 0
                      ? "No invoices yet. Generate your first invoice above."
                      : "No invoices match your search."}
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{inv.invoice_number}</td>
                    <td className="p-3">{inv.client_name}</td>
                    <td className="p-3 text-muted-foreground">{inv.period_label}</td>
                    <td className="p-3 whitespace-nowrap text-muted-foreground">{formatDate(inv.due_date)}{isOverdue(inv) && <span className="block text-[10px] font-bold text-red-600">{daysOverdue(inv)}d overdue</span>}</td>
                    <td className="p-3">{inv.total_hours}</td>
                    {showPricing && <td className="p-3 font-medium">{formatCurrency(inv.amount)}</td>}
                    <td className="p-3">{isOverdue(inv) ? <span className="whitespace-nowrap rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">Overdue</span> : <StatusBadge status={inv.status} />}</td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title="View details" onClick={() => setDetail(inv)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" title="View PDF" onClick={() => exportPdf(inv)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Download PDF (send to client)" onClick={() => downloadPdf(inv)}>
                          <FileDown className="h-3.5 w-3.5" />
                        </Button>
                        {inv.status === "unpaid" && (
                          <Button size="sm" variant="success" onClick={() => markPaid.mutate(inv.id)}>Mark paid</Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Delete"
                          onClick={() => {
                            if (confirm(`Delete invoice ${inv.invoice_number}? Work logs will be un-invoiced.`)) remove.mutate(inv.id)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-card p-6" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{detail.invoice_number}</h2>
                <p className="text-xs text-muted-foreground">{detail.client_name} · {detail.period_label}</p>
              </div>
              <button onClick={() => setDetail(null)} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div className="rounded-xl border p-3"><p className="text-muted-foreground">Status</p><p className="mt-1 font-bold">{isOverdue(detail) ? `Overdue by ${daysOverdue(detail)}d` : detail.status}</p></div>
              <div className="rounded-xl border p-3"><p className="text-muted-foreground">Issued → Due</p><p className="mt-1 font-bold">{formatDate(detail.issue_date)} → {formatDate(detail.due_date)}</p></div>
              <div className="rounded-xl border p-3"><p className="text-muted-foreground">Hours</p><p className="mt-1 font-bold">{detail.total_hours} hrs</p></div>
              <div className="rounded-xl border p-3"><p className="text-muted-foreground">{showPricing ? "Amount" : "Payment"}</p><p className="mt-1 font-bold">{showPricing ? formatCurrency(detail.amount) : detail.payment_method}</p></div>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" /> Net {detail.payment_terms_days} days via {detail.payment_method}{detail.paid_at ? ` · Paid ${formatDate(detail.paid_at.slice(0, 10))}` : ""}</p>
            <p className="mt-4 text-[11px] text-muted-foreground">
              The PDF uses this service description exactly as saved.
            </p>
            <div className="mt-2 overflow-x-auto rounded-xl border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="p-2.5">Service description (client-facing)</th>
                    {showPricing && <th className="p-2.5 w-28">Amount</th>}
                  </tr>
                </thead>
                <tbody>
                  {(detail.line_items ?? []).map((li) => (
                    <tr key={li.id} className="border-b last:border-0 align-top">
                      <td className="p-2.5">
                        <Textarea
                          rows={2}
                          className="min-h-[56px] text-xs"
                          defaultValue={li.description}
                          onBlur={(e) => {
                            const next = e.target.value.trim()
                            if (next && next !== li.description) {
                              saveLine.mutate({ invoiceId: detail.id, lineId: li.id, description: next })
                            }
                          }}
                        />
                      </td>
                      {showPricing && <td className="whitespace-nowrap p-2.5 font-semibold">{formatCurrency(li.amount)}</td>}
                    </tr>
                  ))}
                  {(detail.line_items ?? []).length === 0 && (
                    <tr>
                      <td colSpan={showPricing ? 2 : 1} className="p-4 text-center text-muted-foreground">
                        No line items stored for this invoice.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => exportPdf(detail)}><Eye className="h-4 w-4" /> View PDF</Button>
              <Button variant="outline" onClick={() => downloadPdf(detail)}><FileDown className="h-4 w-4" /> Download PDF</Button>
              {detail.status === "unpaid" && <Button variant="success" onClick={() => markPaid.mutate(detail.id)}>Mark paid</Button>}
              {detail.status === "paid" && <Button variant="outline" onClick={() => markUnpaid.mutate(detail.id)}><Undo2 className="h-4 w-4" /> Mark unpaid</Button>}
            </div>
          </div>
        </div>
      )}

      <ReactPdfViewer blob={pdfBlob} filename={pdfFilename} onClose={() => setPdfBlob(null)} />
    </div>
  )
}
