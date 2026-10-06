export type ThemeId = "light" | "dark" | "pink" | "light-blue" | "bright"

export interface ThemeOption {
  id: ThemeId
  label: string
  swatch: string
  description: string
}

export const THEMES: ThemeOption[] = [
  { id: "pink", label: "Pink", swatch: "#f472b6", description: "Soft pink accents" },
  { id: "light", label: "Light", swatch: "#f8fafc", description: "Clean minimal light UI" },
  { id: "dark", label: "Dark", swatch: "#18181b", description: "Dark mode" },
  { id: "light-blue", label: "Light Blue", swatch: "#38bdf8", description: "Cool sky blue tones" },
  { id: "bright", label: "Bright", swatch: "#facc15", description: "Vivid high-energy palette" },
]

export const DEFAULT_THEME: ThemeId = "pink"
export const THEME_STORAGE_KEY = "shc-theme"

export function getStoredTheme(): ThemeId {
  const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null
  return stored && THEMES.some((t) => t.id === stored) ? stored : DEFAULT_THEME
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme)
  localStorage.setItem(THEME_STORAGE_KEY, theme)
}
