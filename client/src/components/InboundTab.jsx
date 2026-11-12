import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Evidence, Md } from './common.jsx'

export default function InboundTab({ recordingId, targetId, refreshKey }) {
  const [table, setTable] = useState(null)
  useEffect(() => {
    api('GET', `/inbound?recordingId=${recordingId}&targetId=${targetId}`).then(setTable).catch(() => setTable(null))
  }, [recordingId, targetId, refreshKey])
  if (!table) return null
  return (
    <div>
      <p className="muted small">Webhooks are outside the SDK, so the plugin's plan has no table for them. This one is EchoBench's own proposal. {table.markdown.includes('| TBD |') ? "For this target the two TBD cells are yours to fill from your handler's code." : "The two middle cells are read from this target's own code."}</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>{table.header.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.event}>
                <td className="mono">{r.event}</td><td>{r.dedupKey}</td><td className="small"><Md text={r.whereStored} /></td><td className="small"><Md text={r.whatRejects} /></td><td>{r.settleWith}</td><td>{r.proof}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Evidence title="Markdown to paste next to paypal-plan.md" data={table.markdown} />
    </div>
  )
}
