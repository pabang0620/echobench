// Top bar: brand, the target / recording path, and the Record, Shake, Fix flow.
// step: 1 Record, 2 Shake, 3 Fix. Earlier steps get a tick; each one jumps to its part of the screen.
export default function Header({ lab, step, onStep }) {
  const { targets, targetId, setTargetId, recordings, recordingId, setRecordingId } = lab
  return (
    <header className="top">
      <div className="brand">
        <img className="brand-logo" src="/logo-512.png" width="32" height="32" alt="EchoBench" />
        <strong>EchoBench</strong>
      </div>
      <div className="path">
        <span className="path__sep" aria-hidden="true">/</span>
        <label className="path__pick path__pick--strong">
          <span className="sr-only">Target</span>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <span className="path__sep" aria-hidden="true">/</span>
        <label className="path__pick">
          <span className="sr-only">Recording</span>
          <select value={recordingId} onChange={(e) => setRecordingId(e.target.value)}>
            {recordings.map((r) => (
              <option key={r.id} value={r.id}>{r.name.slice(0, 48)}</option>
            ))}
          </select>
        </label>
      </div>
      <ol className="flow" aria-label="Workflow">
        {['Record', 'Shake', 'Fix'].map((name, i) => (
          <li key={name}>
            <button type="button" className={`flow__step${step === i + 1 ? ' flow__step--on' : ''}${step > i + 1 ? ' flow__step--done' : ''}`} aria-current={step === i + 1 ? 'step' : undefined} onClick={() => onStep(i + 1)}>{name}</button>
          </li>
        ))}
      </ol>
    </header>
  )
}

// The three mode chips, shown under the title: where PayPal is, how the app talks to it, who writes the AI text.
export function ModeTags({ status }) {
  if (!status) return null
  const recorded = status.recordedModel
  const ids = recorded ? (recorded.scenarioIds || [recorded.scenarioId]).join(', ') : ''
  return (
    <>
      <span className={`tag tag--${status.mode === 'mock' ? 'amber' : 'good'}`} title={status.note}>PayPal: {status.mode === 'mock' ? 'local stand-in' : 'sandbox'}</span>
      <span className={`tag tag--${status.sdk === 'sdk' ? 'good' : 'amber'}`} title="How the judge and the shop talk to PayPal">PayPal client: {status.sdk === 'sdk' ? 'APIMatic SDK' : 'plain REST'}</span>
      <span className={`tag tag--${status.llm === 'mock' ? 'amber' : 'good'}`} title={status.llm === 'mock' ? (recorded ? `Scripted text unless a card says Recorded run (${recorded.source}, ${recorded.recordedAt}, scenarios ${ids})` : 'No model key or login: the explanation text is scripted') : 'A real model writes the explanation and the patch'}>{status.llm !== 'mock' ? `AI: ${status.llmLabel}` : recorded ? `AI: recorded run, Claude Sonnet ${recorded.recordedAt} (${ids}); other scenarios mocked` : 'AI: mocked'}</span>
    </>
  )
}
