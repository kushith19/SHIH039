import { emptyDetectionResult } from './types.js'
import { runTgnnAnomaly } from './tgnn.js'
import { computeAttackSpread } from './spread.js'
import { scoreTemporal } from './temporal.js'
import { fuseScores } from './fusion.js'
import { promoteIncidents } from './incident.js'
import {
  DETECTION_MODE_FUSION,
  DETECTION_MODE_TGNN,
  normalizeDetectionMode,
} from './modes.js'

export { DETECTION_MODE_FUSION, DETECTION_MODE_TGNN, normalizeDetectionMode }

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

function runTgnnOnly(input) {
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
  return {
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
    temporalScoresByNodeId: {},
    fusedScoresByNodeId: {},
    reasonsByNodeId,
    detectionMode: DETECTION_MODE_TGNN,
    simulationTick: input.simulationTick,
    cityContext: input.cityContext ?? 'normal_day',
    simHour: input.simHour,
    timestamp: input.timestamp,
  }
}

function runFusion(input) {
  const temporal = scoreTemporal(input)
  const tgnnResult = runTgnnAnomaly(input)
  const fused = fuseScores({
    input,
    temporal,
    tgnn: tgnnResult,
  })
  const spread = computeAttackSpread({
    input,
    anomalyNodeIds: fused.anomalyNodeIds,
  })
  const nodeHits = fused.nodeResults
    .filter((r) => r.isAnomaly)
    .map((r) => ({
      id: r.id,
      label: r.label,
      isolationScore: r.isolationScore,
      temporalScore: r.temporalScore,
      fusedScore: r.fusedScore,
      reasons: r.reasons,
      isAnomaly: true,
    }))
  return {
    nodes: nodeHits,
    edges: spreadHits(input, spread),
    anomalyNodeIds: fused.anomalyNodeIds,
    spreadEdgeIds: spread.spreadEdgeIds,
    compromisedNodeIds: spread.compromisedNodeIds,
    atRiskNodeIds: spread.atRiskNodeIds ?? [],
    atRiskEdgeIds: spread.atRiskEdgeIds ?? [],
    primarySpreadNodeId: spread.primarySpreadNodeId ?? null,
    primarySpreadEdgeId: spread.primarySpreadEdgeId ?? null,
    isolationScoresByNodeId: tgnnResult.isolationScoresByNodeId,
    temporalScoresByNodeId: temporal.scoresByNodeId,
    fusedScoresByNodeId: fused.fusedScoresByNodeId,
    reasonsByNodeId: fused.reasonsByNodeId,
    detectionMode: DETECTION_MODE_FUSION,
    simulationTick: input.simulationTick,
    cityContext: input.cityContext ?? 'normal_day',
    simHour: input.simHour,
    timestamp: input.timestamp,
  }
}

/**
 * Run detection on a normalized DetectionInput (never a CitySnapshot or room).
 *
 * @param {import('./types.js').DetectionInput} input
 * @param {string} [mode]
 */
export function runDetection(input, mode) {
  if (!input?.matchActive || !input.endpoints?.length) {
    return {
      ...emptyDetectionResult(),
      detectionMode: normalizeDetectionMode(mode),
      simulationTick: input?.simulationTick ?? 0,
      cityContext: input?.cityContext ?? 'normal_day',
      simHour: input?.simHour,
      timestamp: input?.timestamp ?? null,
    }
  }

  const resolved = normalizeDetectionMode(mode ?? input.detectionMode)
  const result = resolved === DETECTION_MODE_TGNN ? runTgnnOnly(input) : runFusion(input)
  return {
    ...result,
    incidents: promoteIncidents(result, input),
  }
}
