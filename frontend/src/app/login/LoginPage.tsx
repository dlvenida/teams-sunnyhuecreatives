import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  AtSign, BellRing, Eye, EyeOff, Hash, KanbanSquare, KeyRound, Loader2, Lock, Mail, ShieldCheck, Sun, Timer,
} from "lucide-react"
import { login, pinLogin, type AuthUser } from "@/lib/api"
import { PinInput } from "@/components/auth/PinInput"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const FEATURES = [
  { icon: KanbanSquare, text: "Monday-style boards, projects & client work in one place" },
  { icon: Timer, text: "One-tap time clock with live team presence" },
  { icon: BellRing, text: "Instant notifications for comments, approvals & updates" },
  { icon: ShieldCheck, text: "Auditor oversight keeps every VA's week on track" },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return { text: "Good morning", emoji: "☀️" }
  if (h < 18) return { text: "Good afternoon", emoji: "🌤️" }
  return { text: "Good evening", emoji: "🌙" }
}

const REMEMBER_KEY = "shc-remember-email"
const REMEMBER_USERNAME_KEY = "shc-remember-username"

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [mode, setMode] = useState<"password" | "pin">("password")
  const [pin, setPin] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState("")
  const [errorTick, setErrorTick] = useState(0)
  const [loading, setLoading] = useState(false)
  const hello = greeting()

  useEffect(() => {
    const saved = localStorage.getItem(REMEMBER_KEY)
    if (saved) {
      setEmail(saved)
      setRemember(true)
    }
    const savedUsername = localStorage.getItem(REMEMBER_USERNAME_KEY)
    if (savedUsername) setUsername(savedUsername)
    else if (saved) setUsername(saved.split("@")[0].toLowerCase())
  }, [])

  const afterLogin = (user: AuthUser, rememberEmail: boolean) => {
    if (rememberEmail) localStorage.setItem(REMEMBER_KEY, email.trim())
    else localStorage.removeItem(REMEMBER_KEY)
    if (user.mustChangePassword) {
      navigate(user.role === "va" ? "/va/profile" : "/admin/profile")
      return
    }
    navigate(user.role === "admin" || user.role === "auditor" ? "/admin/dashboard" : "/va/time-log")
  }

  const fail = (err: unknown, fallback: string) => {
    setError(err instanceof Error ? err.message : fallback)
    setErrorTick(t => t + 1)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === "pin") {
      await handlePin(pin)
      return
    }
    setError("")
    setLoading(true)
    try {
      afterLogin(await login(email.trim(), password), remember)
    } catch (err) {
      fail(err, "Login failed — please try again")
    } finally {
      setLoading(false)
    }
  }

  const handlePin = async (pinValue: string) => {
    if (loading) return
    if (!username.trim()) {
      setError("Enter your username first, then your 6-digit PIN.")
      setErrorTick(t => t + 1)
      return
    }
    if (pinValue.length !== 6) return
    setError("")
    setLoading(true)
    try {
      // PIN quick login remembers the username so next time it's PIN-only typing.
      localStorage.setItem(REMEMBER_USERNAME_KEY, username.trim().toLowerCase())
      afterLogin(await pinLogin(username.trim().toLowerCase(), pinValue), remember)
    } catch (err) {
      setPin("")
      fail(err, "PIN login failed — please try again")
    } finally {
      setLoading(false)
    }
  }

  const switchMode = (next: "password" | "pin") => {
    setMode(next)
    setError("")
    setPin("")
  }

  return (
    <div className="w-full overflow-hidden rounded-3xl border border-border/70 bg-card shadow-2xl animate-fade-in sm:grid sm:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#f9a3c2] via-[#f78fb0] to-[#f7c1cf] p-7 text-white sm:flex">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-amber-200/25 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/95 shadow-lg">
              <Sun className="h-6 w-6 text-[#e7548c]" />
            </span>
            <div>
              <p className="font-display text-lg font-extrabold leading-tight">Teams.SHC</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/85">Sunny Hue Creatives</p>
            </div>
          </div>
          <h1 className="mt-8 font-display text-[26px] font-extrabold leading-snug">
            {hello.text} {hello.emoji}
            <span className="mt-1 block text-[15px] font-semibold text-white/90">
              Your team's workspace for tasks, time, payroll and clients — work that shines.
            </span>
          </h1>
          <ul className="mt-6 space-y-3">
            {FEATURES.map(f => (
              <li key={f.text} className="flex items-start gap-2.5 text-[12.5px] font-medium text-white/95">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/20">
                  <f.icon className="h-3.5 w-3.5" />
                </span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-8 text-[11px] font-medium text-white/80">
          Virtual Support Micro-Agency · teams.sunnyhuecreatives.com
        </p>
      </div>

      {/* Form panel */}
      <div className="p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-2.5 sm:hidden">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f9a3c2] to-[#f78fb0] shadow">
            <Sun className="h-5 w-5 text-white" />
          </span>
          <div>
            <p className="font-display text-base font-extrabold leading-tight text-primary">Teams.SHC</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sunny Hue Creatives</p>
          </div>
        </div>

        <h2 className="font-display text-xl font-extrabold">Welcome back 👋</h2>
        <p className="mt-1 text-xs text-muted-foreground">Sign in to your workspace to pick up where you left off.</p>

        <div className="mt-4 grid grid-cols-2 gap-1 rounded-full border border-border bg-muted/40 p-1" role="tablist" aria-label="Sign-in method">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "password"}
            onClick={() => switchMode("password")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition",
              mode === "password" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <KeyRound className="h-3.5 w-3.5" /> Password
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "pin"}
            onClick={() => switchMode("pin")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition",
              mode === "pin" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Hash className="h-3.5 w-3.5" /> Quick PIN
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {mode === "password" ? (
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@sunnyhuecreatives.com"
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  placeholder="e.g. janelaurine"
                  className="pl-9"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {mode === "password" ? (
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pl-9 pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>6-digit PIN</Label>
              <div key={errorTick} className={error ? "animate-[shake_0.3s_ease-in-out]" : undefined}>
                <PinInput
                  value={pin}
                  onChange={setPin}
                  onComplete={handlePin}
                  autoFocus={!!username}
                  disabled={loading}
                  showKeypad
                />
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {username
                  ? <>Quick login for <span className="font-semibold text-foreground">@{username}</span> — tap the keys or press <span className="font-semibold text-foreground">#</span> when all six are filled.</>
                  : "Enter your username above, then your PIN with the hash keypad — # confirms when ready."}
              </p>
            </div>
          )}

          {mode === "password" && (
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Remember my email on this device
            </label>
          )}

          {error && (
            <div
              key={errorTick}
              className="animate-[shake_0.3s_ease-in-out] rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
              role="alert"
            >
              {error}
            </div>
          )}

          <Button type="submit" variant="gold" className={cn("w-full", loading && "opacity-90")} disabled={loading || (mode === "pin" && pin.length !== 6)}>
            {loading ? (
              <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Signing you in…</span>
            ) : mode === "pin" ? (
              "Sign In with PIN"
            ) : (
              "Sign In"
            )}
          </Button>
        </form>

        <p className="mt-5 border-t border-border pt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          {mode === "pin" ? (
            <>No PIN yet? Sign in with your password once, then set your username + PIN in <span className="font-semibold">Profile → Security</span>.</>
          ) : (
            <>
              Forgot your password? Ask your admin to reset it for you.
              <span className="block">New VA? Your account is created by the admin — check your email for your first login.</span>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
