import { expect, test, type Page, type Route } from "@playwright/test"

interface FixtureVa {
  va_id: string
  va_name: string
  currency: "PHP" | "USD"
  total_hours: string
  total_pay: string
  timesheet_id: string
  timesheet_status: string | null
  timesheet_submitted: boolean
  is_paid: boolean
}

function seed(): FixtureVa[] {
  return [
    { va_id: "gem", va_name: "Gem", currency: "USD", total_hours: "40.00", total_pay: "800.00", timesheet_id: "sheet-gem", timesheet_status: "submitted", timesheet_submitted: true, is_paid: false },
    { va_id: "myra", va_name: "Myra", currency: "PHP", total_hours: "38.00", total_pay: "12000.00", timesheet_id: "sheet-myra", timesheet_status: "submitted", timesheet_submitted: true, is_paid: false },
    { va_id: "arby", va_name: "Arby", currency: "PHP", total_hours: "20.00", total_pay: "5000.00", timesheet_id: "sheet-arby", timesheet_status: "reviewed", timesheet_submitted: true, is_paid: false },
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
  const rejected = { id: "", reason: "" }
  const posted: Record<string, unknown>[] = []
  const applied: Record<string, unknown>[] = []
  const showMoney = role === "admin"
  const payday = {
    period_start: "2026-11-01",
    period_end: "2026-11-15",
    usd_php_rate: null as string | null,
    confirmed: false,
    prefill_rate: showMoney ? "58.00" : null,
    confirmed_label: null as string | null,
  }
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
    if (path === "/payroll/payday-rate" && method === "GET") {
      if (!showMoney) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "Admin access required" }) })
      return json(payday)
    }
    if (path === "/payroll/payday-rate" && method === "POST") {
      const body = request.postDataJSON() as { usd_php_rate: number }
      const rate = Number(body.usd_php_rate).toFixed(2)
      payday.usd_php_rate = rate
      payday.confirmed = true
      payday.prefill_rate = rate
      payday.confirmed_label = `Confirmed: ${rate} PHP per 1 USD for Nov 1 to Nov 15`
      return json({ ...payday })
    }
    if (path === "/payroll/runs" && method === "GET") return json([])
    if (path === "/payroll/runs/apply-rate" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>
      applied.push(body)
      return json({ updated: 2, unchanged: 1 })
    }
    if (path === "/payroll/runs" && method === "POST") {
      const body = request.postDataJSON() as { va_id: string }
      posted.push(body)
      const person = vas.find((item) => item.va_id === body.va_id)
      if (person) person.is_paid = true
      return json({ id: "run-1" })
    }
    const review = path.match(/^\/payroll\/timesheets\/([^/]+)\/review$/)
    if (review && method === "POST") {
      const person = vas.find((item) => item.timesheet_id === review[1])
      if (person) person.timesheet_status = "reviewed"
      return json({ id: review[1], status: "reviewed" })
    }
    const reject = path.match(/^\/payroll\/timesheets\/([^/]+)\/reject$/)
    if (reject && method === "POST") {
      const body = request.postDataJSON() as { reason?: string | null }
      const person = vas.find((item) => item.timesheet_id === reject[1])
      if (person) person.timesheet_status = "rejected"
      rejected.id = reject[1]
      rejected.reason = body.reason ?? ""
      return json({ id: reject[1], status: "rejected" })
    }
    if (path === "/payroll/calculate" && method === "POST") {
      const body = request.postDataJSON() as { va_id?: string | null }
      const chosen = body.va_id ? vas.filter((item) => item.va_id === body.va_id) : vas
      return json(payrollBody(chosen, showMoney))
    }
    return json({})
  })
  return { rejected, posted, applied }
}

async function expectNoPageScroll(page: Page) {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1)
}

test("admin can pick a VA and see the peso rate beside the period", async ({ page }, testInfo) => {
  const { rejected, posted, applied } = await installApi(page, "admin")
  await page.goto("/admin/payroll")
  await expect(page.getByRole("heading", { name: "Timesheets & pay" })).toBeVisible()
  await expect(page.getByRole("button", { name: "1st – 15th" })).toBeVisible()
  await expect(page.getByLabel("Select VA")).toBeVisible()
  const standardRate = page.getByLabel("Payday rate for all VAs (USD to PHP)")
  await expect(standardRate).toHaveValue("58.00")
  await expect(page.getByRole("button", { name: "Confirm payday rate" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Apply to all paid runs in this period" })).toBeVisible()
  await page.locator("#payroll-top").screenshot({ path: `/opt/cursor/artifacts/payroll-rate-before-confirm-${testInfo.project.name}.png` })
  await page.getByRole("button", { name: "Confirm payday rate" }).click()
  await expect(page.getByTestId("payday-confirmed")).toHaveText("Confirmed: 58.00 PHP per 1 USD for Nov 1 to Nov 15")
  await expect(page.getByRole("button", { name: "Change rate" })).toBeVisible()
  await page.locator("#payroll-top").screenshot({ path: `/opt/cursor/artifacts/payroll-rate-after-confirm-${testInfo.project.name}.png` })
  const gem = page.locator("[data-va=Gem]")
  await expect(gem.getByTestId("peso-equivalent")).toHaveText("To pay about ₱46400.00 at the payday rate")
  await expect(page.getByTestId("pay-totals")).toContainText("Combined ₱63400.00")
  await gem.screenshot({ path: `/opt/cursor/artifacts/payroll-usd-card-peso-${testInfo.project.name}.png` })
  await page.getByRole("button", { name: "Apply to all paid runs in this period" }).click()
  await expect(page.getByText("Updated 2 paid runs to this rate.")).toBeVisible()
  expect(applied.at(-1)).toMatchObject({ period_start: "2026-11-01", period_end: "2026-11-15", usd_php_rate: 58 })
  await expect(page.getByTestId("pay-totals")).toContainText("₱17000.00")
  await expect(page.getByTestId("pay-totals")).toContainText("$800.00")
  const arby = page.locator("[data-va=Arby]")
  await expect(gem.getByRole("button", { name: "Approve Gem" })).toBeVisible()
  await expect(gem.getByRole("button", { name: "Return timesheet Gem" })).toBeVisible()
  await expect(gem).toContainText("Approve first to mark paid")
  await expect(arby.getByRole("button", { name: "Approve Arby" })).toHaveCount(0)
  await expect(arby.getByRole("button", { name: "Mark Paid Arby" })).toBeEnabled()
  await expect(page.locator("[data-va=Myra]").getByTestId("peso-equivalent")).toHaveCount(0)
  await expectNoPageScroll(page)
  if (testInfo.project.name === "mobile") {
    await gem.screenshot({ path: "/opt/cursor/artifacts/payroll-submitted-card.png" })
    await arby.screenshot({ path: "/opt/cursor/artifacts/payroll-approved-card.png" })
  }

  await gem.getByRole("button", { name: "Return timesheet Gem" }).click()
  const sheet = page.getByTestId("return-sheet")
  await expect(sheet).toBeVisible()
  if (testInfo.project.name === "mobile") {
    await page.screenshot({ path: "/opt/cursor/artifacts/payroll-return-sheet.png", fullPage: false })
  }
  await sheet.getByRole("button", { name: "Missing entries" }).click()
  await sheet.getByRole("button", { name: "Send back" }).click()
  await expect(gem.getByRole("button", { name: "Approve Gem" })).toHaveCount(0)
  expect(rejected).toEqual({ id: "sheet-gem", reason: "Missing entries" })

  const myra = page.locator("[data-va=Myra]")
  await myra.getByRole("button", { name: "Approve Myra" }).click()
  await expect(myra.getByRole("button", { name: "Mark Paid Myra" })).toBeEnabled()
  await myra.getByRole("button", { name: "Mark Paid Myra" }).click()
  const payday = page.getByTestId("payday-rate-used")
  await expect(payday).toContainText("58.00")
  await expect(page.getByLabel("Payday exchange rate (USD to PHP)")).toHaveCount(0)
  await page.screenshot({ path: `/opt/cursor/artifacts/payroll-mark-paid-confirmed-${testInfo.project.name}.png`, fullPage: false })
  await page.getByRole("button", { name: "Confirm & mark paid" }).click()
  await expect(myra).toContainText("Paid")
  expect(posted.at(-1)).toMatchObject({ va_id: "myra", currency: "PHP", total_pay: 12000, usd_php_rate: 58 })

  await page.getByRole("button", { name: "Change rate" }).click()
  await standardRate.fill("63.92")
  await expect(gem.getByTestId("peso-equivalent")).toHaveText("To pay about ₱46400.00 at the payday rate")
  await expect(page.getByTestId("pay-totals")).toContainText("Combined ₱63400.00")
  await arby.getByRole("button", { name: "Mark Paid Arby" }).click()
  await expect(payday).toContainText("Confirmed rate is still 58.00")
  await page.getByRole("button", { name: "Back" }).click()
  await page.getByRole("button", { name: "Confirm payday rate" }).click()
  await expect(page.getByTestId("payday-confirmed")).toHaveText("Confirmed: 63.92 PHP per 1 USD for Nov 1 to Nov 15")
  await expect(gem.getByTestId("peso-equivalent")).toHaveText("To pay about ₱51136.00 at the payday rate")
  await expect(page.getByTestId("pay-totals")).toContainText("Combined ₱68136.00")
  await arby.getByRole("button", { name: "Mark Paid Arby" }).click()
  await page.getByRole("button", { name: "Confirm & mark paid" }).click()
  expect(posted.at(-1)).toMatchObject({ va_id: "arby", currency: "PHP", usd_php_rate: 63.92 })
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
  await expect(page.getByLabel("Payday rate for all VAs (USD to PHP)")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Confirm payday rate" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Change rate" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Apply to all paid runs in this period" })).toHaveCount(0)
  await expect(page.getByText("To pay about")).toHaveCount(0)
  await expect(page.getByTestId("payday-rate-used")).toHaveCount(0)
  await expect(page.getByTestId("pay-totals")).toHaveCount(0)
  await expect(page.getByTestId("peso-equivalent")).toHaveCount(0)
  const gem = page.locator("[data-va=Gem]")
  await expect(gem.getByRole("button", { name: "Approve Gem" })).toBeVisible()
  await expect(gem.getByRole("button", { name: "Return timesheet Gem" })).toBeVisible()
  await expect(page.getByRole("button", { name: /Mark Paid/ })).toHaveCount(0)
  if (testInfo.project.name === "mobile") {
    await gem.screenshot({ path: "/opt/cursor/artifacts/payroll-pm-card.png" })
  }
  const text = await page.locator("body").innerText()
  expect(text).not.toMatch(/₱|\$\d/)
  await expectNoPageScroll(page)
  if (testInfo.project.name === "mobile") {
    await page.screenshot({ path: "/opt/cursor/artifacts/payroll-pm-mobile.png", fullPage: false })
  }
})
