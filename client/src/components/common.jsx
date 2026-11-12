export const STATUS_LABEL = { red: 'RED', green: 'GREEN', amber: 'WARN', na: 'N/A', error: 'ERROR', notrun: 'NOT RUN', untested: 'NOT TESTED', readonly: 'READ ONLY', pass: 'PASS', fail: 'FAIL', warn: 'WARN' }

export function StatusBadge({ status }) {
  const tone = { red: 'bad', fail: 'bad', error: 'bad', green: 'good', pass: 'good', amber: 'warn', warn: 'warn' }[status] || 'mute'
  return <span className={`badge badge--${tone}`}>{STATUS_LABEL[status] || status}</span>
}

// The round check-run icon: red cross, green tick, amber bang, grey ring when not run.
export function StatusIcon({ status }) {
  const tone = { red: 'red', fail: 'red', error: 'red', green: 'green', pass: 'green', amber: 'amber', warn: 'amber' }[status] || 'none'
  const mark = { red: '✕', green: '✓', amber: '!', none: '' }[tone]
  return <span className={`ic ic--${tone}`} role="img" aria-label={STATUS_LABEL[status] || 'not run'}>{mark}</span>
}

export function Spinner({ label }) {
  return (
    <div className="busy" role="status">
      <span className="busy__dot" />
      {label}
    </div>
  )
}

export function Evidence({ title = 'Show evidence', data }) {
  return (
    <details className="evidence">
      <summary>{title}</summary>
      <pre>{typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</pre>
    </details>
  )
}

// Text with `code` spans from markdown cells shown as code, without the backticks.
export function Md({ text }) {
  return String(text ?? '').split(/(`[^`]+`)/g).map((part, i) => (part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={i} className="mono">{part.slice(1, -1)}</code> : part))
}
