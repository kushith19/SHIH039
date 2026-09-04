import { useEffect, useRef, useState } from 'react'
import { COMMANDER_MODES } from '@shared/commanderIncidentIntel.js'
import {
  FOLLOW_UP_SUGGESTIONS,
  appendFollowUpTurn,
  buildFollowUpAskBody,
  formatFollowUpAnswerBlocks,
  mergeInvestigateChatSeed,
  shouldShowCommanderFollowUp,
  splitFollowUpInlineParts,
} from './commanderFollowUp.js'

function FollowUpInline({ text }) {
  return (
    <>
      {splitFollowUpInlineParts(text).map((part, i) =>
        part.highlight ? (
          <strong key={i} className="font-medium tabular-nums">
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  )
}

function FollowUpAnswer({ text }) {
  const blocks = formatFollowUpAnswerBlocks(text)
  return (
    <div className="mt-1 space-y-2 text-sm leading-relaxed">
      {blocks.map((block, i) => {
        if (block.type === 'label') {
          return (
            <div key={i} className="tn-label pt-0.5">
              {block.label}
            </div>
          )
        }
        if (block.type === 'ul') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>
                  <FollowUpInline text={item} />
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i}>
            <FollowUpInline text={block.text} />
          </p>
        )
      })}
    </div>
  )
}

export default function CommanderInput({
  roomId,
  disabled,
  incidentId,
  focused = false,
  mode = COMMANDER_MODES.INVESTIGATE,
  initialMessages = null,
  fillPanel = false,
}) {
  const [q, setQ] = useState('')
  const [messages, setMessages] = useState(() =>
    Array.isArray(initialMessages) ? initialMessages : []
  )
  const [busy, setBusy] = useState(false)
  const openerSeed = Array.isArray(initialMessages)
    ? initialMessages.map((m) => `${m.role}\n${m.text}`).join('\n---\n')
    : ''
  const incidentKey = incidentId == null ? '' : String(incidentId)
  const incidentKeyRef = useRef(incidentKey)

  useEffect(() => {
    const switched = incidentKeyRef.current !== incidentKey
    incidentKeyRef.current = incidentKey
    if (switched) {
      setMessages(Array.isArray(initialMessages) ? initialMessages : [])
      setQ('')
      return
    }
    if (!openerSeed) return
    setMessages((prev) => mergeInvestigateChatSeed(prev, initialMessages))
  }, [incidentKey, openerSeed])

  if (!shouldShowCommanderFollowUp({ focused, mode })) {
    return null
  }

  const ask = async (question) => {
    const text = String(question ?? q).trim()
    if (!roomId || !text) return
    setBusy(true)
    setQ('')
    try {
      const res = await fetch(`/rooms/${encodeURIComponent(roomId)}/commander/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildFollowUpAskBody({ question: text, incidentId })),
      })
      const json = await res.json()
      const answer = json.answer || 'Insufficient observed evidence.'
      setMessages((prev) => appendFollowUpTurn(prev, { question: text, answer }))
    } catch {
      setMessages((prev) =>
        appendFollowUpTurn(prev, {
          question: text,
          answer: 'Insufficient observed evidence.',
        })
      )
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e) => {
    e.preventDefault()
    void ask(q)
  }

  const transcript = (
    <ul className={fillPanel ? 'min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3' : 'mt-3 max-h-56 space-y-3 overflow-y-auto'}>
      {messages.map((m, i) => (
        <li key={`${m.role}-${i}`}>
          <span className="tn-label">{m.role === 'user' ? 'You' : 'Commander'}</span>
          {m.role === 'assistant' ? (
            <FollowUpAnswer text={m.text} />
          ) : (
            <p className="mt-0.5 text-sm leading-relaxed">{m.text}</p>
          )}
        </li>
      ))}
    </ul>
  )

  const composer = (
    <>
      {focused ? (
        <div className={fillPanel ? 'flex flex-wrap gap-2' : 'mt-3 flex flex-wrap gap-2'}>
          {FOLLOW_UP_SUGGESTIONS.map((hint) => (
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
      {busy ? <p className="tn-meta mt-2">Commander is answering…</p> : null}
      <form className="mt-3 flex gap-2" onSubmit={onSubmit}>
        <input
          className="tn-input flex-1 px-3 text-sm"
          value={q}
          disabled={disabled || busy}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            focused
              ? 'Ask about this incident…'
              : 'Why is this node considered risky?'
          }
        />
        <button type="submit" className="tn-btn-primary" disabled={disabled || busy || !q.trim()}>
          Ask
        </button>
      </form>
    </>
  )

  if (fillPanel) {
    return (
      <section className="flex h-full min-h-0 flex-col">
        {transcript}
        <div className="shrink-0 border-t border-[var(--tn-line)] px-4 py-3">
          <p className="tn-meta mb-2 text-[11px]">
            Investigate only · structured context + retrieved knowledge · informational — does not
            execute.
          </p>
          {composer}
        </div>
      </section>
    )
  }

  return (
    <section className="soc-zone px-4 py-3">
      <div className="soc-zone-title">
        {focused ? 'Follow-up' : 'Ask Commander'}
      </div>
      <p className="tn-meta mt-1 text-[11px]">
        {focused
          ? 'Investigate only · structured context + retrieved knowledge · informational — does not execute.'
          : 'Answers use the current match snapshot only. Chat is secondary to the briefing.'}
      </p>
      {messages.length > 0 ? transcript : null}
      {composer}
    </section>
  )
}
