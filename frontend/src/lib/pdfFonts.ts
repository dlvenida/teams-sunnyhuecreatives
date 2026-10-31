import { Font } from "@react-pdf/renderer"

let registered = false

/** Register Unicode-capable font so ₱ renders (Helvetica shows ±). */
export function ensurePdfFonts() {
  if (registered) return
  const src =
    typeof window !== "undefined"
      ? `${window.location.origin}/fonts/NotoSans-Regular.ttf`
      : "/fonts/NotoSans-Regular.ttf"
  // Same file for bold so react-pdf does not fall back to Helvetica (which draws ₱ as ±).
  Font.register({
    family: "NotoSans",
    fonts: [
      { src, fontWeight: 400 },
      { src, fontWeight: 700 },
    ],
  })
  registered = true
}

export const PDF_FONT = "NotoSans"
