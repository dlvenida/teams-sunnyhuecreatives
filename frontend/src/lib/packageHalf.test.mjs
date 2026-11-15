import assert from "node:assert/strict"
import test from "node:test"
import {
  calendarHalf,
  halfMonthLabel,
  halfShare,
  resolvePackagePay,
  splitMonthlyPackage,
} from "./packageHalf.ts"

const KYLA = [
  ["Ever After Numbers", 4666.68],
  ["Krysten Mack Perez | ASC", 2333.34],
  ["Joshua Fox", 2000],
  ["The Apolonia-on-Main", 1166.67],
  ["Morgan King", 1166.67],
]

test("even and odd monthly packages split so the two halves add up", () => {
  const even = splitMonthlyPackage(2000)
  assert.deepEqual(even, { first: 1000, second: 1000 })
  assert.equal(even.first + even.second, 2000)

  const odd = splitMonthlyPackage(1166.67)
  assert.deepEqual(odd, { first: 583.33, second: 583.34 })
  assert.equal(Math.round((odd.first + odd.second) * 100), 116667)

  const kyla = splitMonthlyPackage(11333.36)
  assert.deepEqual(kyla, { first: 5666.68, second: 5666.68 })
  assert.equal(Math.round((kyla.first + kyla.second) * 100), 1133336)

  const angeline = splitMonthlyPackage(8400)
  assert.deepEqual(angeline, { first: 4200, second: 4200 })
})

test("a half period uses that half, and a full month does not halve the already-halved figure", () => {
  assert.equal(calendarHalf("2026-11-01", "2026-11-15"), "first")
  assert.equal(calendarHalf("2026-11-16", "2026-11-30"), "second")
  assert.equal(calendarHalf("2026-11-01", "2026-11-30"), null)
  assert.equal(calendarHalf("2026-02-16", "2026-02-28"), "second")

  assert.equal(halfShare(2000, "2026-11-01", "2026-11-15"), 1000)
  assert.equal(halfShare(1166.67, "2026-11-16", "2026-11-30"), 583.34)
  assert.equal(halfShare(2000, "2026-11-01", "2026-11-30"), 1000)
})

test("1st-15th defaults to half of the monthly rate, not half of a half", () => {
  const biweekly = resolvePackagePay({
    monthly: 2000,
    calculated: 1000,
    periodStart: "2026-11-01",
    periodEnd: "2026-11-15",
  })
  assert.equal(biweekly.choice, "half")
  assert.equal(biweekly.amount, 1000)
  assert.equal(biweekly.skipped, false)

  const monthlySchedule = resolvePackagePay({
    monthly: 8400,
    calculated: 8400,
    periodStart: "2026-11-01",
    periodEnd: "2026-11-15",
  })
  assert.equal(monthlySchedule.choice, "half")
  assert.equal(monthlySchedule.amount, 4200)
})

test("16th-end defaults to the remainder, and This Month stays the full package", () => {
  const second = resolvePackagePay({
    monthly: 1166.67,
    calculated: 583.34,
    periodStart: "2026-11-16",
    periodEnd: "2026-11-30",
  })
  assert.equal(second.amount, 583.34)
  assert.equal(second.choice, "half")

  const whole = resolvePackagePay({
    monthly: 2000,
    calculated: 2000,
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
  })
  assert.equal(whole.choice, "full")
  assert.equal(whole.amount, 2000)
})

test("Full and Skip are one tap, and a saved skip stays skipped", () => {
  const full = resolvePackagePay({
    monthly: 2000,
    calculated: 1000,
    periodStart: "2026-11-01",
    periodEnd: "2026-11-15",
    choice: "full",
  })
  assert.equal(full.amount, 2000)
  assert.equal(full.skipped, false)

  const skip = resolvePackagePay({
    monthly: 2333.34,
    calculated: 2333.34,
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    choice: "skip",
  })
  assert.equal(skip.skipped, true)
  assert.equal(skip.amount, 0)

  const savedSkip = resolvePackagePay({
    monthly: 2000,
    calculated: 1000,
    periodStart: "2026-11-01",
    periodEnd: "2026-11-15",
    skipped: true,
  })
  assert.equal(savedSkip.choice, "skip")
  assert.equal(savedSkip.amount, 0)
})

test("Kyla's clients: each half of the month adds back to 11333.36", () => {
  let first = 0
  let second = 0
  for (const [, monthly] of KYLA) {
    first += resolvePackagePay({
      monthly,
      calculated: monthly,
      periodStart: "2026-11-01",
      periodEnd: "2026-11-15",
    }).amount
    second += resolvePackagePay({
      monthly,
      calculated: monthly,
      periodStart: "2026-11-16",
      periodEnd: "2026-11-30",
    }).amount
  }
  assert.equal(Math.round(first * 100), 566667)
  assert.equal(Math.round(second * 100), 566669)
  assert.equal(Math.round((first + second) * 100), 1133336)
})

test("the half label shows the monthly total", () => {
  assert.equal(halfMonthLabel(11333.36, "PHP"), "Half of ₱11,333.36 monthly")
  assert.equal(halfMonthLabel(8400, "PHP"), "Half of ₱8,400.00 monthly")
  assert.equal(halfMonthLabel(2000, "USD"), "Half of $2,000.00 monthly")
})

test("a typed amount stays as typed", () => {
  const typed = resolvePackagePay({
    monthly: 2000,
    calculated: 1000,
    periodStart: "2026-11-01",
    periodEnd: "2026-11-15",
    choice: "custom",
    customAmount: 750,
  })
  assert.equal(typed.choice, "custom")
  assert.equal(typed.amount, 750)
  assert.equal(typed.skipped, false)
})
