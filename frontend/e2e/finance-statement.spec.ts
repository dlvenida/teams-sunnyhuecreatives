import { expect, test, type Page, type Route } from "@playwright/test"

const statement = {
  period_start: "2026-11-01",
  period_end: "2026-11-30",
  display_currency: "PHP",
  usd_php_rate: "58",
  needs_rate: false,
  rate_hint: null,
  opening_balance: "0.00",
  total_in: "6380.00",
  va_pay: "1000.00",
  business_expenses: "1160.00",
  total_out: "2160.00",
  net: "4220.00",
  lines: [
    {
      date: "2026-11-04",
      description: "Client payment: Blue Fawn (Invoice #123)",
      category: "Income",
      money_in: "5800.00",
      money_out: "0.00",
      balance: "5800.00",
      original_amount: "100.00",
      original_currency: "USD",
    },
    {
      date: "2026-11-05",
      description: "Manual earning: Blue Fawn Retainer note",
      category: "Income",
      money_in: "580.00",
      money_out: "0.00",
      balance: "6380.00",
      original_amount: null,
      original_currency: null,
    },
    {
      date: "2026-11-06",
      description: "Business expense: Canva Pro",
      category: "Business expense",
      money_in: "0.00",
      money_out: "1160.00",
      balance: "5220.00",
      original_amount: "20.00",
      original_currency: "USD",
    },
    {
      date: "2026-11-16",
      description: "VA pay: Kyla Marie S. (Nov 1 to Nov 15) at 60.00 PHP/USD",
      category: "VA pay",
      money_in: "0.00",
      money_out: "1000.00",
      balance: "4220.00",
      original_amount: null,
      original_currency: null,
    },
  ],
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
      return json({
        id: "profile",
        email: "jane@example.com",
        role,
        display_name: role === "admin" ? "Jane" : "Audrey",
        has_profile_photo: false,
        must_change_password: false,
      })
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
    if (path === "/dashboard/summary") {
      return json({
        total_invoiced: "0",
        paid_by_clients: "0",
        total_va_payout: "0",
        estimated_profit: "0",
        this_week_va_pay: "0",
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
    if (path === "/dashboard/productivity/team") {
      return json({ counts: { on_track: 0, behind: 0, no_hours: 0 }, members: [] })
    }
    if (path === "/settings") {
      return json({
        company_name: "Sunny Hue Creatives",
        principal_name: "Jane Laurine Venida",
        location: "Dumaguete City, Philippines",
        hide_pricing: role !== "admin",
        usd_php_rate: "58.00",
      })
    }
    if (path.startsWith("/dashboard/owner-finance")) {
      if (role !== "admin") return json({ detail: "Admin access required" }, 403)
      return json({
        period_start: "2026-11-01",
        period_end: "2026-11-30",
        usd_php_rate: null,
        earned: { usd: "0.00", php: "0.00", combined_usd: null, combined_php: null },
        va_payroll: { usd: "0.00", php: "0.00", combined_usd: null, combined_php: null },
        expense_totals: { usd: "0.00", php: "0.00", combined_usd: null, combined_php: null },
        net: { usd: "0.00", php: "0.00", combined_usd: "0.00", combined_php: "0.00" },
        needs_rate: false,
        by_client: [],
        manual_earnings: [],
        expenses: [],
        va_runs_count: 0,
        invoices_count: 0,
        manual_count: 0,
      })
    }
    if (path.startsWith("/dashboard/owner-statement")) {
      if (role !== "admin") return json({ detail: "Admin access required" }, 403)
      const display = url.searchParams.get("display_currency") === "USD" ? "USD" : "PHP"
      return json({ ...statement, display_currency: display })
    }
    return json([])
  })
}

test("admin can read the statement and download the PDF", async ({ page }, testInfo) => {
  await installApi(page, "admin")
  await page.goto("/admin/finance")
  await expect(page.getByRole("heading", { name: "Earnings & expenses" })).toBeVisible()
  await page.getByRole("button", { name: "Statement" }).click()
  await expect(page.getByTestId("statement-view")).toBeVisible()
  await expect(page.getByTestId("statement-view")).toContainText("Client payment: Blue Fawn (Invoice #123)")
  await expect(page.getByTestId("statement-view")).toContainText("VA pay: Kyla Marie S. (Nov 1 to Nov 15) at 60.00 PHP/USD")
  await expect(page.getByTestId("statement-summary")).toContainText("₱4,220.00")
  await expect(page.getByTestId("statement-summary")).toContainText("₱6,380.00")
  await page.screenshot({
    path: `/opt/cursor/artifacts/statement-fixed-${testInfo.project.name}.png`,
    fullPage: true,
  })

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download statement PDF" }).click(),
  ])
  const pdfPath = `/opt/cursor/artifacts/statement-${testInfo.project.name}.pdf`
  await download.saveAs(pdfPath)
  expect(download.suggestedFilename()).toContain("Statement-")
  expect(download.suggestedFilename()).not.toMatch(/[—–]/)
})

test("project manager cannot open the statement", async ({ page }) => {
  await installApi(page, "auditor")
  await page.goto("/admin/finance")
  await expect(page.getByRole("heading", { name: "Earnings & expenses" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Statement" })).toHaveCount(0)
  await expect(page.getByTestId("statement-view")).toHaveCount(0)
})
