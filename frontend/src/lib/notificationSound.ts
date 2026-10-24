import type { NotificationSoundId } from "@/lib/profile"

/** Play a short alert via Web Audio (no asset files required). */
export function playNotificationSound(soundId: NotificationSoundId = "chime") {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime

    const beep = (freq: number, start: number, dur: number, gain = 0.18) => {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = freq
      g.gain.setValueAtTime(0.0001, now + start)
      g.gain.exponentialRampToValueAtTime(gain, now + start + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)
      osc.connect(g)
      g.connect(ctx.destination)
      osc.start(now + start)
      osc.stop(now + start + dur + 0.02)
    }

    if (soundId === "bell") {
      beep(880, 0, 0.22, 0.2)
      beep(1174, 0.12, 0.28, 0.14)
    } else if (soundId === "ping") {
      beep(1320, 0, 0.12, 0.16)
    } else if (soundId === "loud") {
      beep(660, 0, 0.18, 0.32)
      beep(880, 0.16, 0.22, 0.28)
      beep(990, 0.34, 0.28, 0.24)
    } else {
      // chime
      beep(523, 0, 0.16, 0.16)
      beep(659, 0.1, 0.18, 0.14)
      beep(784, 0.2, 0.22, 0.12)
    }

    window.setTimeout(() => void ctx.close().catch(() => undefined), 1200)
  } catch {
    /* autoplay / unsupported — ignore */
  }
}
