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
      <p className="muted small">Same recording, same scenarios, every target that has been run. Agent-built handlers (plugin off / on) and EverShop appear here after their runs; see VERIFY.md R1 and R2.</p>
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
