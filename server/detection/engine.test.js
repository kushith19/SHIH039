import assert from 'node:assert/strict'
import test from 'node:test'
import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { emptyLookback } from './types.js'
import { resetTgnnCalibrator } from './calibrator.js'
import { runDetection } from './engine.js'

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
    ...extra,
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
    roomId: extra.roomId ?? 'engine-exposure',
    timestamp: '2026-09-03T00:00:00.000Z',
    tsMs: Date.parse('2026-09-03T00:00:00.000Z'),
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

test('atRiskNodeIds are undirected 1-hop of residual flags, not the seed', () => {
  const roomId = 'engine-atrisk-hops'
  resetTgnnCalibrator(roomId)
  const healthy = [
    ep('a', { criticality: 'critical' }),
    ep('b'),
    ep('c'),
  ]
  for (let t = 0; t <= warmup; t += 1) {
    runDetection(inputFrom(healthy, { simulationTick: t, roomId }))
  }
  const after = runDetection(
    inputFrom(
      [
        ep('a', {
          criticality: 'critical',
          telemetry: tel(8000, 400, 1, 1),
          behaviour: { attackOverrideActive: true, intrinsicTrust: 70 },
        }),
        ep('b'),
        ep('c'),
      ],
      { simulationTick: warmup + 2, roomId }
    )
  )
  assert.ok(after.anomalyNodeIds.includes('a'))
  assert.deepEqual([...after.atRiskNodeIds].sort(), ['b', 'c'])
  assert.ok(!after.atRiskNodeIds.includes('a'))
  assert.deepEqual([...after.atRiskEdgeIds].sort(), ['e-ab', 'e-ac'])
  assert.ok(!after.atRiskEdgeIds.includes('e-bc'))
})
