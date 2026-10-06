import { useCallback, useEffect, useState } from "react"
import Cropper, { type Area } from "react-easy-crop"
import "react-easy-crop/react-easy-crop.css"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch, apiFetchBlob } from "@/lib/api"
import { avifSupported, cropToAvif, readFileAsDataUrl } from "@/lib/cropImage"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Camera, Trash2, User } from "lucide-react"

interface ProfilePhotoUploadProps {
  hasPhoto: boolean
  displayName: string
  className?: string
}

export function ProfilePhotoUpload({ hasPhoto, displayName, className }: ProfilePhotoUploadProps) {
  const qc = useQueryClient()
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [cropOpen, setCropOpen] = useState(false)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState<Area | null>(null)
  const [error, setError] = useState("")

  const loadPhoto = useCallback(async () => {
    if (!hasPhoto) {
      setPhotoUrl(null)
      return
    }
    const blob = await apiFetchBlob("/profile/photo")
    if (blob) {
      setPhotoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
    }
  }, [hasPhoto])

  useEffect(() => {
    void loadPhoto()
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPhoto, loadPhoto])

  const upload = useMutation({
    mutationFn: async (blob: Blob) => {
      const form = new FormData()
      form.append("file", blob, "profile.avif")
      return apiFetch("/profile/photo", { method: "POST", body: form })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile"] })
      setCropOpen(false)
      setImageSrc(null)
      setError("")
    },
    onError: (err: Error) => setError(err.message),
  })

  const remove = useMutation({
    mutationFn: () => apiFetch("/profile/photo", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile"] })
      setPhotoUrl(null)
    },
  })

  const onCropComplete = (_: Area, area: Area) => setCroppedArea(area)

  const onFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.")
      return
    }
    if (!avifSupported()) {
      setError("Your browser cannot export AVIF. Please use Chrome or Safari.")
      return
    }
    setError("")
    const dataUrl = await readFileAsDataUrl(file)
    setImageSrc(dataUrl)
    setCropOpen(true)
    setZoom(1)
    setCrop({ x: 0, y: 0 })
  }

  const saveCrop = async () => {
    if (!imageSrc || !croppedArea) return
    try {
      const blob = await cropToAvif(imageSrc, croppedArea)
      upload.mutate(blob)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process image")
    }
  }

  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <>
      <div className={cn("flex flex-col items-center gap-3 sm:flex-row sm:items-start", className)}>
        <div className="relative">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-primary/30 bg-muted shadow-sm">
            {photoUrl ? (
              <img src={photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xl font-bold text-primary">{initials || <User className="h-8 w-8" />}</span>
            )}
          </div>
          <label className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md hover:opacity-90">
            <Camera className="h-4 w-4" />
            <input type="file" accept="image/*" className="sr-only" onChange={onFilePick} />
          </label>
        </div>
        <div className="flex flex-col gap-1 text-center sm:text-left">
          <p className="text-sm font-semibold text-foreground">{displayName}</p>
          <p className="text-[11px] text-muted-foreground">Square crop · saved as AVIF</p>
          <div className="mt-1 flex justify-center gap-2 sm:justify-start">
            <label className="cursor-pointer">
              <span className="text-[11px] font-medium text-primary hover:underline">Upload photo</span>
              <input type="file" accept="image/*" className="sr-only" onChange={onFilePick} />
            </label>
            {hasPhoto && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-red-600 hover:underline"
                onClick={() => remove.mutate()}
              >
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            )}
          </div>
          {error && !cropOpen && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
      </div>

      {cropOpen && imageSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-xl animate-fade-in">
            <h3 className="text-sm font-semibold">Crop profile photo</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">Drag to reposition · scroll to zoom</p>
            <div className="relative mt-3 h-64 overflow-hidden rounded-lg bg-muted">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="mt-3 w-full accent-primary"
            />
            {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCropOpen(false)
                  setImageSrc(null)
                  setError("")
                }}
              >
                Cancel
              </Button>
              <Button variant="gold" size="sm" disabled={upload.isPending} onClick={() => void saveCrop()}>
                {upload.isPending ? "Saving..." : "Save as AVIF"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
