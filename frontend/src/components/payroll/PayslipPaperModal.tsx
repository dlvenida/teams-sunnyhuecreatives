import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { Download, X } from "lucide-react"

export function PayslipPaperModal({
  html,
  filename,
  onClose,
}: {
  html: string
  filename: string
  onClose: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)

  const savePdf = () => {
    const frame = frameRef.current?.contentWindow
    if (!frame) return
    frame.focus()
    frame.print()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/45" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 bg-card px-4 py-3 shadow" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Payslip</p>
          <p className="text-sm font-semibold">{filename}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="gold" onClick={savePdf}><Download className="h-3.5 w-3.5" /> Save as PDF</Button>
          <Button variant="outline" onClick={onClose}><X className="h-3.5 w-3.5" /> Close</Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-[#FDF2F5] p-6" onClick={(e) => e.stopPropagation()}>
        <iframe
          ref={frameRef}
          title={filename}
          srcDoc={html}
          className="mx-auto block h-[1100px] w-[8.5in] border-0 bg-white shadow-lg"
        />
      </div>
    </div>
  )
}
