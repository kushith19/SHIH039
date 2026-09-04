import { TRUST_CONFIG } from '@shared/trustConfig.js'
import { distToScore, l2Distance, tgnnForwardWindow } from '@shared/tgnnCore.js'
import {
  directedAdjacency,
  extractCityFeatureFrame,
} from '@shared/tgnnFeatures.js'
import { getTelemetryKeys, metricPresent } from '@shared/telemetryKeys.js'
import { maxMetricDeviation } from '@shared/trustModel.js'
import {
  computeDeviationMetrics,
  getNodeEffectiveMetrics,
  getNodeExpectedMetrics,
} from './peerTrust'
import { buildClientTgnnWindows } from './tgnnWindow'

/** Absolute TGNN score floor for anomaly flagging. */
export const TGNN_ANOMALY_SCORE_THRESHOLD = TRUST_CONFIG.tgnn.anomalyScoreThreshold

/** Relative detection among drift candidates. */
export const TGNN_RELATIVE_MIN_SCORE = TRUST_CONFIG.tgnn.relativeMinScore
export const TGNN_MIN_SCORE_GAP = TRUST_CONFIG.tgnn.minScoreGap
export const TGNN_MIN_SPREAD = TRUST_CONFIG.tgnn.minSpread

/** Minimum relative metric change to count as a drift candidate. */
export const TGNN_MIN_DEVIATION_RATIO = TRUST_CONFIG.tgnn.minDeviationRatio

/** Single-metric spike counts as a drift candidate. */
export const TGNN_METRIC_SPIKE_DEVIATION_RATIO = TRUST_CONFIG.tgnn.metricSpikeDeviationRatio

/** Small-graph fallback score floor. */
export const TGNN_SMALL_GRAPH_MIN_SCORE = TRUST_CONFIG.tgnn.smallGraphMinScore

const MIN_NODES_FOR_FULL_CLASSIFY = TRUST_CONFIG.tgnn.minNodesForFullClassify

function framesFromStates(states) {
  return states.map((state) => extractCityFeatureFrame(state).X)
}

/**
 * Current-tick city feature matrix (inspector / debug). Swap channels in
 * `@shared/tgnnFeatures.js`, not here.
 */
export function buildNodeFeatureMatrix(nodes, edges, sim, mode) {
  const { observed, baseline } = buildClientTgnnWindows(nodes, edges, sim)
  const state = mode === 'baseline' ? baseline[baseline.length - 1] : observed[observed.length - 1]
  return extractCityFeatureFrame(state).rows
}

/**
 * @param {number[]} scores
 * @param {boolean[]} hasScenarioDrift
 * @param {number[]} deviationRatios
 * @param {boolean[]} [hasMetricSpike]
 */
export function classifyTgnnScores(
  scores,
  hasScenarioDrift,
  deviationRatios,
  hasMetricSpike = []
) {
  if (scores.length === 0) return []

  const driftIndices = []
  for (let i = 0; i < scores.length; i++) {
    const meetsDeviation =
      (deviationRatios[i] ?? 0) >= TGNN_MIN_DEVIATION_RATIO ||
      hasMetricSpike[i] === true
    if (hasScenarioDrift[i] && meetsDeviation) {
      driftIndices.push(i)
    }
  }

  if (driftIndices.length === 0) {
    return scores.map(() => false)
  }

  const driftScores = driftIndices.map((i) => scores[i])
  const driftMax = Math.max(...driftScores)
  const driftMin = Math.min(...driftScores)
  const driftSpread = driftMax - driftMin
  const sortedDrift = [...driftScores].sort((a, b) => b - a)
  const driftGap = driftMax - (sortedDrift[1] ?? driftMin)
  const spreadAndGapMet =
    driftSpread >= TGNN_MIN_SPREAD && driftGap >= TGNN_MIN_SCORE_GAP

  return scores.map((score, i) => {
    if (!driftIndices.includes(i)) return false
    if (!hasScenarioDrift[i]) return false
    const meetsDeviation =
      (deviationRatios[i] ?? 0) >= TGNN_MIN_DEVIATION_RATIO ||
      hasMetricSpike[i] === true
    if (!meetsDeviation) return false

    return (
      score >= TGNN_ANOMALY_SCORE_THRESHOLD &&
      (score >= TGNN_RELATIVE_MIN_SCORE || spreadAndGapMet)
    )
  })
}

function classifySmallGraphFallback(
  scores,
  hasScenarioDrift,
  deviationRatios,
  hasMetricSpike = []
) {
  if (scores.length === 0) return []
  return scores.map((score, i) => {
    if (!hasScenarioDrift[i]) return false
    const meetsDeviation =
      (deviationRatios[i] ?? 0) >= TGNN_MIN_DEVIATION_RATIO ||
      hasMetricSpike[i] === true
    if (!meetsDeviation) return false
    return score >= TGNN_SMALL_GRAPH_MIN_SCORE
  })
}

function collectDriftSignals(nodes, sim) {
  const hasScenarioDrift = nodes.map((n) => {
    const expected = getNodeExpectedMetrics(n, sim)
    const effective = getNodeEffectiveMetrics(n, sim)
    return maxMetricDeviation(expected, effective, getTelemetryKeys()) >= TGNN_MIN_DEVIATION_RATIO
  })
  const deviationRatios = nodes.map((n) => {
    const expected = getNodeExpectedMetrics(n, sim)
    const effective = getNodeEffectiveMetrics(n, sim)
    return maxMetricDeviation(expected, effective, getTelemetryKeys())
  })
  const hasMetricSpike = nodes.map((n, i) => {
    if (!hasScenarioDrift[i]) return false
    const expected = getNodeExpectedMetrics(n, sim)
    const effective = getNodeEffectiveMetrics(n, sim)
    for (const key of getTelemetryKeys()) {
      if (!metricPresent(expected, key) || !metricPresent(effective, key)) continue
      const { deviationRatio } = computeDeviationMetrics({
        baselinePps: expected[key],
        effectivePps: effective[key],
        metricKey: key,
      })
      if (deviationRatio >= TGNN_METRIC_SPIKE_DEVIATION_RATIO) return true
    }
    return false
  })
  return { hasScenarioDrift, deviationRatios, hasMetricSpike }
}

function computeTgnnScores(nodes, edges, sim) {
  const { observed, baseline } = buildClientTgnnWindows(nodes, edges, sim)
  const nodeIds = nodes.map((n) => n.id)
  const { adjIn, adjOut } = directedAdjacency(nodeIds, observed[observed.length - 1].dependencies)
  const currentEmb = tgnnForwardWindow(framesFromStates(observed), adjIn, adjOut)
  const baselineEmb = tgnnForwardWindow(framesFromStates(baseline), adjIn, adjOut)
  return nodes.map((_, i) => distToScore(l2Distance(currentEmb[i], baselineEmb[i])))
}

/**
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @param {import('./peerTrust').HackSim | null | undefined} sim
 */
export function runTgnnAnomaly(nodes, edges, sim) {
  if (sim?.active !== true || nodes.length === 0) {
    return {
      isolationScoresByNodeId: {},
      anomalyNodeIds: [],
      nodeResults: [],
    }
  }

  const scoreList = computeTgnnScores(nodes, edges, sim)
  const { hasScenarioDrift, deviationRatios, hasMetricSpike } =
    collectDriftSignals(nodes, sim)

  const anomalyFlags =
    nodes.length < MIN_NODES_FOR_FULL_CLASSIFY
      ? classifySmallGraphFallback(
          scoreList,
          hasScenarioDrift,
          deviationRatios,
          hasMetricSpike
        )
      : classifyTgnnScores(
          scoreList,
          hasScenarioDrift,
          deviationRatios,
          hasMetricSpike
        )

  /** @type {Record<string, number>} */
  const isolationScoresByNodeId = {}
  /** @type {string[]} */
  const anomalyNodeIds = []
  /** @type {Array<{ id: string, label: string, isolationScore: number, isAnomaly: boolean }>} */
  const nodeResults = []

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const score = scoreList[i]
    const isAnomaly = anomalyFlags[i] === true

    isolationScoresByNodeId[n.id] = score
    if (isAnomaly) anomalyNodeIds.push(n.id)

    nodeResults.push({
      id: n.id,
      label: String(n.data?.label ?? n.id),
      isolationScore: score,
      isAnomaly,
    })
  }

  return { isolationScoresByNodeId, anomalyNodeIds, nodeResults }
}

/**
 * @param {string} nodeId
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @param {import('./peerTrust').HackSim | null | undefined} sim
 * @param {Record<string, number>} [scoresByNodeId]
 */
export function getNodeTgnnResult(nodeId, nodes, edges, sim, scoresByNodeId) {
  if (sim?.active !== true) {
    return { isolationScore: 0.5, isAnomaly: false }
  }

  if (scoresByNodeId && typeof scoresByNodeId === 'object') {
    const isolationScore = scoresByNodeId[nodeId] ?? 0.5
    if (Array.isArray(sim.anomalyNodeIds)) {
      return {
        isolationScore,
        isAnomaly: sim.anomalyNodeIds.includes(nodeId),
      }
    }
    return {
      isolationScore,
      isAnomaly: isolationScore >= TGNN_ANOMALY_SCORE_THRESHOLD,
    }
  }

  if (Array.isArray(sim.anomalyNodeIds)) {
    return {
      isolationScore: 0.5,
      isAnomaly: sim.anomalyNodeIds.includes(nodeId),
    }
  }

  const fullResult = runTgnnAnomaly(nodes, edges, sim)

  const scores = fullResult?.isolationScoresByNodeId ?? {}
  const scoreList = nodes.map((n) => scores[n.id] ?? 0.5)
  const { hasScenarioDrift, deviationRatios, hasMetricSpike } =
    collectDriftSignals(nodes, sim)

  const anomalyFlags =
    nodes.length < MIN_NODES_FOR_FULL_CLASSIFY
      ? classifySmallGraphFallback(
          scoreList,
          hasScenarioDrift,
          deviationRatios,
          hasMetricSpike
        )
      : classifyTgnnScores(
          scoreList,
          hasScenarioDrift,
          deviationRatios,
          hasMetricSpike
        )

  const idx = nodes.findIndex((n) => n.id === nodeId)
  return {
    isolationScore: idx >= 0 ? scoreList[idx] : 0.5,
    isAnomaly: idx >= 0 ? anomalyFlags[idx] === true : false,
  }
}
