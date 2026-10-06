import { useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { Client, Invoice, InvoicePreview, Settings } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { StatusBadge } from "@/components/ui/badge"
import { StatCard } from "@/components/magicui/stat-card"
import { buttonVariants } from "@/components/ui/button"
import { cn, formatCurrency } from "@/lib/utils"
import { InvoiceDocument } from "@/components/pdf/InvoiceDocument"
import { PdfPreviewModal } from "@/components/pdf-viewer/PdfPreviewModal"
import { generatePdfBlob } from "@/lib/pdf"
import {
  AlertCircle,
  CheckCircle2,
  FileDown,
  Plus,
  Receipt,
  Search,
  Trash2,
} from "lucide-react"
import { useDisplaySettings } from "@/hooks/useDisplaySettings"

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i).toLocaleString("en", { month: "long" }),
}))

export function InvoicesPage() {
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "unpaid">("all")
  const [form, setForm] = useState({
    client_id: "",
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    cutoff: 30,
    billing_type: "hourly" as "hourly" | "fixed",
    rate: "",
    invoice_number: "",
    payment_method: "wise" as "wise" | "paypal" | "bank_transfer",
    bank_details: "",
    payment_terms_days: 7,
  })
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [generateError, setGenerateError] = useState("")
  const [generateSuccess, setGenerateSuccess] = useState("")
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

  const { data: periodPreview, isFetching: previewLoading } = useQuery({
    queryKey: ["invoice-preview", form.client_id, form.year, form.month, form.cutoff, form.billing_type, form.rate],
    queryFn: () =>
      apiFetch<InvoicePreview>(
        `/invoices/preview?client_id=${form.client_id}&year=${form.year}&month=${form.month}&cutoff=${form.cutoff}&billing_type=${form.billing_type}&rate=${form.rate}`,
      ),
    enabled: previewEnabled,
  })

  useEffect(() => {
    const client = searchParams.get("client")
    if (!client || activeClients.length === 0) return
    const c = activeClients.find((x) => x.id === client)
    setForm((f) => ({
      ...f,
      client_id: client,
      month: Number(searchParams.get("month") || f.month),
      year: Number(searchParams.get("year") || f.year),
      cutoff: Number(searchParams.get("cutoff") || f.cutoff),
      billing_type: (c?.billing_type as "hourly" | "fixed") || f.billing_type,
      rate: c?.default_rate || f.rate,
    }))
  }, [searchParams, activeClients])

  useEffect(() => {
    if (!form.client_id) return
    apiFetch<{ invoice_number: string }>(`/invoices/next-number?year=${form.year}`)
      .then((d) => setForm((f) => ({ ...f, invoice_number: d.invoice_number })))
      .catch(() => {})
  }, [form.client_id, form.year])

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
    const rate = c?.default_rate || (showPricing ? "" : "75")
    setForm((f) => ({
      ...f,
      client_id: clientId,
      billing_type: (c?.billing_type as "hourly" | "fixed") || "hourly",
      rate,
    }))
    setGenerateError("")
    setGenerateSuccess("")
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
          billing_type: form.billing_type,
          rate: rateNum,
          invoice_number: form.invoice_number || null,
          payment_method: form.payment_method,
          bank_details: form.bank_details || null,
          payment_terms_days: form.payment_terms_days,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/invoices/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  })

  const exportPdf = async (inv: Invoice) => {
    if (!settings) return
    const blob = await generatePdfBlob(
      <InvoiceDocument invoice={inv} settings={settings} showPricing={showPricing} />,
    )
    setPdfBlob(blob)
  }

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase()
    return invoices.filter((inv) => {
      if (statusFilter === "paid" && inv.status !== "paid") return false
      if (statusFilter === "unpaid" && inv.status !== "unpaid") return false
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
        <p className="mt-0.5 text-xs text-muted-foreground">Generate client invoices from approved VA time logs</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {showPricing ? (
          <>
            <StatCard title="Total Billed" value={formatCurrency(totalBilled)} subtitle={`${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`} />
            <StatCard title="Total Paid" value={formatCurrency(totalPaid)} subtitle="Collected" className="border-green-200/60" />
            <StatCard title="Total Unpaid" value={formatCurrency(totalUnpaid)} subtitle="Outstanding" className="border-amber-200/60" />
          </>
        ) : (
          <>
            <StatCard title="Invoices" value={invoices.length} subtitle="Pricing hidden" />
            <StatCard title="Unpaid" value={invoices.filter((i) => i.status === "unpaid").length} />
            <StatCard title="Paid" value={invoices.filter((i) => i.status === "paid").length} />
          </>
        )}
      </div>

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
              <option value={30}>Full month</option>
            </Select>
          </div>
          <div>
            <Label>Billing type</Label>
            <Select value={form.billing_type} onChange={(e) => setForm({ ...form, billing_type: e.target.value as "hourly" | "fixed" })}>
              <option value="hourly">Hourly</option>
              <option value="fixed">Fixed package</option>
            </Select>
          </div>
          {showPricing && (
          <div>
            <Label>{form.billing_type === "hourly" ? "Hourly rate ($)" : "Package amount ($)"}</Label>
            <Input type="number" min="0" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="0.00" />
          </div>
          )}
          <div>
            <Label>Invoice #</Label>
            <Input value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} />
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
        </div>

        {previewEnabled && (
          <div className={`mt-4 rounded-lg border px-3 py-2.5 text-xs ${periodPreview?.can_generate ? "border-green-300/60 bg-green-50/80 text-green-900" : "border-amber-300/60 bg-amber-50/80 text-amber-950"}`}>
            {previewLoading ? (
              <span>Checking approved entries...</span>
            ) : periodPreview ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium">{periodPreview.period_label}</p>
                  <p>{periodPreview.message}</p>
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
          <Button variant="outline" size="sm" onClick={() => exportPdf(previewInvoice)}>
            <FileDown className="h-3.5 w-3.5" /> Preview PDF
          </Button>
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
              <option value="paid">Paid</option>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="p-3 font-medium">Invoice #</th>
                <th className="p-3 font-medium">Client</th>
                <th className="p-3 font-medium">Period</th>
                <th className="p-3 font-medium">Hours</th>
                {showPricing && <th className="p-3 font-medium">Amount</th>}
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={showPricing ? 7 : 6} className="p-8 text-center text-muted-foreground">
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
                    <td className="p-3">{inv.total_hours}</td>
                    {showPricing && <td className="p-3 font-medium">{formatCurrency(inv.amount)}</td>}
                    <td className="p-3"><StatusBadge status={inv.status} /></td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title="Download PDF" onClick={() => exportPdf(inv)}>
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

      <PdfPreviewModal blob={pdfBlob} filename="invoice.pdf" onClose={() => setPdfBlob(null)} />
    </div>
  )
}
