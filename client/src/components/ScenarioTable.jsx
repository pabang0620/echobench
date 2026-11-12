import { StatusBadge } from './common.jsx'

export default function ScenarioTable({ overview, onRun, onOpen, busy }) {
  if (!overview) return null
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Scenario</th><th>Starts at</th><th>Rules</th><th>Result</th><th /></tr>
        </thead>
        <tbody>
          {overview.scenarios.map(({ scenario, run }) => (
            <tr key={scenario.id}>
              <td>
                <strong>{scenario.id}</strong> {scenario.title}
                <div className="muted small">{scenario.summary}</div>
              </td>
              <td>{scenario.startPoint}</td>
              <td>{scenario.rules.join(', ')}</td>
              <td>
                {run ? (
                  <button type="button" className="link" onClick={() => onOpen(run.id)}>
                    <StatusBadge status={run.status} /> {run.precomputed ? <span className="muted small">precomputed</span> : null}
                    <div className="small">{run.headline}</div>
                  </button>
                ) : <span className="muted">not run</span>}
              </td>
              <td>
                {scenario.movesMoney
                  ? <span className="muted small">Contract tab (confirmation card)</span>
                  : <button type="button" className="btn btn--small" disabled={Boolean(busy)} onClick={() => onRun(scenario.id)}>Run</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
