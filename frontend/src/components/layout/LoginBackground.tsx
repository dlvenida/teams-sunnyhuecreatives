/** Soft animated gradient orbs for the login screen. */
export function LoginBackground() {
  return (
    <div className="login-bg pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="login-bg-orb login-bg-orb-1" />
      <div className="login-bg-orb login-bg-orb-2" />
      <div className="login-bg-orb login-bg-orb-3" />
      <div className="login-bg-orb login-bg-orb-4" />
      <div className="login-bg-shimmer" />
    </div>
  )
}
