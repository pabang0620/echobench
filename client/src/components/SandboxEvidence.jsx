import { useEffect, useState } from 'react'
import { api } from '../api.js'

// Results measured once on the real PayPal sandbox, shown with their date. Nothing here is run by pressing a button.
export default function SandboxEvidence() {
  const [data, setData] = useState(null)
  useEffect(() => {
    api('GET', '/sandbox-evidence').then(setData).catch(() => setData(null))
  }, [])
  if (!data) return null
  return (
    <div className="evidence-box" aria-label="Measured on the PayPal sandbox">
      <h4>Measured on the PayPal sandbox ({data.measuredAt}) <span className="pill pill--mute">measured, not re-run now</span></h4>
      <p className="muted small">{data.label}</p>
      <ul className="evidence-list">
        {data.items.map((item) => (
          <li key={`${item.id}-${item.claim}`}>
            <span className={`badge badge--${item.result === 'PASS' ? 'good' : 'warn'}`}>{item.result}</span> <strong>{item.id}</strong> {item.claim}
            <div className="small muted">{item.evidence}</div>
          </li>
        ))}
      </ul>
      <p className="muted small">Not run on the sandbox yet: {data.notRunOnTheSandbox.join('; ')}.</p>
    </div>
  )
}
