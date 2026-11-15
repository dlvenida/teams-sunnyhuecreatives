import { expect, test, type Page, type Route } from "@playwright/test"

type Bucket = "approve" | "pay" | "paid" | "draft"

interface FixtureVa {
  va_id: string
  va_name: string
  currency: "PHP" | "USD"
  total_hours: string
  total_pay: string
  timesheet_status: string | null
  timesheet_id: string | null
  timesheet_submitted: boolean
  is_paid: boolean
  run_id: string | null
  entry_count: number
  entries: {
    id: string
    work_date: string
    client_name: string
    description: string
    hours: string
    rate: string
    pay: string
  }[]
}

interface FixtureRun {
  id: string
  va_id: string
  va_name: string
  period_start: string
  period_end: string
  total_hours: string
  total_pay: string
  currency: string
  method: string
  usd_php_rate: string | null
  paid_at: string
}

function va(partial: Partial<FixtureVa> & Pick<FixtureVa, "va_id" | "va_name" | "currency" | "total_hours" | "total_pay">): FixtureVa {
  return {
    timesheet_status: null,
    timesheet_id: null,
    timesheet_submitted: false,
    is_paid: false,
    run_id: null,
    entry_count: 1,
    entries: [{
      id: `${partial.va_id}-log`,
      work_date: "2026-11-03",
      client_name: "Northwind",
      description: "Client support",
      hours: partial.total_hours,
      rate: partial.currency === "USD" ? "20.00" : "300.00",
      pay: partial.total_pay,
    }],
    ...partial,
  }
}

function seed() {
  const vas: FixtureVa[] = [
    va({ va_id: "gem", va_name: "Gem", currency: "USD", total_hours: "40.00", total_pay: "800.00", timesheet_status: "submitted", timesheet_id: "sheet-gem", timesheet_submitted: true }),
    va({ va_id: "myra", va_name: "Myra", currency: "PHP", total_hours: "38.00", total_pay: "12000.00", timesheet_status: "submitted", timesheet_id: "sheet-myra", timesheet_submitted: true }),
    va({ va_id: "arby", va_name: "Arby", currency: "PHP", total_hours: "20.00", total_pay: "5000.00", timesheet_status: "reviewed", timesheet_id: "sheet-arby", timesheet_submitted: true }),
    va({ va_id: "peter", va_name: "Peter", currency: "USD", total_hours: "10.00", total_pay: "200.00", timesheet_status: "reviewed", timesheet_id: "sheet-peter", timesheet_submitted: true, is_paid: true, run_id: "run-peter" }),
    va({ va_id: "leya", va_name: "Leya", currency: "PHP", total_hours: "0.00", total_pay: "0.00", entry_count: 0, entries: [] }),
  ]
  const runs: FixtureRun[] = [{
    id: "run-peter",
    va_id: "peter",
    va_name: "Peter",
    period_start: "2026-11-01",
    period_end: "2026-11-15",
    total_hours: "10.00",
    total_pay: "200.00",
    currency: "USD",
    method: "wise",
    usd_php_rate: "58.00",
    paid_at: "2026-11-15T02:00:00Z",
  }]
  return { vas, runs, rejected: null as { id: string; reason: string | null } | null }
}

function payrollBody(state: ReturnType<typeof seed>, showMoney: boolean) {
  const vas = state.vas.map((item) => ({
    ...item,
    timesheet_period_start: "2026-11-01",
    timesheet_period_end: "2026-11-15",
    days_worked: 4,
    avg_hours_per_day: "8.00",
    clock_hours: "0",
    manual_hours: item.total_hours,
    tasks_done: 1,
    pending_hours: "0",
    by_client: item.entries.length ? [{
      label: "Northwind",
      hours: item.total_hours,
      pay: showMoney ? item.total_pay : null,
      rate: showMoney ? item.entries[0].rate : null,
      pay_type: "hourly",
    }] : [],
    daily: [{ work_date: "2026-11-03", hours: item.total_hours }],
    total_pay: showMoney ? item.total_pay : null,
    currency: item.currency,
  }))
  const php = state.vas.filter((item) => item.currency === "PHP").reduce((sum, item) => sum + Number(item.total_pay), 0)
  const usd = state.vas.filter((item) => item.currency === "USD").reduce((sum, item) => sum + Number(item.total_pay), 0)
  return {
    period_start: "2026-11-01",
    period_end: "2026-11-15",
    vas,
    total_php: showMoney ? php.toFixed(2) : null,
    total_usd: showMoney ? usd.toFixed(2) : null,
    total_hours: state.vas.reduce((sum, item) => sum + Number(item.total_hours), 0).toFixed(2),
    total_pending_hours: "0",
  }
}

async function installApi(page: Page, role: "admin" | "auditor") {
  const state = seed()
  const showMoney = role === "admin"
  await page.addInitScript((user) => {
    localStorage.setItem("access_token", "test-access")
    localStorage.setItem("refresh_token", "test-refresh")
    localStorage.setItem("auth_user", JSON.stringify(user))
  }, { role, name: role === "admin" ? "Jane" : "Audrey", userId: role === "admin" ? "admin-1" : "pm-1", vaId: role === "auditor" ? "pm-va" : undefined })

  await page.route("http://localhost:8090/**", async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    })

    if (path === "/profile/me") {
      return json({
        id: "profile",
        email: role === "admin" ? "jane@example.com" : "audrey@example.com",
        role,
        display_name: role === "admin" ? "Jane" : "Audrey",
        has_profile_photo: false,
        must_change_password: false,
      })
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
        usd_php_rate: "58.00",
      })
    }
    if (path === "/vas") {
      return json(state.vas.map((item) => ({ id: item.va_id, name: item.va_name, currency: item.currency })))
    }
    if (path === "/payroll/timesheets") return json([])
    if (path === "/payroll/calculate" && method === "POST") return json(payrollBody(state, showMoney))
    if (path === "/payroll/runs" && method === "GET") return json(showMoney ? state.runs : [])
    if (path === "/payroll/runs" && method === "POST") {
      const body = request.postDataJSON() as { va_id: string; total_hours: string; total_pay: number; currency: string }
      const person = state.vas.find((item) => item.va_id === body.va_id)
      const id = `run-${body.va_id}`
      if (person) {
        person.is_paid = true
        person.run_id = id
        person.timesheet_status = "reviewed"
      }
      state.runs.unshift({
        id,
        va_id: body.va_id,
        va_name: person?.va_name || "VA",
        period_start: "2026-11-01",
        period_end: "2026-11-15",
        total_hours: String(body.total_hours),
        total_pay: Number(body.total_pay).toFixed(2),
        currency: body.currency,
        method: "wise",
        usd_php_rate: "58.00",
        paid_at: "2026-11-15T08:00:00Z",
      })
      return json({ id })
    }
    const review = path.match(/^\/payroll\/timesheets\/([^/]+)\/review$/)
    if (review && method === "POST") {
      const person = state.vas.find((item) => item.timesheet_id === review[1])
      if (person) person.timesheet_status = "reviewed"
      return json({ id: review[1], status: "reviewed" })
    }
    const reject = path.match(/^\/payroll\/timesheets\/([^/]+)\/reject$/)
    if (reject && method === "POST") {
      const body = request.postDataJSON() as { reason?: string | null }
      const person = state.vas.find((item) => item.timesheet_id === reject[1])
      if (person) person.timesheet_status = "rejected"
      state.rejected = { id: reject[1], reason: body.reason ?? null }
      return json({ id: reject[1], status: "rejected", review_note: body.reason ?? null })
    }
    const undo = path.match(/^\/payroll\/runs\/([^/]+)$/)
    if (undo && method === "DELETE") {
      state.runs = state.runs.filter((item) => item.id !== undo[1])
      const person = state.vas.find((item) => item.run_id === undo[1])
      if (person) {
        person.is_paid = false
        person.run_id = null
      }
      return json({ ok: true })
    }
    return json({})
  })
  return state
}

async function openPayroll(page: Page, role: "admin" | "auditor") {
  const state = await installApi(page, role)
  await page.goto("/admin/payroll")
  await expect(page.getByTestId("needs-action")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Needs your action" })).toBeVisible()
  return state
}

async function buckets(page: Page) {
  return page.locator("[data-testid=action-list] [data-testid=action-card]").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-bucket")),
  )
}

async function expectNoPageScroll(page: Page) {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1)
}

test("admin can approve, return, and mark paid from the top of the page", async ({ page }, testInfo) => {
  const state = await openPayroll(page, "admin")
  await expect(page.getByRole("button", { name: "1st – 15th" })).toBeVisible()
  await expect(page.getByTestId("filter-approve")).toContainText("To approve (2)")
  await expect(page.getByTestId("filter-pay")).toContainText("To pay (1)")
  await expect(page.getByTestId("filter-paid")).toContainText("Paid (1)")
  expect(await buckets(page)).toEqual(["approve", "approve", "pay"] satisfies Bucket[])
  await expect(page.locator("[data-testid=action-list] [data-va=Gem]")).toContainText("40.00 hrs")
  await expect(page.locator("[data-testid=action-list] [data-va=Gem] [data-testid=pay-amount]")).toContainText("$800.00")
  await expectNoPageScroll(page)

  const card = page.locator("[data-testid=action-list] [data-va=Myra]")
  if (testInfo.project.name === "mobile") {
    await page.screenshot({ path: "/opt/cursor/artifacts/payroll-admin-mobile-top.png", fullPage: false })
    await card.screenshot({ path: "/opt/cursor/artifacts/payroll-admin-mobile-card.png" })
  }

  await card.getByRole("button", { name: "Approve Myra" }).click()
  await expect(page.locator("[data-testid=action-list] [data-va=Myra]")).toHaveAttribute("data-bucket", "pay")
  expect(await buckets(page)).toEqual(["approve", "pay", "pay"])

  const gem = page.locator("[data-testid=action-list] [data-va=Gem]")
  await gem.getByRole("button", { name: "Return for fixes Gem" }).click()
  await gem.getByLabel("Note for the VA (optional)").fill("Add Friday")
  await gem.getByRole("button", { name: "Return for fixes", exact: true }).click()
  await expect(page.locator("[data-testid=action-list] [data-va=Gem]")).toHaveCount(0)
  expect(state.rejected).toEqual({ id: "sheet-gem", reason: "Add Friday" })

  await page.getByTestId("filter-pay").click()
  const arby = page.locator("[data-testid=action-list] [data-va=Arby]")
  await arby.getByRole("button", { name: "Mark Paid Arby" }).click()
  await expect(page.getByText("Review before Mark Paid")).toBeVisible()
  await page.getByRole("button", { name: "Confirm & mark paid" }).click()
  await expect(page.locator("[data-testid=action-list] [data-va=Arby]")).toHaveCount(0)
  await page.getByTestId("filter-paid").click()
  await expect(page.locator("[data-testid=action-list] [data-va=Arby]")).toHaveAttribute("data-bucket", "paid")
  await expectNoPageScroll(page)
})

test("project manager sees hours and actions without money", async ({ page }, testInfo) => {
  await openPayroll(page, "auditor")
  await expect(page.getByRole("heading", { name: "Timesheet review" })).toBeVisible()
  await expect(page.getByTestId("filter-approve")).toContainText("To approve (2)")
  await expect(page.getByTestId("filter-pay")).toContainText("Approved (1)")
  await expect(page.getByTestId("filter-pay")).not.toContainText("To pay")
  expect(await buckets(page)).toEqual(["approve", "approve", "pay"])
  await expect(page.locator("[data-testid=action-list] [data-va=Gem]")).toContainText("40.00 hrs")
  await expect(page.getByTestId("pay-amount")).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Mark Paid/ })).toHaveCount(0)
  await expect(page.getByText("USD to PHP")).toHaveCount(0)
  const text = await page.locator("body").innerText()
  expect(text).not.toMatch(/₱|\$\d/)
  await expect(page.locator("[data-va=Gem]").getByRole("button", { name: "Approve Gem" })).toBeVisible()
  await expect(page.locator("[data-va=Gem]").getByRole("button", { name: "Return for fixes Gem" })).toBeVisible()
  await expectNoPageScroll(page)
  if (testInfo.project.name === "mobile") {
    await page.screenshot({ path: "/opt/cursor/artifacts/payroll-pm-mobile.png", fullPage: false })
  }
})

test("desktop keeps the action list at the top without horizontal scroll", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop layout check")
  await openPayroll(page, "admin")
  const action = await page.getByTestId("needs-action").boundingBox()
  const period = await page.locator("#payroll-period").boundingBox()
  expect(action && period && action.y).toBeGreaterThan(0)
  expect(action!.y).toBeLessThan(420)
  expect(await buckets(page)).toEqual(["approve", "approve", "pay"])
  await page.getByRole("button", { name: "1st – 15th" }).click()
  await expect(page.getByRole("button", { name: "1st – 15th" })).toHaveAttribute("aria-pressed", "true")
  await expectNoPageScroll(page)
  await page.screenshot({ path: "/opt/cursor/artifacts/payroll-admin-desktop.png", fullPage: false })
})
