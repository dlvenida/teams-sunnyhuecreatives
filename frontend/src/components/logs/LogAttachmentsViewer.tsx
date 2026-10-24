import { useQuery } from "@tanstack/react-query"
import { apiFetch, apiFetchBlob } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { useEffect, useState } from "react"
import { Download, FileText, Film, Image as ImageIcon } from "lucide-react"

interface Att {
  id: string
  filename: string
  content_type: string
}

function isImageType(ctype: string) {
  return (ctype || "").toLowerCase().startsWith("image/")
}
function isVideoType(ctype: string) {
  return (ctype || "").toLowerCase().startsWith("video/")
}

export function LogAttachmentsViewer({ logId, onClose }: { logId: string; onClose: () => void }) {
  const { data: atts = [], isLoading } = useQuery({
    queryKey: ["log-atts", logId],
    queryFn: () => apiFetch<Att[]>(`/work-logs/${logId}/attachments`),
  })
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<Att | null>(null)

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
          <h2 className="text-sm font-semibold">Attachments</h2>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && atts.length === 0 && <p className="text-xs text-muted-foreground">No files attached.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {atts.map((a) => {
            const image = isImageType(a.content_type)
            const video = isVideoType(a.content_type)
            return (
              <button
                key={a.id}
                type="button"
                className="overflow-hidden rounded-xl border text-left transition hover:ring-2 hover:ring-primary/30"
                onClick={() => setLightbox(a)}
              >
                {image && urls[a.id] ? (
                  <img src={urls[a.id]} alt={a.filename} className="max-h-64 w-full object-contain bg-muted/30" />
                ) : video && urls[a.id] ? (
                  <div className="relative flex h-40 items-center justify-center bg-slate-900">
                    <video src={urls[a.id]} className="absolute inset-0 h-full w-full object-cover opacity-70" muted />
                    <Film className="relative z-10 h-8 w-8 text-white" />
                  </div>
                ) : (
                  <div className="flex h-28 flex-col items-center justify-center gap-2 bg-muted/30 px-3 text-center text-xs text-muted-foreground">
                    {image ? <ImageIcon className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
                    <span className="line-clamp-2 font-medium text-foreground">{a.filename}</span>
                    <span>{a.content_type || "file"}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
                  <p className="truncate text-[11px] text-muted-foreground">{a.filename}</p>
                  <span className="text-[10px] font-semibold text-primary">Preview</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-h-[90vh] max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end gap-2">
              {urls[lightbox.id] && (
                <a
                  href={urls[lightbox.id]}
                  download={lightbox.filename}
                  className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-[11px] font-semibold"
                >
                  <Download className="h-3 w-3" /> Save
                </a>
              )}
              <Button size="sm" variant="outline" className="bg-white" onClick={() => setLightbox(null)}>Close</Button>
            </div>
            {urls[lightbox.id] && isImageType(lightbox.content_type) && (
              <img src={urls[lightbox.id]} alt={lightbox.filename} className="max-h-[85vh] max-w-full rounded-lg object-contain" />
            )}
            {urls[lightbox.id] && isVideoType(lightbox.content_type) && (
              <video src={urls[lightbox.id]} controls autoPlay className="max-h-[85vh] max-w-full rounded-lg" />
            )}
            {urls[lightbox.id] && !isImageType(lightbox.content_type) && !isVideoType(lightbox.content_type) && (
              <div className="rounded-2xl bg-card p-8 text-center">
                <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="font-semibold">{lightbox.filename}</p>
                <a href={urls[lightbox.id]} download={lightbox.filename} className="mt-3 inline-block text-sm font-semibold text-primary underline">
                  Open / download file
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
