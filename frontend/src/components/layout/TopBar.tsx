import { GlobalSearch } from "@/components/layout/GlobalSearch"
import { NotificationsPanel } from "@/components/layout/NotificationsPanel"

export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-end gap-3 border-b border-border bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <GlobalSearch className="w-72 max-w-full" />
      <NotificationsPanel />
    </header>
  )
}
