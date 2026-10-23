import { pdf, type DocumentProps } from "@react-pdf/renderer"
import type { ReactElement } from "react"
import { ensurePdfFonts } from "@/lib/pdfFonts"

export async function generatePdfBlob(document: ReactElement<DocumentProps>): Promise<Blob> {
  ensurePdfFonts()
  return pdf(document).toBlob()
}
