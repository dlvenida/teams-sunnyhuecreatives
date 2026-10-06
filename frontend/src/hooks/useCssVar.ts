import { useEffect, useState } from "react"
import { useTheme } from "@/components/theme/ThemeProvider"

export function useCssVar(name: string, fallback = ""): string {
  const { theme } = useTheme()
  const [value, setValue] = useState(fallback)

  useEffect(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    setValue(v || fallback)
  }, [theme, name, fallback])

  return value
}
