import test from 'node:test'
import assert from 'node:assert/strict'
import { countChecks, checkSummary } from '../client/src/rules.js'

const cases = [
  [[], 'Not run'],
  [['notrun'], 'Not run'],
  [['green', null], '1 of 2 passing'],
  [['green', 'amber'], '1 warning'],
  [['error', 'amber'], '1 failing'],
  [['green', 'green'], 'All passing'],
]
for (const [statuses, expected] of cases) {
  test(`overview ${JSON.stringify(statuses)} shows ${expected}`, () => {
    const counts = countChecks(statuses.map(status => ({ run: status ? { status } : null })))
    assert.equal(checkSummary(counts).label, expected)
  })
}
