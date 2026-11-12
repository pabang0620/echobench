import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { Evidence, Md, StatusBadge } from './common.jsx'
import ConfirmCard from './ConfirmCard.jsx'
import ContractCompare from './ContractCompare.jsx'
import SandboxEvidence from './SandboxEvidence.jsx'

const KIND_TITLE = { 'duplicate-claims': 'DUPLICATE CLAIMS', 'unknown-outcomes': 'UNKNOWN OUTCOMES', 'cross-operation-invariants': 'CROSS-OPERATION INVARIANTS' }

export default function ContractTab({ recordingId, targetId, refreshKey, onOpenRun, onChanged }) {
  const [data, setData] = useState(null)
  const [card, setCard] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await api('GET', `/contract?recordingId=${recordingId}&targetId=${targetId}`))
    } catch (err) {
      setError(err.message)
    }
  }, [recordingId, targetId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const openCard = async (scenarioId, forTarget = targetId) => {
    setError('')
    try {
      setCard(await api('POST', '/contract/cards', { scenarioId, recordingId, targetId: forTarget }))
    } catch (err) {
      setError(err.message)
    }
  }
  const runCard = async () => {
    setBusy(true)
    try {
      const run = await api('POST', `/contract/cards/${card.token}/run`, {})
      setCard(null)
      await load()
      onChanged()
      onOpenRun(run.id)
    } catch (err) {
      setError(err.message)
      setCard(null)
    } finally {
      setBusy(false)
    }
  }
  // C-UNK-CAPTURE moves no money (stand-in only), so it needs no card.
  const runPlain = async (scenarioId, forTarget) => {
    setError('')
    try {
      const run = await api('POST', '/runs', { scenarioId, recordingId, targetId: forTarget })
      await load()
      onChanged()
      onOpenRun(run.id)
    } catch (err) {
      setError(err.message)
    }
  }
  const runCompare = (scenarioId, forTarget) => (scenarioId === 'C-UNK-CAPTURE' ? runPlain(scenarioId, forTarget) : openCard(scenarioId, forTarget))
  const cancel = async () => {
    await api('DELETE', `/contract/cards/${card.token}`).catch(() => {})
    setCard(null)
  }

  if (!data) return error ? <p className="error">{error}</p> : null
  if (!data.available) return <p className="muted">{data.reason}</p>
  return (
    <div>
      <SandboxEvidence />
      <ContractCompare recordingId={recordingId} refreshKey={refreshKey} onOpenRun={onOpenRun} onRun={runCompare} />
      <p className="muted small">Read from <span className="mono">{data.file}</span>. EchoBench adds its own column to a copy; the plan itself is never changed. {data.tbd.length} cell(s) still say TBD.</p>
      {data.blockers.map((b) => <p key={b.line} className="error">Blocker: <Md text={b.write} />: {b.reason}</p>)}
      {Object.keys(KIND_TITLE).map((kind) => {
        const rows = data.rows.filter((r) => r.kind === kind)
        if (!rows.length) return null
        return (
          <div key={kind} className="table-wrap">
            <h4>{KIND_TITLE[kind]}</h4>
            <table className="table">
              <tbody>
                {rows.map((row) => (
                  <tr key={row.line}>
                    <td><strong className="mono"><Md text={row.write} /></strong>{Object.entries(row.cells).slice(1).map(([k, v]) => <div key={k} className="small"><span className="muted">{k}:</span> <Md text={v} /></div>)}</td>
                    <td className="proof">
                      {row.status === 'readonly' ? <span className="muted">read only, not tested</span> : (
                        <>
                          <StatusBadge status={row.status} />
                          <div className="small"><Md text={row.proof} /></div>
                          {row.missingNames?.map((m) => <div key={m.ref} className="small error">{m.ref}: {m.reason}</div>)}
                        </>
                      )}
                      {row.scenario === 'C-DUP' || row.scenario === 'C-UNK' ? <button type="button" className="btn btn--small" onClick={() => openCard(row.scenario)}>Run {row.scenario}</button> : null}
                      {row.scenario === 'C-DUP-CAPTURE' || row.scenario === 'C-UNK-CAPTURE' ? <button type="button" className="btn btn--small" onClick={() => runPlain(row.scenario, targetId)}>Run {row.scenario}</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
      <Evidence title="Plan copy with the Proven by EchoBench column" data={data.annotated} />
      {error && <p className="error" role="alert">{error}</p>}
      {card && <ConfirmCard card={card} onRun={runCard} onCancel={cancel} busy={busy} />}
    </div>
  )
}
