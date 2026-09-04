import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import {
  behavioralFromMetrics,
  computeBehavioralTrustComponent as modelBehavioralComponent,
  computeDeviationMetrics as modelDeviationMetrics,
  interactionFromIncidents,
  localPosture,
  maxMetricDeviation as modelMaxMetricDeviation,
  peerFromNeighborLocal,
  undirectedNeighbors,
} from '../../shared/trustModel.js'
import { resolveExpectedTelemetry } from '../../shared/cityContext.js'
import { getTelemetryKeys } from '../../shared/telemetryKeys.js'
import { endpointIntrinsicTrust } from '../infrastructureNode.js'

export const BEHAVIORAL_TRUST_FULL_PENALTY_RATIO = TRUST_CONFIG.behavioral.fullPenaltyRatio

export function expectedTelemetryOf(ep) {
  return resolveExpectedTelemetry(ep)
}

export function cityContextOf(ep, input) {
  return String(ep?.activeContexts?.cityContext ?? input?.cityContext ?? 'normal_day')
}

export function computeDeviationMetrics({ baselinePps, effectivePps, metricKey }) {
  return modelDeviationMetrics({ baselinePps, effectivePps, metricKey })
}

export function computeBehavioralTrustComponent({ baselinePps, effectivePps }) {
  return modelBehavioralComponent({ baselinePps, effectivePps })
}

function telemetryMode(ep, mode) {
  return mode === 'baseline' ? expectedTelemetryOf(ep) : ep.telemetry
}

function incidentsForEndpoint(endpointId, input, mode = 'effective') {
  const ids = new Set(input.endpoints.map((e) => e.id))
  const ppsById = new Map(
    input.endpoints.map((e) => [e.id, telemetryMode(e, mode).packetsPerSecond])
  )
  const incidents = []
  for (const d of input.dependencies) {
    if (d.source !== endpointId && d.target !== endpointId) continue
    if (!ids.has(d.source) || !ids.has(d.target)) continue
    const edgeEffective = d.packetsPerSecond
    const edgeExpected =
      d.expectedPacketsPerSecond != null
        ? d.expectedPacketsPerSecond
        : d.baselinePacketsPerSecond != null
          ? d.baselinePacketsPerSecond
          : d.packetsPerSecond
    incidents.push({
      role: d.target === endpointId ? 'upstream' : 'downstream',
      edgeEffective: mode === 'baseline' ? edgeExpected : edgeEffective,
      edgeBaseline: edgeExpected,
      srcPps: ppsById.get(d.source) ?? 0,
      tgtPps: ppsById.get(d.target) ?? 0,
    })
  }
  return incidents
}

/**
 * @param {import('./types.js').DetectionInput} input
 * @param {'baseline' | 'effective'} [mode]
 */
export function computePeerTrustMetrics(input, mode = 'effective') {
  const ids = new Set(input.endpoints.map((e) => e.id))
  const neighbors = undirectedNeighbors(input.dependencies, ids)
  const localById = new Map()
  const parts = new Map()

  for (const ep of input.endpoints) {
    const intrinsicTrust = endpointIntrinsicTrust(ep)
    const expected = expectedTelemetryOf(ep)
    const effective = telemetryMode(ep, mode)
    const behavioral = behavioralFromMetrics(
      expected,
      effective,
      getTelemetryKeys(),
      TRUST_CONFIG,
      cityContextOf(ep, input)
    )
    const interactionComponent = interactionFromIncidents(
      incidentsForEndpoint(ep.id, input, mode)
    )
    const local = localPosture({
      intrinsic: intrinsicTrust,
      behavioral: behavioral.score,
      interaction: interactionComponent,
    })
    localById.set(ep.id, local)
    parts.set(ep.id, {
      intrinsicTrust,
      behavioralComponent: behavioral.score,
      interactionComponent,
      local,
    })
  }

  const metrics = new Map()
  for (const ep of input.endpoints) {
    const peerSet = neighbors.get(ep.id)
    const neighborIds = peerSet ? [...peerSet] : []
    const peerTrust = peerFromNeighborLocal(localById, neighborIds, ep.id)
    const part = parts.get(ep.id)
    metrics.set(ep.id, {
      peerTrust,
      degree: neighborIds.length,
      local: part.local,
      behavioralComponent: part.behavioralComponent,
      interactionComponent: part.interactionComponent,
      intrinsicTrust: part.intrinsicTrust,
    })
  }
  return metrics
}

/**
 * @param {string} endpointId
 * @param {import('./types.js').DetectionInput} input
 * @param {'baseline' | 'effective'} [mode]
 */
export function computeInteractionTrustComponent(endpointId, input, mode = 'effective') {
  return interactionFromIncidents(incidentsForEndpoint(endpointId, input, mode))
}

export function maxMetricDeviation(expected, observed) {
  return modelMaxMetricDeviation(expected, observed, getTelemetryKeys())
}

export function hasTelemetryDrift(expected, observed) {
  return maxMetricDeviation(expected, observed) >= TRUST_CONFIG.tgnn.minDeviationRatio
}
