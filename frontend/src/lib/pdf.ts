import { pdf, type DocumentProps } from "@react-pdf/renderer"
import type { ReactElement } from "react"

export async function generatePdfBlob(document: ReactElement<DocumentProps>): Promise<Blob> {
  return pdf(document).toBlob()
}
