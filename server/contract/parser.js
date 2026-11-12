import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { HEADER_SETS } from './headers.js'

// Reads paypal-plan.md. Tables are found by their header names. Everything else in the file is ignored.

const clean = (cell) => cell.replace(/`/g, '').replace(/\*\*/g, '').trim()
const norm = (text) => clean(text).toLowerCase().replace(/\s+/g, ' ')

function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

function kindOf(headers) {
  const have = new Set(headers.map(norm))
  for (const [kind, spec] of Object.entries(HEADER_SETS)) {
    const needed = spec.columns.map(norm)
    if (needed.filter((n) => have.has(n)).length >= Math.min(3, needed.length)) return kind
  }
  return 'unknown'
}

export function parsePlan(markdown) {
  const lines = markdown.split(/\r?\n/)
  const tables = []
  let heading = ''
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    if (h) heading = h[1].trim()
    if (!line.trim().startsWith('|') || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '') ) continue
    const headers = splitRow(line).map(clean)
    const rows = []
    let j = i + 2
    for (; j < lines.length && lines[j].trim().startsWith('|'); j += 1) {
      const cells = splitRow(lines[j])
      rows.push({ line: j + 1, cells: Object.fromEntries(headers.map((name, k) => [name, cells[k] ?? ''])) })
    }
    tables.push({ kind: kindOf(headers), heading, headers, startLine: i + 1, endLine: j, rows })
    i = j - 1
  }

  const tbd = []
  for (const table of tables) {
    for (const row of table.rows) {
      for (const [column, value] of Object.entries(row.cells)) {
        if (/\bTBD\b/.test(value)) tbd.push({ table: table.kind, line: row.line, write: firstCell(table, row), column })
      }
    }
  }
  return { tables, tbd, blockers: findBlockers(tables) }
}

const firstCell = (table, row) => clean(row.cells[table.headers[0]] || '')

// A write with no way to find it again is a Blocker (the plugin's own rule).
// Re-reading a lost refund with getRefund cannot work: the refund id was inside the lost reply.
function findBlockers(tables) {
  const blockers = []
  for (const table of tables.filter((t) => t.kind === 'unknown-outcomes')) {
    for (const row of table.rows) {
      const write = firstCell(table, row)
      const reread = clean(row.cells['The operation you re-read with'] || '')
      const reference = clean(row.cells['The reference you search by'] || '')
      if (!reread || /^(none|n\/a|no way|-)$/i.test(reread)) {
        blockers.push({ write, line: row.line, reason: 'No operation listed to find the write again after a lost reply' })
      } else if (/getRefund\b/i.test(reread) && !/request[- ]?id/i.test(reread) && /refund[ _-]?id/i.test(reference || 'refund id')) {
        blockers.push({ write, line: row.line, reason: 'getRefund needs the refund id, which was inside the lost reply. Re-send with the same PayPal-Request-Id or re-read the order instead' })
      }
    }
  }
  return blockers
}

// "src/refunds.ts:requestRefund" -> does the file exist, does the name appear in it?
export function checkCodeNames(parsed, codeRoot) {
  const missing = []
  const seen = new Set()
  for (const table of parsed.tables) {
    for (const row of table.rows) {
      for (const [column, value] of Object.entries(row.cells)) {
        if (!/where in the code|test/i.test(column)) continue
        for (const ref of clean(value).split(/[,;]/).map((r) => r.trim()).filter(Boolean)) {
          const match = /^([\w./-]+\.(?:ts|js|tsx|jsx|mjs))(?::([\w.$]+))?$/.exec(ref)
          if (!match || seen.has(`${row.line}:${ref}`)) continue
          seen.add(`${row.line}:${ref}`)
          const file = path.join(codeRoot, match[1])
          if (!existsSync(file)) missing.push({ line: row.line, ref, reason: 'file not found' })
          else if (match[2] && !readFileSync(file, 'utf8').includes(match[2].split('.').pop())) missing.push({ line: row.line, ref, reason: `name ${match[2]} not found in the file` })
        }
      }
    }
  }
  return missing
}
