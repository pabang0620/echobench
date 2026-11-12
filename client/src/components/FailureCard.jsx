import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { Evidence, Spinner, StatusBadge } from './common.jsx'
import ProxyStory from './ProxyStory.jsx'
import Timeline from './Timeline.jsx'

function Diff({ text }) {
  return (
    <pre className="diff" aria-label="Proposed patch">
      {text.split('\n').map((line, i) => (
        <span key={i} className={line.startsWith('+') && !line.startsWith('+++') ? 'diff__add' : line.startsWith('-') && !line.startsWith('---') ? 'diff__del' : line.startsWith('@@') ? 'diff__hunk' : ''}>{line}{'\n'}</span>
      ))}
    </pre>
  )
}

function contractNote(run) {
  if (!run.card) return 'This run moves no money. The model has no access to contract runs.'
  if (run.card.environment?.startsWith('PayPal sandbox')) return 'This contract run moved sandbox money (fake money). The model has no access to contract runs.'
  return 'In this run the refund goes to the local PayPal stand-in, no sandbox and no real money. The model has no access to contract runs.'
}

function modelBadge(d) {
  const source = d.explanation.source || d.explanation.modelName || 'the model'
  if (d.mode === 'mock') return { tone: 'amber', text: 'Mocked model output' }
  if (d.mode === 'recorded') return { tone: 'good', text: `Recorded live run: ${d.recorded.source}, ${d.recorded.recordedAt}` }
  return { tone: 'good', text: `Written by ${source}` }
}

function Diagnosis({ diagnosis, applying, onApply, canEdit }) {
  const c = diagnosis.candidate
  const badge = modelBadge(diagnosis)
  const real = diagnosis.mode !== 'mock'
  const modelCalls = diagnosis.mode === 'recorded' ? diagnosis.recorded.toolCalls : diagnosis.modelCalls || []
  const suite = c?.suite || []
  const suiteGreen = suite.filter((s) => s.status === 'green' || s.status === 'amber').length
  return (
    <div className="diag">
      <div className="diag__meta">
        <span className={`pill pill--${badge.tone}`}>{badge.text}</span>
        {diagnosis.mode === 'recorded' && <span className="pill pill--mute">replayed without a key; tsc and the re-runs below are run again now</span>}
        {diagnosis.precomputed && <span className="pill pill--mute">precomputed</span>}
        {diagnosis.fallbackReason && <span className="pill pill--amber">model unavailable, fell back to mocked output</span>}
      </div>
      {!real ? (
        <>
          <h4>What went wrong (scripted text, no model wrote this)</h4>
          <ul>{diagnosis.explanation.cause.map((t, i) => <li key={i}>{t}</li>)}</ul>
          {diagnosis.explanation.fix.length > 0 && (<><h4>The fix (scripted text)</h4><ul>{diagnosis.explanation.fix.map((t, i) => <li key={i}>{t}</li>)}</ul></>)}
        </>
      ) : (
        <>
          <h4>Explanation from {diagnosis.explanation.source || diagnosis.explanation.modelName || 'the model'}{diagnosis.mode === 'recorded' ? ` (${diagnosis.recorded.model}, recorded ${diagnosis.recorded.recordedAt})` : ''}</h4>
          {diagnosis.explanation.model ? <p className="model-text">{diagnosis.explanation.model}</p> : <p className="muted">The model returned no explanation text.</p>}
          {diagnosis.explanation.evidence?.length > 0 && <Evidence title="Judge's verdicts (EchoBench, not the model)" data={diagnosis.explanation.evidence.join('\n')} />}
        </>
      )}
      {c ? (
        <>
          <div className="diag__badges">
            <span className={`badge badge--${c.tscOk ? 'good' : 'bad'}`}>tsc {c.tscOk ? 'passed' : 'failed'}</span>
            {c.rerun && <span className={`badge badge--${c.rerun.status === 'green' || c.rerun.status === 'amber' ? 'good' : 'bad'}`}>copy re-run {c.rerun.status.toUpperCase()}</span>}
            {suite.length > 0 && <span className="badge badge--good">{suiteGreen}/{suite.length} scenarios pass on the copy</span>}
          </div>
          {c.tscOk ? <Diff text={c.diff} /> : <Evidence title="tsc output" data={c.tsc} />}
          <div className="diag__actions">
            {c.applied ? <span className="badge badge--good">Applied to the MugShop working copy</span> : (
              <button type="button" className="btn btn--primary" disabled={!canEdit || !c.verified || !c.dir || applying} onClick={onApply}>
                Apply to the MugShop working copy
              </button>
            )}
            {!c.dir && !c.applied && <span className="muted small">This patch was computed ahead of time. Press "Explain and fix again" to get one you can apply.</span>}
            {c.dir && !c.verified && <span className="muted small">Only a patch that passes tsc and turns the scenario green, checked by EchoBench's own re-run, can be applied.</span>}
          </div>
        </>
      ) : <p className="muted">No patch for this target. A real model run (LLM_BACKEND=account or ANTHROPIC_API_KEY) can write one.</p>}
      {modelCalls.length > 0 && <Evidence title={`Tool calls the model made, in order (${modelCalls.length})`} data={modelCalls.map((m, i) => `${i + 1}. ${m.tool}${m.summary ? ` ${m.summary}` : ''}`).join('\n')} />}
      <Evidence title="Tool steps run by this server (real tools, tsc, re-runs)" data={diagnosis.steps.map((s) => `${s.tool}: ${s.summary}`).join('\n')} />
    </div>
  )
}

export default function FailureCard({ runId, onChanged, onClose, editable }) {
  const [run, setRun] = useState(null)
  const [diagnoses, setDiagnoses] = useState([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

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
  const apply = (id) => wrap('Applying and re-running the scenario...', async () => {
    await api('POST', `/agent/${id}/apply`, { confirm: true })
    await load()
    onChanged()
  })

  if (!run) return <section className="card">{error ? <p className="error">{error}</p> : <Spinner label="Loading" />}</section>
  const failing = run.status === 'red' || run.status === 'amber'
  const latest = diagnoses[0]
  return (
    <section className="card card--detail" aria-label={`Result of ${run.scenarioId}`}>
      <div className="card__head">
        <div>
          <h3>{run.scenarioId} {run.title}</h3>
          <p>{run.headline}</p>
        </div>
        <div className="card__head-actions">
          <StatusBadge status={run.status} />
          <button type="button" className="btn btn--small" onClick={onClose}>Close</button>
        </div>
      </div>
      <Timeline timeline={run.timeline} targetId={run.targetId} caption={`Scenario ${run.scenarioId}: ${run.title}.`} />
      <ul className="verdicts">
        {run.verdicts.map((v) => (
          <li key={v.rule}>
            <StatusBadge status={v.status} /> <strong>{v.rule}</strong> {v.message}
            <Evidence title="Evidence" data={v.evidence} />
          </li>
        ))}
      </ul>
      {run.kind === 'contract' && <ProxyStory story={run.proxyStory} />}
      <Evidence title="Show raw evidence (deliveries, shop state, PayPal records, proxy log)" data={{ deliveries: run.deliveries, shopStateAfter: run.stateAfter, paypalRecords: run.ledger, proxyLog: run.proxyLog, note: run.ledgerFinalNote }} />
      {run.kind === 'webhook' && failing && (
        <div className="ai">
          <h3>AI explanation and fix</h3>
          {busy ? <Spinner label={busy} /> : (
            <button type="button" className="btn" onClick={diagnose}>{latest ? 'Explain and fix again' : 'Explain and fix'}</button>
          )}
          {latest && <Diagnosis diagnosis={latest} applying={Boolean(busy)} canEdit={editable} onApply={() => apply(latest.id)} />}
        </div>
      )}
      {run.kind === 'contract' && <p className="muted small">{contractNote(run)}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  )
}
