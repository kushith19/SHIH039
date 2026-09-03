import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { l2Distance, residualToScore, tgnnForwardWindow } from '../../shared/tgnnCore.js'
import { directedAdjacency, extractCityFeatureFrame } from '../../shared/tgnnFeatures.js'
import { getTelemetryKeys, metricPresent } from '../../shared/telemetryKeys.js'
import {
  computeDeviationMetrics,
  expectedTelemetryOf,
  hasTelemetryDrift,
  maxMetricDeviation,
} from './features.js'
import { buildTgnnWindows } from './tgnnWindow.js'
import {
  calibratedResidual,
  createCalibrator,
  getTgnnCalibrator,
  ingestCalibrationTick,
} from './calibrator.js'

export const TGNN_ANOMALY_SCORE_THRESHOLD = TRUST_CONFIG.tgnn.anomalyScoreThreshold
export const TGNN_RELATIVE_MIN_SCORE = TRUST_CONFIG.tgnn.relativeMinScore
export const TGNN_MIN_SCORE_GAP = TRUST_CONFIG.tgnn.minScoreGap
export const TGNN_MIN_SPREAD = TRUST_CONFIG.tgnn.minSpread
export const TGNN_MIN_DEVIATION_RATIO = TRUST_CONFIG.tgnn.minDeviationRatio
export const TGNN_METRIC_SPIKE_DEVIATION_RATIO = TRUST_CONFIG.tgnn.metricSpikeDeviationRatio
export const TGNN_SMALL_GRAPH_MIN_SCORE = TRUST_CONFIG.tgnn.smallGraphMinScore

const MIN_NODES_FOR_FULL_CLASSIFY = TRUST_CONFIG.tgnn.minNodesForFullClassify

function framesFromStates(states) {
  return states.map((state) => extractCityFeatureFrame(state).X)
}

export function classifyTgnnScores(scores, hasScenarioDrift, deviationRatios, hasMetricSpike = []) {
  if (scores.length === 0) return []
  const driftIndices = []
  for (let i = 0; i < scores.length; i++) {
    const meetsDeviation =
      (deviationRatios[i] ?? 0) >= TGNN_MIN_DEVIATION_RATIO || hasMetricSpike[i] === true
    if (hasScenarioDrift[i] && meetsDeviation) driftIndices.push(i)
  }
  if (driftIndices.length === 0) return scores.map(() => false)

  const driftScores = driftIndices.map((i) => scores[i])
  const driftMax = Math.max(...driftScores)
  const driftMin = Math.min(...driftScores)
  const driftSpread = driftMax - driftMin
  const sortedDrift = [...driftScores].sort((a, b) => b - a)
  const driftGap = driftMax - (sortedDrift[1] ?? driftMin)
  const spreadAndGapMet = driftSpread >= TGNN_MIN_SPREAD && driftGap >= TGNN_MIN_SCORE_GAP

  return scores.map((score, i) => {
    if (!driftIndices.includes(i) || !hasScenarioDrift[i]) return false
    const meetsDeviation =
      (deviationRatios[i] ?? 0) >= TGNN_MIN_DEVIATION_RATIO || hasMetricSpike[i] === true
    if (!meetsDeviation) return false
    return score >= TGNN_ANOMALY_SCORE_THRESHOLD && (score >= TGNN_RELATIVE_MIN_SCORE || spreadAndGapMet)
  })
}

function classifySmallGraphFallback(scores, hasScenarioDrift, deviationRatios, hasMetricSpike = []) {
  if (scores.length === 0) return []
  return scores.map((score, i) => {
    if (!hasScenarioDrift[i]) return false
    const meetsDeviation =
      (deviationRatios[i] ?? 0) >= TGNN_MIN_DEVIATION_RATIO || hasMetricSpike[i] === true
    if (!meetsDeviation) return false
    return score >= TGNN_SMALL_GRAPH_MIN_SCORE
  })
}

function collectDriftSignals(input) {
  const hasScenarioDrift = input.endpoints.map((ep) =>
    hasTelemetryDrift(expectedTelemetryOf(ep), ep.telemetry)
  )
  const deviationRatios = input.endpoints.map((ep) =>
    maxMetricDeviation(expectedTelemetryOf(ep), ep.telemetry)
  )
  const hasMetricSpike = input.endpoints.map((ep, i) => {
    if (!hasScenarioDrift[i]) return false
    const expected = expectedTelemetryOf(ep)
    for (const key of getTelemetryKeys()) {
      if (!metricPresent(expected, key) || !metricPresent(ep.telemetry, key)) continue
      const { deviationRatio } = computeDeviationMetrics({
        baselinePps: expected[key],
        effectivePps: ep.telemetry[key],
      })
      if (deviationRatio >= TGNN_METRIC_SPIKE_DEVIATION_RATIO) return true
    }
    return false
  })
  return { hasScenarioDrift, deviationRatios, hasMetricSpike }
}

function emptyTgnnResult(extra = {}) {
  const warmupTicks = TRUST_CONFIG.tgnn.warmupTicks ?? 15
  return {
    isolationScoresByNodeId: {},
    anomalyNodeIds: [],
    nodeResults: [],
    tgnnCalibrating: extra.tgnnCalibrating ?? false,
    tgnnWarmupCollected: extra.tgnnWarmupCollected ?? 0,
    tgnnWarmupTicks: extra.tgnnWarmupTicks ?? warmupTicks,
  }
}

/**
 * @param {import('./types.js').DetectionInput} input
 * @param {{ calibrator?: ReturnType<typeof createCalibrator> }} [opts]
 */
export function runTgnnAnomaly(input, opts = {}) {
  if (!input?.matchActive || input.endpoints.length === 0) {
    return emptyTgnnResult()
  }

  const { observed, baseline } = buildTgnnWindows(input)
  const nodeIds = input.endpoints.map((ep) => ep.id)
  const { adjIn, adjOut } = directedAdjacency(nodeIds, input.dependencies)

  const currentEmb = tgnnForwardWindow(framesFromStates(observed), adjIn, adjOut)
  const baselineEmb = tgnnForwardWindow(framesFromStates(baseline), adjIn, adjOut)

  const calibrator = opts.calibrator ?? (input.roomId ? getTgnnCalibrator(input.roomId) : createCalibrator())
  const attackActive = input.endpoints.some((ep) => ep.behaviour?.attackOverrideActive === true)
  const calStatus = ingestCalibrationTick(calibrator, nodeIds, currentEmb, { attackActive })

  const minSigma = TRUST_CONFIG.tgnn.calibratorMinSigma ?? 0.05
  const scoreList = input.endpoints.map((ep, i) => {
    if (calStatus.calibrating) return 0
    if (calibrator.ready) {
      const live = calibratedResidual(calibrator, ep.id, currentEmb[i])
      return residualToScore(live.dist, live.sigma)
    }
    const twinDist = l2Distance(currentEmb[i], baselineEmb[i])
    return residualToScore(twinDist, minSigma)
  })

  const { hasScenarioDrift, deviationRatios, hasMetricSpike } = collectDriftSignals(input)
  const anomalyFlags = calStatus.calibrating
    ? scoreList.map(() => false)
    : input.endpoints.length < MIN_NODES_FOR_FULL_CLASSIFY
      ? classifySmallGraphFallback(scoreList, hasScenarioDrift, deviationRatios, hasMetricSpike)
      : classifyTgnnScores(scoreList, hasScenarioDrift, deviationRatios, hasMetricSpike)

  const isolationScoresByNodeId = {}
  const anomalyNodeIds = []
  const nodeResults = []
  for (let i = 0; i < input.endpoints.length; i++) {
    const ep = input.endpoints[i]
    const score = scoreList[i]
    const isAnomaly = anomalyFlags[i] === true
    isolationScoresByNodeId[ep.id] = score
    if (isAnomaly) anomalyNodeIds.push(ep.id)
    nodeResults.push({
      id: ep.id,
      label: ep.label,
      isolationScore: score,
      isAnomaly,
    })
  }
  return {
    isolationScoresByNodeId,
    anomalyNodeIds,
    nodeResults,
    tgnnCalibrating: calStatus.calibrating,
    tgnnWarmupCollected: calStatus.collected,
    tgnnWarmupTicks: calStatus.warmupTicks,
  }
}
