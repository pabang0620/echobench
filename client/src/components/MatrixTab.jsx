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
  return (
    <div>
      <p className="muted small">Same purchase, same scenarios, every target that has been run. The two agent-built handlers are R2: one request text given twice to Claude Code (claude-sonnet-5-5, 2026-11-12), once without and once with the APIMatic Context Plugin 0.4.1 loaded, code not edited afterwards (logs in targets/ab/*/GENERATION_LOG.md). Each handler keeps its own database, so each is run on its own recording of the same purchase on the local PayPal stand-in. In the plugin-on run the model did not open any plugin skill and both handlers call PayPal REST with fetch, so this table compares two handlers, it does not prove a plugin effect. EverShop (R1) is not run.</p>
      <div className="table-wrap">
        <table className="table table--matrix">
          <thead><tr><th>Scenario</th>{columns.map((c) => <th key={c.id}>{c.label}</th>)}</tr></thead>
          <tbody>
            {matrix.scenarios.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.id}</strong> <span className="small">{s.title}</span></td>
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
