import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { Client } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { CheckCircle2, Flag, X } from "lucide-react"

export const REPORT_CATEGORIES: [string, string][] = [
  ["client", "Client issue"], ["task", "Task issue"], ["time_clock", "Time clock"],
  ["payroll", "Payroll"], ["technical", "Technical problem"], ["general", "General report"],
]

/** Create a Report — sent to every Administrator and Auditor (in-app notification + Team Reports inbox). */
export function CreateReportModal({ open, onClose, presetClientId = "", presetCategory = "general" }: { open: boolean; onClose: () => void; presetClientId?: string; presetCategory?: string }) {
  const qc = useQueryClient()
  const isVa = getAuthUser()?.role === "va"
  const [category, setCategory] = useState(presetCategory)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [clientId, setClientId] = useState(presetClientId)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")

  const { data: clients = [] } = useQuery({
    queryKey: ["report-clients", isVa],
    queryFn: () => apiFetch<Client[]>(isVa ? "/va/clients" : "/clients"),
    enabled: open,
  })

  const create = useMutation({
    mutationFn: () => apiFetch("/user-reports", { method: "POST", body: JSON.stringify({ category, title, body, client_id: clientId || null }) }),
    onSuccess: () => {
      setDone(true)
      qc.invalidateQueries({ queryKey: ["user-reports"] })
      qc.invalidateQueries({ queryKey: ["notifications"] })
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!open) return null
  const close = () => { setDone(false); setTitle(""); setBody(""); setError(""); onClose() }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="py-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
            <h2 className="mt-2 text-base font-bold">Report sent</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Your report was sent to the <strong>Administrator and Project Manager</strong>. They'll see it in Team Reports and get a notification. Track its status in My Reports.</p>
            <Button variant="gold" className="mt-4" onClick={close}>Done</Button>
          </div>
        ) : (<>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-bold"><Flag className="h-4 w-4 text-primary" /> Create a Report</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">This report goes to the <strong>Administrator and the Project Manager</strong>.</p>
            </div>
            <button onClick={close} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Category</Label><Select value={category} onChange={(e) => setCategory(e.target.value)}>{REPORT_CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select></div>
              <div><Label>Client (optional)</Label><Select value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">No client / general</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            </div>
            <div><Label>Title *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary — e.g. Client hasn't replied in 3 days" /></div>
            <div><Label>Details *</Label><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="What happened, what you need, and anything the Administrator or Project Manager should check…" /></div>
          </div>
          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={close}>Cancel</Button>
            <Button variant="gold" size="sm" disabled={title.trim().length < 3 || body.trim().length < 3 || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Sending…" : "Send to Admin & Project Manager"}
            </Button>
          </div>
        </>)}
      </div>
    </div>
  )
}

/** Small hook-style wrapper: a button that opens the report modal. */
export function useReportButton() {
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<{ clientId: string; category: string }>({ clientId: "", category: "general" })
  return {
    openReport: (clientId = "", category = "general") => { setPreset({ clientId, category }); setOpen(true) },
    modal: <CreateReportModal open={open} onClose={() => setOpen(false)} presetClientId={preset.clientId} presetCategory={preset.category} />,
  }
}
