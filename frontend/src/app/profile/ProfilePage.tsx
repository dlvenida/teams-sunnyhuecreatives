import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, getAuthUser, setAuthUser } from "@/lib/api"
import { profileToForm, TIMEZONES, type ProfileFormData, type UserProfile } from "@/lib/profile"
import { ProfilePhotoUpload } from "@/components/profile/ProfilePhotoUpload"
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher"
import { Button } from "@/components/ui/button"
import { Input, Label, Select, Textarea } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Briefcase, Hash, HeartHandshake, Link2, Lock, Mail, Palette, Phone, Landmark, Wallet } from "lucide-react"
import { PinInput } from "@/components/auth/PinInput"

export function ProfilePage() {
  const qc = useQueryClient()
  const authUser = getAuthUser()
  const [form, setForm] = useState<ProfileFormData | null>(null)
  const [saveMessage, setSaveMessage] = useState("")
  const [saveOk, setSaveOk] = useState(true)
  const [newEmail, setNewEmail] = useState("")
  const [verifyCode, setVerifyCode] = useState("")
  const [devCode, setDevCode] = useState<string | null>(null)
  const [emailStep, setEmailStep] = useState<"idle" | "pending">("idle")
  const [emailMessage, setEmailMessage] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [passwordMessage, setPasswordMessage] = useState("")
  const [pinPassword, setPinPassword] = useState("")
  const [pin, setPinValue] = useState("")
  const [pinConfirm, setPinConfirm] = useState("")
  const [pinMessage, setPinMessage] = useState("")
  const [pinOk, setPinOk] = useState(true)
  const [tab, setTab] = useState("contact")

  const { data: profile, isLoading, isError, error } = useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<UserProfile>("/profile/me"),
  })

  useEffect(() => {
    if (profile) {
      setForm(profileToForm(profile))
      if (profile.must_change_password) setTab("security")
    }
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
          job_title: body.job_title || null,
          bio: body.bio || null,
          timezone: body.timezone || null,
          skills: body.skills ? body.skills.split(",").map(s => s.trim()).filter(Boolean) : [],
          emergency_contact_name: body.emergency_contact_name || null,
          emergency_contact_phone: body.emergency_contact_phone || null,
          emergency_contact_relationship: body.emergency_contact_relationship || null,
          hire_date: body.hire_date || null,
          date_of_birth: body.date_of_birth || null,
          linkedin_url: body.linkedin_url || null,
          portfolio_url: body.portfolio_url || null,
          status_message: body.status_message || null,
        }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(["profile"], data)
      setSaveOk(true)
      setSaveMessage("✓ Profile saved.")
      if (authUser) {
        setAuthUser({ ...authUser, name: data.display_name, mustChangePassword: data.must_change_password })
      }
      setTimeout(() => setSaveMessage(""), 3000)
    },
    onError: (err: Error) => { setSaveOk(false); setSaveMessage(err.message) },
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

  const setPin = useMutation({
    mutationFn: () =>
      apiFetch<{ message: string }>("/profile/set-pin", {
        method: "POST",
        body: JSON.stringify({ current_password: pinPassword, pin }),
      }),
    onSuccess: (data) => {
      setPinOk(true)
      setPinMessage(`✓ ${data.message}`)
      setPinPassword("")
      setPinValue("")
      setPinConfirm("")
      qc.invalidateQueries({ queryKey: ["profile"] })
    },
    onError: (err: Error) => { setPinOk(false); setPinMessage(err.message) },
  })

  const removePin = useMutation({
    mutationFn: () =>
      apiFetch<{ message: string }>("/profile/remove-pin", {
        method: "POST",
        body: JSON.stringify({ current_password: pinPassword }),
      }),
    onSuccess: (data) => {
      setPinOk(true)
      setPinMessage(`✓ ${data.message}`)
      setPinPassword("")
      qc.invalidateQueries({ queryKey: ["profile"] })
    },
    onError: (err: Error) => { setPinOk(false); setPinMessage(err.message) },
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

  const skillList = form.skills
    ? form.skills.split(",").map(s => s.trim()).filter(Boolean)
    : (profile.skills ?? [])

  const SaveRow = ({ label }: { label: string }) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="gold" size="sm" disabled={saveProfile.isPending || !form.display_name} onClick={() => saveProfile.mutate(form)}>
        {saveProfile.isPending ? "Saving…" : label}
      </Button>
      {saveMessage && (
        <p className={`text-[11px] font-semibold ${saveOk ? "text-green-600" : "text-red-600"}`} role="status">{saveMessage}</p>
      )}
    </div>
  )

  return (
    <div className="w-full space-y-5 animate-fade-in pb-8">
      <div className="px-1 pt-1">
        <h1 className="font-display text-xl font-bold">Profile</h1>
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
            {profile.job_title && <Badge>{profile.job_title}</Badge>}
            {profile.timezone && <Badge>{profile.timezone}</Badge>}
          </div>
          {profile.status_message && <p className="mt-2 text-xs text-muted-foreground">“{profile.status_message}”</p>}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1.5 pb-1" role="tablist" aria-label="Profile sections">
        {[
          { id: "contact", label: "Contact & Details", icon: Phone },
          { id: "work", label: "Work Profile", icon: Briefcase },
          { id: "emergency", label: "Emergency", icon: HeartHandshake },
          { id: "links", label: "Links", icon: Link2 },
          { id: "email", label: "Email", icon: Mail },
          { id: "payment", label: "Payment", icon: Wallet },
          { id: "appearance", label: "Appearance", icon: Palette },
          { id: "security", label: "Security", icon: Lock },
        ].map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-2 text-xs font-semibold transition ${
              tab === t.id
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card hover:bg-muted/60"
            }`}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "contact" && (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Phone className="h-4 w-4 text-primary" /> Contact & Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <Label htmlFor="display-name">Display name</Label>
              <Input id="display-name" value={form.display_name} onChange={(e) => update("display_name", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" type="tel" placeholder="+63 912 345 6789" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
            </div>
            <div className="sm:col-span-2 xl:col-span-1">
              <Label htmlFor="address">Address</Label>
              <Input id="address" placeholder="Street, city, province" value={form.address} onChange={(e) => update("address", e.target.value)} />
            </div>
          </div>
          <SaveRow label="Save details" />
        </CardContent>
      </Card>
      )}

      {tab === "work" && (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Briefcase className="h-4 w-4 text-primary" /> Work Profile</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div><Label htmlFor="job-title">Job title / Role</Label><Input id="job-title" placeholder="Virtual Assistant, Designer…" value={form.job_title} onChange={(e) => update("job_title", e.target.value)} /></div>
            <div><Label htmlFor="status-msg">Status message</Label><Input id="status-msg" placeholder="Available, On leave, Focus mode…" value={form.status_message} onChange={(e) => update("status_message", e.target.value)} /></div>
            <div><Label htmlFor="tz">Timezone</Label><Select id="tz" value={form.timezone} onChange={(e) => update("timezone", e.target.value)}>{TIMEZONES.map(t => <option key={t} value={t}>{t}</option>)}</Select></div>
            <div><Label htmlFor="hire">Hire / Start date</Label><Input id="hire" type="date" value={form.hire_date} onChange={(e) => update("hire_date", e.target.value)} /></div>
            <div><Label htmlFor="dob">Date of birth</Label><Input id="dob" type="date" value={form.date_of_birth} onChange={(e) => update("date_of_birth", e.target.value)} /></div>
            <div><Label htmlFor="skills">Skills (comma separated)</Label><Input id="skills" placeholder="Inbox management, Canva, Bookkeeping" value={form.skills} onChange={(e) => update("skills", e.target.value)} /></div>
          </div>
          <div><Label htmlFor="bio">Bio</Label><Textarea id="bio" placeholder="Short intro about your work…" value={form.bio} onChange={(e) => update("bio", e.target.value)} /></div>
          {skillList.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {skillList.map(s => <Badge key={s}>{s}</Badge>)}
            </div>
          )}
          <SaveRow label="Save work profile" />
        </CardContent>
      </Card>
      )}

      {tab === "emergency" && (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><HeartHandshake className="h-4 w-4 text-primary" /> Emergency Contact</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div><Label htmlFor="ec-name">Full name</Label><Input id="ec-name" value={form.emergency_contact_name} onChange={(e) => update("emergency_contact_name", e.target.value)} /></div>
            <div><Label htmlFor="ec-phone">Phone</Label><Input id="ec-phone" value={form.emergency_contact_phone} onChange={(e) => update("emergency_contact_phone", e.target.value)} /></div>
            <div><Label htmlFor="ec-rel">Relationship</Label><Input id="ec-rel" placeholder="Spouse, Parent…" value={form.emergency_contact_relationship} onChange={(e) => update("emergency_contact_relationship", e.target.value)} /></div>
          </div>
          <SaveRow label="Save emergency contact" />
        </CardContent>
      </Card>
      )}

      {tab === "links" && (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Link2 className="h-4 w-4 text-primary" /> Links</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="linkedin">LinkedIn</Label><Input id="linkedin" type="url" placeholder="https://linkedin.com/in/…" value={form.linkedin_url} onChange={(e) => update("linkedin_url", e.target.value)} /></div>
            <div><Label htmlFor="portfolio">Portfolio / Website</Label><Input id="portfolio" type="url" placeholder="https://" value={form.portfolio_url} onChange={(e) => update("portfolio_url", e.target.value)} /></div>
          </div>
          <SaveRow label="Save links" />
        </CardContent>
      </Card>
      )}

      {tab === "email" && (
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
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
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
            </div>
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
      )}

      {tab === "payment" && (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Wallet className="h-4 w-4 text-primary" /> Payment Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
            <div>
              <Label htmlFor="wise">Wise email</Label>
              <Input id="wise" type="email" placeholder="you@wise.com" value={form.wise_email} onChange={(e) => update("wise_email", e.target.value)} />
            </div>
            <div className="border-border lg:border-l lg:pl-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Landmark className="h-3.5 w-3.5" /> Philippines bank account
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
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
          </div>
          <SaveRow label="Save payment info" />
        </CardContent>
      </Card>
      )}

      {tab === "appearance" && (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Palette className="h-4 w-4 text-primary" /> Appearance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ThemeSwitcher />
        </CardContent>
      </Card>
      )}

      {tab === "security" && (
      <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="current-password">Current password</Label>
              <Input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="new-password">New password</Label>
              <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} />
              <p className="mt-1 text-[10px] text-muted-foreground">At least 8 characters.</p>
            </div>
          </div>
          {passwordMessage && <p className="text-[11px] text-muted-foreground">{passwordMessage}</p>}
          <Button variant="gold" size="sm" disabled={!currentPassword || newPassword.length < 8 || changePassword.isPending} onClick={() => changePassword.mutate()}>
            {changePassword.isPending ? "Updating..." : "Update password"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Hash className="h-4 w-4 text-primary" /> Quick-Login PIN
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {profile.has_pin
              ? "A PIN is set for this account. On the sign-in screen choose Quick PIN, enter your email and PIN, and you're in right away — no password typing. 5 wrong PINs locks PIN login for 15 minutes; your password always works."
              : "Set a 6-digit PIN for faster sign-in on devices you trust. On the sign-in screen choose Quick PIN, enter your email and PIN, and you're in right away. Your full password always remains valid."}
          </p>
          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <Label htmlFor="pin-password">Current password</Label>
              <Input id="pin-password" type="password" value={pinPassword} onChange={(e) => setPinPassword(e.target.value)} placeholder="Required to set or remove a PIN" />
            </div>
            <div>
              <Label>{profile.has_pin ? "New PIN" : "Choose a 6-digit PIN"}</Label>
              <PinInput value={pin} onChange={setPinValue} disabled={setPin.isPending} />
            </div>
            <div>
              <Label>Confirm PIN</Label>
              <PinInput value={pinConfirm} onChange={setPinConfirm} disabled={setPin.isPending} />
            </div>
          </div>
          {pin.length === 6 && pinConfirm.length === 6 && pin !== pinConfirm && (
            <p className="text-[11px] font-semibold text-red-600">PINs don't match.</p>
          )}
          {pinMessage && (
            <p className={`text-[11px] font-semibold ${pinOk ? "text-green-600" : "text-red-600"}`} role="status">{pinMessage}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="gold"
              size="sm"
              disabled={!pinPassword || pin.length !== 6 || pin !== pinConfirm || setPin.isPending}
              onClick={() => setPin.mutate()}
            >
              {setPin.isPending ? "Saving…" : profile.has_pin ? "Change PIN" : "Set PIN"}
            </Button>
            {profile.has_pin && (
              <Button variant="outline" size="sm" disabled={!pinPassword || removePin.isPending} onClick={() => removePin.mutate()}>
                {removePin.isPending ? "Removing…" : "Remove PIN"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      </>
      )}
    </div>
  )
}
