import { useState } from 'react'

export default function CommanderInput({ roomId, disabled }) {
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState(null)
  const [busy, setBusy] = useState(false)

  const ask = async (e) => {
    e.preventDefault()
    if (!roomId || !q.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/rooms/${encodeURIComponent(roomId)}/commander/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q.trim() }),
      })
      const json = await res.json()
      setAnswer(json.answer || 'Insufficient observed evidence.')
    } catch {
      setAnswer('Insufficient observed evidence.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="tn-surface px-5 py-4">
      <div className="tn-section-title">Ask Commander</div>
      <p className="tn-meta mt-1">
        Answers use the current match snapshot only. Chat is secondary to the briefing.
      </p>
      <form className="mt-3 flex gap-2" onSubmit={ask}>
        <input
          className="tn-input flex-1 px-3 text-sm"
          value={q}
          disabled={disabled || busy}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Why is this node considered risky?"
        />
        <button type="submit" className="tn-btn-primary" disabled={disabled || busy || !q.trim()}>
          Ask
        </button>
      </form>
      {answer ? <p className="mt-3 text-sm leading-relaxed">{answer}</p> : null}
    </section>
  )
}
