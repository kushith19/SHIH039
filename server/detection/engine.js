import { emptyDetectionResult } from './types.js'
import { runTgnnAnomaly } from './tgnn.js'
import { computeAttackSpread } from './spread.js'
import { promoteIncidents } from './incident.js'
import { DETECTION_MODE_TGNN } from './modes.js'

export { DETECTION_MODE_TGNN }

function spreadHits(input, spread) {
  const spreadSet = new Set(spread.spreadEdgeIds)
  return input.dependencies
    .filter((d) => spreadSet.has(d.id))
    .map((d) => ({
      id: d.id,
      label: d.id,
      onSpreadPath: true,
    }))
}

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
  const spread = computeAttackSpread({
    input,
    anomalyNodeIds: tgnnResult.anomalyNodeIds,
  })
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
  const result = {
    nodes: nodeHits,
    edges: spreadHits(input, spread),
    anomalyNodeIds: tgnnResult.anomalyNodeIds,
    spreadEdgeIds: spread.spreadEdgeIds,
    compromisedNodeIds: spread.compromisedNodeIds,
    atRiskNodeIds: spread.atRiskNodeIds ?? [],
    atRiskEdgeIds: spread.atRiskEdgeIds ?? [],
    primarySpreadNodeId: spread.primarySpreadNodeId ?? null,
    primarySpreadEdgeId: spread.primarySpreadEdgeId ?? null,
    isolationScoresByNodeId: tgnnResult.isolationScoresByNodeId,
    reasonsByNodeId,
    detectionMode: DETECTION_MODE_TGNN,
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
