import assert from "node:assert/strict"
import test from "node:test"
import { formatPesoEstimate, initialRateInput, parseUsdPhpRate, pesoEstimatePlan } from "./pesoEstimate.ts"

test("58.50 turns 171.19 dollars into PHP 10,014.62", () => {
  assert.equal(formatPesoEstimate("171.19", 58.5), "≈ PHP 10,014.62")
})

test("empty, zero, and junk rates hide the peso line", () => {
  assert.equal(parseUsdPhpRate(""), null)
  assert.equal(parseUsdPhpRate("  "), null)
  assert.equal(parseUsdPhpRate("abc"), null)
  assert.equal(parseUsdPhpRate("0"), null)
  assert.equal(parseUsdPhpRate("-3"), null)
  assert.equal(formatPesoEstimate(171.19, null), null)
  assert.equal(formatPesoEstimate("nope", 58.5), null)
  assert.equal(formatPesoEstimate(171.19, Number.NaN), null)
})

test("a PHP-only VA or Project Manager sees no field, no disclaimer, and no peso lines", () => {
  const phpAmounts = [
    { id: "range", currency: "PHP", amount: "5666.67" },
    { id: "week", currency: "PHP", amount: "1000.00" },
    { id: "month", currency: "PHP", amount: "5666.67" },
    { id: "client", currency: "PHP", amount: "5666.67" },
    { id: "grand", currency: "PHP", amount: "5666.67" },
  ]
  for (const plan of [pesoEstimatePlan(phpAmounts, 58.5), pesoEstimatePlan(phpAmounts, null)]) {
    assert.equal(plan.showField, false)
    assert.equal(plan.showDisclaimer, false)
    assert.deepEqual(plan.lines, [])
  }
  assert.equal(pesoEstimatePlan([], 58.5).showField, false)
})

test("mixed currencies put a peso line only on the USD amounts", () => {
  const plan = pesoEstimatePlan([
    { id: "range", currency: "PHP", amount: "1000.00" },
    { id: "php-client", currency: "PHP", amount: "500.00" },
    { id: "usd-client", currency: "USD", amount: "171.19" },
    { id: "grand", currency: "PHP", amount: "1500.00" },
  ], 58.5)
  assert.equal(plan.showField, true)
  assert.equal(plan.showDisclaimer, true)
  assert.deepEqual(plan.lines, [{ id: "usd-client", text: "≈ PHP 10,014.62" }])
})

test("a saved blank stays blank, otherwise the admin rate is the default", () => {
  assert.equal(initialRateInput(null, "58.50"), "58.50")
  assert.equal(initialRateInput("", "58.50"), "")
  assert.equal(initialRateInput("60", "58.50"), "60")
  assert.equal(initialRateInput(null, "nope"), "")
})
