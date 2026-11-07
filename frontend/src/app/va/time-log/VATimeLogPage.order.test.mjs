import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("./VATimeLogPage.tsx", import.meta.url), "utf8")
const markup = source.slice(source.indexOf("return ("))

function at(marker) {
  const index = markup.indexOf(marker)
  assert.notEqual(index, -1, `missing ${marker}`)
  return index
}

test("a VA log time page starts with the form, then Your entries by week", () => {
  const form = at("<CardTitle>New Entry</CardTitle>")
  const week = at("<CardTitle>Your entries by week</CardTitle>")
  const hint = at("Rate auto-fills from your approved My Rates profile.")
  const pay = at("<MyProductivity />")
  const submit = at("Submit Entry")

  assert.ok(form < submit, "Submit Entry stays inside the form")
  assert.ok(submit < week, "the form stays above Your entries by week")
  assert.ok(week < hint, "the rate note stays below Your entries by week")
  assert.ok(hint < pay, "pay, productivity, and due cards stay below the form and weekly entries")
  assert.equal(markup.includes(">Log time</h1>"), false)

  const beforeForm = markup.slice(0, form)
  for (const blocked of ["MyProductivity", "Your entries by week", "Rate auto-fills", "Your pay", "This week", "Overdue"]) {
    assert.equal(beforeForm.includes(blocked), false, `${blocked} is above the form`)
  }
})

test("the log form keeps the fields Jane uses", () => {
  for (const label of [
    ">Date<",
    ">Client<",
    ">Task name<",
    ">Project<",
    ">My Task<",
    ">Total Hours<",
    ">Your Rate<",
    ">Estimated Pay<",
    ">Description of the work<",
    ">Notes (optional)<",
    "Submit Entry",
  ]) {
    assert.ok(markup.includes(label), `form is missing ${label}`)
  }
  assert.equal(markup.includes("<CardTitle>Your entries by wee<"), false)
})
