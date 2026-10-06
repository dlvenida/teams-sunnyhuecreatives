import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getAuthUser, setAuthUser } from "@/lib/api"
import { profileToForm, type ProfileFormData, type UserProfile } from "@/lib/profile"
import { ProfilePhotoUpload } from "@/components/profile/ProfilePhotoUpload"
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Mail, MapPin, Phone, Landmark, Wallet } from "lucide-react"

export function ProfilePage() {
  const qc = useQueryClient()
  const authUser = getAuthUser()
  const [form, setForm] = useState<ProfileFormData | null>(null)
  const [saveMessage, setSaveMessage] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [verifyCode, setVerifyCode] = useState("")
  const [devCode, setDevCode] = useState<string | null>(null)
  const [emailStep, setEmailStep] = useState<"idle" | "pending">("idle")
  const [emailMessage, setEmailMessage] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [passwordMessage, setPasswordMessage] = useState("")

  const { data: profile, isLoading, isError, error } = useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<UserProfile>("/profile/me"),
  })

  useEffect(() => {
    if (profile) setForm(profileToForm(profile))
  }, [profile])

  const saveProfile = useMutation({
    mutationFn: (body: ProfileFormData) =>
      apiFetch<UserProfile>("/profile/me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: body.display_name,
          phone: body.phone || null,
          address: body.address || null,
          wise_email: body.wise_email || null,
          ph_bank_account: body.ph_bank_account || null,
          ph_bank_account_name: body.ph_bank_account_name || null,
          ph_bank_name: body.ph_bank_name || null,
        }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(["profile"], data)
      setSaveMessage("Profile saved.")
      if (authUser) {
        setAuthUser({ ...authUser, name: data.display_name, mustChangePassword: data.must_change_password })
      }
      setTimeout(() => setSaveMessage(""), 3000)
    },
    onError: (err: Error) => setSaveMessage(err.message),
  })

  const requestEmailChange = useMutation({
    mutationFn: () =>
      apiFetch<{ message: string; dev_code?: string }>("/profile/request-email-change", {
        method: "POST",
        body: JSON.stringify({ new_email: newEmail }),
      }),
    onSuccess: (data) => {
      setEmailMessage(data.message)
      setDevCode(data.dev_code ?? null)
      setEmailStep("pending")
      qc.invalidateQueries({ queryKey: ["profile"] })
    },
    onError: (err: Error) => setEmailMessage(err.message),
  })

  const confirmEmailChange = useMutation({
    mutationFn: () =>
      apiFetch<UserProfile>("/profile/confirm-email-change", {
        method: "POST",
        body: JSON.stringify({ code: verifyCode }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(["profile"], data)
      setEmailStep("idle")
      setNewEmail("")
      setVerifyCode("")
      setDevCode(null)
      setEmailMessage("Email updated successfully.")
    },
    onError: (err: Error) => setEmailMessage(err.message),
  })

  const changePassword = useMutation({
    mutationFn: () =>
      apiFetch("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      }),
    onSuccess: () => {
      setPasswordMessage("Password updated successfully.")
      setCurrentPassword("")
      setNewPassword("")
      if (authUser) setAuthUser({ ...authUser, mustChangePassword: false })
    },
    onError: (err: Error) => setPasswordMessage(err.message),
  })

  if (isLoading) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading profile...</div>
  }

  if (isError || !profile || !form) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Could not load profile{error instanceof Error ? `: ${error.message}` : "."}
      </div>
    )
  }

  const update = (key: keyof ProfileFormData, value: string) => setForm({ ...form, [key]: value })

  return (
    <div className="mx-auto max-w-2xl space-y-5 animate-fade-in pb-8">
      <div>
        <h1 className="text-base font-semibold tracking-tight">Profile</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">Manage your account, contact info, and payment details</p>
      </div>

      {profile.must_change_password && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
          Please set a new password before continuing.
        </p>
      )}

      <Card className="overflow-hidden border-primary/20">
        <CardContent className="bg-gradient-to-br from-primary/5 to-transparent p-5">
          <ProfilePhotoUpload
            hasPhoto={profile.has_profile_photo}
            displayName={profile.display_name}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="default" className="capitalize">{profile.role}</Badge>
            {profile.currency && <Badge variant={profile.currency === "PHP" ? "php" : "usd"}>{profile.currency}</Badge>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Phone className="h-4 w-4 text-primary" /> Contact & Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="display-name">Display name</Label>
            <Input id="display-name" value={form.display_name} onChange={(e) => update("display_name", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" type="tel" placeholder="+63 912 345 6789" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="address">Address</Label>
            <Input id="address" placeholder="Street, city, province" value={form.address} onChange={(e) => update("address", e.target.value)} />
          </div>
          {saveMessage && <p className="text-[11px] text-muted-foreground">{saveMessage}</p>}
          <Button variant="gold" size="sm" disabled={saveProfile.isPending || !form.display_name} onClick={() => saveProfile.mutate(form)}>
            {saveProfile.isPending ? "Saving..." : "Save details"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Mail className="h-4 w-4 text-primary" /> Email
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Current: </span>
            <span className="font-medium">{profile.email}</span>
          </div>
          {profile.pending_email && (
            <p className="text-[11px] text-amber-700">
              Pending verification for <strong>{profile.pending_email}</strong>
            </p>
          )}
          {emailStep === "idle" ? (
            <>
              <div>
                <Label htmlFor="new-email">New email</Label>
                <Input id="new-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="new@example.com" />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!newEmail || requestEmailChange.isPending}
                onClick={() => requestEmailChange.mutate()}
              >
                Send verification code
              </Button>
            </>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground">{emailMessage}</p>
              {devCode && (
                <p className="rounded border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs">
                  Dev code: <strong className="tracking-widest">{devCode}</strong>
                </p>
              )}
              <div>
                <Label htmlFor="verify-code">6-digit verification code</Label>
                <Input
                  id="verify-code"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="tracking-widest"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="gold" size="sm" disabled={verifyCode.length !== 6 || confirmEmailChange.isPending} onClick={() => confirmEmailChange.mutate()}>
                  Verify & update email
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setEmailStep("idle"); setDevCode(null); setEmailMessage("") }}>
                  Cancel
                </Button>
              </div>
            </>
          )}
          {emailStep === "idle" && emailMessage && <p className="text-[11px] text-red-600">{emailMessage}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Wallet className="h-4 w-4 text-primary" /> Payment Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="wise">Wise email</Label>
            <Input id="wise" type="email" placeholder="you@wise.com" value={form.wise_email} onChange={(e) => update("wise_email", e.target.value)} />
          </div>
          <div className="border-t border-border pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Landmark className="h-3.5 w-3.5" /> Philippines bank account
            </p>
            <div className="space-y-3">
              <div>
                <Label htmlFor="ph-bank-name">Name of bank</Label>
                <Input id="ph-bank-name" placeholder="e.g. BDO, BPI, Metrobank" value={form.ph_bank_name} onChange={(e) => update("ph_bank_name", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ph-account-name">Account name</Label>
                <Input id="ph-account-name" placeholder="Name on account" value={form.ph_bank_account_name} onChange={(e) => update("ph_bank_account_name", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ph-account">Account number</Label>
                <Input id="ph-account" placeholder="Account number" value={form.ph_bank_account} onChange={(e) => update("ph_bank_account", e.target.value)} />
              </div>
            </div>
          </div>
          <Button variant="gold" size="sm" disabled={saveProfile.isPending} onClick={() => saveProfile.mutate(form)}>
            Save payment info
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-primary" /> Appearance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ThemeSwitcher />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="current-password">Current password</Label>
            <Input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} />
          </div>
          {passwordMessage && <p className="text-[11px] text-muted-foreground">{passwordMessage}</p>}
          <Button variant="gold" size="sm" disabled={!currentPassword || newPassword.length < 8 || changePassword.isPending} onClick={() => changePassword.mutate()}>
            {changePassword.isPending ? "Updating..." : "Update password"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
