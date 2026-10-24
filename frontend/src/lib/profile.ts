export type NotificationSoundId = "chime" | "bell" | "ping" | "loud"

export interface NotificationPreferences {
  popup_enabled: boolean
  sound_enabled: boolean
  sound_id: NotificationSoundId
  popup_types: Record<string, boolean>
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  popup_enabled: true,
  sound_enabled: true,
  sound_id: "chime",
  popup_types: {
    comment: true,
    task: true,
    log: true,
    clock: true,
    delegation: true,
    invoice: true,
    system: true,
  },
}

export interface UserProfile {
  id: string
  email: string
  username?: string | null
  pending_email?: string | null
  role: "admin" | "auditor" | "va"
  display_name: string
  has_profile_photo: boolean
  phone?: string | null
  address?: string | null
  wise_email?: string | null
  ph_bank_account?: string | null
  ph_bank_account_name?: string | null
  ph_bank_name?: string | null
  currency?: "PHP" | "USD" | null
  must_change_password: boolean
  has_pin?: boolean
  job_title?: string | null
  bio?: string | null
  timezone?: string | null
  skills?: string[] | null
  emergency_contact_name?: string | null
  emergency_contact_phone?: string | null
  emergency_contact_relationship?: string | null
  hire_date?: string | null
  tenure_years?: number | null
  tenure_months?: number | null
  tenure_label?: string | null
  date_of_birth?: string | null
  linkedin_url?: string | null
  portfolio_url?: string | null
  status_message?: string | null
  notification_preferences?: NotificationPreferences | null
  created_at?: string | null
}

export interface ProfileFormData {
  display_name: string
  phone: string
  address: string
  wise_email: string
  ph_bank_account: string
  ph_bank_account_name: string
  ph_bank_name: string
  job_title: string
  bio: string
  timezone: string
  skills: string
  emergency_contact_name: string
  emergency_contact_phone: string
  emergency_contact_relationship: string
  hire_date: string
  date_of_birth: string
  linkedin_url: string
  portfolio_url: string
  status_message: string
}

export function profileToForm(p: UserProfile): ProfileFormData {
  return {
    display_name: p.display_name,
    phone: p.phone || "",
    address: p.address || "",
    wise_email: p.wise_email || "",
    ph_bank_account: p.ph_bank_account || "",
    ph_bank_account_name: p.ph_bank_account_name || "",
    ph_bank_name: p.ph_bank_name || "",
    job_title: p.job_title || "",
    bio: p.bio || "",
    timezone: p.timezone || "Asia/Manila",
    skills: (p.skills || []).join(", "),
    emergency_contact_name: p.emergency_contact_name || "",
    emergency_contact_phone: p.emergency_contact_phone || "",
    emergency_contact_relationship: p.emergency_contact_relationship || "",
    hire_date: p.hire_date || "",
    date_of_birth: p.date_of_birth || "",
    linkedin_url: p.linkedin_url || "",
    portfolio_url: p.portfolio_url || "",
    status_message: p.status_message || "",
  }
}

export const TIMEZONES = ["Asia/Manila", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Europe/London", "America/New_York", "America/Chicago", "America/Los_Angeles", "UTC"]
