import { useRef } from "react"
import { cn } from "@/lib/utils"
import { PinKeypad } from "@/components/auth/PinKeypad"

/** Six-box PIN entry: hash-masked digits, auto-advance, paste + optional keypad. */
export function PinInput({
  value,
  onChange,
  onComplete,
  autoFocus = false,
  disabled = false,
  showKeypad = false,
}: {
  value: string
  onChange: (pin: string) => void
  onComplete?: (pin: string) => void
  autoFocus?: boolean
  disabled?: boolean
  /** Show phone-style number pad with # confirm on login. */
  showKeypad?: boolean
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])

  const applyPin = (next: string, focusIndex?: number) => {
    const cleaned = next.replace(/\D/g, "").slice(0, 6)
    onChange(cleaned)
    if (typeof focusIndex === "number") {
      refs.current[Math.min(focusIndex, 5)]?.focus()
    }
    if (cleaned.length === 6) onComplete?.(cleaned)
  }

  const setDigit = (index: number, digit: string) => {
    const digits = value.split("")
    if (digit) digits[index] = digit
    else digits.splice(index, 1)
    const cleaned = digits.join("").replace(/\D/g, "").slice(0, 6)
    onChange(cleaned)
    if (digit && index < 5) refs.current[index + 1]?.focus()
    if (cleaned.length === 6) onComplete?.(cleaned)
  }

  const appendDigit = (digit: string) => {
    if (value.length >= 6) return
    applyPin(value + digit, value.length + 1)
  }

  const backspace = () => {
    if (!value.length) return
    applyPin(value.slice(0, -1), Math.max(0, value.length - 2))
  }

  const confirm = () => {
    if (value.length === 6) onComplete?.(value)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-2" role="group" aria-label="6-digit PIN">
        {Array.from({ length: 6 }).map((_, i) => (
          <input
            key={i}
            ref={el => { refs.current[i] = el }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`PIN digit ${i + 1}`}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            className={cn(
              "h-12 w-10 rounded-xl border border-input bg-background text-center text-lg font-extrabold tracking-widest text-primary shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50",
              value[i] && "border-primary/50 bg-primary/5",
            )}
            value={value[i] ? "#" : ""}
            onChange={(e) => {
              const typed = e.target.value.replace(/#/g, "").replace(/\D/g, "").slice(-1)
              setDigit(i, typed)
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace") {
                e.preventDefault()
                if (value[i]) setDigit(i, "")
                else if (i > 0) {
                  refs.current[i - 1]?.focus()
                  setDigit(i - 1, "")
                }
              }
              if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus()
              if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus()
              if (e.key === "#" || e.key === "Enter") {
                e.preventDefault()
                confirm()
              }
            }}
            onPaste={(e) => {
              e.preventDefault()
              const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
              if (!pasted) return
              applyPin(pasted, Math.min(pasted.length, 5))
            }}
            onFocus={(e) => e.target.select()}
          />
        ))}
      </div>

      {showKeypad && (
        <PinKeypad
          disabled={disabled}
          confirmEnabled={value.length === 6}
          onDigit={appendDigit}
          onBackspace={backspace}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}
