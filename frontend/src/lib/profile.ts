export interface UserProfile {
  id: string
  email: string
  pending_email?: string | null
  role: "admin" | "va"
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
}

export interface ProfileFormData {
  display_name: string
  phone: string
  address: string
  wise_email: string
  ph_bank_account: string
  ph_bank_account_name: string
  ph_bank_name: string
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
  }
}
