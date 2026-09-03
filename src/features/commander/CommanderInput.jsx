import { useState } from 'react'
import { COMMANDER_MODES } from '@shared/commanderIncidentIntel.js'

const FOLLOW_UPS = [
  'What evidence triggered the anomaly?',
  'Why is the financial exposure high?',
  "Why shouldn't I isolate every propagated node?",
]

export default function CommanderInput({
  roomId,
  disabled,
  incidentId,
  focused = false,
  mode = COMMANDER_MODES.INVESTIGATE,
}) {
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState(null)
  const [busy, setBusy] = useState(false)

  const ask = async (question) => {
    const text = String(question ?? q).trim()
    if (!roomId || !text) return
    setBusy(true)
    setQ(text)
    try {
      const res = await fetch(`/rooms/${encodeURIComponent(roomId)}/commander/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, incidentId: incidentId || undefined }),
      })
      const json = await res.json()
      setAnswer(json.answer || 'Insufficient observed evidence.')
    } catch {
      setAnswer('Insufficient observed evidence.')
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e) => {
    e.preventDefault()
    void ask(q)
  }

  return (
    <section className="tn-surface px-5 py-4">
      <div className="tn-section-title">
        {focused ? 'Follow-up' : 'Ask Commander'}
      </div>
      <p className="tn-meta mt-1">
        {focused
          ? `Answers use structured ${mode} context for this incident only. No invented telemetry.`
          : 'Answers use the current match snapshot only. Chat is secondary to the briefing.'}
      </p>
      {focused ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {FOLLOW_UPS.map((hint) => (
            <button
              key={hint}
              type="button"
              className="rounded-md px-2.5 py-1.5 text-left text-xs"
              style={{ background: 'var(--tn-elevated)', color: 'var(--tn-muted)' }}
              disabled={disabled || busy}
              onClick={() => void ask(hint)}
            >
              {hint}
            </button>
          ))}
        </div>
      ) : null}
      <form className="mt-3 flex gap-2" onSubmit={onSubmit}>
        <input
          className="tn-input flex-1 px-3 text-sm"
          value={q}
          disabled={disabled || busy}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            focused
              ? 'Why is Core Banking at risk?'
              : 'Why is this node considered risky?'
          }
        />
        <button type="submit" className="tn-btn-primary" disabled={disabled || busy || !q.trim()}>
          Ask
        </button>
      </form>
      {answer ? <p className="mt-3 text-sm leading-relaxed">{answer}</p> : null}
    </section>
  )
}
