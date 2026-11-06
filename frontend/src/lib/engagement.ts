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
  approval: string
  latest_at?: string | null
  submitted_at?: string | null
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
