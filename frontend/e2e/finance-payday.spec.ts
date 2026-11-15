import { expect, test, type Page, type Route } from "@playwright/test"

const finance = {
  period_start: "2026-11-01",
  period_end: "2026-11-30",
  usd_php_rate: null,
  earned: { usd: "0.00", php: "37734.40", combined_usd: null, combined_php: null },
  va_payroll: {
    usd: "1298.70",
    php: "33290.78",
    combined_usd: "1819.52",
    combined_php: "116303.68",
  },
  business_expenses: { usd: "0.00", php: "0.00", combined_usd: "0.00", combined_php: "0.00" },
  expense_totals: {
    usd: "0.00",
    php: "0.00",
    combined_usd: "1819.52",
    combined_php: "116303.68",
  },
  net: {
    usd: "-1229.18",
    php: "-78569.17",
    combined_usd: "-1229.18",
    combined_php: "-78569.17",
  },
  needs_rate: false,
  rate_hint: null,
  by_client: [],
  manual_earnings: [],
  expenses: [],
  va_runs_count: 8,
  invoices_count: 0,
  manual_count: 0,
}

async function installApi(page: Page, role: "admin" | "auditor") {
  await page.addInitScript((user) => {
    localStorage.setItem("access_token", "test-access")
    localStorage.setItem("refresh_token", "test-refresh")
    localStorage.setItem("auth_user", JSON.stringify(user))
  }, { role, name: role === "admin" ? "Jane" : "Audrey", userId: "user-1" })

  await page.route("http://localhost:8090/**", async (route: Route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    })
    if (path === "/profile/photo") return route.fulfill({ status: 404, body: "" })
    if (path === "/profile/me") {
      return json({ id: "profile", email: "jane@example.com", role, display_name: role === "admin" ? "Jane" : "Audrey", has_profile_photo: false, must_change_password: false })
    }
    if (path.startsWith("/notifications")) return json({ items: [], unread: 0, total: 0 })
    if (path === "/time-clock/current") return json(null)
    if (path === "/time-clock/live" || path === "/time-clock") return json([])
    if (path === "/auth/users") return json([])
    if (path === "/clients") return json([])
    if (path === "/dashboard/overview") {
      return json({
        role,
        today: "2026-11-15",
        week_start: "2026-11-09",
        week_end: "2026-11-15",
        counts: { total_tasks: 0, todo: 0, in_progress: 0, in_review: 0, approved: 0, done: 0, blocked: 0, overdue: 0, due_today: 0, unassigned: 0, done_this_week: 0 },
        hours_today: "0",
        hours_this_week: "0",
        today_tasks: [],
        backlog: [],
        upcoming: [],
        needs_attention: [],
        prepare: [],
        live_clock: [],
        projects: [],
        recent_comments: [],
      })
    }
    if (path === "/dashboard/productivity/team") {
      return json({ counts: { on_track: 0, behind: 0, no_hours: 0 }, members: [] })
    }
    if (path === "/dashboard/summary") {
      return json({
        total_invoiced: role === "admin" ? "0" : null,
        paid_by_clients: role === "admin" ? "0" : null,
        total_va_payout: role === "admin" ? "0" : null,
        estimated_profit: role === "admin" ? "0" : null,
        this_week_va_pay: role === "admin" ? "0" : null,
        pending_entries: 0,
        approved_hours: "0",
        active_clients: 0,
        invoices_issued: 0,
        unpaid_invoices: 0,
        active_vas: 0,
        hours_by_client: [],
        va_pay_this_week: [],
        pending_logs: [],
      })
    }
    if (path.startsWith("/dashboard/owner-finance")) {
      if (role !== "admin") return json({ detail: "Admin access required" }, 403)
      return json(finance)
    }
    if (path === "/settings") {
      return json({
        company_name: "Sunny Hue Creatives",
        principal_name: "Jane",
        location: "Manila",
        hide_pricing: role !== "admin",
        usd_php_rate: null,
      })
    }
    return json([])
  })
}

test("earnings shows payday conversion, expenses, and one net profit", async ({ page }, testInfo) => {
  await installApi(page, "admin")
  await page.goto("/admin/finance")
  await expect(page.getByRole("heading", { name: "Earnings & expenses" })).toBeVisible()
  await expect(page.getByText("Total Paid to VAs")).toBeVisible()
  await expect(page.getByText("$1819.52").first()).toBeVisible()
  await expect(page.getByText("₱116303.68").first()).toBeVisible()
  await expect(page.getByText("Recorded $1298.70 · ₱33290.78")).toBeVisible()
  await expect(page.getByText("8 payroll run(s) · payday rates applied")).toBeVisible()
  const breakdown = page.getByTestId("expense-breakdown")
  await expect(breakdown).toContainText("VA pay")
  await expect(breakdown).toContainText("$1819.52")
  await expect(breakdown).toContainText("Business expenses")
  await expect(page.getByText("$-1229.18")).toBeVisible()
  await expect(page.getByText("₱-78569.17")).toBeVisible()
  await page.screenshot({
    path: `/opt/cursor/artifacts/finance-earnings-${testInfo.project.name}.png`,
    fullPage: true,
  })
})

test("project manager cannot open earnings", async ({ page }) => {
  await installApi(page, "auditor")
  await page.goto("/admin/finance")
  await expect(page.getByRole("heading", { name: "Earnings & expenses" })).toHaveCount(0)
  await expect(page.getByText("Total Paid to VAs")).toHaveCount(0)
  await expect(page.getByText("₱116303.68")).toHaveCount(0)
  await expect(page.getByLabel("Payday exchange rate (USD to PHP)")).toHaveCount(0)
})
