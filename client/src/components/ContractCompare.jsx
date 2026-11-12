import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { StatusBadge } from './common.jsx'

// The plan's promises on two copies of MugShop side by side: the plan's claim kept, and the plan's claim removed.
export default function ContractCompare({ recordingId, refreshKey, onOpenRun, onRun }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    api('GET', `/contract/compare?recordingId=${recordingId}`).then(setData).catch(() => setData(null))
  }, [recordingId, refreshKey])
  if (!data) return null
  return (
    <div className="table-wrap">
      <h4>What the plan's promise changes</h4>
      <p className="muted small">{data.note}</p>
      <table className="table table--matrix">
        <thead><tr><th>Promise</th>{data.columns.map((c) => <th key={c.id}>{c.label}</th>)}</tr></thead>
        <tbody>
          {data.scenarios.map((s) => (
            <tr key={s.id}>
              <td><strong>{s.id}</strong> <span className="small">{s.title}</span></td>
              {data.columns.map((c) => {
                const r = c.results[s.id]
                return (
                  <td key={c.id}>
                    {r ? <button type="button" className="link" onClick={() => onOpenRun(r.runId)}><StatusBadge status={r.status} /></button> : <span className="muted">not run</span>}
                    {r && <div className="small">{r.headline}{r.precomputed ? ' (precomputed)' : ''}</div>}
                    {(s.id === 'C-DUP' || s.id === 'C-UNK') && <button type="button" className="btn btn--small" onClick={() => onRun(s.id, c.id)}>Run {s.id}</button>}
                    {s.id === 'C-UNK-CAPTURE' && <button type="button" className="btn btn--small" onClick={() => onRun(s.id, c.id)}>Run {s.id}</button>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
