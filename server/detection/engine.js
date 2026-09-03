import { emptyDetectionResult } from './types.js'
import { runTgnnAnomaly } from './tgnn.js'
import { promoteIncidents } from './incident.js'
import { DETECTION_MODE_TGNN } from './modes.js'
import { TRUST_CONFIG } from '../../shared/trustConfig.js'

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
  const result = {
    nodes: nodeHits,
    edges: [],
    anomalyNodeIds: tgnnResult.anomalyNodeIds,
    spreadEdgeIds: [],
    compromisedNodeIds: [...tgnnResult.anomalyNodeIds],
    atRiskNodeIds: [],
    atRiskEdgeIds: [],
    primarySpreadNodeId: null,
    primarySpreadEdgeId: null,
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
