import { useEffect, useState } from "react"
import { RPConfig, RPProvider, RPLayout, RPPages } from "@react-pdf-kit/viewer"
import { Button } from "@/components/ui/button"
import { X, Download } from "lucide-react"

interface PdfPreviewModalProps {
  blob: Blob | null
  filename: string
  onClose: () => void
}

export function PdfPreviewModal({ blob, filename, onClose }: PdfPreviewModalProps) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!blob) return
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  if (!blob || !url) return null

  const handleDownload = () => {
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[90vh] w-full max-w-4xl flex-col rounded-xl bg-card text-card-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-display text-lg font-semibold">{filename}</h2>
          <div className="flex gap-2">
            <Button variant="gold" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4" /> Download
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <RPConfig>
            <RPProvider src={url}>
              <RPLayout toolbar style={{ height: "100%" }}>
                <RPPages />
              </RPLayout>
            </RPProvider>
          </RPConfig>
        </div>
      </div>
    </div>
  )
}
