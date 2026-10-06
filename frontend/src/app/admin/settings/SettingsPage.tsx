import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api"
import type { Settings } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/input"

export function SettingsPage() {
  const qc = useQueryClient()
  const [settingsForm, setSettingsForm] = useState<Settings | null>(null)

  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<Settings>("/settings") })

  useEffect(() => {
    if (settings && !settingsForm) setSettingsForm(settings)
  }, [settings, settingsForm])

  const saveSettings = useMutation({
    mutationFn: () => apiFetch("/settings", { method: "PUT", body: JSON.stringify(settingsForm) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] })
      qc.invalidateQueries({ queryKey: ["display-settings"] })
    },
  })

  const sf = settingsForm || settings

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-base font-semibold tracking-tight">Settings</h1>

      {sf && (
        <Card>
          <CardHeader><CardTitle>Company & Payment Defaults</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Company Name</Label><Input value={sf.company_name} onChange={(e) => setSettingsForm({ ...sf, company_name: e.target.value })} /></div>
              <div><Label>Principal</Label><Input value={sf.principal_name} onChange={(e) => setSettingsForm({ ...sf, principal_name: e.target.value })} /></div>
              <div><Label>Location</Label><Input value={sf.location} onChange={(e) => setSettingsForm({ ...sf, location: e.target.value })} /></div>
              <div><Label>Wise Email</Label><Input value={sf.wise_email} onChange={(e) => setSettingsForm({ ...sf, wise_email: e.target.value })} /></div>
              <div><Label>PayPal Email</Label><Input value={sf.paypal_email} onChange={(e) => setSettingsForm({ ...sf, paypal_email: e.target.value })} /></div>
            </div>
            <Button variant="gold" onClick={() => saveSettings.mutate()}>Save Settings</Button>
          </CardContent>
        </Card>
      )}

      {sf && (
        <Card>
          <CardHeader><CardTitle>Display & Booking</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Show pricing in app</Label>
                <Select
                  value={sf.hide_pricing ? "hide" : "show"}
                  onChange={(e) => setSettingsForm({ ...sf, hide_pricing: e.target.value === "hide" })}
                >
                  <option value="hide">Hide pricing (default)</option>
                  <option value="show">Show pricing</option>
                </Select>
              </div>
              <div>
                <Label>Default VA hourly rate (when pricing hidden)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={sf.default_va_hourly_rate}
                  onChange={(e) => setSettingsForm({ ...sf, default_va_hourly_rate: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Booking link URL</Label>
                <Input
                  type="url"
                  placeholder="https://calendly.com/your-link"
                  value={sf.booking_url}
                  onChange={(e) => setSettingsForm({ ...sf, booking_url: e.target.value })}
                />
              </div>
              <div>
                <Label>Booking page pricing</Label>
                <Select
                  value={sf.booking_hide_pricing ? "hide" : "show"}
                  onChange={(e) => setSettingsForm({ ...sf, booking_hide_pricing: e.target.value === "hide" })}
                >
                  <option value="hide">Hide pricing on booking link (default)</option>
                  <option value="show">Keep booking URL as-is</option>
                </Select>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              When pricing is hidden, rates and amounts are not shown in the dashboard, logs, payroll, invoices list, and reports. VAs log hours without seeing pay.
            </p>
            <Button variant="gold" onClick={() => saveSettings.mutate()}>Save display settings</Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
