import { useEffect, useState } from "react"
import { apiFetchBlob } from "@/lib/api"

/** Attachment files need the auth header, so fetch as blob (apiFetchBlob refreshes
 *  an expired token) and render an object URL. Never hang on "Loading…" forever. */
export function useAuthImageUrl(path?: string | null) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!path) return
    let live = true, obj: string | null = null
    setError(false); setUrl(null)
    apiFetchBlob(path)
      .then(b => {
        if (!live) return
        if (!b) { setError(true); return }
        obj = URL.createObjectURL(b); setUrl(obj)
      })
      .catch(() => { if (live) setError(true) })
    return () => { live = false; if (obj) URL.revokeObjectURL(obj) }
  }, [path])
  return { url, error }
}

export function AuthImage({ path, alt, className, onClick }: { path: string; alt: string; className?: string; onClick?: () => void }) {
  const { url, error } = useAuthImageUrl(path)
  if (error) return <div className={`flex items-center justify-center bg-muted text-[10px] text-muted-foreground ${className || ""}`}>Image unavailable</div>
  if (!url) return <div className={`flex animate-pulse items-center justify-center bg-muted text-[10px] text-muted-foreground ${className || ""}`}>Loading image…</div>
  return <img src={url} alt={alt} className={className} onClick={onClick} />
}
