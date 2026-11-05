export interface Area {
  x: number
  y: number
  width: number
  height: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif"]

export function isPhotoFile(file: File): boolean {
  const type = (file.type || "").toLowerCase()
  if (type.startsWith("image/")) return true
  const name = file.name.toLowerCase()
  return PHOTO_EXTENSIONS.some((ext) => name.endsWith(ext))
}

/** Crop to a square JPEG. Every current browser can encode JPEG, including when AVIF export is missing. */
export async function cropToJpeg(imageSrc: string, crop: Area, size = 512): Promise<Blob> {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas not supported")

  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, size, size)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.86)
  })
  if (!blob) throw new Error("Could not prepare that photo. Try a JPG or PNG.")
  return blob
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
