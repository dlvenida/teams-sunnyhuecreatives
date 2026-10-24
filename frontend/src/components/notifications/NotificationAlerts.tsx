import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { X } from "lucide-react"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { NotificationList } from "@/lib/types"
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPreferences, type UserProfile } from "@/lib/profile"
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
  }
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
    for (const n of fresh.slice(0, 4).reverse()) {
      const typeOk = prefs.popup_types[n.type] !== false
      if (prefs.popup_enabled && typeOk) {
        setToasts((prev) => {
          if (prev.some((t) => t.id === n.id)) return prev
          return [...prev, { id: n.id, type: n.type, title: n.title, body: n.body, link: n.link }].slice(-5)
        })
      }
      if (prefs.sound_enabled && typeOk && !playedSound) {
        playNotificationSound(prefs.sound_id)
        playedSound = true
      }
    }
  }, [data, profile?.notification_preferences])

  useEffect(() => {
    if (!toasts.length) return
    const id = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1))
    }, 7000)
    return () => clearTimeout(id)
  }, [toasts])

  if (!user || !toasts.length) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,360px)] flex-col gap-2">
      {toasts.map((t) => {
        const meta = TYPE_META[t.type] || TYPE_META.system
        const Icon = meta.icon
        const href = resolveNotificationLink(t.link || "")
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto animate-fade-in rounded-2xl border bg-card/95 p-3 shadow-xl backdrop-blur",
              "ring-1 ring-black/5",
            )}
          >
            <div className="flex items-start gap-2.5">
              <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", meta.bg)}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                {href ? (
                  <Link
                    to={href}
                    className="block text-sm font-semibold leading-snug hover:underline"
                    onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
                  >
                    {t.title}
                  </Link>
                ) : (
                  <p className="text-sm font-semibold leading-snug">{t.title}</p>
                )}
                {t.body && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{t.body}</p>}
              </div>
              <button
                type="button"
                className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                aria-label="Dismiss"
                onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
