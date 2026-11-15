import { expect, test, type Page, type Route } from "@playwright/test"

const money = (usd: string, php: string, combinedUsd: string | null, combinedPhp: string | null) => ({
  usd,
  php,
  combined_usd: combinedUsd,
  combined_php: combinedPhp,
})

const chef = {
  id: "chef-1",
  name: "Chef Stephanie Tranchina",
  billing_type: "hourly",
  default_rate: "25.00",
  is_active: true,
  approval_status: "approved",
}

const financials = {
  client_id: "chef-1",
  client_name: "Chef Stephanie Tranchina",
  is_active: true,
  created_at: "2024-03-01T00:00:00Z",
  total_hours: "6.00",
  total_earned: money("140.00", "580.00", "150.00", "8700.00"),
  total_collected: money("100.00", "580.00", "110.00", "6380.00"),
  total_outstanding: money("40.00", "0.00", "40.00", "2320.00"),
  va_earned: money("122.29", "1032.30", "140.09", "8353.94"),
  va_unpaid: money("0.00", "200.00", "3.45", "200.00"),
  net: money("17.71", "-452.30", "9.91", "346.06"),
  net_collected: money("-22.29", "-452.30", "-30.09", "-1973.94"),
  profit_margin_pct: -27.4,
  rate_label: "Using each paid run's saved rate: 58.00 and 60.00 PHP per 1 USD. Confirmed payday rate: 58.00 PHP per 1 USD.",
  invoices_count: 2,
  invoices_paid: 1,
  invoices_unpaid_count: 1,
  manual_count: 1,
  by_va: [
    { va_id: "va-1", va_name: "Aquirah Daine M.", currency: "USD", hours: "1.00", logs: 1, va_pay: "7.88", va_pay_usd: "7.88", va_pay_php: "0.00", unpaid_usd: "0.00", unpaid_php: "0.00" },
    { va_id: "va-2", va_name: "Arby Mae L.", currency: "PHP", hours: "3.00", logs: 1, va_pay: "1032.30", va_pay_usd: "0.00", va_pay_php: "1032.30", unpaid_usd: "0.00", unpaid_php: "0.00" },
    { va_id: "va-3", va_name: "Gem", currency: "USD", hours: "2.00", logs: 1, va_pay: "114.41", va_pay_usd: "114.41", va_pay_php: "0.00", unpaid_usd: "0.00", unpaid_php: "0.00" },
  ],
}

const detail = {
  client: { id: "chef-1", name: chef.name, billing_type: "hourly", default_rate: "25.00", is_active: true, approval_status: "approved", created_at: "2024-03-01" },
  stats: {
    total_hours: "6.00",
    hours_this_month: "6.00",
    pending_hours: "0",
    pending_count: 0,
    invoiced_hours: "0",
    ready_to_invoice_hours: "6.00",
    logs_count: 3,
    tasks_total: 0,
    tasks_open: 0,
    tasks_done: 0,
    tasks_overdue: 0,
    invoices_count: 2,
    invoices_unpaid: 1,
    va_names: ["Aquirah Daine M.", "Arby Mae L.", "Gem"],
    last_activity: "2026-11-06",
  },
  team: [],
  sub_clients: [],
  projects: [],
  tasks: [],
  logs: [],
  invoices: [],
  financials: {
    since: "2024-03-01",
    ...financials,
  },
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
    if (path === "/settings/display") {
      return json({ hide_pricing: false, booking_url: "", booking_hide_pricing: true, default_va_hourly_rate: "75" })
    }
    if (path === "/clients/financials") {
      if (role !== "admin") return json({ detail: "Admin access required" }, 403)
      return json({
        clients: [financials],
        unassigned: {
          label: "not assigned to a client",
          earned: money("0.00", "0.00", "0.00", "0.00"),
          va_paid: money("0.00", "0.00", "0.00", "0.00"),
        },
      })
    }
    if (path === "/clients/sub-clients") return json([])
    if (path === "/clients/chef-1/detail") {
      if (role !== "admin") {
        return json({
          ...detail,
          financials: {
            ...detail.financials,
            total_earned: null,
            total_collected: null,
            total_outstanding: null,
            va_earned: null,
            va_unpaid: null,
            net: null,
            net_collected: null,
            profit_margin_pct: null,
            rate_label: null,
            by_va: detail.financials.by_va.map((row) => ({ ...row, va_pay: null, currency: "" })),
          },
        })
      }
      return json(detail)
    }
    if (path === "/clients") return json(role === "admin" ? [chef] : [])
    if (path === "/work-logs" || path === "/projects" || path === "/tasks" || path === "/vas") return json([])
    return json([])
  })
}

test("admin sees each currency and the combined total", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => errors.push(String(err)))
  await installApi(page, "admin")
  await page.goto("/admin/clients")
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible()
  const main = page.getByRole("main")
  await expect(main.getByText("Total Earned")).toBeVisible()
  await expect(main.getByText("VA Earned")).toBeVisible()
  await expect(main.getByText("Net", { exact: true })).toBeVisible()
  const row = main.locator("tr", { hasText: "Chef Stephanie Tranchina" })
  await expect(row).toContainText("$122.29 + ₱1,032.30")
  await expect(row).toContainText("$17.71 and -₱452.30")
  await expect(row).toContainText("About $140.09 / ₱8,353.94")
  await expect(page.getByText("$1,154.59")).toHaveCount(0)
  await expect(page.getByText("$1154.59")).toHaveCount(0)
  if (testInfo.project.name === "desktop") {
    await page.screenshot({ path: "/opt/cursor/artifacts/clients-list-desktop.png", fullPage: true })
  }

  await row.click()
  await expect(page.getByText("Lifetime financials · Admin only")).toBeVisible()
  await expect(page.getByText("Invoices plus earnings you added").first()).toBeVisible()
  await expect(page.getByText("Virtual Assistant Earned")).toBeVisible()
  await expect(page.getByText("$140.00 + ₱580.00").first()).toBeVisible()
  await expect(page.getByText("-$22.29 and -₱452.30").first()).toBeVisible()
  await expect(page.getByText("₱200.00 not yet paid").first()).toBeVisible()
  await expect(page.getByText("Using each paid run's saved rate: 58.00 and 60.00 PHP per 1 USD.").first()).toBeVisible()
  if (testInfo.project.name === "mobile") {
    const panel = page.locator("div.fixed.inset-0 > div")
    await panel.getByText("Lifetime financials").scrollIntoViewIfNeeded()
    await panel.screenshot({ path: "/opt/cursor/artifacts/client-detail-mobile.png" })
  }
  expect(errors.filter((line) => !line.includes("favicon"))).toEqual([])
})

test("project manager does not see client money", async ({ page }) => {
  await installApi(page, "auditor")
  await page.goto("/admin/clients")
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible()
  await expect(page.getByRole("main").getByText("Total Earned")).toHaveCount(0)
  await expect(page.getByText("Lifetime financials · Admin only")).toHaveCount(0)
  await expect(page.getByText("$122.29")).toHaveCount(0)
})
