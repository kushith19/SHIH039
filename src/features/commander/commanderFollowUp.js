/**
 * Investigate-mode follow-up helpers.
 * Informational Q&A only — never executes or mutates response plans.
 */

import { COMMANDER_MODES } from '../../../shared/commanderIncidentIntel.js'

export const FOLLOW_UP_SUGGESTIONS = Object.freeze([
  'What evidence triggered the anomaly?',
  'Why is the financial exposure high?',
  "Why shouldn't I isolate every propagated node?",
  'Why is Core Banking at risk?',
])

/** First Commander chat turn: Level-1 observed evidence (not retrieved knowledge). */
export function buildObservedEvidenceOpener(observed) {
  const lines = Array.isArray(observed)
    ? observed.map((line) => String(line ?? '').trim()).filter(Boolean)
    : []
  const heading =
    'Observed evidence (Level-1 facts from detection · not retrieved knowledge)'
  if (!lines.length) {
    return `${heading}\n\nNo Level-1 evidence items were supplied in this incident context.`
  }
  return [heading, '', ...lines.map((line) => `- ${line}`)].join('\n')
}

export function observedEvidenceChatMessages(observed) {
  return [{ role: 'assistant', text: buildObservedEvidenceOpener(observed) }]
}

function knowledgeLines(items) {
  return (Array.isArray(items) ? items : [])
    .map((line) => String(line ?? '').trim())
    .filter(Boolean)
}

function formatKnowledgeSource(citation) {
  const c = citation && typeof citation === 'object' ? citation : {}
  const name = c.document || c.source || 'Retrieved guidance'
  const parts = [name]
  if (c.section) parts.push(String(c.section))
  if (c.page != null) parts.push(`p.${c.page}`)
  return parts.join(' · ')
}

/** Second Commander chat turn: retrieved knowledge (not live telemetry). */
export function buildKnowledgeOpener(knowledgeContext, knowledgeStatus) {
  const kc =
    knowledgeContext && typeof knowledgeContext === 'object' ? knowledgeContext : null
  const status =
    kc?.knowledgeStatus ||
    kc?.knowledge_status ||
    knowledgeStatus ||
    'unavailable'
  const retrieved = kc?.retrieved === true
  const heading =
    'Knowledge (retrieved guidance · not live telemetry · not executable actions)'
  if (!retrieved) {
    const reason =
      kc?.reason ||
      'Knowledge retrieval unavailable. Incident intelligence and response plan remain available from live SOC context.'
    return `${heading}\n\n${reason}\n\nKnowledge retrieval: ${String(status)}`
  }

  const attack = knowledgeLines(kc?.attackUnderstanding || kc?.attack_understanding)
  const relevant = knowledgeLines(kc?.relevantKnowledge || kc?.relevant_knowledge)
  const prevention = knowledgeLines(kc?.preventionGuidance || kc?.prevention_guidance)
  const sources = Array.isArray(kc?.sources) ? kc.sources : []
  const blocks = [heading, '']

  const pushList = (title, lines) => {
    if (!lines.length) return
    blocks.push(title)
    for (const line of lines) blocks.push(`- ${line}`)
    blocks.push('')
  }

  pushList('Attack pattern / why this is happening', attack)
  pushList('What this pattern means', relevant)
  pushList('Prevention / hardening', prevention)

  blocks.push('Sources')
  if (!sources.length) {
    blocks.push('- No citations attached.')
  } else {
    for (const citation of sources) {
      blocks.push(`- ${formatKnowledgeSource(citation)}`)
    }
  }
  blocks.push('')
  blocks.push(
    `Knowledge retrieval: ${String(status)} · labeled as knowledge base, not observed detection`
  )
  return blocks.join('\n').trim()
}

/** Opening transcript: observed evidence first, then retrieved knowledge. */
export function investigateChatSeedMessages(
  observed,
  knowledgeContext,
  knowledgeStatus
) {
  return [
    { role: 'assistant', text: buildObservedEvidenceOpener(observed) },
    { role: 'assistant', text: buildKnowledgeOpener(knowledgeContext, knowledgeStatus) },
  ]
}

/** Replace leading seed assistant turns; keep any user Q&A that follows. */
export function mergeInvestigateChatSeed(prev, seed) {
  const nextSeed = Array.isArray(seed) ? seed : []
  const prevMsgs = Array.isArray(prev) ? prev : []
  if (!nextSeed.length) return [...prevMsgs]
  let i = 0
  while (i < prevMsgs.length && prevMsgs[i]?.role === 'assistant') i += 1
  return [...nextSeed, ...prevMsgs.slice(i)]
}

/** Follow-up card is Investigate-only when an incident is focused. */
export function shouldShowCommanderFollowUp({ focused = false, mode } = {}) {
  if (!focused) return true
  return mode === COMMANDER_MODES.INVESTIGATE || mode === 'investigate'
}

/** POST body for /rooms/:id/commander/ask — no action fields. */
export function buildFollowUpAskBody({ question, incidentId } = {}) {
  const text = String(question ?? '').trim()
  const body = { question: text }
  if (incidentId) body.incidentId = String(incidentId)
  return body
}

export function appendFollowUpTurn(messages, { question, answer } = {}) {
  const q = String(question ?? '').trim()
  const a = String(answer ?? '').trim()
  if (!q) return Array.isArray(messages) ? [...messages] : []
  const next = Array.isArray(messages) ? [...messages] : []
  next.push({ role: 'user', text: q })
  next.push({
    role: 'assistant',
    text: a || 'Insufficient observed evidence.',
  })
  return next
}

/** Fresh conversation when the selected incident changes. */
export function followUpMessagesForIncident(prevIncidentId, nextIncidentId, messages) {
  const prev = prevIncidentId == null ? '' : String(prevIncidentId)
  const next = nextIncidentId == null ? '' : String(nextIncidentId)
  if (prev !== next) return []
  return Array.isArray(messages) ? messages : []
}

const FORBIDDEN_FOLLOW_UP_KEYS = [
  'actionId',
  'action_id',
  'availableActions',
  'available_actions',
  'execute',
  'responsePlan',
  'response_plan',
]

/**
 * Follow-up answers must be informational only.
 * Returns true when the payload has no executable action fields.
 */
export function followUpResponseIsInformationalOnly(payload) {
  if (payload == null || typeof payload !== 'object') return true
  for (const key of FORBIDDEN_FOLLOW_UP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key) && payload[key] != null) {
      return false
    }
  }
  const answer = String(payload.answer ?? '')
  if (/\bactionId\b/i.test(answer) && /execute|quarantine/i.test(answer)) {
    return false
  }
  return true
}

const SECTION_LABEL =
  /^(Observed|Knowledge|Evidence|Guidance|Note|Path|Related)\s*:\s*(.*)$/i

const HIGHLIGHT_RE =
  /(₹[\d.,]+[A-Za-z%]*|\b\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b(?:\s*(?:hop|hops|node|nodes))?)/g

/**
 * Split answer text into short readable blocks for display.
 * Prefers natural paragraphs; bullets only when the source text already lists items.
 * Does not invent facts.
 */
export function formatFollowUpAnswerBlocks(answer) {
  const raw = String(answer ?? '').trim()
  if (!raw) {
    return [{ type: 'p', text: 'Insufficient observed evidence.' }]
  }

  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const blocks = []
  const pushP = (text) => {
    const t = String(text ?? '').trim()
    if (t) blocks.push({ type: 'p', text: t })
  }
  const pushBullets = (items) => {
    const list = items.map((x) => String(x).trim()).filter(Boolean)
    if (list.length >= 2) {
      blocks.push({ type: 'ul', items: list })
    } else if (list.length === 1) {
      pushP(list[0])
    }
  }

  const chunks = normalized.split(/\n\n+/)
  for (const chunk of chunks) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue

    const bulletLines = []
    const flushBullets = () => {
      if (bulletLines.length) {
        pushBullets(bulletLines.splice(0, bulletLines.length))
      }
    }

    for (const line of lines) {
      const bullet = line.match(/^[-•*]\s+(.+)$/)
      if (bullet) {
        bulletLines.push(bullet[1])
        continue
      }
      flushBullets()

      // Keep labeled lines as natural prose (not report section headers).
      const labeled = line.match(SECTION_LABEL)
      if (labeled) {
        const body = String(labeled[2] ?? '').trim()
        pushP(body ? `${labeled[1]}: ${body}` : `${labeled[1]}:`)
        continue
      }

      // Only bulletize dense semicolon lists when there are clearly multiple items.
      const dense = line.match(/^(.+?:\s*)(.+)$/)
      if (dense && /;/.test(dense[2])) {
        const parts = dense[2].split(';').map((s) => s.trim()).filter(Boolean)
        if (parts.length >= 3) {
          pushP(dense[1].trim().replace(/:$/, ''))
          pushBullets(parts)
          continue
        }
      }

      // Soft-wrap very long multi-sentence blobs into a few short paragraphs.
      const sentences = line.match(/[^.!?]+[.!?]+|[^.!?]+$/g)
      if (sentences && sentences.length >= 3 && line.length > 180) {
        for (const s of sentences.map((x) => x.trim()).filter(Boolean).slice(0, 4)) {
          pushP(s)
        }
        continue
      }

      pushP(line)
    }
    flushBullets()
  }

  return blocks.length ? blocks : [{ type: 'p', text: raw }]
}

/**
 * Inline highlight parts for important numbers / money (display only).
 * @returns {Array<{ text: string, highlight?: boolean }>}
 */
export function splitFollowUpInlineParts(text) {
  const s = String(text ?? '')
  if (!s) return []
  const parts = []
  let last = 0
  HIGHLIGHT_RE.lastIndex = 0
  let m
  while ((m = HIGHLIGHT_RE.exec(s)) !== null) {
    if (m.index > last) parts.push({ text: s.slice(last, m.index) })
    parts.push({ text: m[0], highlight: true })
    last = m.index + m[0].length
  }
  if (last < s.length) parts.push({ text: s.slice(last) })
  return parts.length ? parts : [{ text: s }]
}
