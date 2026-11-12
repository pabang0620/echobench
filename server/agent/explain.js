// Plain-language cause for a failing run, built from the run's own evidence.
// Used as the mocked model output when no Anthropic key is set, and as the fallback when the API is down.
export function explainRun(run) {
  const failing = run.verdicts.find((v) => v.status === 'fail') || run.verdicts[0]
  const rule = failing?.rule
  const shipments = failing?.evidence?.shipments || []
  const causes = []
  const fixes = []

  if (rule === 'I1' || rule === 'I4' || rule === 'I8') {
    if (shipments.some((s) => s.at_event === 'CHECKOUT.ORDER.APPROVED' || !s.capture_recorded)) {
      causes.push('The handler ships the mug on CHECKOUT.ORDER.APPROVED. At that moment PayPal has only recorded the buyer\'s approval; the money is not captured yet.')
      fixes.push('Ship only when PAYMENT.CAPTURE.COMPLETED arrives and a COMPLETED capture is booked.')
    }
    if (run.scenarioId !== 'S0' || shipments.length > 1) {
      causes.push('PAYMENT.CAPTURE.COMPLETED ships unconditionally. It does not look at the event id, does not check whether the order already shipped, and does not check for an open dispute, so every repeat or reordering ships another mug.')
      fixes.push('Claim the event id and ship inside one transaction (INSERT OR IGNORE, then act only if a row was inserted), skip orders that already shipped, skip orders on hold.')
    }
  }
  if (rule === 'I2') {
    causes.push('PAYMENT.CAPTURE.REFUNDED keeps a single refund per order: each new event deletes the earlier row and writes its own. A second partial refund overwrites the first, so the books show the last amount instead of the sum.')
    fixes.push('Book each refund under its own refund id (UNIQUE, INSERT OR IGNORE) so repeats are harmless and different refunds add up.')
  }
  if (rule === 'I5') {
    causes.push('The refund webhook never arrived and nothing else ever asks PayPal. Storing event ids cannot help, because the event that would be stored is the one that is missing.')
    fixes.push('Add a reconcile step that reads the order back (purchase_units[].payments.refunds) and books any refund the shop does not know yet.')
  }
  if (rule === 'I6') {
    causes.push('The handler has no memory of the events it already processed, so an old delivery is treated as new and changes the order again.')
    fixes.push('Claim every event id before acting, in the same transaction as the action.')
  }
  if (rule === 'I3') {
    causes.push('A forged event changed the shop state: the signature check accepted a certificate or body PayPal did not sign.')
    fixes.push('Take the certificate only from a PayPal host and verify the signature over the exact raw body with your own webhook id.')
  }
  if (!causes.length) {
    causes.push(failing ? failing.message : 'The run failed but no rule explains why.')
  }
  return {
    title: `${run.scenarioId}: ${failing?.message || run.headline}`,
    cause: causes,
    evidence: run.verdicts.map((v) => `${v.rule} ${v.status}: ${v.message}`),
    fix: fixes,
  }
}
