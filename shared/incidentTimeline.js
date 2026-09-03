import { formatEvidenceItem } from './incidents.js'

export const TIMELINE_KINDS = Object.freeze([
  'telemetry',
  'detection',
  'trust',
  'escalation',
  'ai',
  'recommendation',
])

export const TIMELINE_CAPTION =
  'Detection pipeline on this tick — not a stored per-second event log.'

export const TIMELINE_KIND_LABELS = Object.freeze({
  telemetry: 'Telemetry',
  detection: 'Detection',
  trust: 'Trust',
  escalation: 'Escalation',
  ai: 'AI Analysis',
  recommendation: 'Recommendation',
})

const ADVISORY_CONTAINMENT =
  'Isolate the affected network segment, preserve monitoring, validate the condition with the operator team, and investigate before physical intervention. Advisory only — not an executed control.'

const TELEMETRY_CODES = new Set(['metric_deviation', 'edge_pps'])
const TELEMETRY_PREFIXES = Object.freeze([
  'telemetry_spike',
  'telemetry_drift',
  'telemetry_slope',
  'telemetry_zscore',
  'telemetry_',
])

/**
 * Demo sequence for tests and visual reference. Do not render when the live
 * incident stream is empty.
 */
export const DEMO_INCIDENT_TIMELINE = Object.freeze({
  caption: TIMELINE_CAPTION,
  events: Object.freeze([
    Object.freeze({
      id: 'telemetry',
      kind: 'telemetry',
      title: 'Telemetry deviation',
      description: 'Unusual behavior detected in network telemetry',
      detail: 'packetsPerSecond deviation: +81%',
      at: '2026-09-03T12:31:02.000Z',
      timeLabel: '12:31:02',
      reached: true,
    }),
    Object.freeze({
      id: 'detection',
      kind: 'detection',
      title: 'Graph residual anomaly detected',
      description: 'Graph residual detector identified anomalous behavior',
      detail: 'Residual score 0.82',
      at: '2026-09-03T12:31:03.000Z',
      timeLabel: '12:31:03',
      reached: true,
    }),
    Object.freeze({
      id: 'trust',
      kind: 'trust',
      title: 'Peer trust degradation',
      description: 'Trust score between affected entities decreased',
      detail: 'peer trust decreased: 72 → 41',
      at: '2026-09-03T12:31:04.000Z',
      timeLabel: '12:31:04',
      reached: true,
    }),
    Object.freeze({
      id: 'escalation',
      kind: 'escalation',
      title: 'Incident promoted',
      description: 'Threat crossed the incident severity threshold',
      detail: 'Severity high · confidence 74%',
      at: '2026-09-03T12:31:05.000Z',
      timeLabel: '12:31:05',
      reached: true,
    }),
    Object.freeze({
      id: 'ai',
      kind: 'ai',
      title: 'AI Commander assessment',
      description: 'AI analysis completed',
      detail: 'Ungrounded restatement · no RAG',
      at: '2026-09-03T12:31:06.000Z',
      timeLabel: '12:31:06',
      reached: true,
    }),
    Object.freeze({
      id: 'recommendation',
      kind: 'recommendation',
      title: 'Containment recommendation',
      description: 'Recommended action generated',
      detail: ADVISORY_CONTAINMENT,
      at: '2026-09-03T12:31:07.000Z',
      timeLabel: '12:31:07',
      reached: true,
    }),
  ]),
})

function evidenceOf(incident) {
  return Array.isArray(incident?.evidence) ? incident.evidence : []
}

function codeOf(item) {
  return String(item?.code ?? '')
}

function isTelemetryItem(item) {
  const code = codeOf(item)
  if (TELEMETRY_CODES.has(code)) return true
  const detail = String(item?.detail ?? '')
  return TELEMETRY_PREFIXES.some(
    (p) => code === p || code.startsWith(p) || detail.startsWith(p)
  )
}

function firstMatching(items, pred) {
  return items.find(pred) ?? null
}

function clockFromIso(iso) {
  const m = String(iso ?? '').match(/T(\d{2}:\d{2}:\d{2})/)
  return m ? m[1] : '—'
}

function shiftIso(iso, seconds) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { at: null, timeLabel: '—' }
  d.setTime(d.getTime() + seconds * 1000)
  const at = d.toISOString()
  return { at, timeLabel: clockFromIso(at) }
}

function pctLabel(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Math.round(Number(n) * 100)}%`
}

function residualLabel(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toFixed(2)
}

function hasIncidentIdentity(incident) {
  if (!incident || typeof incident !== 'object') return false
  return Boolean(incident.id || incident.endpointId)
}

function aiDescription(status) {
  if (status === 'pending') return 'AI analysis in progress'
  if (status === 'fallback') return 'Deterministic template — Commander offline'
  if (status === 'error') return 'Commander could not explain this detection'
  if (status === 'ready') return 'AI analysis completed'
  return 'AI analysis completed'
}

function aiDetail(incident) {
  const status = incident.explanationStatus
  if (status === 'pending') return 'Waiting for Commander restatement'
  if (status === 'fallback') return 'Template · no RAG'
  if (status === 'error') return 'Numeric facts remain authoritative'
  if (incident.explanationSource === 'llm-explain') return 'Ungrounded LLM restatement · no RAG'
  return 'Template · no RAG'
}

function explanationText(incident) {
  return String(incident?.explanation ?? '').trim()
}

function hasRecommendation(incident) {
  const status = incident?.explanationStatus
  if (status !== 'ready' && status !== 'fallback') return false
  return explanationText(incident).length > 0
}

/**
 * Last reached stage. All included stages are reached; the latest is current.
 */
export function currentTimelineEvent(events) {
  const list = Array.isArray(events) ? events : []
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.reached) return list[i]
  }
  return null
}

export function currentTimelineKind(events) {
  return currentTimelineEvent(events)?.kind ?? null
}

/**
 * Map a live incident snapshot to pipeline timeline events.
 * Display times are 1s offsets around incident.timestamp for order only.
 */
export function timelineEventsFromIncident(incident) {
  if (!hasIncidentIdentity(incident)) return []

  const items = evidenceOf(incident)
  const stages = []

  const tel = firstMatching(items, isTelemetryItem)
  if (tel) {
    stages.push({
      id: 'telemetry',
      kind: 'telemetry',
      title: 'Telemetry deviation',
      description: 'Unusual behavior detected in network telemetry',
      detail: formatEvidenceItem(tel) || 'Observed metric deviation',
    })
  }

  stages.push({
    id: 'detection',
    kind: 'detection',
    title: 'Graph residual anomaly detected',
    description: 'Graph residual detector identified anomalous behavior',
    detail: `Residual score ${residualLabel(incident.anomalyScore)}`,
  })

  const trustEv = firstMatching(items, (ev) => codeOf(ev) === 'peer_trust_decrease')
  if (trustEv) {
    stages.push({
      id: 'trust',
      kind: 'trust',
      title: 'Peer trust degradation',
      description: 'Trust score between affected entities decreased',
      detail: formatEvidenceItem(trustEv),
    })
  }

  stages.push({
    id: 'escalation',
    kind: 'escalation',
    title: 'Incident promoted',
    description: 'Threat crossed the incident severity threshold',
    detail: `Severity ${incident.severity || 'low'} · confidence ${pctLabel(incident.confidence)}`,
  })

  if (incident.explanationStatus) {
    stages.push({
      id: 'ai',
      kind: 'ai',
      title: 'AI Commander assessment',
      description: aiDescription(incident.explanationStatus),
      detail: aiDetail(incident),
    })
  }

  if (hasRecommendation(incident)) {
    stages.push({
      id: 'recommendation',
      kind: 'recommendation',
      title: 'Containment recommendation',
      description: 'Recommended action generated',
      detail: ADVISORY_CONTAINMENT,
    })
  }

  const promoIdx = stages.findIndex((s) => s.kind === 'escalation')
  const anchor = incident.timestamp

  return stages.map((stage, i) => {
    const clock = shiftIso(anchor, i - promoIdx)
    return {
      ...stage,
      at: clock.at,
      timeLabel: clock.timeLabel,
      reached: true,
    }
  })
}
