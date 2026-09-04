import assert from 'node:assert/strict'
import test from 'node:test'
import { TRUST_CONFIG } from './trustConfig.js'
import {
  computeDeviationMetrics,
  explainTelemetryDeviation,
  maxMetricDeviation,
} from './trustModel.js'
import { GAME_METRIC_KEYS } from './telemetryKeys.js'

test('filesDownloaded 0→1 is a small count change, not ratio=1', () => {
  const { deviationRatio } = computeDeviationMetrics({
    baselinePps: 0,
    effectivePps: 1,
    metricKey: 'filesDownloaded',
  })
  assert.ok(deviationRatio < TRUST_CONFIG.tgnn.minDeviationRatio)
  assert.ok(deviationRatio < 0.1)
})

test('filesDownloaded absolute steps increase progressively', () => {
  const ratios = [1, 2, 5, 10, 20].map(
    (v) =>
      computeDeviationMetrics({
        baselinePps: 0,
        effectivePps: v,
        metricKey: 'filesDownloaded',
      }).deviationRatio
  )
  for (let i = 1; i < ratios.length; i++) {
    assert.ok(ratios[i] > ratios[i - 1], `ratio[${i}] should exceed prior`)
  }
  assert.ok(ratios[0] < TRUST_CONFIG.tgnn.minDeviationRatio)
  assert.ok(ratios[2] >= TRUST_CONFIG.tgnn.minDeviationRatio)
  assert.ok(ratios[4] >= TRUST_CONFIG.tgnn.metricSpikeDeviationRatio)
})

test('failedLoginsPerMin 1→2 is not a full spike', () => {
  const { deviationRatio } = computeDeviationMetrics({
    baselinePps: 1,
    effectivePps: 2,
    metricKey: 'failedLoginsPerMin',
  })
  assert.ok(deviationRatio < TRUST_CONFIG.tgnn.minDeviationRatio)
  const spray = computeDeviationMetrics({
    baselinePps: 1,
    effectivePps: 20,
    metricKey: 'failedLoginsPerMin',
  }).deviationRatio
  assert.ok(spray >= TRUST_CONFIG.tgnn.metricSpikeDeviationRatio)
})

test('packetsPerSecond keeps classic relative deviation', () => {
  const tiny = computeDeviationMetrics({
    baselinePps: 5000,
    effectivePps: 5050,
    metricKey: 'packetsPerSecond',
  }).deviationRatio
  assert.ok(Math.abs(tiny - 0.01) < 1e-9)
  const ten = computeDeviationMetrics({
    baselinePps: 5000,
    effectivePps: 5500,
    metricKey: 'packetsPerSecond',
  }).deviationRatio
  assert.ok(Math.abs(ten - 0.1) < 1e-9)
})

test('explainTelemetryDeviation reports dominant metric', () => {
  const expected = {
    packetsPerSecond: 5000,
    httpRequestsPerMin: 40,
    filesDownloaded: 0,
    failedLoginsPerMin: 1,
  }
  const observed = { ...expected, filesDownloaded: 20 }
  const expl = explainTelemetryDeviation(expected, observed, GAME_METRIC_KEYS)
  assert.equal(expl.dominantMetric, 'filesDownloaded')
  assert.equal(maxMetricDeviation(expected, observed, GAME_METRIC_KEYS), expl.maxDeviation)
})
