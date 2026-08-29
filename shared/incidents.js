import { TRUST_CONFIG } from './trustConfig.js'

export const DETECTION_TYPES = Object.freeze([
  'behavioural_anomaly',
  'structural_anomaly',
  'temporal_anomaly',
  'dependency_anomaly',
  'communication_anomaly',
  'graph_propagation',
])

export const DETECTION_TYPE_LABELS = Object.freeze({
  behavioural_anomaly: 'Behavioural',
  structural_anomaly: 'Structural',
  temporal_anomaly: 'Temporal',
  dependency_anomaly: 'Dependency',
  communication_anomaly: 'Communication',
  graph_propagation: 'Graph propagation',
})

export const SEVERITY_LEVELS = Object.freeze(['low', 'medium', 'high', 'critical'])

const REASON_TYPE_PREFIXES = Object.freeze([
  Object.freeze({ prefix: 'telemetry_spike:', type: 'behavioural_anomaly' }),
  Object.freeze({ prefix: 'telemetry_drift:', type: 'behavioural_anomaly' }),
  Object.freeze({ prefix: 'telemetry_slope:', type: 'temporal_anomaly' }),
  Object.freeze({ prefix: 'telemetry_zscore:', type: 'temporal_anomaly' }),
  Object.freeze({ prefix: 'tgnn_embed', type: 'structural_anomaly' }),
  Object.freeze({ prefix: 'edge_contract', type: 'dependency_anomaly' }),
  Object.freeze({ prefix: 'interaction', type: 'dependency_anomaly' }),
  Object.freeze({ prefix: 'dependency', type: 'dependency_anomaly' }),
  Object.freeze({ prefix: 'link_volume', type: 'communication_anomaly' }),
  Object.freeze({ prefix: 'edge_pps', type: 'communication_anomaly' }),
  Object.freeze({ prefix: 'communication', type: 'communication_anomaly' }),
  Object.freeze({ prefix: 'graph_propagation', type: 'graph_propagation' }),
  Object.freeze({ prefix: 'spread', type: 'graph_propagation' }),
  Object.freeze({ prefix: 'metric_deviation', type: 'behavioural_anomaly' }),
  Object.freeze({ prefix: 'peer_trust_decrease', type: 'dependency_anomaly' }),
  Object.freeze({ prefix: 'neighbor_set_change', type: 'structural_anomaly' }),
  Object.freeze({ prefix: 'critical_infrastructure', type: 'other' }),
])

export function isKnownDetectionType(type) {
  return DETECTION_TYPES.includes(type)
}

export function detectionTypeLabel(type) {
  if (DETECTION_TYPE_LABELS[type]) return DETECTION_TYPE_LABELS[type]
  return String(type ?? 'unknown').replaceAll('_', ' ')
}

export function emptyIncident() {
  return {
    id: '',
    timestamp: null,
    endpointId: '',
    severity: 'low',
    confidence: 0,
    anomalyScore: 0,
    trustScore: 0,
    detectionType: 'behavioural_anomaly',
    evidence: [],
    explanation: '',
    explanationStatus: null,
    affectedDependencies: [],
  }
}

export function incidentId(endpointId, detectionType) {
  return `inc-${String(endpointId ?? '')}-${String(detectionType ?? 'unknown')}`
}

/**
 * Map a detector reason tag to a detection type. Unknown tags return null
 * so new detectors can attach evidence without forcing a type.
 */
export function mapReasonToType(reason) {
  const tag = String(reason ?? '')
  if (!tag) return null
  if (isKnownDetectionType(tag)) return tag
  for (const row of REASON_TYPE_PREFIXES) {
    if (tag === row.prefix || tag.startsWith(row.prefix)) return row.type
  }
  return null
}

export function primaryDetectionType(types, config = TRUST_CONFIG) {
  const known = [...new Set((types ?? []).filter(Boolean))]
  if (known.length === 0) return 'behavioural_anomaly'
  const priority = config.incident?.typePriority ?? TRUST_CONFIG.incident.typePriority
  for (const type of priority) {
    if (known.includes(type)) return type
  }
  return known[0]
}

export function severityFromScore(anomalyScore, criticality, config = TRUST_CONFIG) {
  const bands = config.incident?.severity ?? TRUST_CONFIG.incident.severity
  const score = Number(anomalyScore) || 0
  let level = 'low'
  if (score >= bands.criticalMinScore) level = 'critical'
  else if (score >= bands.highMinScore) level = 'high'
  else if (score >= bands.mediumMinScore) level = 'medium'

  const order = SEVERITY_LEVELS
  const crit = String(criticality ?? '').toLowerCase()
  let bump = 0
  if (crit === 'critical' && level !== 'critical') bump = 1
  else if (crit === 'high' && (level === 'low' || level === 'medium')) bump = 1
  const idx = Math.min(order.indexOf(level) + bump, order.length - 1)
  return order[idx]
}

export function confidenceFromSignals(
  { temporalScore = 0, isolationScore = 0, hasDrift = false, extraReasonCount = 0 },
  config = TRUST_CONFIG
) {
  const w = config.incident?.confidence ?? TRUST_CONFIG.incident.confidence
  const tgnnMin = config.incident?.tgnnSignalMin ?? TRUST_CONFIG.incident.tgnnSignalMin
  const temporalMin = config.incident?.temporalSignalMin ?? TRUST_CONFIG.incident.temporalSignalMin
  let c = 0
  if ((Number(temporalScore) || 0) >= temporalMin) {
    c += w.temporal * Math.min(1, Number(temporalScore) || 0)
  }
  if ((Number(isolationScore) || 0) >= tgnnMin) {
    c += w.tgnn * Math.min(1, Number(isolationScore) || 0)
  }
  if (hasDrift) c += w.drift
  const extras = Math.max(0, Number(extraReasonCount) || 0)
  c += Math.min(w.extraReasonCap, extras * w.extraReason)
  if (!Number.isFinite(c)) return 0
  return Math.max(0, Math.min(1, Math.round(c * 100) / 100))
}

export function evidenceFromReason(reason, score) {
  const tag = String(reason ?? '')
  const type = mapReasonToType(tag)
  const colon = tag.indexOf(':')
  const code = colon >= 0 ? tag.slice(0, colon) : tag
  const metric = colon >= 0 ? tag.slice(colon + 1) : undefined
  const item = {
    code: code || 'unknown',
    kind: type ?? 'other',
    detail: tag,
  }
  if (metric) item.metric = metric
  if (Number.isFinite(Number(score))) item.score = Number(score)
  return item
}

function signedPctLabel(n) {
  const v = Math.round(Number(n) || 0)
  if (v > 0) return `+${v}%`
  if (v < 0) return `${v}%`
  return '0%'
}

/**
 * Compact machine-readable line for UI and tests. Not a natural-language explanation.
 */
export function formatEvidenceItem(item) {
  if (!item || typeof item !== 'object') return ''
  const code = String(item.code ?? '')
  if (code === 'metric_deviation' && item.metric != null && Number.isFinite(Number(item.deviationPct))) {
    return `${item.metric} deviation: ${signedPctLabel(item.deviationPct)}`
  }
  if (code === 'edge_pps' && Number.isFinite(Number(item.deviationPct))) {
    return `packetsPerSecond deviation: ${signedPctLabel(item.deviationPct)}`
  }
  if (
    code === 'peer_trust_decrease' &&
    Number.isFinite(Number(item.previous)) &&
    Number.isFinite(Number(item.current))
  ) {
    return `peer trust decreased: ${Math.round(item.previous)} → ${Math.round(item.current)}`
  }
  if (code === 'neighbor_set_change') {
    const n = Math.round(Number(item.neighborDelta) || 0)
    const w = Number.isFinite(Number(item.windowSeconds)) ? Number(item.windowSeconds) : 8
    return `${n} neighbouring nodes changed within ${w} seconds`
  }
  if (code === 'critical_infrastructure') {
    return 'endpoint is critical infrastructure'
  }
  if (item.metric && Number.isFinite(Number(item.deviationPct))) {
    return `${item.metric} deviation: ${signedPctLabel(item.deviationPct)}`
  }
  if (item.detail) return String(item.detail)
  if (item.metric) return `${code}:${item.metric}`
  return code
}
