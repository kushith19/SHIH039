import assert from 'node:assert/strict'
import test from 'node:test'
import { createTgnnParams, tgnnForwardWindow } from './tgnnCore.js'
import { BASE_CITY_FEATURE_KEYS, CITY_FEATURE_KEYS, extractCityFeatureFrame } from './tgnnFeatures.js'
import { TGNN_CHECKPOINT } from './tgnn_checkpoint.js'

test('TGNN encoder stays at 14 frozen channels', () => {
  assert.equal(CITY_FEATURE_KEYS.length, BASE_CITY_FEATURE_KEYS.length)
  assert.equal(CITY_FEATURE_KEYS.length, 14)
})

test('checkpoint weights differ from sin-seed fallback', () => {
  assert.ok(TGNN_CHECKPOINT?.W_IN?.length, 'run npm run train:tgnn to write the model file')
  const trained = createTgnnParams()
  const sin = createTgnnParams({ useSinFallback: true })
  assert.equal(trained.fromCheckpoint, true)
  assert.equal(sin.fromCheckpoint, false)
  assert.equal(trained.W_IN.length, sin.W_IN.length)
  assert.notEqual(trained.W_IN[0][0], sin.W_IN[0][0])
  const X = [Array(trained.featureDim).fill(0.2)]
  const adj = [[]]
  const a = tgnnForwardWindow([X, X, X], adj, adj, trained)
  const b = tgnnForwardWindow([X, X, X], adj, adj, sin)
  assert.notDeepEqual(a[0], b[0])
})

test('game flags alone do not change TGNN feature rows', () => {
  const base = {
    id: 'n1',
    telemetry: {
      packetsPerSecond: 1000,
      httpRequestsPerMin: 20,
      filesDownloaded: 2,
      failedLoginsPerMin: 1,
    },
    expectedTelemetry: {
      packetsPerSecond: 1000,
      httpRequestsPerMin: 20,
      filesDownloaded: 2,
      failedLoginsPerMin: 1,
    },
    baselineTelemetry: {
      packetsPerSecond: 1000,
      httpRequestsPerMin: 20,
      filesDownloaded: 2,
      failedLoginsPerMin: 1,
    },
    criticality: 'medium',
    typeTrust: 70,
    cityContext: 'normal_day',
  }
  const clean = extractCityFeatureFrame({
    endpoints: [{ ...base, runtimeState: { quarantined: false, provenance: 'legitimate' }, attackOverrideActive: false }],
    dependencies: [],
  })
  const flagged = extractCityFeatureFrame({
    endpoints: [
      {
        ...base,
        runtimeState: { quarantined: true, provenance: 'injected' },
        attackOverrideActive: true,
      },
    ],
    dependencies: [],
  })
  assert.deepEqual(clean.X[0], flagged.X[0])
})
