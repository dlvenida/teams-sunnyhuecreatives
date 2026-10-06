/** Turn FastAPI / fetch error payloads into a readable string. */
export function formatApiError(detail: unknown, fallback = "Request failed"): string {
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: string }).msg)
        }
        return typeof item === "string" ? item : null
      })
      .filter(Boolean)
    if (messages.length) return messages.join(". ")
  }
  if (detail && typeof detail === "object" && "msg" in detail) {
    return String((detail as { msg: string }).msg)
  }
  return fallback
}
