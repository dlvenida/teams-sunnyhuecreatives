import { expect, test, type Page, type Route } from "@playwright/test"

const submitted = {
  id: "log-new",
  work_date: "2026-11-12",
  va_id: "va-1",
  va_name: "Arby Mae L.",
  client_id: "client-1",
  client_name: "Chef Stephanie Tranchina",
  description_plain: "Instagram comments",
  hours: "1.00",
  va_rate: "10.00",
  va_pay: "10.00",
  status: "submitted",
  source: "manual",
  created_at: "2026-11-12T08:00:00Z",
  needs_fixing: null,
  rejection_history: [],
}

const oldRejected = {
  id: "log-old",
  work_date: "2026-11-02",
  va_id: "va-1",
  va_name: "Arby Mae L.",
  client_id: "client-1",
  client_name: "Chef Stephanie Tranchina",
  description_plain: "Older screenshots",
  hours: "1.00",
  va_rate: "10.00",
  va_pay: "10.00",
  status: "rejected",
  source: "manual",
  created_at: "2026-11-02T08:00:00Z",
  needs_fixing: "No reason given",
  rejection_history: [],
}

async function installApi(page: Page, role: "admin" | "va") {
  const logs = [submitted, { ...oldRejected }]
  await page.addInitScript((user) => {
    localStorage.setItem("access_token", "test-access")
    localStorage.setItem("refresh_token", "test-refresh")
    if (!localStorage.getItem("auth_user")) localStorage.setItem("auth_user", JSON.stringify(user))
  }, { role, name: role === "admin" ? "Jane" : "Arby Mae L.", userId: "user-1", vaId: "va-1" })

  await page.route("http://localhost:8090/**", async (route: Route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    })
    if (path === "/profile/photo") return route.fulfill({ status: 404, body: "" })
    if (path === "/profile/me") {
      return json({ id: "profile", email: "jane@example.com", role, display_name: role === "admin" ? "Jane" : "Arby Mae L.", has_profile_photo: false, must_change_password: false })
    }
    if (path.startsWith("/notifications")) return json({ items: [], unread: 0, total: 0 })
    if (path === "/time-clock/current") return json(null)
    if (path === "/time-clock/live" || path === "/time-clock") return json([])
    if (path === "/auth/users") return json([])
    if (path === "/settings/display") {
      return json({ hide_pricing: false, booking_url: "", booking_hide_pricing: true, default_va_hourly_rate: "75" })
    }
    if (path === "/clients" || path === "/va/clients") return json([{ id: "client-1", name: "Chef Stephanie Tranchina", billing_type: "hourly", default_rate: null, is_active: true }])
    if (path === "/vas") return json([{ id: "va-1", name: "Arby Mae L.", currency: "PHP", is_active: true }])
    if (path === "/tasks" || path.startsWith("/projects") || path.startsWith("/va/sub-clients")) return json([])
    if (path === "/va/month-pay") {
      return json({ month_label: "November 2026", month_pay: "0.00", month_hours: "0", period_label: "Nov 1 to Nov 15", period_pay: "0.00", period_hours: "0", currency: "PHP" })
    }
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
        team_load: [],
        tomorrow_tasks: [],
      })
    }
    if (path === "/dashboard/summary") {
      return json({ pending_logs: [], pending_entries: 0, approved_hours: "0", active_clients: 0, active_vas: 0, total_invoiced: "0", paid_by_clients: "0", total_va_payout: "0", estimated_profit: "0", this_week_va_pay: "0", invoices_issued: 0, hours_by_client: [], va_pay_this_week: [] })
    }
    if (path === "/dashboard/productivity") {
      return json({
        va_name: "Arby Mae L.",
        percentage: 0,
        status: "no_hours",
        status_label: "No hours yet",
        summary: "Nothing logged yet.",
        days_logged: 0,
        expected_workdays: 5,
        hours_this_week: "0",
        tasks_done_this_week: 0,
        tasks_open: 0,
        week_start: "2026-11-09",
        week_end: "2026-11-15",
        counts: { overdue: 0, due_today: 0, due_soon: 0, pending: 0, timesheet: 0, still_open: 0 },
        dues: { overdue: [], due_today: [], due_soon: [], pending: [], timesheets: [] },
      })
    }
    const reject = path.match(/^\/work-logs\/([^/]+)\/reject$/)
    if (reject && method === "POST") {
      const body = route.request().postDataJSON() as { reasons?: string[]; note?: string | null }
      if (!body.reasons?.length) return json({ detail: "Pick at least one reason." }, 400)
      const row = logs.find((item) => item.id === reject[1])
      if (!row) return json({ detail: "missing" }, 404)
      const note = (body.note || "").trim()
      const needs = note ? `Needs fixing: ${body.reasons.join(", ")}. Note: ${note}` : `Needs fixing: ${body.reasons.join(", ")}.`
      const history = {
        reasons: body.reasons,
        note: note || null,
        rejected_by_name: "Jane",
        rejected_at: "2026-11-15T04:00:00Z",
        needs_fixing: needs,
        last_sent_back: note ? `Last sent back: ${body.reasons.join(", ")}. Note: ${note}` : `Last sent back: ${body.reasons.join(", ")}.`,
      }
      row.status = "rejected"
      row.needs_fixing = needs
      row.rejection_history = [history]
      return json(row)
    }
    if (path === "/va/work-logs" && method === "PATCH" || path.match(/^\/va\/work-logs\/[^/]+$/) && method === "PATCH") {
      const id = path.split("/").pop()
      const row = logs.find((item) => item.id === id)
      if (!row) return json({ detail: "missing" }, 404)
      row.status = "submitted"
      row.needs_fixing = null
      return json(row)
    }
    if (path === "/work-logs" || path === "/va/work-logs") return json(logs)
    return json([])
  })
}

test("reject needs a reason, the VA sees it, and an old entry still loads", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()) })
  page.on("pageerror", (err) => errors.push(String(err)))
  await installApi(page, "admin")
  await page.goto("/admin/logs")
  await expect(page.getByRole("heading", { name: "Review logs" })).toBeVisible()
  await expect(page.getByText("No reason given")).toBeVisible()
  await page.getByRole("button", { name: "Reject", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("button", { name: "Reject" })).toBeDisabled()
  if (testInfo.project.name === "mobile") {
    await page.screenshot({ path: "/opt/cursor/artifacts/reject-reason-prompt-mobile.png" })
  }
  await dialog.getByRole("button", { name: "Cropped or blurry" }).click()
  await dialog.getByRole("button", { name: "Wrong client" }).click()
  await dialog.getByLabel("Optional note").fill("The top of the chat is cut off.")
  await expect(dialog.getByRole("button", { name: "Reject" })).toBeEnabled()
  await dialog.getByRole("button", { name: "Reject" }).click()
  await expect(page.getByText("Needs fixing: Cropped or blurry, Wrong client. Note: The top of the chat is cut off.")).toBeVisible()
  if (testInfo.project.name === "mobile") {
    await page.screenshot({ path: "/opt/cursor/artifacts/review-list-after-reject-mobile.png", fullPage: true })
  }

  await page.evaluate(() => {
    localStorage.setItem("auth_user", JSON.stringify({ role: "va", name: "Arby Mae L.", userId: "user-1", vaId: "va-1" }))
  })
  await page.goto("/va/time-log")
  await expect(page.getByText("Needs fixing: Cropped or blurry, Wrong client. Note: The top of the chat is cut off.")).toBeVisible()
  await expect(page.getByText("No reason given")).toBeVisible()
  if (testInfo.project.name === "mobile") {
    await page.screenshot({ path: "/opt/cursor/artifacts/va-reject-reason-mobile.png", fullPage: true })
  }

  const fixing = page.getByText("Needs fixing: Cropped or blurry, Wrong client. Note: The top of the chat is cut off.")
  await fixing.locator("xpath=ancestor::tr").getByRole("button", { name: "Edit" }).click()
  await page.getByRole("button", { name: "Save" }).click()
  await expect(fixing).toHaveCount(0)
  await expect(page.getByText("No reason given")).toBeVisible()

  expect(errors.filter((line) => !line.includes("favicon"))).toEqual([])
})
