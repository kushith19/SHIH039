import { emptyDetectionResult } from './types.js'
import { runTgnnAnomaly } from './tgnn.js'
import { promoteIncidents } from './incident.js'
import { DETECTION_MODE_TGNN } from './modes.js'
import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { peerExposureFromFlags } from '../../shared/trustModel.js'
import { propagateGraphRisk } from '../../shared/graphPropagation.js'

export { DETECTION_MODE_TGNN }

/**
 * Run TGNN detection on a normalized DetectionInput (never a CitySnapshot or room).
 *
 * @param {import('./types.js').DetectionInput} input
 */
export function runDetection(input) {
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
  
  const propagation = propagateGraphRisk({
    edges: input.dependencies,
    seedNodeIds: tgnnResult.anomalyNodeIds,
    validNodeIds: knownIds,
    maxHops: 3,
    decayFactor: 0.5,
  })

  const result = {
    nodes: nodeHits,
    edges: [],
    anomalyNodeIds: tgnnResult.anomalyNodeIds,
    peerExposedNodeIds: exposure.atRiskNodeIds, // Semantic alias for clarity
    propagatedNodeIds: propagation.propagatedNodeIds,
    propagationPaths: propagation.propagationPaths,
    propagationRiskByNode: propagation.propagationRiskByNode,
    spreadEdgeIds: [],
    compromisedNodeIds: [...tgnnResult.anomalyNodeIds],
    // Maintain atRiskNodeIds as a backwards-compatible union for frontend visual state
    atRiskNodeIds: [...new Set([...exposure.atRiskNodeIds, ...propagation.propagatedNodeIds])].sort(),
    atRiskEdgeIds: exposure.atRiskEdgeIds,
    primarySpreadNodeId: (() => {
      const seedSet = new Set(tgnnResult.anomalyNodeIds)
      let best = null
      let bestRisk = -Infinity
      for (const [nodeId, risk] of Object.entries(propagation.propagationRiskByNode ?? {})) {
        if (seedSet.has(nodeId)) continue
        if (risk > bestRisk) { bestRisk = risk; best = nodeId }
      }
      return best
    })(),
    primarySpreadEdgeId: (() => {
      const seedSet = new Set(tgnnResult.anomalyNodeIds)
      let best = null
      let bestRisk = -Infinity
      for (const [nodeId, risk] of Object.entries(propagation.propagationRiskByNode ?? {})) {
        if (seedSet.has(nodeId)) continue
        if (risk > bestRisk) { bestRisk = risk; best = nodeId }
      }
      if (!best) return null
      const edge = (input.dependencies ?? []).find(
        (e) => (seedSet.has(String(e.source ?? '')) && String(e.target ?? '') === best) ||
                (seedSet.has(String(e.target ?? '')) && String(e.source ?? '') === best)
      )
      return edge?.id ?? null
    })(),
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
    incidents: promoteIncidents(result, input),
  }
}
