import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { login } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const user = await login(email, password)
      if (user.mustChangePassword) {
        navigate(user.role === "admin" ? "/admin/profile" : "/va/profile")
        return
      }
      navigate(user.role === "admin" ? "/admin/dashboard" : "/va/time-log")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full border-border/80 bg-card/90 shadow-lg backdrop-blur-sm animate-fade-in">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-lg text-primary">Teams.SHC</CardTitle>
        <p className="text-[11px] text-muted-foreground">Virtual Support Micro-Agency</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <Button type="submit" variant="gold" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
