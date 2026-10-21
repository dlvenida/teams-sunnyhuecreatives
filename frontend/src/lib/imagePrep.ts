/** Client-side half of the image guide: keep originals ≤10 MB / ≤1920px long edge
 *  before upload; the api then re-encodes everything to AVIF and stores it in the bucket. */
export const MAX_UPLOAD_MB = 10
export const MAX_EDGE = 1920

export function formatBytes(n: number): string {
  if (!n) return "0 B"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
  } finally { /* keep url alive until draw completes in caller via revoke there */ }
}

/** If the file is over the guide limits, downscale/re-encode in the browser first. Otherwise send as-is (api makes the AVIF). */
export async function prepareImage(file: File): Promise<{ file: File; note?: string }> {
  const overSize = file.size > MAX_UPLOAD_MB * 1024 * 1024
  if (!overSize) return { file }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext("2d"); if (!ctx) return { file }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/jpeg", 0.88))
    if (!blob) return { file }
    return { file: new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }),
             note: `Downscaled in your browser to ${canvas.width}×${canvas.height} to fit the 10 MB guide — the api will store it as AVIF.` }
  } catch { return { file } } finally { URL.revokeObjectURL(url) }
}
export { loadImage }
