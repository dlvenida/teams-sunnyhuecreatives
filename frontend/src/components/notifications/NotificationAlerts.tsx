import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { X } from "lucide-react"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { NotificationList } from "@/lib/types"
import { DEFAULT_NOTIFICATION_PREFS, type NotificationDelivery, type NotificationPreferences, type UserProfile } from "@/lib/profile"
import { playNotificationSound } from "@/lib/notificationSound"
import { resolveNotificationLink } from "@/lib/notificationLink"
import { TYPE_META } from "@/components/layout/NotificationsPanel"
import { cn } from "@/lib/utils"

interface ToastItem {
  id: string
  type: string
  title: string
  body?: string | null
  link?: string | null
}

function mergePrefs(raw?: NotificationPreferences | null): NotificationPreferences {
  return {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...(raw || {}),
    popup_types: {
      ...DEFAULT_NOTIFICATION_PREFS.popup_types,
      ...(raw?.popup_types || {}),
    },
    delivery: {
      ...(DEFAULT_NOTIFICATION_PREFS.delivery || {}),
      ...(raw?.delivery || {}),
    },
  }
}

function deliveryFor(type: string, prefs: NotificationPreferences): NotificationDelivery {
  const chosen = prefs.delivery?.[type]
  if (chosen === "both" || chosen === "popup" || chosen === "sound" || chosen === "bell") return chosen
  if (prefs.popup_types[type] === false) return "bell"
  if (prefs.popup_enabled && prefs.sound_enabled) return "both"
  if (prefs.popup_enabled) return "popup"
  if (prefs.sound_enabled) return "sound"
  return "bell"
}

/**
 * Global poll watcher: when new unread notifications arrive, show a pop-up
 * and optionally play a sound — per the user's Notification Settings.
 */
export function NotificationAlerts() {
  const user = getAuthUser()
  const seenIds = useRef<Set<string>>(new Set())
  const primed = useRef(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<UserProfile>("/profile/me"),
    enabled: !!user,
    staleTime: 60_000,
  })

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<NotificationList>("/notifications?limit=20"),
    enabled: !!user,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (!data?.items) return
    const prefs = mergePrefs(profile?.notification_preferences)
    const items = data.items
    if (!primed.current) {
      items.forEach((n) => seenIds.current.add(n.id))
      primed.current = true
      return
    }
    const fresh = items.filter((n) => !seenIds.current.has(n.id) && !n.is_read)
    if (!fresh.length) return
    fresh.forEach((n) => seenIds.current.add(n.id))

    let playedSound = false
    for (const n of fresh.slice(0, 3).reverse()) {
      const mode = deliveryFor(n.type, prefs)
      if (mode === "both" || mode === "popup") {
        setToasts((prev) => {
          if (prev.some((t) => t.id === n.id)) return prev
          return [...prev, { id: n.id, type: n.type, title: n.title, body: n.body, link: n.link }].slice(-3)
        })
      }
      if ((mode === "both" || mode === "sound") && prefs.sound_enabled && !playedSound) {
        playNotificationSound(prefs.sound_id || "loud")
        playedSound = true
      }
    }
  }, [data, profile?.notification_preferences])

  useEffect(() => {
    if (!toasts.length) return
    const id = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1))
    }, 12000)
    return () => clearTimeout(id)
  }, [toasts])

  if (!user || !toasts.length) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-6 z-[80] flex justify-center px-4">
      <div className="flex w-full max-w-xl flex-col gap-3">
      {toasts.map((t) => {
        const meta = TYPE_META[t.type] || TYPE_META.system
        const Icon = meta.icon
        const href = resolveNotificationLink(t.link || "")
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto animate-fade-in rounded-3xl border bg-card p-5 shadow-2xl",
              "ring-1 ring-primary/20",
            )}
          >
            <div className="flex items-start gap-4">
              <span className={cn("mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", meta.bg)}>
                <Icon className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                {href ? (
                  <Link
                    to={href}
                    className="block text-lg font-semibold leading-snug hover:underline"
                    onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
                  >
                    {t.title}
                  </Link>
                ) : (
                  <p className="text-lg font-semibold leading-snug">{t.title}</p>
                )}
                {t.body && (
                  <p className="mt-2 max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-base leading-relaxed text-foreground/90">
                    {t.body}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="rounded-full p-2 text-muted-foreground hover:bg-muted"
                aria-label="Dismiss"
                onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )
      })}
      </div>
    </div>
  )
}
