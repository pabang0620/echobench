import { StatusBadge } from './common.jsx'

// The three lines shown on the first screen.
export default function ResultRows({ rows, onOpen }) {
  if (!rows?.length) return <p className="muted">No results yet. Press "Shake all" to run every scenario.</p>
  return (
    <ul className="rows">
      {rows.map((row) => (
        <li key={row.id}>
          <button type="button" className={`row row--${row.status}`} onClick={() => onOpen(row.runId)}>
            <StatusBadge status={row.status} />
            <span className="row__text">{row.headline}{row.precomputed && <> <span className="pill pill--mute" title="Computed ahead of time against the local stand-in. Press Shake all to run it now.">precomputed</span></>}</span>
            <span className="row__id">{row.id}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
