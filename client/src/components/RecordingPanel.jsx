import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Evidence } from './common.jsx'

// Start / finish a recording. Calls the same API as the scripts: POST /recordings/start and /recordings/finish.
function Recorder({ targetId, status, onRecorded }) {
  const [live, setLive] = useState(null)
  const [info, setInfo] = useState(null)
  const [name, setName] = useState('My recording')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const poll = () => api('GET', '/recordings-live').then((x) => alive && setLive(x)).catch(() => {})
    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const run = async (work) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const start = () => run(async () => {
    setInfo(await api('POST', '/recordings/start', { name: name.trim(), targetId }))
    setLive(await api('GET', '/recordings-live'))
  })
  const finish = () => run(async () => {
    const done = await api('POST', '/recordings/finish')
    setLive(null)
    setInfo(null)
    await onRecorded(done.id)
  })

  return (
    <div>
      <h4>Record</h4>
      {live ? (
        <>
          <p><strong>Recording "{live.name}" is running.</strong> {live.deliveries.length} deliveries so far{live.deliveries.length ? ` (${live.deliveries.join(', ')})` : ''}; start points: {live.startPoints.join(', ') || 'none yet'}.</p>
          {info && <p className="muted small">PayPal posts to <span className="mono">{info.webhookUrl}</span>. The buyer returns through <span className="mono">{info.returnUrl}</span> (replace ORDER_ID).</p>}
          <div className="rec-actions"><button type="button" className="btn btn--primary" disabled={busy} onClick={finish}>Finish recording</button></div>
        </>
      ) : (
        <>
          <p className="muted small">
            {status?.mode === 'mock'
              ? 'Records the deliveries that reach this EchoBench while it runs. In the default run PayPal is the local stand-in, so a purchase has to come from it; real sandbox deliveries need credentials and a public URL (VERIFY.md V1).'
              : 'Records the real sandbox deliveries that reach this EchoBench while it runs.'}
          </p>
          <div className="rec-actions">
            <input aria-label="Recording name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="btn" disabled={busy || !name.trim() || !targetId} onClick={start}>Start recording</button>
          </div>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}

// Step 1: what was recorded. Shows the exact deliveries and the start points taken for state reset.
export default function RecordingPanel({ recordingId, status, targetId, onRecorded }) {
  const [rec, setRec] = useState(null)
  useEffect(() => {
    if (recordingId) api('GET', `/recordings/${recordingId}`).then(setRec).catch(() => setRec(null))
  }, [recordingId])
  return (
    <div>
      <Recorder targetId={targetId} status={status} onRecorded={onRecorded} />
      {rec && <Recorded rec={rec} status={status} />}
    </div>
  )
}

function Recorded({ rec, status }) {
  return (
    <div>
      <p>
        <strong>{rec.name}</strong>
        <span className="muted small"> {rec.builtin ? 'built-in' : 'recorded'} ({rec.source})</span>
      </p>
      <p className="muted small">
        {status?.mode === 'mock'
          ? 'These deliveries came from the local PayPal stand-in, which signs them like PayPal does. With sandbox credentials the same screen records real sandbox deliveries.'
          : 'These deliveries are real PayPal sandbox deliveries.'}
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>#</th><th>Event</th><th>Handler answered</th><th /></tr></thead>
          <tbody>
            {rec.deliveries.map((d) => (
              <tr key={d.eventId}>
                <td>{d.seq || 'extra'}</td>
                <td><strong className="mono">{d.eventType}</strong><div className="muted small">{d.label}</div></td>
                <td>{d.targetResponse ? `HTTP ${d.targetResponse.status}` : '-'}</td>
                <td><Evidence title="Exact event" data={{ headers: d.headers, body: d.body }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">Start points saved for state reset: {Object.entries(rec.startPoints).map(([k, v]) => `${k} (shipped ${v.fulfilled_count}, refunds ${v.refunds.length})`).join(', ')}{rec.contract ? ', SPC (a captured, unrefunded payment for contract runs)' : ''}.</p>
    </div>
  )
}
