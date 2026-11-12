import { Evidence } from './common.jsx'
import ModelText from './ModelText.jsx'

function Diff({ text }) {
  return (
    <pre className="diff" aria-label="Proposed patch">
      {text.split('\n').map((line, i) => (
        <span key={i} className={line.startsWith('+') && !line.startsWith('+++') ? 'diff__add' : line.startsWith('-') && !line.startsWith('---') ? 'diff__del' : line.startsWith('@@') ? 'diff__hunk' : ''}>{line}{'\n'}</span>
      ))}
    </pre>
  )
}

function modelBadge(d) {
  const source = d.explanation.source || d.explanation.modelName || 'the model'
  if (d.mode === 'mock') return { tone: 'amber', text: 'Rule-based stand-in (no model wrote this)' }
  if (d.mode === 'recorded') return { tone: 'good', text: `Recorded run: ${d.recorded.source}, ${d.recorded.recordedAt}` }
  return { tone: 'good', text: `Written by ${source}` }
}

export default function Diagnosis({ diagnosis, applying, onApply, canEdit }) {
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
        {diagnosis.fallbackReason && <span className="pill pill--amber">{'Live Claude not used: '}{diagnosis.fallbackReason}</span>}
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
          {diagnosis.explanation.model ? <ModelText text={diagnosis.explanation.model} /> : <p className="muted">The model returned no explanation text.</p>}
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
      {modelCalls.length > 0 && <Evidence title={`Tool calls the model made, in order (${modelCalls.length})`} data={[...modelCalls.map((m, i) => `${i + 1}. ${Number.isInteger(m.atMs) ? `[${(m.atMs / 1000).toFixed(1)} s] ` : ''}${m.tool}${m.summary ? ` ${m.summary}` : ''}`), ...(diagnosis.recorded?.durationMs ? [`Model time: ${Math.round(diagnosis.recorded.durationMs / 1000)} s`] : diagnosis.modelMs ? [`Model time: ${Math.round(diagnosis.modelMs / 1000)} s`] : [])].join('\n')} />}
      <Evidence title="Tool steps run by this server (real tools, tsc, re-runs)" data={diagnosis.steps.map((s) => `${s.tool}: ${s.summary}`).join('\n')} />
    </div>
  )
}
