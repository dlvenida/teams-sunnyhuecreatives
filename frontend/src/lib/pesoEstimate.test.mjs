import assert from "node:assert/strict"
import test from "node:test"
import { formatPesoEstimate, initialRateInput, parseUsdPhpRate } from "./pesoEstimate.ts"

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

test("a saved blank stays blank, otherwise the admin rate is the default", () => {
  assert.equal(initialRateInput(null, "58.50"), "58.50")
  assert.equal(initialRateInput("", "58.50"), "")
  assert.equal(initialRateInput("60", "58.50"), "60")
  assert.equal(initialRateInput(null, "nope"), "")
})
