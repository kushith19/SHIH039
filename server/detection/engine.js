import { emptyDetectionResult } from './types.js'
import { runTgnnAnomaly } from './tgnn.js'
import { promoteIncidents } from './incident.js'
import { DETECTION_MODE_TGNN } from './modes.js'
import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { peerExposureFromFlags } from '../../shared/trustModel.js'
import { propagateGraphRisk } from '../../shared/graphPropagation.js'
import { rankPropagationCandidates } from '../../shared/propagationRisk.js'
import { applySpreadTargetLocks } from '../../shared/spreadTargetLock.js'
import { computePeerTrustMetrics } from './features.js'

export { DETECTION_MODE_TGNN }

/**
 * Run TGNN detection on a normalized DetectionInput (never a CitySnapshot or room).
 *
 * Optional `opts.spreadTargetBySeedId` enables sticky per-seed next-target locks
 * (mutated in place). Ranking still runs every call; only published primary* fields
 * are gated. Omit opts for pure ranking (unit tests).
 *
 * @param {import('./types.js').DetectionInput} input
 * @param {{
 *   spreadTargetBySeedId?: Record<string, object>
 *   quarantinedNodeIds?: Iterable<string>
 * }} [opts]
 */
export function runDetection(input, opts = {}) {
  if (!input?.matchActive || !input.endpoints?.length) {
    return {
      ...emptyDetectionResult(),
      simulationTick: input?.simulationTick ?? 0,
      cityContext: input?.cityContext ?? 'normal_day',
      simHour: input?.simHour,
      timestamp: input?.timestamp ?? null,
    }
  }

  const tgnnResult = runTgnnAnomaly(input)
  const nodeHits = tgnnResult.nodeResults
    .filter((r) => r.isAnomaly)
    .map((r) => ({
      id: r.id,
      label: r.label,
      isolationScore: r.isolationScore,
      isAnomaly: true,
    }))
  const reasonsByNodeId = {}
  for (const id of tgnnResult.anomalyNodeIds) {
    reasonsByNodeId[id] = ['tgnn_embed']
  }
  const knownIds = new Set((input.endpoints ?? []).map((ep) => ep.id))
  const exposure = peerExposureFromFlags(
    input.dependencies,
    tgnnResult.anomalyNodeIds,
    knownIds
  )

  const maxHops = TRUST_CONFIG.spread?.maxHops ?? 3
  const decayFactor = TRUST_CONFIG.spread?.decayFactor ?? 0.5

  // Reachability / paths (unchanged BFS). Hop-attenuation map is discovery-only;
  // primarySpread ranking uses composite scores from rankPropagationCandidates.
  const propagation = propagateGraphRisk({
    edges: input.dependencies,
    seedNodeIds: tgnnResult.anomalyNodeIds,
    validNodeIds: knownIds,
    maxHops,
    decayFactor,
  })

  const peerMetrics = computePeerTrustMetrics(input)
  const ranked = rankPropagationCandidates({
    edges: input.dependencies,
    seedNodeIds: tgnnResult.anomalyNodeIds,
    validNodeIds: knownIds,
    maxHops,
    peerMetricsByNodeId: peerMetrics,
    isolationScoresByNodeId: tgnnResult.isolationScoresByNodeId,
  })

  const quarantinedFromInput = (input.endpoints ?? [])
    .filter((ep) => ep.runtimeState?.quarantined === true)
    .map((ep) => ep.id)
  const quarantinedNodeIds = new Set([
    ...quarantinedFromInput,
    ...(opts.quarantinedNodeIds ?? []),
  ].map(String))

  let primarySpreadNodeId = ranked.primarySpreadNodeId
  let primarySpreadEdgeId = ranked.primarySpreadEdgeId
  let primarySpreadAssessment = ranked.primarySpreadAssessment
  let spreadTargetBySeedId = null

  if (opts.spreadTargetBySeedId && typeof opts.spreadTargetBySeedId === 'object') {
    const published = applySpreadTargetLocks({
      locks: opts.spreadTargetBySeedId,
      anomalyNodeIds: tgnnResult.anomalyNodeIds,
      assessmentsBySeedId: ranked.assessmentsBySeedId ?? {},
      knownNodeIds: knownIds,
      quarantinedNodeIds,
      edges: input.dependencies,
      simulationTick: input.simulationTick,
    })
    primarySpreadNodeId = published.primarySpreadNodeId
    primarySpreadEdgeId = published.primarySpreadEdgeId
    primarySpreadAssessment = published.primarySpreadAssessment
    spreadTargetBySeedId = opts.spreadTargetBySeedId
  }

  const result = {
    nodes: nodeHits,
    edges: [],
    anomalyNodeIds: tgnnResult.anomalyNodeIds,
    peerExposedNodeIds: exposure.atRiskNodeIds, // Semantic alias for clarity
    propagatedNodeIds: propagation.propagatedNodeIds,
    propagationPaths: propagation.propagationPaths,
    // Live composite scores (still recalculated every tick for analysis).
    propagationRiskByNode: ranked.propagationRiskByNode,
    spreadEdgeIds: [],
    compromisedNodeIds: [...tgnnResult.anomalyNodeIds],
    // Maintain atRiskNodeIds as a backwards-compatible union for frontend visual state
    atRiskNodeIds: [...new Set([...exposure.atRiskNodeIds, ...propagation.propagatedNodeIds])].sort(),
    atRiskEdgeIds: exposure.atRiskEdgeIds,
    primarySpreadNodeId,
    primarySpreadEdgeId,
    primarySpreadAssessment,
    // Sticky map reference for incident seed-scope (room-owned; not required on wire).
    spreadTargetBySeedId,
    isolationScoresByNodeId: tgnnResult.isolationScoresByNodeId,
    reasonsByNodeId,
    detectionMode: DETECTION_MODE_TGNN,
    tgnnCalibrating: tgnnResult.tgnnCalibrating === true,
    tgnnWarmupCollected: tgnnResult.tgnnWarmupCollected ?? 0,
    tgnnWarmupTicks: tgnnResult.tgnnWarmupTicks ?? TRUST_CONFIG.tgnn.warmupTicks ?? 15,
    tgnnSkippedAttackTicks: tgnnResult.tgnnSkippedAttackTicks ?? 0,
    simulationTick: input.simulationTick,
    cityContext: input.cityContext ?? 'normal_day',
    simHour: input.simHour,
    timestamp: input.timestamp,
  }
  return {
    ...result,
    // Room owns sticky map; omit from published detection payload (avoids dual sources of truth on the wire).
    spreadTargetBySeedId: undefined,
    incidents: promoteIncidents(result, input),
  }
}
