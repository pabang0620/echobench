// Shown before a contract scenario that moves sandbox money. Nothing runs until Run is pressed.
export default function ConfirmCard({ card, onRun, onCancel, busy }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="modal__box">
        <h3 id="confirm-title">Confirm: {card.scenarioId}</h3>
        <p>{card.text}</p>
        <dl className="facts">
          <dt>Amount</dt><dd>{card.amount} {card.currency}{card.attempts > 1 ? ` (up to ${card.attempts} attempts)` : ''}</dd>
          <dt>Capture</dt><dd className="mono">{card.captureId}</dd>
          <dt>Environment</dt><dd>{card.environment}</dd>
          <dt>Run by</dt><dd>{card.operator}</dd>
        </dl>
        <p className="muted small">The amount is set in EchoBench's code, not by a model. This card works once and expires in 5 minutes.</p>
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={onRun} disabled={busy}>{busy ? 'Running...' : 'Run'}</button>
        </div>
      </div>
    </div>
  )
}
