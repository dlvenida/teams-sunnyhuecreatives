import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { CommentAttachment } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatBytes, prepareImage } from "@/lib/imagePrep"
import { AuthImage } from "./AuthImage"
import { ImageAnnotator } from "./ImageAnnotator"
import { ExternalLink, ImagePlus, Link2, Loader2, Pencil, Trash2, X } from "lucide-react"

interface Pending { blob: Blob; name: string; preview: string; width?: number; height?: number; guided: boolean }

/** Attachments block for Task Details / Project Details:
 *  [Attach image] = plain image · [Attach image with guide] = red drawing, boxes with text, and text.
 *  Preview first — it uploads (AVIF → bucket) only when you save the attachment. */
export function DetailAttachments({ scope, scopeId }: { scope: "task" | "project"; scopeId: string }) {
  const qc = useQueryClient()
  const base = scope === "task" ? `/tasks/${scopeId}` : `/projects/${scopeId}`
  const [pending, setPending] = useState<Pending | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [note, setNote] = useState("")
  const [link, setLink] = useState("")
  const plainRef = useRef<HTMLInputElement>(null)
  const guideRef = useRef<HTMLInputElement>(null)

  const { data: attachments = [] } = useQuery({ queryKey: ["attachments", scope, scopeId], queryFn: () => apiFetch<CommentAttachment[]>(`${base}/attachments`) })

  async function pick(file: File, withGuide: boolean) {
    setNote("")
    const { file: prepared, note } = await prepareImage(file)
    if (note) setNote(note)
    const preview = URL.createObjectURL(prepared)
    const dims = await new Promise<{ w: number; h: number } | null>(res => {
      const img = new Image(); img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => res(null); img.src = preview
    })
    setPending({ blob: prepared, name: prepared.name, preview, width: dims?.w, height: dims?.h, guided: false })
    if (withGuide) setDrawing(true)
  }

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData(); fd.append("file", new File([pending!.blob], pending!.name, { type: pending!.blob.type || "image/png" }))
      return apiFetch<CommentAttachment>(`${base}/comments/attachments${pending!.guided ? "?is_annotation=true" : ""}`, { method: "POST", body: fd })
    },
    onSuccess: () => {
      if (pending) URL.revokeObjectURL(pending.preview)
      setPending(null)
      qc.invalidateQueries({ queryKey: ["attachments", scope, scopeId] })
      qc.invalidateQueries({ queryKey: ["comments", scope, scopeId] })
    },
    onError: (e: Error) => setNote(e.message),
  })
  const addLink = useMutation({
    mutationFn: () => apiFetch<CommentAttachment>(`${base}/attachments/link`, { method: "POST", body: JSON.stringify({ url: link.trim() }) }),
    onSuccess: () => { setLink(""); qc.invalidateQueries({ queryKey: ["attachments", scope, scopeId] }) },
    onError: (e: Error) => setNote(e.message),
  })
  const removeAtt = useMutation({
    mutationFn: (id: string) => apiFetch(`/comments/attachments/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attachments", scope, scopeId] }),
  })

  return (
    <div className="rounded-xl border p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold">📎 Attachments</h4>
        <span className="text-[10px] text-muted-foreground">{attachments.length} attached</span>
      </div>

      {attachments.filter(a => a.kind === "link").length > 0 && (
        <div className="mb-2 space-y-1.5">
          {attachments.filter(a => a.kind === "link").map(a => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-1.5 text-[11px]">
              <span>{a.provider === "google_drive" ? "🟢" : "🔵"}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{a.provider === "google_drive" ? "Google Drive" : "Dropbox"} link</span>
              <a href={a.link_url || "#"} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"><ExternalLink className="h-3 w-3" /> Open</a>
              <button title="Remove link" onClick={() => { if (confirm("Remove this link?")) removeAtt.mutate(a.id) }}><Trash2 className="h-3 w-3 text-red-500" /></button>
            </div>
          ))}
        </div>
      )}

      {attachments.filter(a => a.kind !== "link").length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.filter(a => a.kind !== "link").map(a => (
            <figure key={a.id} className="w-28">
              <AuthImage path={a.url} alt={a.original_name} className="h-16 w-28 rounded-lg border object-cover" />
              <figcaption className="mt-0.5 flex items-start justify-between gap-1 text-[8px] leading-tight text-muted-foreground">
                <span className="truncate">{a.is_annotation ? "✏️ With guide · " : ""}{a.width}×{a.height} · {formatBytes(a.size_bytes)}</span>
                <button title="Delete attachment" onClick={() => { if (confirm("Delete this attachment?")) removeAtt.mutate(a.id) }}><Trash2 className="h-3 w-3 shrink-0 text-red-500" /></button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {pending ? (
        <div className="rounded-lg border bg-muted/20 p-2.5">
          <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">Preview — {pending.guided ? "with guide ✏️" : "plain image"} · not attached yet</p>
          <div className="relative w-full max-w-[280px]">
            <img src={pending.preview} alt={pending.name} className="h-36 w-full rounded-lg border object-cover" />
            <button title="Discard" className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white" onClick={() => { URL.revokeObjectURL(pending.preview); setPending(null) }}><X className="h-3 w-3" /></button>
            {pending.guided && <span className="absolute left-1.5 top-1.5 rounded-full bg-red-500 px-1.5 py-px text-[9px] font-semibold text-white">✏️ With guide</span>}
          </div>
          <p className="mt-1 truncate text-[9px] text-muted-foreground">{pending.name}{pending.width ? ` · ${pending.width}×${pending.height}` : ""} · {formatBytes(pending.blob.size)}</p>
          <div className="mt-2 flex flex-col gap-1.5 sm:flex-row">
            {!pending.guided && (
              <Button size="sm" variant="outline" className="flex-1 whitespace-nowrap border-red-200 text-red-600 hover:bg-red-50" onClick={() => setDrawing(true)}>
                <Pencil className="h-3.5 w-3.5" /> Attach image with guide
              </Button>
            )}
            {pending.guided && (
              <Button size="sm" variant="outline" className="flex-1 whitespace-nowrap border-red-200 text-red-600 hover:bg-red-50" onClick={() => setDrawing(true)}>
                <Pencil className="h-3.5 w-3.5" /> Edit guide
              </Button>
            )}
            <Button size="sm" variant="gold" className="flex-1 whitespace-nowrap" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Save attachment
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 sm:flex-row">
          <Button size="sm" variant="outline" className="flex-1 whitespace-nowrap" onClick={() => plainRef.current?.click()}>
            <ImagePlus className="h-3.5 w-3.5" /> Attach image
          </Button>
          <Button size="sm" variant="outline" className="flex-1 whitespace-nowrap border-red-200 text-red-600 hover:bg-red-50" onClick={() => guideRef.current?.click()}>
            <Pencil className="h-3.5 w-3.5" /> Attach image with guide
          </Button>
        </div>
      )}
      {!pending && (
        <div className="mt-2 flex gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Link2 className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={link} onChange={e => setLink(e.target.value)} placeholder="Drop a Google Drive or Dropbox link here…" className="pl-7"
              onKeyDown={e => { if (e.key === "Enter" && link.trim()) addLink.mutate() }}
              />
          </div>
          <Button size="sm" variant="outline" className="shrink-0 whitespace-nowrap" disabled={!link.trim() || addLink.isPending} onClick={() => addLink.mutate()}>
            {addLink.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Add link
          </Button>
        </div>
      )}
      {note && <p className="mt-1 text-[10px] text-amber-600">{note}</p>}

      <input ref={plainRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) pick(f, false); e.target.value = "" }} />
      <input ref={guideRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) pick(f, true); e.target.value = "" }} />

      {drawing && pending && (
        <ImageAnnotator imageUrl={pending.preview} title={pending.name}
          onClose={() => setDrawing(false)}
          onSave={blob => {
            URL.revokeObjectURL(pending.preview)
            setPending({ ...pending, blob, preview: URL.createObjectURL(blob), guided: true, name: `guided-${pending.name.replace(/\.\w+$/, "")}.png` })
            setDrawing(false)
          }} />
      )}
    </div>
  )
}
