import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { RULE_NAMES } from '../rules.js'
import { Evidence, Spinner, StatusIcon } from './common.jsx'
import Diagnosis from './Diagnosis.jsx'
import ProxyStory from './ProxyStory.jsx'
import Timeline from './Timeline.jsx'

function contractNote(run) {
  if (!run.card) return 'This run moves no money. The model has no access to contract runs.'
  if (run.card.environment?.startsWith('PayPal sandbox')) return 'This contract run moved sandbox money (fake money). The model has no access to contract runs.'
  return 'In this run the refund goes to the local PayPal stand-in, no sandbox and no real money. The model has no access to contract runs.'
}

const VERDICT_WORD = { fail: 'failed', warn: 'warning', pass: 'passed', na: 'not applicable' }
const VERDICT_TONE = { fail: 'red', warn: 'amber', pass: 'green' }

// One annotation per rule verdict, failures first: "I1 failed: the mug was shipped 2 times".
function Annotations({ run, summary }) {
  const order = { fail: 0, warn: 1, pass: 2 }
  const verdicts = [...run.verdicts].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))
  return verdicts.map((v, i) => (
    <div key={v.rule} className={`panel anno anno--${VERDICT_TONE[v.status] || 'none'}`}>
      <div className="anno__body">
        <b className="anno__rule">{v.rule} {VERDICT_WORD[v.status] || v.status}:</b> {v.message}
        <p>{i === 0 && summary ? `${summary} ` : ''}Rule: {RULE_NAMES[v.rule] || v.rule}.</p>
        <Evidence title="Evidence" data={v.evidence} />
      </div>
    </div>
  ))
}

// Deliveries as a CI log: line number, HTTP status, label, time. Shipments from the verdict evidence follow in red.
function DeliveryLog({ run }) {
  const first = run.deliveries.find((d) => d.body?.orderId)?.body
  const shipments = run.verdicts.find((v) => v.rule === 'I1' && v.status === 'fail')?.evidence?.shipments || []
  if (!run.deliveries.length && !shipments.length) return null
  return (
    <div className="panel">
      <h3 className="panel__head">Deliveries {first && <small className="mono">order {first.orderId}{first.captureId ? `, capture ${first.captureId}` : ''}</small>}</h3>
      <ol className="log">
        {run.deliveries.map((d, i) => (
          <li key={`d${i}`}>
            <span className="log__ln">{i + 1}</span>
            <span className={Number(d.status) >= 200 && Number(d.status) < 300 ? 'log__ok' : 'log__bad'}>{d.status ?? '-'}</span>
            <span>{d.label}</span>
            <span className="log__ms">{Number.isFinite(d.ms) ? `${d.ms} ms` : ''}</span>
          </li>
        ))}
        {shipments.map((s, i) => (
          <li key={`s${i}`} className="log__bad">
            <span className="log__ln">{run.deliveries.length + i + 1}</span>
            <span>ship</span>
            <span>shipment #{s.id} at {s.at_event}</span>
            <span />
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function FailureCard({ runId, scenarios = [], onChanged, editable }) {
  const [run, setRun] = useState(null)
  const [diagnoses, setDiagnoses] = useState([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [raw, setRaw] = useState(false)

  const load = useCallback(async () => {
    try {
      const [r, d] = await Promise.all([api('GET', `/runs/${runId}`), api('GET', `/agent/for-run/${runId}`)])
      setRun(r)
      setDiagnoses(d)
    } catch (err) {
      setError(err.message)
    }
  }, [runId])

  useEffect(() => {
    load()
  }, [load])

  const wrap = async (label, work) => {
    setBusy(label)
    setError('')
    try {
      await work()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const diagnose = () => wrap('Reading the failure, trying a patch on a copy, type-checking and re-running...', async () => {
    await api('POST', '/agent/diagnose', { runId })
    await load()
  })
  // After Apply the server re-runs every scenario on the patched copy; the card then opens the new run.
  const apply = (id) => wrap('Applying, then re-running every scenario on your patched copy...', async () => {
    const result = await api('POST', `/agent/${id}/apply`, { confirm: true })
    if (!result?.rerun?.run_id) await load()
    await onChanged(result?.rerun?.run_id)
  })

  if (!run) return <div className="panel"><div className="panel__body">{error ? <p className="error">{error}</p> : <Spinner label="Loading" />}</div></div>
  const failing = run.status === 'red' || run.status === 'amber'
  const latest = diagnoses[0]
  const summary = scenarios.find((s) => s.scenario.id === run.scenarioId)?.scenario.summary
  const sub = [run.startPoint, (run.rules || []).join(', '), Number.isFinite(run.durationMs) ? `${run.durationMs} ms` : '', run.resetOk === false ? 'reset failed' : 'reset ok'].filter(Boolean).join(' · ')
  return (
    <article className="card--detail" aria-label={`Result of ${run.scenarioId}`}>
      <div className="dhead">
        <StatusIcon status={run.status} />
        <h2>{run.scenarioId} {run.title}</h2>
        <span className="dhead__sub">{sub}</span>
        {run.precomputed && <span className="pill pill--mute" title="Computed ahead of time against the local stand-in. Press Shake all to run it now.">precomputed</span>}
        <button type="button" className="btn dhead__btn" aria-expanded={raw} onClick={() => setRaw((v) => !v)}>{raw ? 'Hide raw evidence' : 'Show raw evidence'}</button>
      </div>
      <p className={run.verdicts.some((v) => v.message === run.headline) ? 'sr-only' : 'dhead__headline'}>{run.headline}</p>
      {raw && (
        <div className="panel">
          <h3 className="panel__head">Raw evidence <small>deliveries, shop state, PayPal records, proxy log</small></h3>
          <pre className="panel__pre">{JSON.stringify({ deliveries: run.deliveries, shopStateAfter: run.stateAfter, paypalRecords: run.ledger, proxyLog: run.proxyLog, note: run.ledgerFinalNote }, null, 2)}</pre>
        </div>
      )}
      <Annotations run={run} summary={summary} />
      {run.kind === 'contract' && <div className="panel"><ProxyStory story={run.proxyStory} /></div>}
      <div className="panel">
        <h3 className="panel__head">Books vs PayPal's records</h3>
        <Timeline timeline={run.timeline} targetId={run.targetId} caption={`Scenario ${run.scenarioId}: ${run.title}.`} />
      </div>
      <DeliveryLog run={run} />
      {run.kind === 'webhook' && failing && (
        <div className="panel ai">
          <div className="fix">
            <span className="fix__spark" aria-hidden="true">{'✦'}</span>
            <p><b>Explain and fix.</b> The AI step reads this failure, the recorded event and the handler, tries a patch on a copy, runs <span className="mono">tsc</span>, then re-runs every scenario on the copy.</p>
            {busy ? <Spinner label={busy} /> : (
              <button type="button" className="btn btn--primary" onClick={diagnose}>{latest ? 'Explain and fix again' : 'Explain and fix'}</button>
            )}
          </div>
          {latest && <div className="panel__body"><Diagnosis diagnosis={latest} applying={Boolean(busy)} canEdit={editable} onApply={() => apply(latest.id)} /></div>}
        </div>
      )}
      {run.kind === 'contract' && <p className="muted small">{run.confirmedBy ? `Approved by ${run.confirmedBy}. ` : ''}{contractNote(run)}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  )
}
