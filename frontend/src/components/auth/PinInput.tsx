import { useRef } from "react"
import { cn } from "@/lib/utils"

/** Six-box PIN entry: auto-advance, backspace-to-previous, paste support. */
export function PinInput({
  value,
  onChange,
  onComplete,
  autoFocus = false,
  disabled = false,
}: {
  value: string
  onChange: (pin: string) => void
  onComplete?: (pin: string) => void
  autoFocus?: boolean
  disabled?: boolean
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])

  const setDigit = (index: number, digit: string) => {
    const chars = value.padEnd(6, " ").split("")
    chars[index] = digit
    const next = chars.join("").replace(/ /g, "").slice(0, 6)
    // Keep positional integrity: rebuild from raw digits typed so far
    const digits = value.split("")
    if (digit) digits[index] = digit
    else digits.splice(index, 1)
    const cleaned = digits.join("").replace(/\D/g, "").slice(0, 6)
    onChange(cleaned || next)
    if (digit && index < 5) refs.current[index + 1]?.focus()
    if (cleaned.length === 6) onComplete?.(cleaned)
  }

  return (
    <div className="flex items-center gap-2" role="group" aria-label="6-digit PIN">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el }}
          type="password"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`PIN digit ${i + 1}`}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          className={cn(
            "h-12 w-10 rounded-xl border border-input bg-background text-center text-lg font-bold tracking-widest shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50",
            value[i] && "border-primary/50 bg-primary/5",
          )}
          value={value[i] ?? ""}
          onChange={(e) => setDigit(i, e.target.value.replace(/\D/g, "").slice(-1))}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i] && i > 0) {
              e.preventDefault()
              refs.current[i - 1]?.focus()
              setDigit(i - 1, "")
            }
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus()
            if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus()
          }}
          onPaste={(e) => {
            e.preventDefault()
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
            if (!pasted) return
            onChange(pasted)
            refs.current[Math.min(pasted.length, 5)]?.focus()
            if (pasted.length === 6) onComplete?.(pasted)
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  )
}
