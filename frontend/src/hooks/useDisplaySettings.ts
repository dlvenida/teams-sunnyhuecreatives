import { useQuery } from "@tanstack/react-query"
import { apiFetch, getAuthUser } from "@/lib/api"

export interface DisplaySettings {
  hide_pricing: boolean
  booking_url: string
  booking_hide_pricing: boolean
  default_va_hourly_rate: string
}

const DEFAULTS: DisplaySettings = {
  hide_pricing: true,
  booking_url: "",
  booking_hide_pricing: true,
  default_va_hourly_rate: "75",
}

export function useDisplaySettings() {
  const { data, isLoading } = useQuery({
    queryKey: ["display-settings"],
    queryFn: () => apiFetch<DisplaySettings>("/settings/display"),
    staleTime: 60_000,
  })
  const settings = data ?? DEFAULTS
  const role = getAuthUser()?.role
  // Auditor never sees money; VAs always see their own earnings; admin follows company toggle
  const showPricing =
    role === "auditor" ? false : role === "va" ? true : !settings.hide_pricing
  return {
    ...settings,
    showPricing,
    isLoading,
  }
}

/** Booking URL with pricing-related query params stripped when configured. */
export function getBookingUrl(settings: DisplaySettings): string {
  const raw = settings.booking_url?.trim()
  if (!raw) return ""
  if (!settings.booking_hide_pricing) return raw
  try {
    const url = new URL(raw)
    const stripKeys = [
      "price",
      "pricing",
      "amount",
      "package",
      "plan",
      "tier",
      "product",
      "sku",
    ]
    stripKeys.forEach((key) => url.searchParams.delete(key))
    url.searchParams.set("hide_prices", "1")
    url.searchParams.set("hide_pricing", "1")
    return url.toString()
  } catch {
    return raw
  }
}
