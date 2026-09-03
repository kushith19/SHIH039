import assert from 'node:assert/strict'
import test from 'node:test'
import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { emptyLookback } from './types.js'
import { createCalibrator } from './calibrator.js'
import { runTgnnAnomaly } from './tgnn.js'

function tel(pps, http = 10, files = 1, logins = 1) {
  return {
    packetsPerSecond: pps,
    httpRequestsPerMin: http,
    filesDownloaded: files,
    failedLoginsPerMin: logins,
  }
}

function ep(id, extra = {}) {
  const baseline = extra.baselineTelemetry ?? tel(100)
  return {
    id,
    type: 'gateway',
    label: id,
    sector: extra.sector ?? 'water',
    criticality: extra.criticality ?? 'medium',
    telemetry: extra.telemetry ?? baseline,
    baselineTelemetry: baseline,
    expectedTelemetry: extra.expectedTelemetry ?? baseline,
    runtimeState: extra.runtimeState ?? {
      quarantined: false,
      provenance: 'legitimate',
      matchLocked: false,
    },
    behaviour: extra.behaviour ?? { attackOverrideActive: false, intrinsicTrust: 70 },
    activeContexts: {
      phase: 'playing',
      matchActive: true,
      overrideActive: extra.behaviour?.attackOverrideActive === true,
      cityContext: 'normal_day',
    },
    lookback: extra.lookback ?? emptyLookback(),
    neighborLookback: extra.neighborLookback ?? [],
    telemetry: extra.telemetry ?? baseline,
    expectedTelemetry: extra.expectedTelemetry ?? baseline,
  }
}

function dep(id, source, target, pps = 80) {
  return {
    id,
    source,
    target,
    packetsPerSecond: pps,
    baselinePacketsPerSecond: pps,
    expectedPacketsPerSecond: pps,
  }
}

function inputFrom(endpoints, extra = {}) {
  return {
    roomId: extra.roomId ?? '',
    timestamp: '2026-09-02T00:00:00.000Z',
    tsMs: Date.parse('2026-09-02T00:00:00.000Z'),
    simulationTick: extra.simulationTick ?? 20,
    cityContext: 'normal_day',
    simHour: 10,
    matchActive: true,
    endpoints,
    dependencies: extra.dependencies ?? [
      dep('e-ab', 'a', 'b'),
      dep('e-ac', 'a', 'c'),
      dep('e-bc', 'b', 'c'),
    ],
  }
}

const warmup = TRUST_CONFIG.tgnn.warmupTicks ?? 15

function healthyEndpoints() {
  return [ep('a', { criticality: 'critical' }), ep('b'), ep('c')]
}

test('warmup scores stay near 0; metric spike after warmup scores high', () => {
  const calibrator = createCalibrator()
  let last = null
  for (let t = 0; t < warmup - 1; t++) {
    last = runTgnnAnomaly(inputFrom(healthyEndpoints(), { simulationTick: t }), { calibrator })
    assert.equal(last.tgnnCalibrating, true)
    assert.equal(last.isolationScoresByNodeId.a, 0)
    assert.deepEqual(last.anomalyNodeIds, [])
  }
  last = runTgnnAnomaly(inputFrom(healthyEndpoints(), { simulationTick: warmup - 1 }), { calibrator })
  assert.equal(last.tgnnCalibrating, false)
  assert.ok(last.isolationScoresByNodeId.a < 0.2)

  const attacked = [
    ep('a', { criticality: 'critical', telemetry: tel(8000, 400, 1, 1) }),
    ep('b'),
    ep('c'),
  ]
  const after = runTgnnAnomaly(inputFrom(attacked, { simulationTick: warmup + 1 }), { calibrator })
  assert.equal(after.tgnnCalibrating, false)
  assert.ok(after.isolationScoresByNodeId.a > last.isolationScoresByNodeId.a)
  assert.ok(after.isolationScoresByNodeId.a > 0.5)
  assert.ok(after.anomalyNodeIds.includes('a'))
})

test('attack override during warmup is not ingested into the live baseline', () => {
  const calibrator = createCalibrator()
  const attacking = [
    ep('a', {
      criticality: 'critical',
      telemetry: tel(8000),
      behaviour: { attackOverrideActive: true, intrinsicTrust: 70 },
    }),
    ep('b'),
    ep('c'),
  ]
  const result = runTgnnAnomaly(inputFrom(attacking, { simulationTick: 1 }), { calibrator })
  assert.equal(result.tgnnCalibrating, true)
  assert.equal(calibrator.collected, 0)
  assert.equal(calibrator.skippedAttackTicks, 1)
})

test('override flag without metric change does not raise the calibrated score', () => {
  const calibrator = createCalibrator()
  for (let t = 0; t <= warmup; t++) {
    runTgnnAnomaly(inputFrom(healthyEndpoints(), { simulationTick: t }), { calibrator })
  }
  const flaggedOnly = [
    ep('a', {
      criticality: 'critical',
      behaviour: { attackOverrideActive: true, intrinsicTrust: 70 },
      runtimeState: { quarantined: true, provenance: 'injected', matchLocked: false },
    }),
    ep('b'),
    ep('c'),
  ]
  const idle = runTgnnAnomaly(inputFrom(healthyEndpoints(), { simulationTick: warmup + 1 }), {
    calibrator,
  })
  const flagged = runTgnnAnomaly(inputFrom(flaggedOnly, { simulationTick: warmup + 2 }), {
    calibrator,
  })
  assert.ok(Math.abs(idle.isolationScoresByNodeId.a - flagged.isolationScoresByNodeId.a) < 0.05)
  assert.equal(flagged.anomalyNodeIds.includes('a'), false)
})
