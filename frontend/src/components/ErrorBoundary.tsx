import { Component, type ReactNode } from "react"

interface State { error: Error | null }

/** Catches render crashes so one broken widget shows a recoverable message instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error("UI crash caught by ErrorBoundary:", error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="w-full max-w-sm rounded-2xl border bg-card p-5 text-center shadow-sm">
            <div className="text-2xl">🌧️</div>
            <h1 className="mt-2 text-sm font-semibold">Something went wrong on this screen</h1>
            <p className="mt-1 text-xs text-muted-foreground">{this.state.error.message || "An unexpected error occurred."}</p>
            <div className="mt-4 flex gap-2">
              <button className="flex-1 rounded-lg border px-3 py-2 text-xs font-medium" onClick={() => this.setState({ error: null })}>Try again</button>
              <button className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white" onClick={() => window.location.reload()}>Reload page</button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
