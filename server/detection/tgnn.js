import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { TGNN_PARAMS, l2Distance, residualToScore, tgnnForwardWindow } from '../../shared/tgnnCore.js'
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

function repeatLastFrame(frames, k) {
  const last = frames[frames.length - 1]
  if (!last) return []
  const n = Number.isFinite(k) && k > 0 ? Math.floor(k) : 3
  return Array.from({ length: n }, () => last)
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
        metricKey: key,
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
    tgnnSkippedAttackTicks: extra.tgnnSkippedAttackTicks ?? 0,
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

  const observedFrames = framesFromStates(observed)
  const baselineFrames = framesFromStates(baseline)
  const currentEmb = tgnnForwardWindow(observedFrames, adjIn, adjOut)
  const baselineEmb = tgnnForwardWindow(baselineFrames, adjIn, adjOut)
  const k = TGNN_PARAMS.temporalWindow ?? TRUST_CONFIG.tgnn.temporalWindow ?? 3
  const spikeEmb = tgnnForwardWindow(repeatLastFrame(observedFrames, k), adjIn, adjOut)
  const spikeBaseEmb = tgnnForwardWindow(repeatLastFrame(baselineFrames, k), adjIn, adjOut)

  const calibrator = opts.calibrator ?? (input.roomId ? getTgnnCalibrator(input.roomId) : createCalibrator())
  const attackActive = input.endpoints.some((ep) => ep.behaviour?.attackOverrideActive === true)
  const calStatus = ingestCalibrationTick(calibrator, nodeIds, currentEmb, { attackActive })

  const minSigma = TRUST_CONFIG.tgnn.calibratorMinSigma ?? 0.05
  const pauseTwinScore = calStatus.calibrating && attackActive
  const { hasScenarioDrift, deviationRatios, hasMetricSpike } = collectDriftSignals(input)
  const scoreList = input.endpoints.map((ep, i) => {
    let score = 0
    if (calibrator.ready) {
      const live = calibratedResidual(calibrator, ep.id, currentEmb[i])
      score = residualToScore(live.dist, live.sigma)
    } else if (pauseTwinScore) {
      score = residualToScore(l2Distance(currentEmb[i], baselineEmb[i]), minSigma)
    }
    if (hasMetricSpike[i] === true) {
      const twin = residualToScore(l2Distance(spikeEmb[i], spikeBaseEmb[i]), minSigma)
      score = Math.max(score, twin)
    }
    return score
  })

  const smallGraph = input.endpoints.length < MIN_NODES_FOR_FULL_CLASSIFY
  const anomalyFlags = smallGraph
    ? classifySmallGraphFallback(scoreList, hasScenarioDrift, deviationRatios, hasMetricSpike)
    : classifyTgnnScores(scoreList, hasScenarioDrift, deviationRatios, hasMetricSpike)

  const isolationScoresByNodeId = {}
  const anomalyNodeIds = []
  const nodeResults = []
  for (let i = 0; i < input.endpoints.length; i++) {
    const ep = input.endpoints[i]
    const score = scoreList[i]
    // Already-contained nodes keep a residual score for explainability but are
    // not re-seeded as anomalies (avoids open↔cleared incident reopen loops).
    const isAnomaly =
      anomalyFlags[i] === true && ep.runtimeState?.quarantined !== true
    isolationScoresByNodeId[ep.id] = score
    if (isAnomaly) anomalyNodeIds.push(ep.id)
    const expected = expectedTelemetryOf(ep)
    nodeResults.push({
      id: ep.id,
      label: ep.label,
      isolationScore: score,
      isAnomaly,
      // Debug/test observability — not rendered in production UI.
      debug: {
        cityContext: ep.activeContexts?.cityContext ?? input.cityContext ?? null,
        telemetryOverrideActive: ep.behaviour?.telemetryOverrideActive === true,
        attackStateActive: ep.behaviour?.attackOverrideActive === true,
        maxDeviation: deviationRatios[i] ?? 0,
        hasScenarioDrift: hasScenarioDrift[i] === true,
        hasMetricSpike: hasMetricSpike[i] === true,
        expectedFilesDownloaded: expected?.filesDownloaded,
        observedFilesDownloaded: ep.telemetry?.filesDownloaded,
      },
    })
  }
  return {
    isolationScoresByNodeId,
    anomalyNodeIds,
    nodeResults,
    tgnnCalibrating: calStatus.calibrating,
    tgnnWarmupCollected: calStatus.collected,
    tgnnWarmupTicks: calStatus.warmupTicks,
    tgnnSkippedAttackTicks: calStatus.skippedAttackTicks ?? 0,
  }
}
