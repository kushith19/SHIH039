import assert from 'node:assert/strict'
import test from 'node:test'
import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { computePresetOverrides } from '../../shared/attackPresets.js'
import { getTelemetryKeys } from '../../shared/telemetryKeys.js'
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
  assert.equal(result.tgnnSkippedAttackTicks, 1)
})

test('file spike during paused warmup flags via expected-embedding residual', () => {
  const calibrator = createCalibrator()
  const attacking = [
    ep('a', {
      criticality: 'critical',
      telemetry: tel(100, 10, 100000, 1),
      behaviour: { attackOverrideActive: true, intrinsicTrust: 70 },
    }),
    ep('b'),
    ep('c'),
  ]
  const result = runTgnnAnomaly(inputFrom(attacking, { simulationTick: 1 }), { calibrator })
  assert.equal(result.tgnnCalibrating, true)
  assert.equal(calibrator.collected, 0)
  assert.equal(calibrator.skippedAttackTicks, 1)
  assert.ok(result.isolationScoresByNodeId.a > 0.5)
  assert.ok(result.anomalyNodeIds.includes('a'))
})

test('after idle warmup a later metric spike still uses the Welford residual', () => {
  const calibrator = createCalibrator()
  for (let t = 0; t <= warmup; t++) {
    runTgnnAnomaly(inputFrom(healthyEndpoints(), { simulationTick: t }), { calibrator })
  }
  assert.equal(calibrator.ready, true)
  const attacked = [
    ep('a', { criticality: 'critical', telemetry: tel(8000, 400, 1, 1) }),
    ep('b'),
    ep('c'),
  ]
  const after = runTgnnAnomaly(inputFrom(attacked, { simulationTick: warmup + 2 }), { calibrator })
  assert.equal(after.tgnnCalibrating, false)
  assert.ok(after.isolationScoresByNodeId.a > 0.5)
  assert.ok(after.anomalyNodeIds.includes('a'))
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

function lookbackFromHistory(history) {
  const out = emptyLookback()
  for (const key of getTelemetryKeys()) {
    out[key] = history.map(({ tick, telemetry }) => ({ tick, value: telemetry[key] }))
  }
  return out
}

test('idle lookback plus one traffic-flood tick on a hub flags via current-frame residual', () => {
  const hub = 'power_substation'
  const spoke = ['telecom_gateway', 'water_supply', 'metro_rail', 'healthcare', 'data_centers']
  const types = ['power_grid', hub, ...spoke]
  const baselineOf = (type) => (type === hub ? tel(16_000, 36, 2, 1) : tel(10_000, 40, 2, 1))
  const deps = [
    dep('e-grid-hub', 'power_grid', hub, 22_000),
    ...spoke.map((id) => dep(`e-hub-${id}`, hub, id, 8_000)),
  ]
  const graph = (telemetryByType = {}, lookbackByType = {}, extra = {}) =>
    types.map((type) => {
      const baseline = baselineOf(type)
      return ep(type, {
        criticality: type === hub ? 'critical' : 'high',
        sector: 'energy',
        telemetry: telemetryByType[type] ?? baseline,
        baselineTelemetry: baseline,
        expectedTelemetry: baseline,
        lookback: lookbackByType[type] ?? emptyLookback(),
        behaviour: extra.behaviour?.[type] ?? { attackOverrideActive: false, intrinsicTrust: 90 },
      })
    })

  const calibrator = createCalibrator()
  const history = []
  for (let t = 0; t <= warmup; t++) {
    const lookbackByType = {}
    for (const type of types) {
      lookbackByType[type] = lookbackFromHistory(history.filter((h) => h.type === type))
    }
    runTgnnAnomaly(inputFrom(graph({}, lookbackByType), { simulationTick: t, dependencies: deps }), {
      calibrator,
    })
    for (const type of types) history.push({ tick: t, type, telemetry: baselineOf(type) })
  }
  assert.equal(calibrator.ready, true)

  const idleLookback = {}
  for (const type of types) {
    idleLookback[type] = lookbackFromHistory(history.filter((h) => h.type === type))
  }
  const idle = runTgnnAnomaly(
    inputFrom(graph({}, idleLookback), { simulationTick: warmup + 1, dependencies: deps }),
    { calibrator }
  )
  assert.equal(idle.anomalyNodeIds.includes(hub), false)

  const flood = computePresetOverrides('traffic_flood', baselineOf(hub))
  const telemetryByType = { [hub]: { ...baselineOf(hub), ...flood } }
  const behaviour = {
    [hub]: { attackOverrideActive: true, intrinsicTrust: 90 },
  }
  const after = runTgnnAnomaly(
    inputFrom(graph(telemetryByType, idleLookback, { behaviour }), {
      simulationTick: warmup + 2,
      dependencies: deps,
    }),
    { calibrator }
  )
  assert.ok(after.isolationScoresByNodeId[hub] > 0.58)
  assert.ok(after.anomalyNodeIds.includes(hub))
})
