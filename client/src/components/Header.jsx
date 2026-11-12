// step: 1 Record, 2 Shake, 3 Fix. The current one is highlighted; each chip jumps to its part of the screen.
export default function Header({ lab, step, onStep }) {
  const { status, targets, targetId, setTargetId, recordings, recordingId, setRecordingId } = lab
  return (
    <header className="top">
      <div className="top__brand">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="var(--accent)" />
          <path d="M6 17h4l3-8 4 14 3-9 2 3h4" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <strong>EchoBench</strong>
      </div>
      <ol className="steps" aria-label="Workflow">
        {['Record', 'Shake', 'Fix'].map((name, i) => (
          <li key={name}>
            <button type="button" className={`step${step === i + 1 ? ' step--on' : ''}`} aria-current={step === i + 1 ? 'step' : undefined} onClick={() => onStep(i + 1)}>{i + 1} {name}</button>
          </li>
        ))}
      </ol>
      <div className="top__pick">
        <label>
          Target
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <label>
          Recording
          <select value={recordingId} onChange={(e) => setRecordingId(e.target.value)}>
            {recordings.map((r) => (
              <option key={r.id} value={r.id}>{r.name.slice(0, 48)}</option>
            ))}
          </select>
        </label>
      </div>
      {status && (
        <div className="top__modes">
          <span className={`pill pill--${status.mode === 'mock' ? 'amber' : 'good'}`} title={status.note}>PayPal: {status.mode === 'mock' ? 'local stand-in' : 'sandbox'}</span>
          <span className={`pill pill--${status.sdk === 'sdk' ? 'good' : 'amber'}`} title="How the judge and the shop talk to PayPal">PayPal client: {status.sdk === 'sdk' ? 'APIMatic SDK' : 'plain REST'}</span>
          <span className={`pill pill--${status.llm === 'mock' ? 'amber' : 'good'}`} title={status.llm === 'mock' ? (status.recordedModel ? `Scripted text unless a card says Recorded run (${status.recordedModel.source}, ${status.recordedModel.recordedAt}, scenarios ${(status.recordedModel.scenarioIds || [status.recordedModel.scenarioId]).join(', ')})` : 'No model key or login: the explanation text is scripted') : 'A real model writes the explanation and the patch'}>{status.llm !== 'mock' ? `AI: ${status.llmLabel}` : status.recordedModel ? `AI: recorded run, Claude Sonnet ${status.recordedModel.recordedAt} (${(status.recordedModel.scenarioIds || [status.recordedModel.scenarioId]).join(', ')}); other scenarios mocked` : 'AI: mocked'}</span>
        </div>
      )}
    </header>
  )
}
