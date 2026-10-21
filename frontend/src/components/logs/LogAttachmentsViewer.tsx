import { useQuery } from "@tanstack/react-query"
import { apiFetch, apiFetchBlob } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { useEffect, useState } from "react"

interface Att {
  id: string
  filename: string
  content_type: string
}

export function LogAttachmentsViewer({ logId, onClose }: { logId: string; onClose: () => void }) {
  const { data: atts = [], isLoading } = useQuery({
    queryKey: ["log-atts", logId],
    queryFn: () => apiFetch<Att[]>(`/work-logs/${logId}/attachments`),
  })
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const next: Record<string, string> = {}
      for (const a of atts) {
        const blob = await apiFetchBlob(`/work-logs/attachments/${a.id}/content`)
        if (blob && !cancelled) next[a.id] = URL.createObjectURL(blob)
      }
      if (!cancelled) setUrls(next)
    }
    if (atts.length) load()
    return () => {
      cancelled = true
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atts])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Proof of work</h2>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && atts.length === 0 && <p className="text-xs text-muted-foreground">No images attached.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {atts.map((a) => (
            <div key={a.id} className="overflow-hidden rounded-xl border">
              {urls[a.id] ? (
                <img src={urls[a.id]} alt={a.filename} className="max-h-64 w-full object-contain bg-muted/30" />
              ) : (
                <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">Loading…</div>
              )}
              <p className="truncate border-t px-2 py-1.5 text-[11px] text-muted-foreground">{a.filename}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
