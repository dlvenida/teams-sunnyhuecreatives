import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getAuthUser, homeForRole } from "@/lib/api"
import { ThemeProvider } from "@/components/theme/ThemeProvider"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { ProtectedRoute } from "@/components/ProtectedRoute"
import { AppShell } from "@/components/layout/AppShell"
import { AuthShell } from "@/components/layout/AuthShell"
import { LoginPage } from "@/app/login/LoginPage"
import { DashboardPage } from "@/app/dashboard/DashboardPage"
import { LogsPage } from "@/app/admin/logs/LogsPage"
import { PayrollPage } from "@/app/admin/payroll/PayrollPage"
import { ReportsPage } from "@/app/admin/reports/ReportsPage"
import { InvoicesPage } from "@/app/admin/invoices/InvoicesPage"
import { SettingsPage } from "@/app/admin/settings/SettingsPage"
import { ClientsPage } from "@/app/admin/clients/ClientsPage"
import { UsersPage } from "@/app/admin/users/UsersPage"
import { VATimeLogPage } from "@/app/va/time-log/VATimeLogPage"
import { VAPayrollPage } from "@/app/va/payroll/VAPayrollPage"
import { VARatesPage } from "@/app/va/rates/VARatesPage"
import { VARatesAdminPage } from "@/app/admin/va-rates/VARatesAdminPage"
import { ProfilePage } from "@/app/profile/ProfilePage"
import { BookingPage } from "@/app/booking/BookingPage"
import { TasksPage } from "@/app/tasks/TasksPage"
import { ProjectsPage } from "@/app/projects/ProjectsPage"
import { TimeClockPage } from "@/app/timeclock/TimeClockPage"
import { AnalyticsPage } from "@/app/admin/analytics/AnalyticsPage"
import { NotificationsPage } from "@/app/notifications/NotificationsPage"
import { NotFoundPage } from "@/app/not-found/NotFoundPage"
import { VAClientsPage } from "@/app/va/clients/VAClientsPage"
import { UserReportsPage } from "@/app/reports/UserReportsPage"

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

function RootRedirect() {
  const user = getAuthUser()
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={homeForRole(user.role as "admin" | "auditor" | "va")} replace />
}

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<RootRedirect />} />

            <Route element={<AuthShell />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="/notifications" element={<NotificationsPage />} />
              </Route>
            </Route>

            <Route element={<ProtectedRoute role={["admin", "auditor"]} />}>
              <Route element={<AppShell />}>
                <Route path="/admin/dashboard" element={<DashboardPage />} />
                <Route path="/admin/logs" element={<LogsPage />} />
                <Route path="/admin/payroll" element={<PayrollPage />} />
                <Route path="/admin/clients" element={<ClientsPage />} />
                <Route path="/admin/user-reports" element={<UserReportsPage />} />
                <Route path="/admin/tasks" element={<TasksPage />} />
                <Route path="/admin/projects" element={<ProjectsPage />} />
                <Route path="/admin/time-clock" element={<TimeClockPage />} />
                <Route path="/admin/reports" element={<ReportsPage />} />
                <Route path="/admin/analytics" element={<AnalyticsPage />} />
                <Route path="/admin/users" element={<UsersPage />} />
                <Route path="/admin/profile" element={<ProfilePage />} />
              </Route>
            </Route>

            <Route element={<ProtectedRoute role="admin" />}>
              <Route element={<AppShell />}>
                <Route path="/admin/va-rates" element={<VARatesAdminPage />} />
                <Route path="/admin/invoices" element={<InvoicesPage />} />
                <Route path="/admin/settings" element={<SettingsPage />} />
                <Route path="/admin/booking" element={<BookingPage />} />
              </Route>
            </Route>

            <Route element={<ProtectedRoute role="va" />}>
              <Route element={<AppShell />}>
                <Route path="/va/dashboard" element={<DashboardPage />} />
                <Route path="/va/tasks" element={<TasksPage />} />
                <Route path="/va/projects" element={<ProjectsPage />} />
                <Route path="/va/time-clock" element={<TimeClockPage />} />
                <Route path="/va/time-log" element={<VATimeLogPage />} />
                <Route path="/va/payroll" element={<VAPayrollPage />} />
                <Route path="/va/rates" element={<VARatesPage />} />
                <Route path="/va/clients" element={<VAClientsPage />} />
                <Route path="/va/reports" element={<UserReportsPage />} />
                <Route path="/va/profile" element={<ProfilePage />} />
                <Route path="/va/booking" element={<BookingPage />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  )
}
