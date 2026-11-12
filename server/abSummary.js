// The A/B result in words, computed from the matrix columns so the tab, the README and the DEVPOST
// cannot say something the table does not show (REVIEW_4 defect 1: the tab said the opposite).

export const AB_ROUNDS = [
  { id: 'sdk', label: 'Round 2, SDK-named request', off: 'ab-sdk-plugin-off', on: 'ab-sdk-plugin-on' },
  { id: 'r1', label: 'Round 1, "a PayPal checkout"', off: 'ab-plugin-off', on: 'ab-plugin-on' },
]

const greens = (column) => Object.entries(column.results).filter(([, r]) => r.status === 'green').map(([id]) => id)

// One round: green counts, rows only one side passes, rows both fail. Null when a column has no runs.
export function summarizeRound(columns, round, scenarioOrder) {
  const off = columns.find((c) => c.id === round.off)
  const on = columns.find((c) => c.id === round.on)
  if (!off || !on || !Object.keys(off.results).length || !Object.keys(on.results).length) return null
  const order = (ids) => [...ids].sort((a, b) => scenarioOrder.indexOf(a) - scenarioOrder.indexOf(b))
  const offGreen = new Set(greens(off))
  const onGreen = new Set(greens(on))
  const both = scenarioOrder.filter((id) => off.results[id]?.status === 'red' && on.results[id]?.status === 'red')
  const onlyOn = order([...onGreen].filter((id) => !offGreen.has(id)))
  const onlyOff = order([...offGreen].filter((id) => !onGreen.has(id)))
  const verdict = onGreen.size > offGreen.size ? 'plugin on scored better' : onGreen.size < offGreen.size ? 'plugin off scored better' : 'same score'
  return { id: round.id, label: round.label, off: round.off, on: round.on, offGreen: offGreen.size, onGreen: onGreen.size, total: scenarioOrder.length, onlyOn, onlyOff, bothRed: both, verdict }
}

const list = (ids) => (ids.length ? ids.join(', ') : 'none')

// The three lines the A/B tab shows for a round.
export function roundLines(s) {
  return [
    `Plugin on ${s.onGreen} green, plugin off ${s.offGreen} green, of ${s.total} scenarios: ${s.verdict}.`,
    `Only plugin on passes: ${list(s.onlyOn)}. Only plugin off passes: ${list(s.onlyOff)}. Both red: ${list(s.bothRed)}.`,
    'One generation per arm: one measured sample, not a rate.',
  ]
}

export function summarizeAb(columns, scenarioOrder) {
  return AB_ROUNDS.map((round) => summarizeRound(columns, round, scenarioOrder)).filter(Boolean).map((s) => ({ ...s, lines: roundLines(s) }))
}
