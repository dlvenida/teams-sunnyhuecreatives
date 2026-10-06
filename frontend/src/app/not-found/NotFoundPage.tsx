import { Link } from "react-router-dom"
import { getAuthUser } from "@/lib/api"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { LoginBackground } from "@/components/layout/LoginBackground"

export function NotFoundPage() {
  const user = getAuthUser()
  const homePath = user
    ? user.role === "admin"
      ? "/admin/dashboard"
      : "/va/time-log"
    : "/login"

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <LoginBackground />
      <div className="relative z-10 w-full max-w-md animate-fade-in text-center">
        <p className="text-6xl font-bold tracking-tighter text-primary">404</p>
        <h1 className="mt-2 text-lg font-semibold text-foreground">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you are looking for does not exist or may have been moved.
        </p>
        <Link to={homePath} className={cn(buttonVariants({ variant: "gold" }), "mt-6 inline-flex")}>
          {user ? "Back to dashboard" : "Back to sign in"}
        </Link>
      </div>
    </div>
  )
}
