import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { CommentAttachment, MentionRef, TaskComment, TeamMember } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Select, Textarea } from "@/components/ui/input"
import { formatBytes, prepareImage } from "@/lib/imagePrep"
import { roleLabel } from "@/lib/utils"
import { AuthImage, useAuthImageUrl } from "./AuthImage"
import { ImageAnnotator } from "./ImageAnnotator"
import { ImagePlus, Loader2, Pencil, Pin, Reply, Send, Trash2, X } from "lucide-react"

export const REACTION_EMOJI = ["👍", "❤️", "🎉", "👀", "✅", "🔥", "🙏", "💯"]
type Scope = "task" | "project"
type SortMode = "newest" | "oldest" | "most_reacted"

function AuthFileLink({ path, name }: { path: string; name: string }) {
  const { url, error } = useAuthImageUrl(path)
  if (error) return <span className="flex h-24 w-36 items-center justify-center rounded-lg border bg-muted/40 px-2 text-center text-[10px] text-muted-foreground">File unavailable</span>
  if (!url) return <span className="flex h-24 w-36 items-center justify-center rounded-lg border bg-muted/40 px-2 text-center text-[10px] text-muted-foreground">Loading file…</span>
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex h-24 w-36 items-center justify-center rounded-lg border bg-muted/40 px-2 text-center text-[10px] font-medium text-primary underline">
      {name || "Open file"}
    </a>
  )
}

function initials(n: string) { return n.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() }
function highlightMentions(body: string) {
  return body.split(/(@[\w][\w .'-]*)/g).map((part, i) =>
    part.startsWith("@") ? <span key={i} className="rounded bg-primary/15 px-1 font-medium text-primary">{part}</span> : <span key={i}>{part}</span>)
}

export function CommentThread({
  scope,
  scopeId,
  scopeTitle,
  highlightCommentId,
}: {
  scope: Scope
  scopeId: string
  scopeTitle?: string
  /** Scroll to and briefly highlight this comment (e.g. from a mention notification). */
  highlightCommentId?: string | null
}) {
  const qc = useQueryClient()
  const me = getAuthUser()
  const base = scope === "task" ? `/tasks/${scopeId}` : `/projects/${scopeId}`
  const qKey = ["comments", scope, scopeId]
  const [sort, setSort] = useState<SortMode>("newest")
  const [filter, setFilter] = useState<"all" | "mentions" | "attachments" | "pinned">("all")
  const [body, setBody] = useState("")
  const [mentions, setMentions] = useState<MentionRef[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  /** Images picked in the composer live ONLY in the browser until Post — preview & draw first, attach on post. */
  const [staged, setStaged] = useState<{ key: string; blob: Blob; name: string; preview: string; width?: number; height?: number; annotated: boolean; mode: "plain" | "guide" | null }[]>([])
  const [uploadNote, setUploadNote] = useState("")
  const [replyTo, setReplyTo] = useState<TaskComment | null>(null)
  const [editing, setEditing] = useState<TaskComment | null>(null)
  const [annotate, setAnnotate] = useState<{ att: CommentAttachment; commentId: string } | null>(null)
  const [annotateLocal, setAnnotateLocal] = useState<string | null>(null) // staged key being drawn on, before attach
  const fileRef = useRef<HTMLInputElement>(null)
  const nextWithGuide = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const { data: comments = [], isLoading } = useQuery({ queryKey: [...qKey, sort], queryFn: () => apiFetch<TaskComment[]>(`${base}/comments?sort=${sort}`) })
  const { data: team = [] } = useQuery({ queryKey: ["team"], queryFn: () => apiFetch<TeamMember[]>("/team") })

  useEffect(() => {
    if (!highlightCommentId || isLoading || !comments.length) return
    const el = document.getElementById(`comment-${highlightCommentId}`)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    el.classList.add("ring-2", "ring-primary", "ring-offset-2")
    const t = window.setTimeout(() => el.classList.remove("ring-2", "ring-primary", "ring-offset-2"), 2800)
    return () => window.clearTimeout(t)
  }, [highlightCommentId, isLoading, comments])

  const invalidate = () => qc.invalidateQueries({ queryKey: qKey })
  async function uploadOne(blob: Blob, name: string, extra: Record<string, string> = {}): Promise<CommentAttachment> {
    const fd = new FormData(); fd.append("file", new File([blob], name, { type: blob.type || "image/png" }))
    const qs = new URLSearchParams(extra).toString()
    return apiFetch<CommentAttachment>(`${base}/comments/attachments${qs ? `?${qs}` : ""}`, { method: "POST", body: fd })
  }

  const [postError, setPostError] = useState("")
  const post = useMutation({
    mutationFn: async () => {
      setPostError("")
      // Treat unfinished guide previews as plain images so Post always works.
      const ready = staged.map(s => ({ ...s, mode: s.mode || ("plain" as const) }))
      const used = mentions.filter(m => body.includes("@" + m.name))
      if (editing) {
        for (const s of ready) {
          await uploadOne(s.blob, s.name, {
            comment_id: editing.id,
            ...(s.annotated ? { is_annotation: "true" } : {}),
          })
        }
        return apiFetch(`${base}/comments/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ body: body.trim() || "📎 Attachment", mentions: used }),
        })
      }
      const ids: string[] = []
      for (const s of ready) {
        const att = await uploadOne(s.blob, s.name, s.annotated ? { is_annotation: "true" } : {})
        ids.push(att.id)
      }
      return apiFetch(`${base}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: body.trim() || "📎 Attachment",
          parent_id: replyTo?.id || null,
          mentions: used,
          attachment_ids: ids,
        }),
      })
    },
    onSuccess: () => {
      setBody(""); setMentions([]); setPostError("")
      staged.forEach(s => URL.revokeObjectURL(s.preview)); setStaged([])
      setReplyTo(null); setEditing(null); setAnnotateLocal(null); invalidate()
    },
    onError: (err: Error) => setPostError(err.message || "Could not post comment. Please try again."),
  })
  const react = useMutation({ mutationFn: ({ id, emoji }: { id: string; emoji: string }) => apiFetch(`${base}/comments/${id}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) }), onSuccess: invalidate })
  const pin = useMutation({ mutationFn: (id: string) => apiFetch(`${base}/comments/${id}/pin`, { method: "POST" }), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => apiFetch(`${base}/comments/${id}`, { method: "DELETE" }), onSuccess: invalidate })

  /** Pick files → instant LOCAL preview only. Nothing is uploaded/attached yet. */
  async function stageFiles(files: FileList | File[], withGuide = false) {
    setUploadNote("")
    for (const raw of Array.from(files)) {
      const isImage = (raw.type || "").startsWith("image/")
      if (withGuide && !isImage) {
        setUploadNote("Image guide only works with image files.")
        continue
      }
      const { file, note } = isImage ? await prepareImage(raw) : { file: raw }
      if (note) setUploadNote(note)
      const preview = URL.createObjectURL(file)
      const dims = isImage
        ? await new Promise<{ w: number; h: number } | null>(res => {
            const img = new Image()
            img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight })
            img.onerror = () => res(null)
            img.src = preview
          })
        : null
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      setStaged(s => [...s, { key, blob: file, name: file.name, preview, width: dims?.w, height: dims?.h, annotated: false, mode: withGuide ? null : ("plain" as const) }])
      if (withGuide) setAnnotateLocal(key)
    }
  }

  const localTarget = staged.find(s => s.key === annotateLocal) || null

  /** Drawing on a preview (before attach): swap the local blob for the annotated one — still nothing uploaded. */
  function saveLocalAnnotation(blob: Blob) {
    if (!localTarget) return
    URL.revokeObjectURL(localTarget.preview)
    const preview = URL.createObjectURL(blob)
    setStaged(s => s.map(x => (x.key === localTarget.key
      ? { ...x, blob, preview, annotated: true, mode: "guide" as const, name: `annotated-${x.name.replace(/\.\w+$/, "")}.png` }
      : x)))
    setAnnotateLocal(null)
  }

  const { url: annotateUrl } = useAuthImageUrl(annotate?.att.url)
  const saveAnnotation = useMutation({
    mutationFn: async (blob: Blob) => {
      const target = annotate!
      const fd = new FormData(); fd.append("file", new File([blob], `annotated-${target.att.original_name}.png`, { type: "image/png" }))
      await apiFetch(`${base}/comments/attachments?is_annotation=true&annotated_from_id=${target.att.id}&comment_id=${target.commentId}`, { method: "POST", body: fd })
    },
    onSuccess: () => { setAnnotate(null); invalidate() },
  })

  const onType = (v: string) => {
    setBody(v)
    const caret = taRef.current?.selectionStart ?? v.length
    const m = v.slice(0, caret).match(/@([\w .'-]*)$/)
    setMentionQuery(m ? m[1] : null)
  }
  const pickMention = (m: TeamMember) => {
    const caret = taRef.current?.selectionStart ?? body.length
    const before = body.slice(0, caret).replace(/@([\w .'-]*)$/, "@" + m.name + " ")
    setBody(before + body.slice(caret))
    setMentions(ms => [...ms.filter(x => x.user_id !== m.user_id), { user_id: m.user_id, name: m.name }])
    setMentionQuery(null); taRef.current?.focus()
  }
  const mentionMatches = mentionQuery === null ? [] : team.filter(t => t.user_id !== me?.userId && t.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)

  const visible = useMemo(() => comments.filter(c => {
    if (filter === "mentions") return c.mentions?.some(m => m.user_id === me?.userId)
    if (filter === "attachments") return c.attachments.length > 0
    if (filter === "pinned") return c.is_pinned
    return true
  }), [comments, filter, me?.userId])
  const roots = visible.filter(c => !c.parent_id)
  const repliesOf = (id: string) => visible.filter(c => c.parent_id === id)

  const renderComment = (c: TaskComment, nested = false) => (
    <div key={c.id} id={`comment-${c.id}`} className={nested ? "ml-8 border-l-2 border-muted pl-3 scroll-mt-24" : "scroll-mt-24"}>
      <div className={`rounded-xl border bg-card p-3 transition ${highlightCommentId === c.id ? "ring-2 ring-primary ring-offset-2" : ""}`}>
        <div className="flex items-start gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{initials(c.author_name)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-semibold text-foreground">{c.author_name}</span>
              <span className={`rounded-full px-1.5 py-px text-[9px] font-semibold ${c.author_role === "admin" ? "bg-rose-100 text-rose-700" : c.author_role === "auditor" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"}`}>{roleLabel(c.author_role)}</span>
              <span className="text-muted-foreground">{new Date(c.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              {c.edited_at && <span className="text-muted-foreground">(edited)</span>}
              {c.is_pinned && <span className="inline-flex items-center gap-0.5 text-amber-600"><Pin className="h-3 w-3" /> Pinned</span>}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{highlightMentions(c.body)}</p>

            {c.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {c.attachments.map(a => {
                  const isImg = a.kind === "image" || !!(a.width && a.height)
                  return (
                    <figure key={a.id} className="w-36">
                      {isImg ? (
                        <AuthImage path={a.url} alt={a.original_name} className="h-24 w-36 cursor-zoom-in rounded-lg border object-cover" onClick={() => setAnnotate({ att: a, commentId: c.id })} />
                      ) : (
                        <AuthFileLink path={a.url} name={a.original_name || "Open file"} />
                      )}
                      <figcaption className="mt-1 text-[9px] leading-tight text-muted-foreground">
                        {a.is_annotation ? "✏️ Annotated · " : ""}
                        {a.width && a.height ? `${a.width}×${a.height} · ` : ""}
                        {(a.format || "file").toUpperCase()} {formatBytes(a.size_bytes)}
                        {a.original_size !== a.size_bytes && <> (was {formatBytes(a.original_size)})</>}
                        {isImg && (
                          <button className="ml-1 font-medium text-red-600 underline" onClick={() => setAnnotate({ att: a, commentId: c.id })}>
                            ✏️ Draw on it
                          </button>
                        )}
                      </figcaption>
                    </figure>
                  )
                })}
              </div>
            )}

            {/* Reactions belong to THIS comment only — click an emoji to add/remove your reaction */}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {REACTION_EMOJI.map(emoji => {
                const r = c.reactions.find(x => x.emoji === emoji)
                return (
                  <button key={emoji} title={r ? `${r.users.join(", ")} reacted ${emoji} — click to toggle` : `React ${emoji} to this comment`}
                    onClick={() => react.mutate({ id: c.id, emoji })}
                    className={`rounded-full border px-1.5 py-0.5 text-[11px] transition hover:scale-110 ${r?.reacted_by_me ? "border-primary bg-primary/15 font-semibold" : r ? "bg-muted/40" : "border-dashed bg-transparent opacity-50 hover:opacity-100"}`}>
                    {emoji}{r ? ` ${r.count}` : ""}
                  </button>
                )
              })}
              <button className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-primary" onClick={() => { setReplyTo(c); taRef.current?.focus() }}><Reply className="h-3 w-3" /> Reply</button>
              <button className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-amber-600" onClick={() => pin.mutate(c.id)}><Pin className="h-3 w-3" /> {c.is_pinned ? "Unpin" : "Pin"}</button>
              {c.author_user_id === me?.userId && <button className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-primary" onClick={() => { setEditing(c); setBody(c.body); setMentions(c.mentions || []) }}><Pencil className="h-3 w-3" /> Edit</button>}
              {(c.author_user_id === me?.userId || me?.role === "admin") && <button className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-red-600" onClick={() => { if (confirm("Delete this comment?")) remove.mutate(c.id) }}><Trash2 className="h-3 w-3" /></button>}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 space-y-2">{repliesOf(c.id).map(r => renderComment(r, true))}</div>
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Toolbar: sorting + filters + storage proof */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={sort} onChange={e => setSort(e.target.value as SortMode)} className="h-8 w-auto text-xs">
          <option value="newest">Sort: Newest first</option>
          <option value="oldest">Sort: Oldest first</option>
          <option value="most_reacted">Sort: Most reacted</option>
        </Select>
        <div className="flex rounded-lg border p-0.5 text-[11px]">
          {([["all", "All"], ["mentions", "@ Me"], ["attachments", "📎 Images"], ["pinned", "📌 Pinned"]] as const).map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-2 py-1 ${filter === f ? "bg-primary text-white" : "text-muted-foreground"}`}>{label}</button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">{comments.length} comment(s){scopeTitle ? ` on ${scopeTitle}` : ""}</span>
      </div>

      {isLoading ? <p className="text-xs text-muted-foreground">Loading comments…</p>
        : roots.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No comments match. Start the discussion below — Admin, Project Managers, and VAs can all join in.</p>
        : <div className="space-y-2">{roots.map(c => renderComment(c))}</div>}

      {/* Composer */}
      <div className="rounded-xl border bg-muted/20 p-3">
        {replyTo && <div className="mb-2 flex items-center justify-between rounded-lg bg-primary/10 px-2 py-1 text-[11px]">Replying to <b>{replyTo.author_name}</b>: “{replyTo.body.slice(0, 60)}…” <button onClick={() => setReplyTo(null)}><X className="h-3 w-3" /></button></div>}
        {editing && <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-100 px-2 py-1 text-[11px]">Editing your comment <button onClick={() => { setEditing(null); setBody("") }}><X className="h-3 w-3" /></button></div>}
        <div className="relative">
          <Textarea ref={taRef} value={body} onChange={e => onType(e.target.value)} rows={3}
            placeholder={`Comment… type @ to tag a teammate, e.g. @${team[0]?.name || "Name"}`}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && (body.trim() || staged.length)) post.mutate() }} />
          {mentionMatches.length > 0 && (
            <div className="absolute bottom-full left-0 z-30 mb-1 w-64 overflow-hidden rounded-lg border bg-card shadow-xl">
              {mentionMatches.map(m => (
                <button key={m.user_id} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted" onClick={() => pickMention(m)}>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[8px] font-bold text-primary">{initials(m.name)}</span>
                  {m.name} <span className="ml-auto text-[9px] text-muted-foreground">{roleLabel(m.role)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {staged.length > 0 && (
          <div className="mt-2">
            <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">Preview — choose how to attach each image. It only uploads when you post.</p>
            <div className="flex flex-wrap gap-3">
              {staged.map(a => {
                const isImage = (a.blob.type || "").startsWith("image/") || !!a.width
                return (
                <figure key={a.key} className="w-full max-w-[280px]">
                  <div className="relative">
                    {isImage ? (
                      <img src={a.preview} alt={a.name} className="h-36 w-full cursor-pointer rounded-lg border object-cover" onClick={() => setAnnotateLocal(a.key)} />
                    ) : (
                      <div className="flex h-36 w-full items-center justify-center rounded-lg border bg-muted/40 px-3 text-center text-[11px] font-medium">{a.name}</div>
                    )}
                    <button title="Remove" className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white hover:bg-black"
                      onClick={() => { URL.revokeObjectURL(a.preview); setStaged(s => s.filter(x => x.key !== a.key)) }}><X className="h-3 w-3" /></button>
                    {a.annotated && <span className="absolute left-1.5 top-1.5 rounded-full bg-red-500 px-1.5 py-px text-[9px] font-semibold text-white">✏️ With guide</span>}
                  </div>
                  <figcaption className="mt-1 truncate text-[9px] leading-tight text-muted-foreground" title={a.name}>
                    {a.name}{a.width ? ` · ${a.width}×${a.height}` : ""} · {formatBytes(a.blob.size)} · {isImage ? (a.mode === "guide" ? "with guide" : "image") : "file"} · not attached yet
                  </figcaption>
                  {isImage && (
                    <Button size="sm" variant="outline" className="mt-1.5 w-full whitespace-nowrap border-red-200 text-red-600 hover:bg-red-50" onClick={() => setAnnotateLocal(a.key)}>
                      <Pencil className="h-3.5 w-3.5" /> {a.mode === "guide" ? "Edit guide" : "Add guide to this image"}
                    </Button>
                  )}
                </figure>
              )})}
            </div>
          </div>
        )}
        {uploadNote && <p className="mt-1 text-[10px] text-amber-600">{uploadNote}</p>}
        {postError && <p className="mt-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">{postError}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" hidden
            onChange={e => { if (e.target.files) stageFiles(e.target.files, nextWithGuide.current).catch(err => setUploadNote(err.message)); nextWithGuide.current = false; e.target.value = "" }} />
          <Button type="button" size="sm" variant="outline" className="whitespace-nowrap" onClick={() => { nextWithGuide.current = false; fileRef.current?.click() }}><ImagePlus className="h-3.5 w-3.5" /> Attach file</Button>
          <Button type="button" size="sm" variant="outline" className="whitespace-nowrap border-red-200 text-red-600 hover:bg-red-50" onClick={() => { nextWithGuide.current = true; fileRef.current?.click() }}><Pencil className="h-3.5 w-3.5" /> Attach image with guide</Button>
          <Button
            type="button"
            variant="gold"
            size="sm"
            className="ml-auto"
            disabled={(!body.trim() && staged.length === 0) || post.isPending}
            onClick={() => post.mutate()}
          >
            {post.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {post.isPending && staged.length
              ? "Uploading & posting…"
              : editing
                ? "Save edit"
                : replyTo
                  ? "Reply"
                  : staged.length
                    ? `Post comment + attach ${staged.length}`
                    : "Post comment"}
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">Ctrl/⌘ + Enter to post · Attachments upload when you post · @mentions still notify even with files.</p>
      </div>

      {annotate && annotateUrl && (
        <ImageAnnotator imageUrl={annotateUrl} title={annotate.att.original_name} saving={saveAnnotation.isPending}
          onClose={() => setAnnotate(null)} onSave={b => saveAnnotation.mutate(b)} />
      )}
      {localTarget && (
        <ImageAnnotator
          imageUrl={localTarget.preview}
          title={`${localTarget.name} (preview — not attached yet)`}
          onClose={() => {
            // Closing without drawing still lets the image post as a plain attachment.
            setStaged(s => s.map(x => (x.key === localTarget.key && !x.mode ? { ...x, mode: "plain" as const } : x)))
            setAnnotateLocal(null)
          }}
          onSave={saveLocalAnnotation}
        />
      )}
    </div>
  )
}
