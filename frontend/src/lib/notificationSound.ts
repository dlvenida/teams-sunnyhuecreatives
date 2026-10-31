import type { NotificationSoundId } from "@/lib/profile"

/** Play a short alert via Web Audio (no asset files required). Default is the loud alert. */
export function playNotificationSound(soundId: NotificationSoundId = "loud") {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime

    const beep = (
      freq: number,
      start: number,
      dur: number,
      gain = 0.18,
      type: OscillatorType = "sine",
      dest: AudioNode = ctx.destination,
    ) => {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      g.gain.setValueAtTime(0.0001, now + start)
      g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), now + start + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)
      osc.connect(g)
      g.connect(dest)
      osc.start(now + start)
      osc.stop(now + start + dur + 0.02)
    }

    if (soundId === "bell") {
      beep(880, 0, 0.22, 0.2)
      beep(1174, 0.12, 0.28, 0.14)
    } else if (soundId === "ping") {
      beep(1320, 0, 0.12, 0.16)
    } else if (soundId === "loud") {
      // Chime peaks at 0.16. Loud is mixed near full scale (triangle harmonics + makeup gain)
      // so the preview and the alert are clearly louder than chime, bell, and ping.
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.setValueAtTime(-14, now)
      comp.knee.setValueAtTime(6, now)
      comp.ratio.setValueAtTime(2.5, now)
      comp.attack.setValueAtTime(0.003, now)
      comp.release.setValueAtTime(0.18, now)
      const makeup = ctx.createGain()
      makeup.gain.setValueAtTime(1.8, now)
      comp.connect(makeup)
      makeup.connect(ctx.destination)
      beep(349, 0, 0.32, 0.98, "triangle", comp)
      beep(523, 0.02, 0.3, 0.72, "sawtooth", comp)
      beep(784, 0.16, 0.34, 0.95, "triangle", comp)
      beep(1046, 0.34, 0.42, 0.9, "triangle", comp)
    } else {
      // chime — quiet three-note
      beep(523, 0, 0.16, 0.16)
      beep(659, 0.1, 0.18, 0.14)
      beep(784, 0.2, 0.22, 0.12)
    }

    window.setTimeout(() => void ctx.close().catch(() => undefined), 1600)
  } catch {
    /* autoplay / unsupported — ignore */
  }
}
