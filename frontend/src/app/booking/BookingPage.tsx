import { Link } from "react-router-dom"
import { Calendar, ExternalLink } from "lucide-react"
import { useDisplaySettings, getBookingUrl } from "@/hooks/useDisplaySettings"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function BookingPage() {
  const display = useDisplaySettings()
  const bookingUrl = getBookingUrl(display)

  return (
    <div className="mx-auto max-w-lg space-y-4 animate-fade-in">
      <div>
        <h1 className="text-base font-semibold tracking-tight">Booking</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Schedule time — pricing is hidden on the booking experience
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-primary" /> Book a session
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {bookingUrl ? (
            <>
              <p className="text-xs text-muted-foreground">
                You will be taken to our scheduling page. Package and price options are not shown here
                {display.booking_hide_pricing ? " (pricing hidden on the link)" : ""}.
              </p>
              <a
                href={bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "gold" }), "w-full")}
              >
                Open booking page <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              No booking link configured yet. An admin can add one under{" "}
              <Link to="/admin/settings" className="font-medium text-primary hover:underline">
                Settings
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
