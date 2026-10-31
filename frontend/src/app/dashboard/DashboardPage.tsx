import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { apiFetch, getAuthUser } from "@/lib/api"
import type { DashboardOverview, DashboardSummary, TaskItem } from "@/lib/types"
import type { UserProfile } from "@/lib/profile"
import { formatCurrency, formatDate, cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TASK_STATUSES, PRIORITY_META, formatDuration } from "@/components/tasks/task-utils"
import { OwnerFinancePanel } from "@/components/dashboard/OwnerFinancePanel"
import { AlertTriangle, ArrowRight, CalendarDays, Check, CheckCircle2, ClipboardList, DollarSign, Flame, Lightbulb, ListTodo, Pause, Play, Sparkles, Square, Sun, Sunrise, Sunset, Timer, TrendingUp, Volume2, X } from "lucide-react"

const BIBLE_VERSES = [
  { text: "She is clothed with strength and dignity; she can laugh at the days to come.", author: "Proverbs 31:25" },
  { text: "I can do all things through Christ who strengthens me.", author: "Philippians 4:13" },
  { text: "Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.", author: "Joshua 1:9" },
  { text: "The Lord is my shepherd; I shall not want.", author: "Psalm 23:1" },
  { text: "For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.", author: "Jeremiah 29:11" },
  { text: "Trust in the Lord with all your heart and lean not on your own understanding.", author: "Proverbs 3:5" },
  { text: "Let all that you do be done in love.", author: "1 Corinthians 16:14" },
  { text: "This is the day that the Lord has made; let us rejoice and be glad in it.", author: "Psalm 118:24" },
  { text: "Cast all your anxiety on Him because He cares for you.", author: "1 Peter 5:7" },
  { text: "The joy of the Lord is your strength.", author: "Nehemiah 8:10" },
  { text: "A cheerful heart is good medicine.", author: "Proverbs 17:22" },
  { text: "Be kind to one another, tenderhearted, forgiving one another, as God in Christ forgave you.", author: "Ephesians 4:32" },
]

function greeting() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return { label: "Good Morning", Icon: Sunrise, emoji: "☀️", emojiClass: "emoji-sun" }
  if (h >= 12 && h < 17) return { label: "Good Afternoon", Icon: Sun, emoji: "🌤️", emojiClass: "emoji-float" }
  if (h >= 17 && h < 21) return { label: "Good Evening", Icon: Sunset, emoji: "🌇", emojiClass: "emoji-float" }
  return { label: "Good Night", Icon: Sunset, emoji: "🌙", emojiClass: "emoji-moon" }
}
function verseOfDay() {
  const now = new Date(); const start = new Date(now.getFullYear(), 0, 0)
  return BIBLE_VERSES[Math.floor((now.getTime() - start.getTime()) / 86400000) % BIBLE_VERSES.length]
}
function statusLabel(s: string) { return TASK_STATUSES.find(x => x.id === s)?.label || s }

interface Advice { emoji: string; title: string; text: string; tone: "primary" | "warn" | "danger" | "calm" }
function buildAdvice(o: DashboardOverview, isAdmin: boolean): Advice[] {
  const h = new Date().getHours()
  const c = o.counts
  const night = h >= 21 || h < 5
  const morning = h >= 5 && h < 12
  const afternoon = h >= 12 && h < 17
  const evening = h >= 17 && h < 21
  const out: Advice[] = []
  const tomorrowFirst = o.tomorrow_tasks?.[0]

  if (night) {
    out.push({ emoji: "🌙", tone: "calm", title: "It's late — time to wind down", text: `You've logged ${o.hours_today}h today and finished ${c.done_this_week} task(s) this week. Sleep early tonight${tomorrowFirst ? ` — tomorrow starts with “${tomorrowFirst.title}”${tomorrowFirst.due_date ? "" : ""} for ${tomorrowFirst.client_name}` : " — tomorrow's board is light, enjoy the slow start"}. A rested brain tomorrow beats one more tired hour tonight.` })
    out.push({ emoji: "🌅", tone: "primary", title: "Tomorrow at a glance", text: o.tomorrow_tasks?.length ? `${o.tomorrow_tasks.length} task(s) due tomorrow: ${o.tomorrow_tasks.slice(0, 3).map(t => t.title).join(" · ")}. Lay out what you need tonight so the morning is just execution.` : "Nothing is due tomorrow. Use the morning to pull one backlog item forward and get ahead of the week." })
    if (c.overdue) out.push({ emoji: "🧹", tone: "warn", title: "Don't sleep on the overdue list", text: `${c.overdue} overdue item(s) are waiting. Don't work on them now — just pick the one you'll clear first tomorrow and let the rest wait.` })
    if (!isAdmin && o.live_clock.length) out.push({ emoji: "⏰", tone: "danger", title: "You're still clocked in!", text: "Your clock is still running. Clock out now so today's hours are logged correctly — future you says thanks." })
    return out.slice(0, 3)
  }
  if (morning) {
    out.push({ emoji: "🎯", tone: "primary", title: "Your focus plan", text: c.due_today ? `Start with the ${c.due_today} task(s) due today${o.estimated_hours_today && Number(o.estimated_hours_today) ? ` (~${o.estimated_hours_today}h estimated)` : ""}. Do the hardest one first while your energy is highest.` : "Nothing due today — perfect day to clear backlog and get ahead. Pick one To Do and finish it end-to-end." })
    if (c.overdue) out.push({ emoji: "🚨", tone: "danger", title: "Clear one overdue first", text: `${c.overdue} overdue item(s). Knocking out just one before lunch changes the whole feel of the day.` })
  }
  if (afternoon) {
    out.push({ emoji: "⚡", tone: "primary", title: "Midday check-in", text: `${c.in_progress} in progress, ${c.due_today} due today, ${o.hours_today}h logged so far. If a task has been 'in progress' all day, split it or ask for help — stuck is information.` })
    if (c.blocked) out.push({ emoji: "🧱", tone: "warn", title: "Unblock something", text: `${c.blocked} blocked task(s). One message to the right person now can save a whole day tomorrow.` })
  }
  if (evening) {
    out.push({ emoji: "🏁", tone: "primary", title: "Land the day well", text: `Finish what's closest to done, update your task comments, and make sure your time is logged (${o.hours_today}h so far today). Tomorrow's list writes itself when today is closed properly.` })
    if (tomorrowFirst) out.push({ emoji: "🌇", tone: "calm", title: "Tomorrow's first move", text: `“${tomorrowFirst.title}” (${tomorrowFirst.client_name}) is due tomorrow. A 2-minute look now means a fast start in the morning.` })
  }
  if (isAdmin && o.team_load?.length) {
    const top = o.team_load[0]
    const free = o.team_load[o.team_load.length - 1]
    if (top.open >= 5) out.push({ emoji: "👥", tone: "warn", title: `${top.name} is loaded`, text: `${top.name} has ${top.open} open task(s)${top.overdue ? `, ${top.overdue} overdue` : ""}. ${free && free.name !== top.name ? `Consider moving one to ${free.name} (${free.open} open) to balance the week.` : "Consider redistributing before adding more."}` })
    if (c.unassigned) out.push({ emoji: "🙋", tone: "warn", title: "Unassigned work is invisible work", text: `${c.unassigned} task(s) have no owner. Assign them today — unowned tasks are the ones that slip.` })
  }
  if (!isAdmin && !o.live_clock.length && (morning || afternoon)) {
    out.push({ emoji: "⏱️", tone: "calm", title: "Clock in, don't reconstruct later", text: "Start the clock when you start working — your log writes itself at clock-out, times and all. No more end-of-day timesheet guessing." })
  }
  out.push({ emoji: "💡", tone: "calm", title: "Work smarter", text: morning ? "Time-box: 50 minutes focused, 10 minutes break. Check comments between boxes, not during." : afternoon ? "Batch the small stuff: comments, updates, and quick replies in one 15-minute sweep instead of all day." : "Write tomorrow's top 3 before you log off. Starting decided is starting fast." })
  return out.slice(0, 3)
}
function MiniTask({ t, base }: { t: TaskItem; base: string }) {
  const overdue = t.due_date && t.due_date < new Date().toISOString().slice(0, 10) && t.status !== "done"
  return (
    <Link to={`${base}/tasks`} className="flex items-center gap-3 rounded-xl border p-3 monday-card bg-card">
      <span className="h-9 w-1.5 rounded-full shrink-0" style={{ background: t.project_color || "var(--primary)" }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{t.title}</span>
        <span className="block text-[11px] text-muted-foreground">{t.client_name}{t.assignee_name ? ` · ${t.assignee_name}` : ""} · {statusLabel(t.status)}</span>
      </span>
      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", PRIORITY_META[t.priority].className)}>{PRIORITY_META[t.priority].label}</span>
      <span className={cn("text-[11px] whitespace-nowrap", overdue && "font-bold text-red-600")}>{t.due_date ? formatDate(t.due_date) : "No date"}</span>
    </Link>
  )
}


type VoiceGender = "female" | "male"
interface BriefSection { text: string; feeling: "warm" | "happy" | "serious" | "calm" | "proud" }
const FEMALE_HINTS = ["female", "zira", "samantha", "jenny", "aria", "serena", "karen", "moira", "tessa", "fiona", "veena", "allison", "ava", "susan", "catherine", "joana", "luciana"]
const MALE_HINTS = ["male", "david", "daniel", "alex", "fred", "tom", "george", "james", "christopher", "mark", "guy", "christopher", "eric", "roger"]


/** Build the spoken script from whatever is on the dashboard right now. */
function buildBriefing(o: DashboardOverview, isAdmin: boolean, firstName: string): BriefSection[] {
  const c = o.counts
  const h = new Date().getHours()
  const greeting = h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 17 ? "Good afternoon" : h >= 17 && h < 21 ? "Good evening" : "Good night"
  const dateLine = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
  const out: BriefSection[] = []
  out.push({ feeling: "warm", text: `${greeting}, ${firstName}! It's ${dateLine}. Here's what's happening on your dashboard today.` })
  out.push({ feeling: "happy", text: `You have ${c.due_today} task${c.due_today === 1 ? "" : "s"} due today, ${c.done_this_week} done this week, and you've logged ${o.hours_today} hours today, ${o.hours_this_week} hours this week.` })
  if (c.overdue) out.push({ feeling: "serious", text: `A quick heads-up: ${c.overdue} task${c.overdue === 1 ? " is" : "s are"} overdue. Clearing just one will change the whole feel of the day.` })
  else out.push({ feeling: "proud", text: "Great news — nothing is overdue. You're right on track. Keep that streak alive!" })
  for (const a of buildAdvice(o, isAdmin)) out.push({ feeling: a.tone === "danger" ? "serious" : a.tone === "warn" ? "serious" : a.tone === "primary" ? "happy" : "calm", text: `${a.title}. ${a.text}` })
  if (o.today_tasks.length) out.push({ feeling: "calm", text: `Today's tasks are: ${o.today_tasks.slice(0, 5).map(t => `${t.title}, for ${t.client_name}`).join(". ")}.` })
  if (o.needs_attention.length) out.push({ feeling: "serious", text: `Needs your attention: ${o.needs_attention.slice(0, 3).map(a => `${a.title}. ${a.detail}`).join(" ")}` })
  if (o.live_clock.length) out.push({ feeling: "happy", text: isAdmin ? `Right now, ${o.live_clock.length} ${o.live_clock.length === 1 ? "person is" : "people are"} on the clock: ${o.live_clock.slice(0, 4).map(e => e.va_name || "a teammate").join(", ")}.` : "And good news — your clock is running, so your time is being captured automatically." })
  if (o.upcoming.length) out.push({ feeling: "calm", text: `Coming up in the next seven days: ${o.upcoming.slice(0, 4).map(t => `${t.title}, due ${t.due_date ? formatDate(t.due_date) : "soon"}`).join(". ")}.` })
  if (o.projects.length) out.push({ feeling: "calm", text: `Your projects: ${o.projects.slice(0, 4).map(pr => `${pr.name}, ${pr.task_total ? Math.round((pr.task_done / pr.task_total) * 100) : 0} percent complete`).join(". ")}.` })
  if (isAdmin && o.team_load?.length) { const top = o.team_load[0]; out.push({ feeling: "calm", text: `Team load check: ${top.name} is the busiest with ${top.open} open tasks${top.overdue ? `, ${top.overdue} of them overdue` : ""}.` }) }
  if (!isAdmin && o.tomorrow_tasks?.length) out.push({ feeling: "calm", text: `Tomorrow starts with: ${o.tomorrow_tasks.slice(0, 3).map(t => t.title).join(", ")}. A two-minute look tonight means a fast start in the morning.` })
  const q = verseOfDay()
  out.push({ feeling: "warm", text: `And here's your Bible verse of the day, from ${q.author}: "${q.text}" You've got this, ${firstName}. Let's make today shine with kindness and joy!` })
  return out
}

// Gentle prosody — close to natural speech (strong pitch/rate shifts are what sound robotic)
const FEELING_PROSODY: Record<BriefSection["feeling"], { pitch: number; rate: number }> = {
  warm: { pitch: 1.01, rate: 0.9 },
  happy: { pitch: 1.03, rate: 0.92 },
  proud: { pitch: 1.03, rate: 0.91 },
  calm: { pitch: 1.0, rate: 0.88 },
  serious: { pitch: 0.97, rate: 0.85 },
}

/** Score voices by how human they sound: Natural/Neural/Google/Premium first, novelty voices last. */
function naturalScore(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase()
  let s = 0
  if (n.includes("natural")) s += 120
  if (n.includes("neural")) s += 115
  if (n.includes("google us english")) s += 100
  if (n.includes("google")) s += 60
  if (n.includes("premium") || n.includes("enhanced")) s += 90
  if (n.includes("samantha") || n.includes("jenny") || n.includes("aria") || n.includes("zira") || n.includes("david") || n.includes("daniel") || n.includes("alex")) s += 55
  if (v.lang === "en-US") s += 25
  if (v.lang?.toLowerCase().startsWith("en")) s += 10
  if (["fred", "albert", "bad news", "bells", "boing", "bubbles", "cellos", "deranged", "hysterical", "pipe organ", "trinoids", "whisper", "zarvox", "junior", "ralph", "kathy", "compact"].some(x => n.includes(x))) s -= 200
  return s
}
function sortedVoices(): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return []
  return window.speechSynthesis.getVoices()
    .filter(v => v.lang?.toLowerCase().startsWith("en"))
    .sort((a, b) => naturalScore(b) - naturalScore(a))
}
// The single smoothest voices, in preference order — no list shown to the user, we just pick the best available
const FEMALE_BEST = ["jenny natural", "aria natural", "jenny", "aria", "google us english", "samantha enhanced", "samantha premium", "samantha", "zira", "serena", "karen", "allison", "ava", "fiona", "moira", "tessa"]
const MALE_BEST = ["guy natural", "christopher natural", "ryan natural", "guy", "christopher", "google us english", "daniel", "alex", "david", "george", "james", "tom", "fred"]

function bestVoiceFor(gender: VoiceGender): SpeechSynthesisVoice | null {
  const voices = sortedVoices()
  if (!voices.length) return null
  const preferred = gender === "female" ? FEMALE_BEST : MALE_BEST
  for (const name of preferred) {
    const hit = voices.find(v => v.name.toLowerCase().includes(name))
    if (hit) return hit
  }
  const hints = gender === "female" ? FEMALE_HINTS : MALE_HINTS
  return voices.find(v => hints.some(h => v.name.toLowerCase().includes(h))) || voices[0]
}
function voiceMatchesGender(v: SpeechSynthesisVoice, gender: VoiceGender): boolean {
  const hints = gender === "female" ? FEMALE_HINTS : MALE_HINTS
  return hints.some(h => v.name.toLowerCase().includes(h))
}
/** Split a section into short sentence chunks — long utterances are the main cause of the robotic drone. */
function toSentences(text: string): string[] {
  return (text.match(/[^.!?…]+[.!?…]+["']?|[^.!?…]+$/g) || [text]).map(s => s.trim()).filter(Boolean)
}

/** Talking-person dashboard reader: press play, it greets you and reads the dashboard aloud. */
function DashboardReader({ overview, isAdmin, firstName, autoPlay = false, onClose }: { overview: DashboardOverview; isAdmin: boolean; firstName: string; autoPlay?: boolean; onClose?: () => void }) {
  const autoPlayedRef = useRef(false)
  const [gender, setGender] = useState<VoiceGender>("female")
  const [speaking, setSpeaking] = useState(false)
  const [paused, setPaused] = useState(false)
  const [current, setCurrent] = useState(-1)
  const [showScript, setShowScript] = useState(false)
  const [, setAllVoices] = useState<SpeechSynthesisVoice[]>([])
  const sectionsRef = useRef<BriefSection[]>([])
  const supported = typeof window !== "undefined" && "speechSynthesis" in window
  const sections = useMemo(() => buildBriefing(overview, isAdmin, firstName), [overview, isAdmin, firstName])
  sectionsRef.current = sections
  const persona = gender === "female" ? { emoji: "👩🏽", name: "Sunny", label: "Female voice" } : { emoji: "👨🏽", name: "Hue", label: "Male voice" }

  useEffect(() => {
    if (!supported) return
    const load = () => setAllVoices(sortedVoices())
    load()
    window.speechSynthesis.addEventListener?.("voiceschanged", load)
    return () => { window.speechSynthesis.removeEventListener?.("voiceschanged", load); window.speechSynthesis.cancel() }
  }, [supported])

  const stop = () => { if (supported) window.speechSynthesis.cancel(); setSpeaking(false); setPaused(false); setCurrent(-1) }
  const hide = () => { stop(); onClose?.() }

  useEffect(() => {
    if (!autoPlay || autoPlayedRef.current) return
    autoPlayedRef.current = true
    const id = setTimeout(() => speakFrom(0), 350) // let voices load, then start reading right away
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const speakFrom = (startIndex: number) => {
    if (!supported) return
    window.speechSynthesis.cancel()
    const voice = bestVoiceFor(gender)
    const matched = voice ? voiceMatchesGender(voice, gender) : false
    const list = sectionsRef.current
    // Flatten to sentence chunks for a natural, conversational cadence
    const chunks: { idx: number; text: string; feeling: BriefSection["feeling"]; last: boolean }[] = []
    list.slice(startIndex).forEach((section, offset) => {
      const parts = toSentences(section.text)
      parts.forEach((part, pi) => chunks.push({ idx: startIndex + offset, text: part, feeling: section.feeling, last: offset === list.slice(startIndex).length - 1 && pi === parts.length - 1 }))
    })
    chunks.forEach((chunk) => {
      const u = new SpeechSynthesisUtterance(chunk.text)
      if (voice) { u.voice = voice; u.lang = voice.lang }
      const prosody = FEELING_PROSODY[chunk.feeling]
      // Only nudge pitch if the available voice doesn't match the chosen gender — and only gently
      u.pitch = matched ? prosody.pitch : Math.min(1.12, Math.max(0.85, prosody.pitch * (gender === "female" ? 1.04 : 0.94)))
      u.rate = prosody.rate
      u.volume = 0.9 // soft and smooth, not shouty
      u.onstart = () => { setCurrent(chunk.idx); setSpeaking(true); setPaused(false) }
      u.onend = () => { if (chunk.last) { setSpeaking(false); setCurrent(-1) } }
      u.onerror = () => { if (chunk.last) { setSpeaking(false); setCurrent(-1) } }
      window.speechSynthesis.speak(u)
    })
    setSpeaking(true); setPaused(false)
  }

  const togglePause = () => {
    if (!supported) return
    if (paused) { window.speechSynthesis.resume(); setPaused(false) }
    else { window.speechSynthesis.pause(); setPaused(true) }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/[0.07] via-card to-amber-50/60 shadow-sm dark:to-amber-950/20">
      <div className="flex flex-wrap items-center gap-3 p-3.5 sm:gap-4 sm:p-4">
        {/* Talking person */}
        <div className="relative shrink-0">
          <div className={cn("flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-4xl ring-2 ring-primary/30", speaking && !paused && "animate-bounce")}>{persona.emoji}</div>
          <span className={cn("absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-card text-white", speaking && !paused ? "bg-green-500" : "bg-slate-400")}>
            {speaking && !paused ? <span className="flex items-end gap-[2px]">{[0, 1, 2].map(i => <span key={i} className="w-[3px] animate-pulse rounded-full bg-white" style={{ height: `${7 + i * 3}px`, animationDelay: `${i * 120}ms` }} />)}</span> : <Volume2 className="h-3 w-3" />}
          </span>
          {/* mouth */}
          <span className={cn("absolute bottom-[13px] left-1/2 h-1.5 -translate-x-1/2 rounded-full bg-slate-700/70 transition-all", speaking && !paused ? "w-4 animate-ping" : "w-2.5")} />
        </div>
        <div className="min-w-[180px] flex-1">
          <p className="text-sm font-extrabold">Meet {persona.name} — your dashboard reader</p>
          <p className="text-[15px] leading-snug text-muted-foreground">
            {speaking ? (paused ? "Paused — tap resume and I'll keep reading." : current >= 0 && sections[current] ? sections[current].text : "Reading your updates…")
              : `Press play and I'll say ${new Date().getHours() < 12 ? "good morning" : new Date().getHours() < 17 ? "good afternoon" : "good evening"} and read your latest updates out loud — with feeling!`}
          </p>
          {!supported && <p className="mt-1 text-xs font-semibold text-red-600">Sorry — your browser doesn't support speech. You can still read the script below.</p>}
        </div>
        {/* Controls */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="flex overflow-hidden rounded-full border text-xs font-bold">
            {(["female", "male"] as VoiceGender[]).map(g => (
              <button key={g} onClick={() => { setGender(g); if (speaking) stop() }} className={cn("px-3 py-2 capitalize transition", gender === g ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>{g === "female" ? "👩🏽 Female" : "👨🏽 Male"}</button>
            ))}
          </div>
          {!speaking ? (
            <Button variant="gold" size="lg" disabled={!supported} onClick={() => speakFrom(0)}><Play className="h-4 w-4 fill-current" /> Play briefing</Button>
          ) : (<>
            <Button variant="gold" size="lg" onClick={togglePause}>{paused ? <><Play className="h-4 w-4 fill-current" /> Resume</> : <><Pause className="h-4 w-4 fill-current" /> Pause</>}</Button>
            <Button variant="outline" size="lg" onClick={stop}><Square className="h-4 w-4 fill-current" /> Stop</Button>
          </>)}
          <Button variant="ghost" size="sm" onClick={() => setShowScript(s => !s)}>{showScript ? "Hide script" : "Read script"}</Button>
          {onClose && <Button variant="ghost" size="sm" onClick={hide} title="Hide reader"><X className="h-4 w-4" /> Hide</Button>}
        </div>
      </div>
      {/* Speaking progress */}
      {sections.length > 0 && (speaking || current >= 0) && (
        <div className="flex gap-1 px-4 pb-3">{sections.map((_, i) => <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i < current ? "bg-primary" : i === current ? "animate-pulse bg-primary" : "bg-primary/15")} />)}</div>
      )}
      {showScript && (
        <div className="space-y-2 border-t bg-card/70 px-4 py-3">
          {sections.map((s, i) => (
            <p key={i} className={cn("text-[15px] leading-relaxed", i === current ? "font-bold text-primary" : "text-muted-foreground")}>
              <button className="mr-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary hover:bg-primary/20" title="Read from here" onClick={() => speakFrom(i)}>▶ {s.feeling}</button>{s.text}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export function DashboardPage() {
  const qc = useQueryClient()
  const [readerOpen, setReaderOpen] = useState(false)
  const user = getAuthUser()
  const isAdmin = user?.role === "admin"
  const isStaff = user?.role === "admin" || user?.role === "auditor"
  const isVA = user?.role === "va"
  const base = isStaff ? "/admin" : "/va"
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<UserProfile>("/profile/me"), staleTime: 60_000 })
  const firstName = (profile?.display_name || user?.name || "there").split(" ")[0]
  const { label: greetLabel, Icon: GreetIcon, emoji, emojiClass } = greeting()
  const quote = useMemo(verseOfDay, [])

  const { data: overview, isLoading: ovLoading } = useQuery({ queryKey: ["dashboard-overview"], queryFn: () => apiFetch<DashboardOverview>("/dashboard/overview"), refetchInterval: 30_000 })
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => apiFetch<DashboardSummary>("/dashboard/summary"), enabled: isStaff })
  const [payFrom, setPayFrom] = useState("")
  const [payTo, setPayTo] = useState("")
  type Earnings = {
    this_week: { hours: string; earned: string; currency: string }
    this_month: { hours: string; earned: string; currency: string }
    all_time: { hours: string; earned: string; currency: string }
    range?: { hours: string; earned: string; currency: string } | null
    by_client: { client_name: string; hours: string; earned: string; pay_type: string; currency: string; status: string }[]
  }
  const { data: earnings } = useQuery({
    queryKey: ["va-earnings", payFrom, payTo],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (payFrom) qs.set("date_from", payFrom)
      if (payTo) qs.set("date_to", payTo)
      return apiFetch<Earnings>(`/va/earnings${qs.toString() ? `?${qs}` : ""}`)
    },
    enabled: isVA,
  })
  const approve = useMutation({ mutationFn: (id: string) => apiFetch(`/work-logs/${id}/approve`, { method: "POST" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["dashboard-overview"] }) } })
  const reject = useMutation({ mutationFn: (id: string) => apiFetch(`/work-logs/${id}/reject`, { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }) })

  if (ovLoading || !overview) return <p className="text-sm text-muted-foreground">Loading your day…</p>
  const c = overview.counts

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Hero — open, no box */}
      <div className="px-1 pt-2 sm:px-2">
        <p className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em] text-primary"><GreetIcon className="h-4 w-4" /> {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <h1 className="break-words font-extrabold leading-[1.05] tracking-tight" style={{ fontSize: "clamp(1.65rem, 7vw, 2.9rem)" }}>{greetLabel}, <span className="gradient-text">{firstName}</span> <span className={cn("inline-block", emojiClass)} aria-hidden="true">{emoji}</span><span className="emoji-wave inline-block" aria-hidden="true">👋</span></h1>
          {isVA && (profile?.job_title || profile?.tenure_label) && (
            <p className="mt-2 text-sm text-muted-foreground">
              {profile.job_title && <span className="font-semibold text-foreground">{profile.job_title}</span>}
              {profile.job_title && profile.tenure_label ? " · " : ""}
              {profile.tenure_label}
            </p>
          )}
          <div className="flex flex-wrap gap-4 pb-1 text-center sm:gap-8">
            {[{ label: "Due today", v: c.due_today, icon: CalendarDays }, { label: "Overdue", v: c.overdue, icon: AlertTriangle }, { label: "Done this week", v: c.done_this_week, icon: CheckCircle2 }].map(s => (
              <div key={s.label}>
                <s.icon className={cn("mx-auto h-5 w-5", s.label === "Overdue" && c.overdue > 0 ? "text-red-500" : "text-primary")} />
                <div className={cn("mt-1 text-2xl font-extrabold leading-none sm:text-3xl", s.label === "Overdue" && c.overdue > 0 && "text-red-600")}>{s.v}</div>
                <div className="mt-1 text-[11px] font-medium text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 max-w-3xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary/80">Bible verse of the day 💕</p>
          <p className="mt-1 flex items-start gap-2.5 text-lg font-medium leading-snug text-foreground/90"><Sparkles className="mt-1 h-4.5 w-4.5 shrink-0 text-primary" /><span>“{quote.text}” <span className="text-sm font-semibold text-primary/80">— {quote.author}</span></span></p>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 [&>a]:min-w-0 [&_button]:w-full min-[480px]:[&_button]:w-auto">
          <Link to={`${base}/tasks`}><Button variant="gold" size="lg"><ListTodo className="h-4 w-4" /> Open Task Board</Button></Link>
          {isVA && <Link to="/va/time-clock"><Button variant="outline" size="lg"><Play className="h-4 w-4" /> Clock In</Button></Link>}
          <Link to={`${base}/projects`}><Button variant="outline" size="lg">Projects <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
          <Button variant="outline" size="lg" onClick={() => setReaderOpen(true)}><Volume2 className="h-4 w-4 text-primary" /> Listen to updates</Button>
        </div>
      </div>

      {readerOpen && <div id="dashboard-reader" className="scroll-mt-20"><DashboardReader overview={overview} isAdmin={isStaff} firstName={firstName} autoPlay onClose={() => setReaderOpen(false)} /></div>}

      {/* VA earnings strip + pay report (Approved only) */}
      {isVA && earnings && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "This Week", ...earnings.this_week },
              { label: "This Month", ...earnings.this_month },
              { label: "All Time", ...earnings.all_time },
            ].map((s) => (
              <Card key={s.label} className="min-w-0">
                <CardContent className="p-4">
                  <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
                  <p className="mt-1 text-2xl font-extrabold">{formatCurrency(s.earned, s.currency)}</p>
                  <p className="text-[11px] text-muted-foreground">{s.hours}h approved</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle>My Pay Report</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-[11px] text-muted-foreground">Only Jane-approved entries count. Pending and rejected work is excluded.</p>
              <div className="flex flex-wrap items-end gap-3">
                <div><Label className="text-[11px]">From</Label><Input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} /></div>
                <div><Label className="text-[11px]">To</Label><Input type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)} /></div>
                <Button variant="outline" size="sm" onClick={() => { setPayFrom(""); setPayTo("") }}>Clear</Button>
              </div>
              {earnings.range && (payFrom || payTo) && (
                <p className="text-sm font-semibold">
                  Range total: {formatCurrency(earnings.range.earned, earnings.range.currency)} · {earnings.range.hours}h approved
                </p>
              )}
              {earnings.by_client.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-3">Client</th><th className="p-3">Type</th><th className="p-3">Hours</th><th className="p-3">Earned</th><th className="p-3">Status</th></tr></thead>
                    <tbody>
                      {earnings.by_client.map((r) => (
                        <tr key={r.client_name} className="border-b">
                          <td className="p-3 font-semibold">{r.client_name}</td>
                          <td className="p-3 capitalize">{r.pay_type}</td>
                          <td className="p-3">{r.hours}</td>
                          <td className="p-3">{formatCurrency(r.earned, r.currency)}</td>
                          <td className="p-3">{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {earnings.by_client.length === 0 && <p className="text-xs text-muted-foreground">No approved work in this range yet.</p>}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Owner earnings + expenses — admin only (never shown to VA or auditor) */}
      {isAdmin && <OwnerFinancePanel />}

      {/* Jane profit bar + business stats (admin only — money hidden for auditor) */}
      {isAdmin && data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Total Invoiced", value: formatCurrency(data.total_invoiced), icon: DollarSign },
              { label: "Paid by Clients", value: formatCurrency(data.paid_by_clients), icon: CheckCircle2 },
              { label: "Total VA Payout", value: formatCurrency(data.total_va_payout), icon: DollarSign },
              {
                label: "Estimated Profit",
                value: formatCurrency(data.estimated_profit),
                icon: TrendingUp,
                tone: Number(data.estimated_profit) >= 0 ? "text-green-600" : "text-red-600",
              },
              { label: "Pending Entries", value: String(data.pending_entries), icon: ClipboardList },
              { label: "Approved Hours", value: String(data.approved_hours), icon: Timer },
            ].map((s) => (
              <Card key={s.label} className="min-w-0">
                <CardContent className="flex items-center gap-3 p-4">
                  <s.icon className={cn("h-5 w-5 shrink-0 text-primary", s.tone)} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
                    <p className={cn("truncate text-lg font-extrabold", s.tone)}>{s.value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Active Clients", value: data.active_clients },
              { label: "Invoices Issued", value: data.invoices_issued },
              { label: "This Week's VA Pay", value: formatCurrency(data.this_week_va_pay) },
              { label: "Active VAs", value: data.active_vas },
            ].map((s) => (
              <Card key={s.label} className="min-w-0">
                <CardContent className="p-4">
                  <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
                  <p className="mt-1 text-2xl font-extrabold">{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader className="pb-2"><CardTitle>Hours by Client</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.hours_by_client.length === 0 && <p className="text-xs text-muted-foreground">No approved hours yet.</p>}
                {data.hours_by_client.slice(0, 8).map((row) => {
                  const max = Math.max(...data.hours_by_client.map((r) => r.hours), 1)
                  return (
                    <div key={row.client} className="flex items-center gap-3 text-xs">
                      <span className="w-28 truncate font-semibold sm:w-36">{row.client}</span>
                      <span className="h-2.5 flex-1 rounded-full bg-slate-100">
                        <span className="block h-2.5 rounded-full bg-primary" style={{ width: `${Math.max(4, (row.hours / max) * 100)}%` }} />
                      </span>
                      <span className="w-12 text-right font-mono text-muted-foreground">{row.hours}h</span>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader className="pb-2"><CardTitle>VA Pay This Week</CardTitle></CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {data.va_pay_this_week.length === 0 && <p className="text-xs text-muted-foreground">No approved VA pay this week.</p>}
                {data.va_pay_this_week.map((v) => (
                  <div key={v.va_id} className="rounded-xl border p-3">
                    <p className="text-xs font-semibold">{v.name}</p>
                    <p className="mt-1 text-lg font-extrabold">{formatCurrency(v.pay, v.currency)}</p>
                    <p className="text-[11px] text-muted-foreground">{v.hours}h · {v.currency}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Smart advice — time & workload aware */}
      <div>
        <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><Lightbulb className="h-3.5 w-3.5 text-primary" /> Smart advice for {greetLabel.replace("Good ", "").toLowerCase()}</p>
        <div className="grid gap-3 lg:grid-cols-3">
          {buildAdvice(overview, isStaff).map((a, i) => (
            <div key={i} className={cn("monday-card rounded-2xl border p-4", a.tone === "danger" && "border-red-200 bg-red-50/70", a.tone === "warn" && "border-amber-200 bg-amber-50/70", a.tone === "calm" && "border-primary/25 bg-primary/[0.04]", a.tone === "primary" && "bg-card")}>
              <p className="flex items-center gap-2 text-sm font-bold"><span className="text-lg">{a.emoji}</span>{a.title}</p>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{a.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* What to prepare */}
        <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-primary" /> What to Prepare Today</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {overview.prepare.map((item, i) => <label key={i} className="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-xs hover:bg-muted/40"><input type="checkbox" className="mt-0.5 accent-[var(--primary)]" /><span>{item}</span></label>)}
            {overview.prepare.length === 0 && <p className="text-xs text-muted-foreground">You're all caught up. Review the board for what's next.</p>}
          </CardContent></Card>

        {/* Today's tasks */}
        <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><Flame className="h-4 w-4 text-primary" /> Current Tasks — Today</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {overview.today_tasks.map(t => <MiniTask key={t.id} t={t} base={base} />)}
            {overview.today_tasks.length === 0 && <p className="text-xs text-muted-foreground">Nothing due today. Pull something from the backlog below.</p>}
            <Link className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" to={`${base}/tasks`}>View full Task Board <ArrowRight className="h-3 w-3" /></Link>
          </CardContent></Card>

        {/* Needs attention */}
        <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" /> Needs Attention {overview.needs_attention.length > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">{overview.needs_attention.length}</span>}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {overview.needs_attention.map((a, i) => <Link key={i} to={a.link} className={cn("block rounded-xl border p-3 monday-card", a.severity === "high" ? "border-red-200 bg-red-50/70" : "border-amber-200 bg-amber-50/70")}><p className="text-xs font-semibold">{a.title}</p><p className="text-[11px] text-muted-foreground">{a.detail}</p></Link>)}
            {overview.needs_attention.length === 0 && <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs"><CheckCircle2 className="mr-1 inline h-4 w-4 text-green-600" /> All clear — nothing overdue, blocked, or waiting.</div>}
            {overview.live_clock.length > 0 && <div className="pt-1"><p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"><Timer className="h-3.5 w-3.5" /> Live clock</p>{overview.live_clock.map(e => <div key={e.id} className="mb-1.5 flex items-center justify-between rounded-lg border px-2.5 py-2 text-[11px]"><span><span className="live-dot mr-1.5 inline-block h-2 w-2 rounded-full bg-green-500" />{isStaff ? `${e.va_name} · ` : ""}{e.task_title || e.client_name || "Working"}</span><span className="font-mono font-bold">{formatDuration(e.elapsed_seconds)}</span></div>)}</div>}
          </CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle>Coming Up — Next 7 Days</CardTitle></CardHeader><CardContent className="space-y-2">
          {overview.upcoming.map(t => <MiniTask key={t.id} t={t} base={base} />)}{overview.upcoming.length === 0 && <p className="text-xs text-muted-foreground">No deadlines in the next 7 days.</p>}
        </CardContent></Card>
        {/* Projects */}
        <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle>Projects at a Glance</CardTitle></CardHeader><CardContent className="space-y-3">
          {overview.projects.map(p => { const pct = p.task_total ? Math.round((p.task_done / p.task_total) * 100) : 0; return (
            <Link key={p.id} to={`${base}/tasks?project=${p.id}`} className="block rounded-xl border p-3 monday-card"><div className="flex justify-between text-xs"><span className="font-semibold">{p.name}</span><span className="text-muted-foreground">{pct}%</span></div>
              <div className="mt-1 text-[11px] text-muted-foreground">{p.client_name} · {p.cadence} · {p.task_done}/{p.task_total} done</div>
              <div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: p.color }} /></div></Link>) })}
          {overview.projects.length === 0 && <p className="text-xs text-muted-foreground">No active projects yet.</p>}
        </CardContent></Card>
        {isStaff ? (
          <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle>Team Load — Who's Busy</CardTitle></CardHeader><CardContent className="space-y-2">
            {(overview.team_load ?? []).map(v => (
              <div key={v.name} className="flex items-center gap-3 text-xs">
                <span className="w-20 truncate font-semibold">{v.name}</span>
                <span className="h-2 flex-1 rounded-full bg-slate-100"><span className={cn("block h-2 rounded-full", v.overdue ? "bg-red-400" : v.open >= 5 ? "bg-amber-400" : "bg-green-400")} style={{ width: `${Math.min(100, v.open * 14)}%` }} /></span>
                <span className="text-muted-foreground">{v.open} open{v.overdue ? ` · ${v.overdue} overdue` : ""}{v.due_today ? ` · ${v.due_today} today` : ""}</span>
              </div>
            ))}
            {(overview.team_load ?? []).length === 0 && <p className="text-xs text-muted-foreground">No open tasks assigned yet.</p>}
            <p className="pt-1 text-[11px] text-muted-foreground">Balance the board: move work from red/amber to green before assigning new tasks.</p>
          </CardContent></Card>
        ) : (
          <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle>Tomorrow</CardTitle></CardHeader><CardContent className="space-y-2">
            {(overview.tomorrow_tasks ?? []).map(t => <MiniTask key={t.id} t={t} base={base} />)}
            {(overview.tomorrow_tasks ?? []).length === 0 && <p className="text-xs text-muted-foreground">Nothing due tomorrow. A calm start — pull one thing forward if you finish early today.</p>}
          </CardContent></Card>
        )}
      </div>

      {isStaff && data && data.pending_logs.length > 0 && (
          <Card><CardHeader className="pb-2"><CardTitle>Pending Approval ({data.pending_logs.length})</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full text-xs">
            <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground"><th className="p-3">Date</th><th className="p-3">VA</th><th className="p-3">Client</th><th className="p-3">Hours</th><th className="p-3">Actions</th></tr></thead>
            <tbody>{data.pending_logs.map(log => <tr key={log.id} className="border-b"><td className="p-3">{log.work_date}</td><td className="p-3">{log.va_name}</td><td className="p-3">{log.client_name}</td><td className="p-3">{log.hours}</td><td className="p-3"><div className="flex gap-1"><Button size="sm" variant="success" onClick={() => approve.mutate(log.id)}><Check className="h-3 w-3" /></Button><Button size="sm" variant="danger" onClick={() => reject.mutate(log.id)}><X className="h-3 w-3" /></Button></div></td></tr>)}</tbody></table></CardContent></Card>
      )}

      {isStaff && data && !isAdmin && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Pending Entries", value: data.pending_entries },
              { label: "Approved Hours", value: data.approved_hours },
              { label: "Active Clients", value: data.active_clients },
              { label: "Active VAs", value: data.active_vas },
            ].map((s) => (
              <Card key={s.label} className="min-w-0"><CardContent className="p-4"><p className="text-[11px] font-medium text-muted-foreground">{s.label}</p><p className="mt-1 text-2xl font-extrabold">{s.value}</p></CardContent></Card>
            ))}
          </div>
          <Card className="min-w-0">
            <CardHeader className="pb-2"><CardTitle>Hours by Client</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {data.hours_by_client.length === 0 && <p className="text-xs text-muted-foreground">No approved hours yet.</p>}
              {data.hours_by_client.slice(0, 8).map((row) => {
                const max = Math.max(...data.hours_by_client.map((r) => r.hours), 1)
                return (
                  <div key={row.client} className="flex items-center gap-3 text-xs">
                    <span className="w-28 truncate font-semibold sm:w-36">{row.client}</span>
                    <span className="h-2.5 flex-1 rounded-full bg-slate-100">
                      <span className="block h-2.5 rounded-full bg-primary" style={{ width: `${Math.max(4, (row.hours / max) * 100)}%` }} />
                    </span>
                    <span className="w-12 text-right font-mono text-muted-foreground">{row.hours}h</span>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
