import { cn } from "@/lib/utils"
import { THEMES, type ThemeId } from "@/lib/theme"
import { useTheme } from "@/components/theme/ThemeProvider"
import { Palette } from "lucide-react"

interface ThemeSwitcherProps {
  className?: string
  compact?: boolean
}

export function ThemeSwitcher({ className, compact = false }: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme()

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {!compact && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Palette className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wide">Theme</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Color theme">
        {THEMES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={theme === option.id}
            aria-label={option.label}
            title={option.description}
            onClick={() => setTheme(option.id as ThemeId)}
            className={cn(
              "group relative h-8 w-8 rounded-full border-2 transition-all hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              theme === option.id ? "border-primary scale-110 shadow-md" : "border-border/60",
            )}
            style={{ backgroundColor: option.swatch }}
          >
            {theme === option.id && (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="h-2 w-2 rounded-full bg-white shadow-sm ring-1 ring-black/20" />
              </span>
            )}
            <span className="sr-only">{option.label}</span>
          </button>
        ))}
      </div>
      {!compact && (
        <p className="text-xs text-muted-foreground">
          {THEMES.find((t) => t.id === theme)?.label}
        </p>
      )}
    </div>
  )
}
