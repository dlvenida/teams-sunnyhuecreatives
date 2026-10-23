import { Delete } from "lucide-react"
import { cn } from "@/lib/utils"

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "hash"] as const

/** Phone-style PIN pad: digits, backspace, and # to confirm. */
export function PinKeypad({
  onDigit,
  onBackspace,
  onConfirm,
  disabled = false,
  confirmEnabled = false,
}: {
  onDigit: (digit: string) => void
  onBackspace: () => void
  onConfirm: () => void
  disabled?: boolean
  /** When true, # is emphasized and triggers confirm. */
  confirmEnabled?: boolean
}) {
  return (
    <div className="mx-auto grid w-full max-w-[240px] grid-cols-3 gap-2" role="group" aria-label="PIN keypad">
      {KEYS.map((key) => {
        if (key === "back") {
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={onBackspace}
              aria-label="Delete last digit"
              className={cn(
                "flex h-12 items-center justify-center rounded-2xl border border-border bg-muted/50 text-foreground transition",
                "hover:bg-muted active:scale-95 disabled:opacity-50",
              )}
            >
              <Delete className="h-4 w-4" />
            </button>
          )
        }
        if (key === "hash") {
          return (
            <button
              key={key}
              type="button"
              disabled={disabled || !confirmEnabled}
              onClick={onConfirm}
              aria-label="Confirm PIN"
              title="Confirm PIN"
              className={cn(
                "flex h-12 items-center justify-center rounded-2xl border text-lg font-extrabold transition active:scale-95 disabled:opacity-40",
                confirmEnabled
                  ? "border-primary bg-primary text-primary-foreground shadow hover:opacity-95"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
            >
              #
            </button>
          )
        }
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onDigit(key)}
            className={cn(
              "flex h-12 items-center justify-center rounded-2xl border border-border bg-card text-lg font-bold text-foreground shadow-sm transition",
              "hover:border-primary/40 hover:bg-primary/5 active:scale-95 disabled:opacity-50",
            )}
          >
            {key}
          </button>
        )
      })}
    </div>
  )
}
