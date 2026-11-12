import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { StatusBadge } from './common.jsx'

// Targets side by side. This is where the plugin off/on handlers (R2) and EverShop (R1) show up once they have been run.
export default function MatrixTab({ recordingId, refreshKey, onOpenRun }) {
  const [matrix, setMatrix] = useState(null)
  useEffect(() => {
    api('GET', `/matrix?recordingId=${recordingId}`).then(setMatrix).catch(() => setMatrix(null))
  }, [recordingId, refreshKey])
  if (!matrix) return null
  const columns = matrix.columns.filter((c) => Object.keys(c.results).length > 0 || c.group)
  // Round 2 rows only one side passes, marked so the difference is visible in the table itself.
  const round2 = (matrix.abSummary || []).find((s) => s.id === 'sdk')
  const marks = {}
  for (const id of round2?.onlyOn || []) marks[id] = 'round 2: only plugin on passes'
  for (const id of round2?.onlyOff || []) marks[id] = 'round 2: only plugin off passes'
  return (
    <div>
      <p className="muted small">Same purchase, same scenarios, every target that has been run. R2: one request text given twice to Claude Code (claude-sonnet-5-5, 2026-11-12, local account), without and with the APIMatic Context Plugin 0.4.1, code not edited afterwards (logs in targets/ab/*/GENERATION_LOG.md). Round 2 names the Paypal TypeScript SDK the way the plugin's skill does; there the plugin-on model loaded 5 plugin skills and wrote a paypal-plan.md (Contract tab, that target). In round 1 the model opened no plugin skill, so round 1 compares two handlers, not the plugin.</p>
      {(matrix.abSummary || []).map((s) => (
        <div key={s.id}>
          <p className="small"><strong>{s.label}</strong> (measured, computed from the table below)</p>
          <ul className="small">{s.lines.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      ))}
      <p className="muted small">Each handler runs on its own recording of the same purchase on the local PayPal stand-in. EverShop (R1) is the unmodified open-source shop (2.4.0, commit 25cf1e8): purchase and both refunds made inside EverShop on the local stand-in, PostgreSQL restored from a template on every run; results measured and pending maintainer review.</p>
      <div className="table-wrap">
        <table className="table table--matrix">
          <thead><tr><th>Scenario</th>{columns.map((c) => <th key={c.id}>{c.label}</th>)}</tr></thead>
          <tbody>
            {matrix.scenarios.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.id}</strong> <span className="small">{s.title}</span>{marks[s.id] ? <span className="small muted"> ({marks[s.id]})</span> : null}</td>
                {columns.map((c) => {
                  const r = c.results[s.id]
                  return <td key={c.id}>{r ? <button type="button" className="link" onClick={() => onOpenRun(r.runId)}><StatusBadge status={r.status} /></button> : <span className="muted">-</span>}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
