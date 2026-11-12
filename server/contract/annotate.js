import { PROOF_COLUMN } from './headers.js'

// Which EchoBench scenario proves which plan row. Matched on the Write cell: the SDK operation name,
// or plain "refund" as the plugin-generated plan in targets/ab/sdk-plugin-on writes it.
const ROW_SCENARIOS = {
  'duplicate-claims': [
    { match: /refundCapturedPayment|^refunds?$/i, scenario: 'C-DUP' },
    { match: /captureOrder/i, scenario: 'C-DUP-CAPTURE' },
  ],
  'unknown-outcomes': [
    { match: /refundCapturedPayment|^refunds?$/i, scenario: 'C-UNK' },
    { match: /captureOrder/i, scenario: 'C-UNK-CAPTURE' },
  ],
}

const clean = (cell) => String(cell || '').replace(/`/g, '').trim()

export function scenarioForRow(kind, write) {
  return (ROW_SCENARIOS[kind] || []).find((r) => r.match.test(write))?.scenario || null
}

function proofText(run, scenarioId) {
  if (!scenarioId) return 'not tested'
  if (!run) return `${scenarioId}: not run yet`
  const label = { green: 'GREEN', red: 'RED', amber: 'WARN', na: 'n/a', error: 'ERROR' }[run.status] || run.status
  return `${scenarioId} ${label}: ${run.headline}`
}

// Rows for the Contract tab. results = { scenarioId -> latest run }.
export function contractRows(parsed, results, codeRootMissing = []) {
  const out = []
  for (const table of parsed.tables) {
    if (table.kind === 'unknown') continue
    if (table.kind === 'cross-operation-invariants') {
      for (const row of table.rows) out.push({ kind: table.kind, line: row.line, write: clean(row.cells[table.headers[0]]), cells: row.cells, scenario: null, status: 'readonly', proof: 'read only, not tested' })
      continue
    }
    for (const row of table.rows) {
      const write = clean(row.cells[table.headers[0]])
      const scenario = scenarioForRow(table.kind, write)
      const run = scenario ? results[scenario] : null
      out.push({
        kind: table.kind,
        line: row.line,
        write,
        cells: row.cells,
        scenario,
        status: scenario ? run?.status || 'notrun' : 'untested',
        proof: proofText(run, scenario),
        blocker: parsed.blockers.find((b) => b.line === row.line) || null,
        missingNames: codeRootMissing.filter((m) => m.line === row.line),
      })
    }
  }
  return out
}

// A copy of the plan with the extra column. The original file is not touched.
export function annotatedPlan(markdown, parsed, results) {
  const lines = markdown.split(/\r?\n/)
  for (const table of parsed.tables) {
    if (table.kind === 'unknown' || table.kind === 'cross-operation-invariants') continue
    lines[table.startLine - 1] = `${lines[table.startLine - 1].replace(/\s*\|\s*$/, '')} | ${PROOF_COLUMN} |`
    lines[table.startLine] = `${lines[table.startLine].replace(/\s*\|\s*$/, '')} | --- |`
    for (const row of table.rows) {
      const scenario = scenarioForRow(table.kind, clean(row.cells[table.headers[0]]))
      lines[row.line - 1] = `${lines[row.line - 1].replace(/\s*\|\s*$/, '')} | ${proofText(scenario ? results[scenario] : null, scenario)} |`
    }
  }
  return lines.join('\n')
}
