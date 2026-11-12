// Short names of the judge's rules (server/oracle.js RULES, README "Rules"), used to group the checks.
export const RULE_NAMES = {
  I1: 'one shipment, after capture',
  I2: 'refunds match PayPal',
  I3: 'forgeries change nothing',
  I4: 'final state ignores delivery order',
  I5: 'books settle after a missed event',
  I6: 'old re-delivery changes nothing',
  I7: 'the contract promise holds',
  I8: 'disputed orders are held',
}

export const isFailing = (status) => status === 'red' || status === 'error'

// Counts for the head line: "8 failing, 6 passing, 14 scenarios".
export function countChecks(scenarios = []) {
  const runs = scenarios.map((s) => s.run?.status)
  const failing = runs.filter(isFailing).length
  const passing = runs.filter((s) => s === 'green').length
  const warning = runs.filter((s) => s === 'amber').length
  const notRun = runs.filter((s) => !s || s === 'na' || s === 'notrun').length
  return { failing, passing, warning, notRun, total: scenarios.length }
}

// Checks grouped by the first rule they test, in rule order.
export function groupByRule(scenarios = []) {
  const groups = new Map()
  for (const item of scenarios) {
    const rule = item.scenario.rules[0]
    if (!groups.has(rule)) groups.set(rule, [])
    groups.get(rule).push(item)
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

// Use the same counts as the detailed results when reporting overall coverage.
export function checkSummary({ failing, passing, warning, notRun, total }) {
  if (failing) return { tone: 'red', label: `${failing} failing` }
  if (warning) return { tone: 'none', label: `${warning} warning${warning === 1 ? '' : 's'}` }
  if (!total || notRun === total) return { tone: 'none', label: 'Not run' }
  if (passing === total) return { tone: 'green', label: 'All passing' }
  return { tone: 'none', label: `${passing} of ${total} passing` }
}
