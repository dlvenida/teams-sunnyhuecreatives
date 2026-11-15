import { expect, test, type Page, type Route } from "@playwright/test"

interface FixtureVa {
  va_id: string
  va_name: string
  currency: "PHP" | "USD"
  total_hours: string
  total_pay: string
  timesheet_status: string | null
  timesheet_submitted: boolean
  is_paid: boolean
}

function seed(): FixtureVa[] {
  return [
    { va_id: "gem", va_name: "Gem", currency: "USD", total_hours: "40.00", total_pay: "800.00", timesheet_status: "submitted", timesheet_submitted: true, is_paid: false },
    { va_id: "myra", va_name: "Myra", currency: "PHP", total_hours: "38.00", total_pay: "12000.00", timesheet_status: "submitted", timesheet_submitted: true, is_paid: false },
    { va_id: "arby", va_name: "Arby", currency: "PHP", total_hours: "20.00", total_pay: "5000.00", timesheet_status: "reviewed", timesheet_submitted: true, is_paid: false },
  ]
}

function payrollBody(vas: FixtureVa[], showMoney: boolean) {
  const php = vas.filter((item) => item.currency === "PHP").reduce((sum, item) => sum + Number(item.total_pay), 0)
  const usd = vas.filter((item) => item.currency === "USD").reduce((sum, item) => sum + Number(item.total_pay), 0)
  return {
    period_start: "2026-11-01",
    period_end: "2026-11-15",
    total_php: showMoney ? php.toFixed(2) : null,
    total_usd: showMoney ? usd.toFixed(2) : null,
    total_hours: vas.reduce((sum, item) => sum + Number(item.total_hours), 0).toFixed(2),
    total_pending_hours: "0",
    vas: vas.map((item) => ({
      ...item,
      entry_count: 1,
      entries: [],
      days_worked: 2,
      avg_hours_per_day: "8.00",
      clock_hours: "0",
      manual_hours: item.total_hours,
      tasks_done: 1,
      pending_hours: "0",
      by_client: [],
      daily: [],
      total_pay: showMoney ? item.total_pay : null,
    })),
  }
}

async function installApi(page: Page, role: "admin" | "auditor") {
  const vas = seed()
  const showMoney = role === "admin"
  await page.addInitScript((user) => {
    localStorage.setItem("access_token", "test-access")
    localStorage.setItem("refresh_token", "test-refresh")
    localStorage.setItem("auth_user", JSON.stringify(user))
  }, { role, name: role === "admin" ? "Jane" : "Audrey", userId: "user-1" })

  await page.route("http://localhost:8090/**", async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    })
    if (path === "/profile/me") {
      return json({ id: "profile", email: "jane@example.com", role, display_name: role === "admin" ? "Jane" : "Audrey", has_profile_photo: false, must_change_password: false })
    }
    if (path.startsWith("/notifications")) return json({ items: [], unread: 0, total: 0 })
    if (path === "/time-clock/current") return json(null)
    if (path === "/time-clock/live" || path === "/time-clock") return json([])
    if (path === "/settings") {
      return json({
        company_name: "Sunny Hue Creatives",
        principal_name: "Jane",
        location: "Manila",
        wise_email: "",
        paypal_email: "",
        hide_pricing: false,
        booking_url: "",
        booking_hide_pricing: false,
        default_va_hourly_rate: "0",
        usd_php_rate: showMoney ? "58.00" : null,
      })
    }
    if (path === "/vas") return json(vas.map((item) => ({ id: item.va_id, name: item.va_name, currency: item.currency })))
    if (path === "/payroll/timesheets") return json([])
    if (path === "/payroll/runs") return json([])
    if (path === "/payroll/calculate" && method === "POST") {
      const body = request.postDataJSON() as { va_id?: string | null }
      const chosen = body.va_id ? vas.filter((item) => item.va_id === body.va_id) : vas
      return json(payrollBody(chosen, showMoney))
    }
    return json({})
  })
}

async function expectNoPageScroll(page: Page) {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1)
}

test("admin can pick a VA and see the peso rate beside the period", async ({ page }, testInfo) => {
  await installApi(page, "admin")
  await page.goto("/admin/payroll")
  await expect(page.getByRole("heading", { name: "Timesheets & pay" })).toBeVisible()
  await expect(page.getByRole("button", { name: "1st – 15th" })).toBeVisible()
  await expect(page.getByLabel("Select VA")).toBeVisible()
  await expect(page.getByLabel("USD to PHP Rate")).toHaveValue("58.00")
  await expect(page.getByTestId("pay-totals")).toContainText("₱17000.00")
  await expect(page.getByTestId("pay-totals")).toContainText("$800.00")
  await expect(page.getByRole("button", { name: "View timesheet for Gem" })).toBeVisible()
  await expect(page.getByTestId("peso-equivalent").first()).toContainText("₱46400.00")
  await expectNoPageScroll(page)
  if (testInfo.project.name === "mobile") {
    await page.screenshot({ path: "/opt/cursor/artifacts/payroll-admin-mobile-top.png", fullPage: false })
  }

  await page.getByLabel("Select VA").selectOption("myra")
  await expect(page.getByRole("button", { name: "View timesheet for Myra" })).toBeVisible()
  await expect(page.getByRole("button", { name: "View timesheet for Gem" })).toHaveCount(0)
  await expectNoPageScroll(page)
  if (testInfo.project.name === "mobile") {
    await page.screenshot({ path: "/opt/cursor/artifacts/payroll-admin-mobile-filtered.png", fullPage: false })
  }
})

test("project manager does not see the rate or pay", async ({ page }, testInfo) => {
  await installApi(page, "auditor")
  await page.goto("/admin/payroll")
  await expect(page.getByRole("heading", { name: "Timesheet review" })).toBeVisible()
  await expect(page.getByLabel("Select VA")).toBeVisible()
  await expect(page.getByLabel("USD to PHP Rate")).toHaveCount(0)
  await expect(page.getByTestId("pay-totals")).toHaveCount(0)
  await expect(page.getByTestId("peso-equivalent")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "View timesheet for Gem" })).toBeVisible()
  await expect(page.getByRole("button", { name: /Mark Paid/ })).toHaveCount(0)
  const text = await page.locator("body").innerText()
  expect(text).not.toMatch(/₱|\$\d/)
  await expectNoPageScroll(page)
  if (testInfo.project.name === "mobile") {
    await page.screenshot({ path: "/opt/cursor/artifacts/payroll-pm-mobile.png", fullPage: false })
  }
})
