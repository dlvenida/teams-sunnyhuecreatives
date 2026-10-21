import { useEffect, useState } from "react"
import { API_URL } from "@/lib/api"

/** Attachment files need the auth header, so fetch as blob and render an object URL. */
export function useAuthImageUrl(path?: string | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return
    let live = true, obj: string | null = null
    const token = localStorage.getItem("access_token")
    fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => (r.ok ? r.blob() : null))
      .then(b => { if (b && live) { obj = URL.createObjectURL(b); setUrl(obj) } })
      .catch(() => {})
    return () => { live = false; if (obj) URL.revokeObjectURL(obj) }
  }, [path])
  return url
}

export function AuthImage({ path, alt, className, onClick }: { path: string; alt: string; className?: string; onClick?: () => void }) {
  const url = useAuthImageUrl(path)
  if (!url) return <div className={`flex items-center justify-center bg-muted text-[10px] text-muted-foreground ${className || ""}`}>Loading image…</div>
  return <img src={url} alt={alt} className={className} onClick={onClick} />
}
