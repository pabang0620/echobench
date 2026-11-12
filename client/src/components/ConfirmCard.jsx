import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Md } from './common.jsx'

// The approval gate before a contract scenario that moves money. Nothing runs until "Approve and run" is pressed.
// Everything shown comes from the card the server issued, the scenario definition, the plan row and the recorded sandbox evidence.
function Measured({ scenarioId, targetId }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    api('GET', '/sandbox-evidence').then(setData).catch(() => setData(null))
  }, [])
  if (!data) return null
  // The sandbox results for this scenario on this kind of target (the contrast copy has its own lines).
  const contrast = targetId.includes('contrast')
  const items = data.items.filter((item) => (scenarioId === 'C-UNK' && item.id === 'V5') || (item.claim.startsWith(`${scenarioId} `) && item.claim.includes('contrast') === contrast))
  if (!items.length) return null
  return (
    <div className="panel">
      <h3 className="panel__head">Already measured <small>{[...new Set(items.map((i) => i.id))].join(', ')}</small></h3>
      <ul className="measured">
        {items.map((item) => (
          <li key={item.claim}>
            <span className={`badge badge--${item.result === 'PASS' || item.result === 'GREEN' ? 'good' : item.result === 'RED' ? 'bad' : 'warn'}`}>{item.result}</span> {item.claim}
            <div className="small muted">{item.evidence}</div>
          </li>
        ))}
      </ul>
      <p className="panel__body small muted"><em>Measured on the PayPal sandbox on {data.measuredAt}, not re-run now.</em></p>
    </div>
  )
}

export default function ConfirmCard({ card, scenario, planRow, onRun, onCancel, busy }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    ref.current?.focus()
  }, [])
  const steps = scenario?.steps || []
  const expires = new Date(card.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const initials = String(card.operator).slice(0, 3)
  const code = planRow?.cells?.['Where in the code']
  const reference = planRow?.cells?.['The reference you search by'] || planRow?.cells?.['Where the claim is stored']
  return (
    <div className="gate" ref={ref} tabIndex={-1} role="region" aria-labelledby="confirm-title">
      <div className="gate__main">
        <div className="banner">
          <span className="banner__clock" aria-hidden="true">{'⧗'}</span>
          <div className="banner__text">
            <b id="confirm-title">{card.scenarioId} is waiting for your approval</b>
            <p>{card.text} Expires at {expires} (5 minutes), works once.</p>
          </div>
          <div className="banner__btns">
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>Reject</button>
            <button type="button" className="btn btn--green" onClick={onRun} disabled={busy}>{busy ? 'Running...' : 'Approve and run'}</button>
          </div>
        </div>
        <div className="panel sumgrid">
          <div>
            <small>Refund amount</small>
            <span className="sumgrid__big">{card.amount}<span>{card.currency}</span></span>
            {card.attempts > 1 && <div className="small muted">up to {card.attempts} attempts</div>}
          </div>
          <div><small>Capture</small><span className="mono">{card.captureId}</span></div>
          <div><small>Environment</small>{card.environment}</div>
        </div>
        <div className="panel">
          <h3 className="panel__head">Steps this run will take <small>{card.title}</small></h3>
          <ol className="jobs">
            {steps.map((s) => (
              <li key={s} className={`job${/cut/.test(s) ? ' job--cut' : ''}`}><span className="job__dot" aria-hidden="true" /><span>{s}</span></li>
            ))}
          </ol>
          <div className="req mono">
            POST /v2/payments/captures/{card.captureId}/refund{card.attempts > 1 ? ` x${card.attempts}` : ''}
            {reference && <> · <Md text={reference} /></>}
            {code && <> · code <Md text={code} /></>}
          </div>
        </div>
      </div>
      <aside className="gate__side">
        <div className="panel">
          <h3 className="panel__head">Reviewer</h3>
          <div className="rev">
            <span className="rev__av" aria-hidden="true">{initials}</span>
            <div><b>{card.operator}</b><small>Required. The model has no access to contract runs.</small></div>
          </div>
          <p className="rev__rule">The amount is set in EchoBench's code, not by a model. This card works once and expires in 5 minutes.</p>
        </div>
        {scenario && (
          <div className="panel">
            <h3 className="panel__head">Passes when</h3>
            <p className="passcrit">{scenario.summary} (rule {scenario.rules.join(', ')}: the contract promise holds)</p>
          </div>
        )}
        <Measured scenarioId={card.scenarioId} targetId={card.targetId} />
      </aside>
    </div>
  )
}
