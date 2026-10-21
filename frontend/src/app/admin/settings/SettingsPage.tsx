import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { ActivityLog, EmailLog, EmailTemplate, Settings } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Building2, Eye, Mail, Paintbrush, ScrollText, Search, Send, Trash2, X } from "lucide-react"

type Tab = "company" | "display" | "emails" | "activity"
type EmailTab = "resend" | "templates" | "activity"

const EMPTY: Settings = {
  company_name: "", principal_name: "", location: "", wise_email: "", paypal_email: "",
  hide_pricing: true, booking_url: "", booking_hide_pricing: true, default_va_hourly_rate: "75.00",
  resend_api_key: "", resend_from_email: "onboarding@resend.dev", admin_notify_email: "",
}

export function SettingsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>("company")
  const [emailTab, setEmailTab] = useState<EmailTab>("resend")
  const [form, setForm] = useState<Settings>(EMPTY)
  const [savedNote, setSavedNote] = useState("")

  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<Settings>("/settings") })
  useEffect(() => { if (settings) setForm({ ...EMPTY, ...settings }) }, [settings])

  const save = useMutation({
    mutationFn: (body: Partial<Settings>) => apiFetch("/settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] })
      qc.invalidateQueries({ queryKey: ["display-settings"] })
      setSavedNote("Saved ✓")
      setTimeout(() => setSavedNote(""), 2500)
    },
  })
  const saveCompany = () => save.mutate({ company_name: form.company_name, principal_name: form.principal_name, location: form.location, wise_email: form.wise_email, paypal_email: form.paypal_email })
  const saveDisplay = () => save.mutate({ hide_pricing: form.hide_pricing, booking_url: form.booking_url, booking_hide_pricing: form.booking_hide_pricing, default_va_hourly_rate: form.default_va_hourly_rate as unknown as never })
  const saveResend = () => save.mutate({ resend_api_key: form.resend_api_key, resend_from_email: form.resend_from_email, admin_notify_email: form.admin_notify_email })

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="px-1 pt-1">
        <h1 className="font-display text-xl font-bold">Settings</h1>
        <p className="text-xs text-muted-foreground">Each tab saves on its own — no more saving everything at once. {savedNote && <span className="font-bold text-green-600">{savedNote}</span>}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {([["company", "Company & Payment", Building2], ["display", "Display & Booking", Paintbrush], ["emails", "Emails", Mail], ["activity", "Activity Logs", ScrollText]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={cn("flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold transition", tab === id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted/60")}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "company" && (
        <Card>
          <CardHeader><CardTitle>Company & Payment Defaults</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Company Name</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></div>
              <div><Label>Principal</Label><Input value={form.principal_name} onChange={(e) => setForm({ ...form, principal_name: e.target.value })} /></div>
              <div><Label>Location</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
              <div><Label>Wise Email</Label><Input value={form.wise_email} onChange={(e) => setForm({ ...form, wise_email: e.target.value })} /></div>
              <div><Label>PayPal Email</Label><Input value={form.paypal_email} onChange={(e) => setForm({ ...form, paypal_email: e.target.value })} /></div>
            </div>
            <p className="text-[11px] text-muted-foreground">Used on invoices, reports, and payroll documents.</p>
            <Button variant="gold" onClick={saveCompany} disabled={save.isPending}>Save Company Settings</Button>
          </CardContent>
        </Card>
      )}

      {tab === "display" && (
        <Card>
          <CardHeader><CardTitle>Display & Booking</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Show pricing in app</Label>
                <Select value={form.hide_pricing ? "hide" : "show"} onChange={(e) => setForm({ ...form, hide_pricing: e.target.value === "hide" })}>
                  <option value="hide">Hide pricing (default)</option>
                  <option value="show">Show pricing</option>
                </Select>
              </div>
              <div>
                <Label>Default VA hourly rate (when pricing hidden)</Label>
                <Input type="number" step="0.01" value={form.default_va_hourly_rate} onChange={(e) => setForm({ ...form, default_va_hourly_rate: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label>Booking link URL</Label>
                <Input type="url" placeholder="https://calendly.com/your-link" value={form.booking_url} onChange={(e) => setForm({ ...form, booking_url: e.target.value })} />
              </div>
              <div>
                <Label>Booking page pricing</Label>
                <Select value={form.booking_hide_pricing ? "hide" : "show"} onChange={(e) => setForm({ ...form, booking_hide_pricing: e.target.value === "hide" })}>
                  <option value="hide">Hide pricing on booking link (default)</option>
                  <option value="show">Keep booking URL as-is</option>
                </Select>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">When pricing is hidden, rates and amounts are not shown in the dashboard, logs, payroll, invoices list, and reports. VAs log hours without seeing pay.</p>
            <Button variant="gold" onClick={saveDisplay} disabled={save.isPending}>Save Display Settings</Button>
          </CardContent>
        </Card>
      )}

      {tab === "emails" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {([["resend", "Resend Setup"], ["templates", "Email Templates"], ["activity", "Email Activity"]] as const).map(([id, label]) => (
              <button key={id} onClick={() => setEmailTab(id)} className={cn("rounded-full border px-3 py-1.5 text-xs font-bold transition", emailTab === id ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-muted/60")}>{label}</button>
            ))}
          </div>

          {emailTab === "resend" && (
            <Card>
              <CardHeader><CardTitle>Resend — Email Sending</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2"><Label>Resend API Key</Label><Input type="password" placeholder="re_..." value={form.resend_api_key ?? ""} onChange={(e) => setForm({ ...form, resend_api_key: e.target.value })} /></div>
                  <div><Label>From Email</Label><Input placeholder="onboarding@resend.dev" value={form.resend_from_email ?? ""} onChange={(e) => setForm({ ...form, resend_from_email: e.target.value })} /></div>
                  <div><Label>Admin Notification Email</Label><Input placeholder="you@company.com" value={form.admin_notify_email ?? ""} onChange={(e) => setForm({ ...form, admin_notify_email: e.target.value })} /></div>
                </div>
                <p className="text-[11px] text-muted-foreground">Task assignments, comments, submissions, approvals, and payroll notices are emailed from this setup. Without a key, emails are skipped (and logged as “skipped” in Email Activity) — in-app notifications still work. Domain for production: <b>teams.sunnyhuecreatives.com</b> — verify your sending domain in Resend before going live.</p>
                <Button variant="gold" onClick={saveResend} disabled={save.isPending}>Save Email Settings</Button>
              </CardContent>
            </Card>
          )}

          {emailTab === "templates" && <EmailTemplates />}
          {emailTab === "activity" && <EmailActivity />}
        </div>
      )}

      {tab === "activity" && <ActivityLogs />}
    </div>
  )
}

function EmailTemplates() {
  const qc = useQueryClient()
  const [selectedKey, setSelectedKey] = useState("")
  const [subject, setSubject] = useState("")
  const [bodyHtml, setBodyHtml] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [testTo, setTestTo] = useState("")
  const [testMsg, setTestMsg] = useState("")

  const { data: templates = [] } = useQuery({ queryKey: ["email-templates"], queryFn: () => apiFetch<EmailTemplate[]>("/settings/email-templates") })
  const selected = templates.find(t => t.key === selectedKey) ?? templates[0]

  useEffect(() => {
    if (selected) { setSelectedKey(selected.key); setSubject(selected.subject); setBodyHtml(selected.body_html); setIsActive(selected.is_active) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key])

  const { data: preview } = useQuery({
    queryKey: ["email-preview", selectedKey, subject, bodyHtml],
    queryFn: () => apiFetch<{ subject: string; html: string }>(`/settings/email-templates/${selectedKey}/preview`),
    enabled: !!selectedKey,
  })

  const saveTpl = useMutation({
    mutationFn: () => apiFetch(`/settings/email-templates/${selectedKey}`, { method: "PUT", body: JSON.stringify({ subject, body_html: bodyHtml, is_active: isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-templates"] }),
  })
  const sendTest = useMutation({
    mutationFn: () => apiFetch<{ sent: boolean; message: string }>(`/settings/email-templates/${selectedKey}/test`, { method: "POST", body: JSON.stringify({ to_email: testTo }) }),
    onSuccess: (r) => { setTestMsg(r.message); qc.invalidateQueries({ queryKey: ["email-activity"] }) },
    onError: (e: Error) => setTestMsg(e.message),
  })

  if (!selected) return <p className="text-sm text-muted-foreground">Loading templates…</p>

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="min-w-0">
        <CardHeader className="pb-2"><CardTitle>Email Templates</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {templates.map(t => (
              <button key={t.key} onClick={() => setSelectedKey(t.key)} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold", selectedKey === t.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/60", !t.is_active && "opacity-50")}>{t.name}</button>
            ))}
          </div>
          <div><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div><Label>Body (HTML)</Label><Textarea rows={10} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} className="font-mono text-[11px]" /></div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-bold">Variables:</span>
            {selected.variables.map(v => <button key={v} onClick={() => setBodyHtml(b => b + ` {{${v}}}`)} className="rounded-full bg-muted px-2 py-0.5 font-mono hover:bg-primary/10">{`{{${v}}}`}</button>)}
          </div>
          <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" className="accent-[var(--primary)]" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Template active (inactive = built-in design is used)</label>
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button variant="gold" size="sm" onClick={() => saveTpl.mutate()} disabled={saveTpl.isPending}>Save Template</Button>
            <Input type="email" placeholder="Test email address" value={testTo} onChange={(e) => setTestTo(e.target.value)} className="h-9 w-52" />
            <Button variant="outline" size="sm" onClick={() => sendTest.mutate()} disabled={!testTo || sendTest.isPending}><Send className="h-3.5 w-3.5" /> Test Email</Button>
          </div>
          {testMsg && <p className="text-[11px] font-medium text-muted-foreground">{testMsg}</p>}
          <p className="text-[11px] text-muted-foreground">Save first, then send a test — the test uses the saved template with sample data.</p>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Eye className="h-4 w-4 text-primary" /> Live Preview</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-2 truncate text-xs"><span className="font-bold">Subject:</span> {preview?.subject ?? subject}</p>
          {preview?.html
            ? <iframe title="Email preview" srcDoc={preview.html} className="h-[560px] w-full rounded-xl border bg-white" />
            : <p className="text-xs text-muted-foreground">Preview loads from the saved template. Edit + save to refresh it.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function EmailActivity() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const { data: logs = [] } = useQuery({
    queryKey: ["email-activity", search],
    queryFn: () => apiFetch<EmailLog[]>(`/settings/email-activity?search=${encodeURIComponent(search)}`),
    refetchInterval: 30_000,
  })
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/settings/email-activity/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-activity"] }),
  })
  const statusStyle = (s: string) => s === "sent" ? "bg-green-100 text-green-700 border-green-200" : s === "failed" ? "bg-red-100 text-red-700 border-red-200" : "bg-slate-100 text-slate-600 border-slate-200"

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Email Activity Logs</CardTitle>
          <div className="relative w-full sm:w-64"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="Search email, subject, template…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-3">Date</th><th className="p-3">To</th><th className="p-3">Subject</th><th className="p-3">Template</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr></thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="whitespace-nowrap p-3 text-muted-foreground">{new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                <td className="p-3 font-medium">{l.to_email}</td>
                <td className="max-w-[240px] truncate p-3">{l.subject}</td>
                <td className="p-3 text-muted-foreground">{l.template_key ?? "—"}</td>
                <td className="p-3"><span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize", statusStyle(l.status))}>{l.status}</span>{l.error && <span className="block max-w-[160px] truncate text-[10px] text-red-500">{l.error}</span>}</td>
                <td className="p-3"><div className="flex justify-end"><Button size="sm" variant="ghost" title="Delete log" onClick={() => remove.mutate(l.id)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button></div></td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No emails logged yet. Sends, skips, and failures will appear here.</td></tr>}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function ActivityLogs() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [viewing, setViewing] = useState<ActivityLog | null>(null)
  const { data: logs = [] } = useQuery({
    queryKey: ["activity-logs", search],
    queryFn: () => apiFetch<ActivityLog[]>(`/settings/activity-logs?search=${encodeURIComponent(search)}`),
    refetchInterval: 30_000,
  })
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/settings/activity-logs/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  })
  const clearAll = useMutation({
    mutationFn: () => apiFetch("/settings/activity-logs", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  })
  const roleStyle = (r?: string | null) => r === "admin" ? "bg-primary/10 text-primary" : r === "auditor" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Activity Logs — Who Did What</CardTitle>
          <div className="flex gap-2">
            <div className="relative w-full sm:w-64"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="Search user or action…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <Button size="sm" variant="outline" onClick={() => { if (confirm("Delete ALL activity logs?")) clearAll.mutate() }}><Trash2 className="h-3.5 w-3.5" /> Clear All</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-3">Date</th><th className="p-3">User</th><th className="p-3">Log Description</th><th className="p-3">Action</th><th className="p-3 text-right">View / Delete</th></tr></thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="whitespace-nowrap p-3 text-muted-foreground">{new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                <td className="p-3"><span className="font-semibold">{l.user_name}</span>{l.user_role && <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", roleStyle(l.user_role))}>{l.user_role}</span>}</td>
                <td className="p-3">{l.description}</td>
                <td className="p-3 capitalize text-muted-foreground">{l.action}</td>
                <td className="p-3"><div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" title="View" onClick={() => setViewing(l)}><Eye className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" title="Delete" onClick={() => remove.mutate(l.id)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
                </div></td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No activity logged yet. Creating, approving, clocking, commenting, and paying will show up here automatically.</td></tr>}
          </tbody>
        </table>
      </CardContent>

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setViewing(null)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-6" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between"><h3 className="font-bold">Activity Detail</h3><button onClick={() => setViewing(null)} className="rounded-full p-1 hover:bg-muted"><X className="h-4 w-4" /></button></div>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between border-b pb-2"><dt className="text-muted-foreground">Date</dt><dd className="font-semibold">{new Date(viewing.created_at).toLocaleString()}</dd></div>
              <div className="flex justify-between border-b pb-2"><dt className="text-muted-foreground">User</dt><dd className="font-semibold">{viewing.user_name} ({viewing.user_role})</dd></div>
              <div className="flex justify-between border-b pb-2"><dt className="text-muted-foreground">Action</dt><dd className="font-semibold capitalize">{viewing.action}</dd></div>
              <div className="border-b pb-2"><dt className="text-muted-foreground">Description</dt><dd className="mt-1 font-medium">{viewing.description}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Endpoint</dt><dd className="font-mono text-[11px]">{viewing.method} {viewing.path}</dd></div>
            </dl>
          </div>
        </div>
      )}
    </Card>
  )
}
