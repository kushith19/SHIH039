import {
  cityContextAt,
  contextResidualRatio,
  expectedTelemetry,
} from '../../shared/cityContext.js'
import {
  cityContextOf,
  computeDeviationMetrics,
  expectedTelemetryOf,
  hasTelemetryDrift,
  maxMetricDeviation,
} from './features.js'
import { getTelemetryKeys, metricPresent } from '../../shared/telemetryKeys.js'

export const TEMPORAL_SPIKE_DEVIATION_RATIO = 0.5
export const TEMPORAL_SLOPE_RATIO = 0.35

function clamp01(n) {
  return Math.max(0, Math.min(1, n))
}

function expectedAtTick(ep, tick) {
  return expectedTelemetry(ep.baselineTelemetry, cityContextAt(tick), {
    sector: ep.sector,
    type: ep.type,
    id: ep.id,
    tick,
  })
}

function residualSeries(lookback, key, ep) {
  const series = lookback?.[key]
  if (!Array.isArray(series)) return []
  return series
    .map((s) => {
      const tick = Number(s?.tick) || 0
      const observed = Number(s?.value)
      if (!Number.isFinite(observed)) return null
      const expected = expectedAtTick(ep, tick)[key] ?? 0
      return contextResidualRatio(observed, expected)
    })
    .filter((v) => v != null)
}

function slopeRatio(values) {
  if (values.length < 2) return 0
  const first = values[0]
  const last = values[values.length - 1]
  return Math.abs(last - first) / Math.max(1, first)
}

function zScoreLast(values) {
  if (values.length < 3) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  let varSum = 0
  for (const v of values) {
    const d = v - mean
    varSum += d * d
  }
  const std = Math.sqrt(varSum / values.length)
  if (std < 1e-6) {
    const last = values[values.length - 1]
    return last !== mean ? 4 : 0
  }
  return Math.abs(values[values.length - 1] - mean) / std
}

function deviationToScore(ratio) {
  return clamp01(Math.log10(1 + Math.max(0, ratio)) / 1.15)
}

function scoreMetric(key, ep) {
  const expectedBag = expectedTelemetryOf(ep)
  if (!metricPresent(expectedBag, key) || !metricPresent(ep.telemetry, key)) {
    return { score: 0, reasons: [], deviationRatio: 0, slope: 0, z: 0 }
  }
  const expected = expectedBag[key]
  const effective = ep.telemetry[key]
  const { deviationRatio } = computeDeviationMetrics({
    baselinePps: expected,
    effectivePps: effective,
  })
  const values = residualSeries(ep.lookback, key, ep)
  const slope = slopeRatio(values)
  const z = zScoreLast(values)

  const deviationScore = deviationToScore(deviationRatio)
  const spikeScore =
    deviationRatio >= TEMPORAL_SPIKE_DEVIATION_RATIO
      ? clamp01(0.55 + (deviationRatio - TEMPORAL_SPIKE_DEVIATION_RATIO) * 0.5)
      : 0
  const slopeScore =
    slope >= TEMPORAL_SLOPE_RATIO ? clamp01(Math.log10(1 + slope) / 1.4) : 0
  const zScore = z >= 2 ? clamp01(z / 5) : 0

  const score = Math.max(deviationScore, spikeScore, slopeScore, zScore)
  const reasons = []
  if (spikeScore > 0 && spikeScore >= score * 0.85) {
    reasons.push(`telemetry_spike:${key}`)
  } else if (slopeScore > 0 && slopeScore >= score * 0.85) {
    reasons.push(`telemetry_slope:${key}`)
  } else if (zScore > 0 && zScore >= score * 0.85) {
    reasons.push(`telemetry_zscore:${key}`)
  } else if (deviationScore >= 0.12) {
    reasons.push(`telemetry_drift:${key}`)
  }
  return { score, reasons, deviationRatio, slope, z }
}

/**
 * Temporal telemetry scorer. Uses current vs expected-under-context plus residual lookback.
 *
 * @param {import('./types.js').DetectionInput} input
 */
export function scoreTemporal(input) {
  /** @type {Record<string, number>} */
  const scoresByNodeId = {}
  /** @type {Record<string, string[]>} */
  const reasonsByNodeId = {}
  const nodeResults = []

  if (!input?.endpoints?.length) {
    return { scoresByNodeId, reasonsByNodeId, nodeResults }
  }

  for (const ep of input.endpoints) {
    const expected = expectedTelemetryOf(ep)
    const perMetric = getTelemetryKeys().map((key) => scoreMetric(key, ep))
    const score = perMetric.reduce((m, r) => Math.max(m, r.score), 0)
    const reasons = []
    const seen = new Set()
    const ranked = [...perMetric].sort((a, b) => b.score - a.score)
    for (const row of ranked) {
      for (const tag of row.reasons) {
        if (seen.has(tag)) continue
        seen.add(tag)
        reasons.push(tag)
        if (reasons.length >= 3) break
      }
      if (reasons.length >= 3) break
    }
    const context = cityContextOf(ep, input)
    if (hasTelemetryDrift(expected, ep.telemetry) && context && context !== 'normal_day') {
      const tag = `context_mismatch:${context}`
      if (!seen.has(tag) && reasons.length < 3) reasons.push(tag)
    }
    scoresByNodeId[ep.id] = score
    reasonsByNodeId[ep.id] = reasons
    nodeResults.push({
      id: ep.id,
      score,
      reasons,
      hasDrift: hasTelemetryDrift(expected, ep.telemetry),
      maxDeviation: maxMetricDeviation(expected, ep.telemetry),
    })
  }

  return { scoresByNodeId, reasonsByNodeId, nodeResults }
}
