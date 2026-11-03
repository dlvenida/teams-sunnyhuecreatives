import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BellRing, Mail } from "lucide-react"
import { apiFetch } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPreferences, type UserProfile } from "@/lib/profile"

export const VA_NOTICE_ROWS = [
  { id: "task_assigned", label: "Task assigned", example: "Jane assigned you a task: Calendar" },
  { id: "project_assigned", label: "Project assigned", example: "Jane assigned you a project: Calendar" },
  { id: "deadline_soon", label: "Deadline in 24 hours", example: "Calendar is due tomorrow at 5:00 PM" },
  { id: "deadline_overdue", label: "Task past due", example: "Calendar is past due" },
  { id: "task_updated", label: "Task updated", example: "Audrey updated Calendar" },
  { id: "task_comment", label: "Comment on your task", example: "Jane commented: Please update the captions" },
  { id: "task_mention", label: "Mention on your task", example: "Audrey mentioned you" },
  { id: "task_approved", label: "Task approved", example: "Jane approved Calendar" },
  { id: "task_rejected", label: "Task rejected", example: "Audrey rejected Calendar" },
  { id: "timesheet_approved", label: "Timesheet approved", example: "Jane approved your timesheet" },
  { id: "timesheet_rejected", label: "Timesheet rejected", example: "Jane rejected your timesheet" },
] as const

type EventPrefs = Record<string, { popup: boolean; email: boolean }>

function eventsFrom(prefs?: NotificationPreferences | null): EventPrefs {
  const saved = prefs?.events || {}
  const out: EventPrefs = {}
  for (const row of VA_NOTICE_ROWS) {
    const current = saved[row.id]
    out[row.id] = {
      popup: current?.popup !== false,
      email: current?.email !== false,
    }
  }
  return out
}

export function VANotificationPreferencesPage() {
  const qc = useQueryClient()
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/profile/me") })
  const [events, setEvents] = useState<EventPrefs>(eventsFrom(null))
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (profile) setEvents(eventsFrom(profile.notification_preferences))
  }, [profile])

  const save = useMutation({
    mutationFn: () => {
      const current = profile?.notification_preferences || DEFAULT_NOTIFICATION_PREFS
      return apiFetch("/profile/me", {
        method: "PATCH",
        body: JSON.stringify({
          notification_preferences: {
            ...current,
            events,
          },
        }),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile"] })
      setMessage("Preferences saved. New alerts follow these switches.")
    },
    onError: (err: Error) => setMessage(err.message),
  })

  const setChannel = (id: string, channel: "popup" | "email", value: boolean) => {
    setEvents((prev) => ({ ...prev, [id]: { ...prev[id], [channel]: value } }))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Notification preferences</h1>
        <p className="text-sm text-muted-foreground">Choose a corner pop-up, an email, or both. Everything still lands in the bell. Both are on until you turn one off.</p>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Your alerts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <th className="p-3">Alert</th>
                <th className="p-3 text-center">Pop-up</th>
                <th className="p-3 text-center">Email</th>
              </tr>
            </thead>
            <tbody>
              {VA_NOTICE_ROWS.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="p-3">
                    <p className="font-semibold">{row.label}</p>
                    <p className="text-[11px] text-muted-foreground">{row.example}</p>
                  </td>
                  <td className="p-3 text-center">
                    <input
                      aria-label={`${row.label} pop-up`}
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={events[row.id]?.popup !== false}
                      onChange={(e) => setChannel(row.id, "popup", e.target.checked)}
                    />
                  </td>
                  <td className="p-3 text-center">
                    <input
                      aria-label={`${row.label} email`}
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={events[row.id]?.email !== false}
                      onChange={(e) => setChannel(row.id, "email", e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3 px-3 py-3">
            <Button variant="gold" disabled={save.isPending} onClick={() => save.mutate()}>
              <BellRing className="h-3.5 w-3.5" /> {save.isPending ? "Saving…" : "Save preferences"}
            </Button>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Mail className="h-3.5 w-3.5" /> Emails use the Sunny Hue note and one link to the task, timesheet, or project.</span>
          </div>
          {message && <p className="px-3 pb-3 text-xs text-muted-foreground">{message}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
