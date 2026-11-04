import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/input"

interface NoteRevision {
  id: string
  body: string
  editor_name: string
  updated_label: string
}

interface TaskNotes {
  body: string
  updated_by?: string | null
  updated_label?: string | null
  history: NoteRevision[]
}

export function TaskStaffNotes({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const [error, setError] = useState("")
  const { data } = useQuery({
    queryKey: ["task-notes", taskId],
    queryFn: () => apiFetch<TaskNotes>(`/tasks/${taskId}/notes`),
  })

  useEffect(() => {
    setDraft(data?.body ?? "")
    setError("")
  }, [data?.body, taskId])

  const save = useMutation({
    mutationFn: () => apiFetch<TaskNotes>(`/tasks/${taskId}/notes`, {
      method: "PUT",
      body: JSON.stringify({ body: draft }),
    }),
    onSuccess: () => {
      setError("")
      qc.invalidateQueries({ queryKey: ["task-notes", taskId] })
    },
    onError: (err: Error) => setError(err.message),
  })

  const dirty = (data?.body ?? "") !== draft

  return (
    <div className="rounded-xl border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold">Notes</h4>
        {canEdit && data && data.history.length > 0 && (
          <button type="button" className="text-[10px] font-semibold text-primary" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Hide history" : "View history"}
          </button>
        )}
      </div>
      {canEdit ? (
        <>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Notes for this task. Saving does not post a comment."
            rows={4}
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="gold" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {draft.trim() ? "Save notes" : "Clear notes"}
            </Button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-wrap text-xs text-foreground">{data?.body?.trim() ? data.body : "No notes yet."}</p>
      )}
      {data?.updated_label && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Last Updated: {data.updated_label}{data.updated_by ? ` by ${data.updated_by}` : ""}
        </p>
      )}
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      {canEdit && showHistory && (
        <ul className="mt-3 space-y-2 border-t pt-2">
          {data?.history.map((row) => (
            <li key={row.id} className="text-[11px]">
              <p className="font-semibold text-muted-foreground">{row.updated_label} by {row.editor_name}</p>
              <p className="mt-0.5 whitespace-pre-wrap">{row.body.trim() ? row.body : "Cleared"}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
