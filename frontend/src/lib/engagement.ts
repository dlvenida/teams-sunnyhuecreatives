import { useQuery } from "@tanstack/react-query"
import { apiFetch, getAuthUser } from "@/lib/api"

export interface EngagementAccess {
  enabled: boolean
  scope: "va" | "management" | "none"
  va_id?: string | null
  va_name?: string | null
}

export interface EngagementCategory {
  key: string
  label: string
  min: number
  max: number
  detected: number
  duplicates: number
  invalid: number
  needs_review: number
  verified: number
  remaining: number
  completion_pct: number
  below_target: boolean
}

export interface EngagementAlert {
  code: string
  label: string
  explanation: string
  screenshot_id?: string | null
  activity_id?: string | null
}

export interface EngagementActivity {
  id: string
  screenshot_id: string
  activity_type: string
  username?: string | null
  activity_date?: string | null
  activity_time?: string | null
  text?: string | null
  status: string
  counted: boolean
  alerts: EngagementAlert[]
  explanation?: string | null
  decision?: string | null
  decision_reason?: string | null
}

export interface EngagementShot {
  id: string
  original_name: string
  extraction_status: string
  extraction_note?: string | null
  platform_seen?: string | null
  account_seen?: string | null
  url: string
  created_at?: string | null
}

export interface EngagementTask {
  task_id: string
  title: string
  client_id: string
  client_name: string
  assignee_name: string
  platform: string
  work_date: string
  status: string
  status_label: string
  completion_pct: number
  time_logged: string
  rejection_note?: string | null
  rejection_reasons?: string[]
  review_reasons?: string[]
  reader_failed?: boolean
  counts_not_measured?: boolean
  unreadable_screenshots?: number
  approval: string
  latest_at?: string | null
  submitted_at?: string | null
  rejected_at?: string | null
  pending_review: number
  duplicate_count: number
  invalid_count: number
  verified_total: number
  categories: EngagementCategory[]
  alerts: EngagementAlert[]
  screenshots: EngagementShot[]
  activities: EngagementActivity[]
  audits: { id: string; action: string; reason: string; actor_name: string; created_at?: string | null; original_result?: { status?: string; counted?: boolean } | null }[]
}

export interface EngagementBoard {
  work_date: string
  tasks: EngagementTask[]
}

export function engagementPlatform(title: string): "instagram" | "facebook" | "linkedin" | null {
  const text = title.toLowerCase()
  if (text.includes("linkedin")) return "linkedin"
  if (text.includes("instagram")) return "instagram"
  if (text.includes("facebook")) return "facebook"
  return null
}

export function useEngagementAccess() {
  const user = getAuthUser()
  return useQuery({
    queryKey: ["engagement-access"],
    queryFn: () => apiFetch<EngagementAccess>("/engagement/access"),
    enabled: !!user,
    staleTime: 60_000,
  })
}

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
}

const LACKING_WORD: Record<string, string> = {
  dm: "DMs",
  comment: "comments",
  share: "shares",
}

const METRIC_NAME: Record<string, string> = {
  "instagram:dm": "Instagram DMs",
  "instagram:comment": "Instagram comments",
  "facebook:share": "Facebook shares",
  "linkedin:comment": "LinkedIn comments",
}

function lackingLead(words: string[]): string {
  if (words.length === 1) return `Lacking ${words[0]}.`
  if (words.length === 2) return `Lacking ${words[0]} and ${words[1]}.`
  return `Lacking ${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}.`
}

/** Same wording as the API. Used only when an older payload has counts but no review_reasons. */
export function lackingReason(task: Pick<EngagementTask, "platform" | "categories">): string | null {
  const words: string[] = []
  const counts: string[] = []
  for (const row of task.categories || []) {
    if (row.verified == null || row.min == null || Number(row.verified) >= Number(row.min)) continue
    const word = LACKING_WORD[row.key]
    const metric = METRIC_NAME[`${task.platform}:${row.key}`]
    if (!word || !metric) {
      const label = (row.label || "").trim()
      if (!label) continue
      words.push(label.toLowerCase())
      counts.push(`${label} ${Number(row.verified)} of ${Number(row.min)}`)
      continue
    }
    words.push(word)
    counts.push(`${metric} ${Number(row.verified)} of ${Number(row.min)}`)
  }
  if (!words.length) return null
  return `${lackingLead(words)} ${counts.join(". ")}.`
}

const UNREAD_SCREENSHOT_NOTE = "This screenshot could not be read. Nothing on it was counted."

export function taskNeedsReview(task: EngagementTask): boolean {
  if (task.status === "needs_review" || task.status === "incomplete") return true
  if (task.approval === "Pending management review" || task.approval === "Sent back") return true
  if (task.approval === "Approved") return false
  if ((task.activities || []).some((row) => row.status === "rejected" || row.decision === "rejected")) return true
  if (task.status === "target_met" || task.status === "target_exceeded" || task.status === "completed") return false
  return (task.rejection_reasons?.length ?? 0) > 0
}

function uploadedButNotCounted(task: EngagementTask): boolean {
  if (task.reader_failed || task.counts_not_measured) return true
  const shots = task.screenshots || []
  if (!shots.length) return false
  if ((task.categories || []).some((row) => Number(row.verified) > 0)) return false
  if ((task.activities || []).some((row) => row.counted)) return false
  return true
}

export function reviewReasonLines(task: EngagementTask): string[] {
  if (Array.isArray(task.review_reasons)) {
    return task.review_reasons.map((line) => line.trim()).filter(Boolean)
  }
  if (!taskNeedsReview(task)) return []
  const lines: string[] = []
  const unread = uploadedButNotCounted(task)
  const lacking = unread ? null : lackingReason(task)
  if (unread) {
    const note = (task.screenshots || []).map((shot) => (shot.extraction_note || "").trim()).find(Boolean)
      || (task.alerts || []).find((alert) => alert.code === "UNCLEAR_SCREENSHOT" && !alert.activity_id)?.explanation
      || UNREAD_SCREENSHOT_NOTE
    lines.push(note)
  } else if (lacking) {
    lines.push(lacking)
  }
  if (task.approval === "Sent back" && task.rejection_note?.trim()) {
    const note = task.rejection_note.trim()
    const line = /^(rejected:|sent back)/i.test(note) ? note : `Rejected: ${note}`
    if (!lines.some((existing) => existing.toLowerCase() === line.toLowerCase())) lines.push(line)
  }
  for (const reason of task.rejection_reasons ?? []) {
    const text = reason.trim()
    if (!text) continue
    if (unread && /lacking |below the minimum/i.test(text)) continue
    if (lacking && /below the minimum|lacking /i.test(text)) continue
    if (lines.some((existing) => existing.toLowerCase() === text.toLowerCase() || existing.includes(text))) continue
    const line = unread && /could not be read|could not be checked/i.test(text)
      ? text
      : /^(rejected:|sent back)/i.test(text) ? text : `Rejected: ${text}`
    if (lines.some((existing) => existing.toLowerCase() === line.toLowerCase())) continue
    lines.push(line)
  }
  if (!lines.length && task.approval === "Pending management review") lines.push("Submitted for management review.")
  if (!lines.length) lines.push(unread ? UNREAD_SCREENSHOT_NOTE : "Needs review.")
  return lines
}
