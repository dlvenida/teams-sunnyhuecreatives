import { Font } from "@react-pdf/renderer"

let registered = false

/** Register Unicode-capable font so ₱ renders (Helvetica shows ±). */
export function ensurePdfFonts() {
  if (registered) return
  const src =
    typeof window !== "undefined"
      ? `${window.location.origin}/fonts/NotoSans-Regular.ttf`
      : "/fonts/NotoSans-Regular.ttf"
  Font.register({ family: "NotoSans", src })
  registered = true
}

export const PDF_FONT = "NotoSans"
