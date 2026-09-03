import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { blendTrust } from '../../shared/trustModel.js'
import {
  confidenceFromSignals,
  evidenceFromReason,
  incidentId,
  mapReasonToType,
  primaryDetectionType,
  severityFromScore,
} from '../../shared/incidents.js'
import { GAME_METRIC_KEYS, metricPresent } from '../../shared/telemetryKeys.js'
import { computeDeviationMetrics, computePeerTrustMetrics, expectedTelemetryOf, hasTelemetryDrift } from './features.js'

export const METRIC_DEVIATION_MIN_PCT = 5
export const NEIGHBOR_WINDOW_SECONDS = 8

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function uniqueEvidence(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    const key = `${item.code}|${item.kind}|${item.metric ?? ''}|${item.detail ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function endpointById(input) {
  const map = new Map()
  for (const ep of input?.endpoints ?? []) map.set(ep.id, ep)
  return map
}

function trustForEndpoint(ep, peerMetrics) {
  const part = peerMetrics.get(ep.id)
  const intrinsic = part?.intrinsicTrust ?? 0
  return blendTrust({
    intrinsic,
    peer: part?.peerTrust ?? intrinsic,
    behavioral: part?.behavioralComponent ?? intrinsic,
    interaction: part?.interactionComponent ?? intrinsic,
  })
}

function anomalyScoreOf(epId, result) {
  return clamp01(result.isolationScoresByNodeId?.[epId] ?? 0)
}

function signedDeviationPct(expected, observed) {
  const eps = Number(TRUST_CONFIG.eps) > 0 ? Number(TRUST_CONFIG.eps) : 1
  const base = Math.max(Number(expected) || 0, eps)
  return Math.round((((Number(observed) || 0) - (Number(expected) || 0)) / base) * 100)
}

function metricFactsOf(ep) {
  const expectedTel = expectedTelemetryOf(ep)
  /** @type {Record<string, { observed: number, expected: number, deviationPct: number }>} */
  const facts = {}
  for (const key of GAME_METRIC_KEYS) {
    if (!metricPresent(ep.telemetry, key) || !metricPresent(expectedTel, key)) continue
    const observed = Number(ep.telemetry[key])
    const expected = Number(expectedTel[key])
    facts[key] = {
      observed,
      expected,
      deviationPct: signedDeviationPct(expected, observed),
    }
  }
  return facts
}

function enrichReasonItem(item, metricFacts) {
  const facts = item.metric ? metricFacts[item.metric] : null
  if (!facts) return item
  return {
    ...item,
    observed: facts.observed,
    expected: facts.expected,
    deviationPct: facts.deviationPct,
  }
}

function metricDeviationEvidence(metricFacts) {
  const items = []
  for (const key of Object.keys(metricFacts)) {
    const facts = metricFacts[key]
    if (!facts || Math.abs(facts.deviationPct) < METRIC_DEVIATION_MIN_PCT) continue
    items.push({
      code: 'metric_deviation',
      kind: 'behavioural_anomaly',
      metric: key,
      observed: facts.observed,
      expected: facts.expected,
      deviationPct: facts.deviationPct,
      detail: `metric_deviation:${key}`,
    })
  }
  return items
}

function peerTrustEvidence(epId, peerMetrics, baselinePeerMetrics) {
  const current = peerMetrics.get(epId)?.peerTrust
  const previous = baselinePeerMetrics.get(epId)?.peerTrust
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return []
  const prevR = Math.round(previous)
  const currR = Math.round(current)
  if (currR >= prevR) return []
  return [
    {
      code: 'peer_trust_decrease',
      kind: 'dependency_anomaly',
      previous: prevR,
      current: currR,
      detail: `peer_trust_decrease:${prevR}->${currR}`,
    },
  ]
}

function neighborSetSymmetricDelta(a, b) {
  const A = new Set(a ?? [])
  const B = new Set(b ?? [])
  let n = 0
  for (const x of A) if (!B.has(x)) n += 1
  for (const x of B) if (!A.has(x)) n += 1
  return n
}

function currentNeighborIds(ep, input) {
  const ids = new Set((input?.endpoints ?? []).map((e) => e.id))
  const out = new Set()
  for (const d of input.dependencies ?? []) {
    if (!ids.has(d.source) || !ids.has(d.target)) continue
    if (d.source === ep.id) out.add(d.target)
    else if (d.target === ep.id) out.add(d.source)
  }
  return [...out]
}

function neighborChangeEvidence(ep, input) {
  const current = currentNeighborIds(ep, input)
  const tick = Number(input.simulationTick) || 0
  const series = Array.isArray(ep.neighborLookback) ? ep.neighborLookback : []
  let maxDelta = 0
  let previousCount = current.length
  for (const snap of series) {
    const snapTick = Number(snap?.tick) || 0
    if (tick - snapTick > NEIGHBOR_WINDOW_SECONDS || snapTick >= tick) continue
    const prior = Array.isArray(snap.neighborIds) ? snap.neighborIds : []
    const delta = neighborSetSymmetricDelta(current, prior)
    if (delta > maxDelta) {
      maxDelta = delta
      previousCount = prior.length
    }
  }
  if (maxDelta < 1) return []
  return [
    {
      code: 'neighbor_set_change',
      kind: 'structural_anomaly',
      neighborDelta: maxDelta,
      windowSeconds: NEIGHBOR_WINDOW_SECONDS,
      previousCount,
      currentCount: current.length,
      detail: `neighbor_set_change:${maxDelta}@${NEIGHBOR_WINDOW_SECONDS}s`,
    },
  ]
}

function criticalityEvidence(ep) {
  const crit = String(ep.criticality ?? '').toLowerCase()
  if (crit !== 'high' && crit !== 'critical') return []
  return [
    {
      code: 'critical_infrastructure',
      kind: 'other',
      criticality: String(ep.criticality ?? ''),
      sector: String(ep.sector ?? ''),
      detail: 'endpoint is critical infrastructure',
    },
  ]
}

function communicationEvidence(ep, input, config) {
  const ratioMin = config.incident.communicationDeviationRatio
  const items = []
  const types = []
  for (const d of input.dependencies ?? []) {
    if (d.source !== ep.id && d.target !== ep.id) continue
    const expected =
      d.expectedPacketsPerSecond != null
        ? d.expectedPacketsPerSecond
        : d.baselinePacketsPerSecond != null
          ? d.baselinePacketsPerSecond
          : d.packetsPerSecond
    const observed = Number(d.packetsPerSecond) || 0
    const { deviationRatio } = computeDeviationMetrics({
      baselinePps: expected,
      effectivePps: observed,
    })
    if (deviationRatio < ratioMin) continue
    types.push('communication_anomaly')
    items.push({
      code: 'edge_pps',
      kind: 'communication_anomaly',
      metric: 'packetsPerSecond',
      observed,
      expected,
      deviationPct: signedDeviationPct(expected, observed),
      score: clamp01(deviationRatio),
      detail: `edge_pps:${d.id}`,
    })
  }
  return { items, types }
}

function dependencyEvidence(ep, peerMetrics, config) {
  const below = config.incident.dependencyTrustBelow
  const interaction = peerMetrics.get(ep.id)?.interactionComponent
  if (!Number.isFinite(interaction) || interaction >= below) {
    return { items: [], types: [] }
  }
  return {
    types: ['dependency_anomaly'],
    items: [
      {
        code: 'edge_contract',
        kind: 'dependency_anomaly',
        score: clamp01(1 - interaction / 100),
        detail: `edge_contract:interaction=${Math.round(interaction)}`,
      },
    ],
  }
}

function affectedDependenciesFor(epId, _input, result) {
  // If the incident seed is the source, return the downstream path from propagation
  const paths = []
  if (result?.propagationPaths) {
    for (const [nodeId, path] of Object.entries(result.propagationPaths)) {
      if (path[0] === epId) {
        paths.push({ nodeId, path })
      }
    }
  }
  return paths
}

function illustrativeImpactOf(ep, metricFacts) {
  const sector = String(ep.sector ?? '').toLowerCase()
  const type = String(ep.type ?? ep.assetType ?? '').toLowerCase()
  const finance =
    sector.includes('finance') ||
    type.includes('bank') ||
    type.includes('payment')
  if (!finance) return null
  const maxDev = Math.max(
    0,
    ...metricFacts.map((f) => Math.abs(Number(f.deviationPct) || 0))
  )
  const crit =
    ep.criticality === 'critical' ? 1.4 : ep.criticality === 'high' ? 1.2 : 1
  return {
    kind: 'illustrative',
    label: 'Simulated disruption index (not a loss estimate)',
    value: Math.round(maxDev * crit),
  }
}

function buildIncident({
  ep,
  result,
  input,
  peerMetrics,
  baselinePeerMetrics,
  reasons,
  extraEvidence,
  extraTypes,
}) {
  const timestamp = result.timestamp ?? input.timestamp ?? null
  const isolationScore = clamp01(result.isolationScoresByNodeId?.[ep.id] ?? 0)
  const score = anomalyScoreOf(ep.id, result)
  const expected = expectedTelemetryOf(ep)
  const drift = hasTelemetryDrift(expected, ep.telemetry)
  const metricFacts = metricFactsOf(ep)

  const typesFromReasons = reasons.map(mapReasonToType).filter(Boolean)
  const detectionTypes = [...new Set([...typesFromReasons, ...extraTypes])]
  const detectionType = primaryDetectionType(
    detectionTypes.length ? detectionTypes : ['behavioural_anomaly']
  )
  const mappedReasonCount = reasons.filter((tag) => mapReasonToType(tag) != null).length
  const extraReasonCount = Math.max(0, reasons.length - mappedReasonCount) + extraEvidence.length

  const structured = [
    ...metricDeviationEvidence(metricFacts),
    ...peerTrustEvidence(ep.id, peerMetrics, baselinePeerMetrics),
    ...neighborChangeEvidence(ep, input),
    ...criticalityEvidence(ep),
  ]
  const evidence = uniqueEvidence([
    ...reasons.map((tag) => enrichReasonItem(evidenceFromReason(tag, score), metricFacts)),
    ...extraEvidence,
    ...structured,
  ])
  if (evidence.length === 0) {
    evidence.push({
      code: 'anomaly',
      kind: detectionType,
      score,
      detail: 'anomaly_score',
    })
  }

  return {
    id: incidentId(ep.id),
    timestamp,
    endpointId: ep.id,
    endpointLabel: ep.label ?? ep.id,
    severity: severityFromScore(score, ep.criticality),
    confidence: confidenceFromSignals({
      isolationScore,
      hasDrift: drift,
      extraReasonCount,
    }),
    anomalyScore: Math.round(score * 1000) / 1000,
    trustScore: trustForEndpoint(ep, peerMetrics),
    detectionType,
    detectionTypes,
    evidence,
    affectedDependencies: affectedDependenciesFor(ep.id, input, result),
    peerExposedNodeIds: result.peerExposedNodeIds || [],
    propagatedNodeIds: result.propagatedNodeIds || [],
    propagationPaths: result.propagationPaths || {},
    cityContext: input.cityContext ?? ep.activeContexts?.cityContext,
    criticality: ep.criticality,
    sector: ep.sector,
    cityEndpointId: ep.cityEndpointId,
    campaignId: null,
    illustrativeImpact: illustrativeImpactOf(ep, metricFacts),
  }
}

/**
 * Promote detections that already passed engine criteria into Incident records.
 *
 * @param {ReturnType<typeof import('./types.js').emptyDetectionResult>} result
 * @param {import('./types.js').DetectionInput} input
 */
export function promoteIncidents(result, input) {
  if (!result || !input?.endpoints?.length) return []

  const config = TRUST_CONFIG
  const endpoints = endpointById(input)
  const peerMetrics = computePeerTrustMetrics(input)
  const baselinePeerMetrics = computePeerTrustMetrics(input, 'baseline')
  const anomalyIds = new Set(result.anomalyNodeIds ?? [])

  const incidents = []
  const seen = new Set()

  const consider = (epId) => {
    const ep = endpoints.get(epId)
    if (!ep) return
    if (seen.has(epId)) return
    seen.add(epId)

    const reasons = result.reasonsByNodeId?.[epId] ?? []
    const comm = communicationEvidence(ep, input, config)
    const dep = dependencyEvidence(ep, peerMetrics, config)
    const extraEvidence = [...comm.items, ...dep.items]
    const extraTypes = [...comm.types, ...dep.types]

    incidents.push(
      buildIncident({
        ep,
        result,
        input,
        peerMetrics,
        baselinePeerMetrics,
        reasons,
        extraEvidence,
        extraTypes,
      })
    )
  }

  for (const id of anomalyIds) consider(id)

  incidents.sort((a, b) => String(a.endpointId).localeCompare(String(b.endpointId)))
  return incidents
}
