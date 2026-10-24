import { getAuthUser } from "@/lib/api"

/**
 * Resolve a notification link for the current user's role.
 * Handles role-neutral `/tasks` / `/projects` paths and legacy `/va|/admin` prefixes
 * so clicking a mention always opens the right board for admin, auditor, or VA.
 */
export function resolveNotificationLink(link: string | null | undefined): string | null {
  if (!link) return null
  const role = getAuthUser()?.role
  const prefix = role === "va" ? "/va" : "/admin"

  if (link.startsWith("/tasks") || link.startsWith("/projects")) {
    return `${prefix}${link}`
  }

  for (const board of ["/tasks", "/projects"] as const) {
    for (const old of ["/va", "/admin"] as const) {
      if (link.startsWith(`${old}${board}`)) {
        return `${prefix}${link.slice(old.length)}`
      }
    }
  }

  // Other links (payroll, logs, etc.) — leave as stored
  return link
}
