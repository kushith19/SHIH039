import assert from 'node:assert/strict'
import test from 'node:test'
import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { emptyLookback } from './types.js'
import { attachLookback } from './adapter.js'
import { collectWindowTicks, buildTgnnWindows } from './tgnnWindow.js'
import { resetTgnnCalibrator } from './calibrator.js'
import { runTgnnAnomaly } from './tgnn.js'
import { runDetection } from './engine.js'
import {
  LOOKBACK_TICKS,
  appendDetectionInput,
  deleteRoomLookbackSamples,
  getLookback,
  getMetricsDb,
  resetMetricsDbForTests,
} from '../metrics/store.js'

const warmup = TRUST_CONFIG.tgnn.warmupTicks ?? 15
const threshold = TRUST_CONFIG.tgnn.anomalyScoreThreshold

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
    type: extra.type ?? 'gateway',
    label: extra.label ?? id,
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

function dep(id, source, target) {
  return {
    id,
    source,
    target,
    packetsPerSecond: 80,
    baselinePacketsPerSecond: 80,
    expectedPacketsPerSecond: 80,
  }
}

function attacked(id, extra = {}) {
  return ep(id, {
    ...extra,
    telemetry: tel(8000, 400, 1, 1),
    behaviour: { attackOverrideActive: true, intrinsicTrust: 70 },
  })
}

function healthyTrio() {
  return [ep('a', { criticality: 'critical' }), ep('b'), ep('c')]
}

function inputFrom(endpoints, extra = {}) {
  return {
    roomId: extra.roomId ?? 'lookback',
    timestamp: '2026-09-04T00:00:00.000Z',
    tsMs: Date.parse('2026-09-04T00:00:00.000Z') + (Number(extra.simulationTick) || 0) * 1000,
    simulationTick: extra.simulationTick ?? 20,
    cityContext: 'normal_day',
    simHour: 10,
    matchActive: true,
    endpoints,
    dependencies: extra.dependencies ?? [dep('e-ab', 'a', 'b'), dep('e-ac', 'a', 'c'), dep('e-bc', 'b', 'c')],
  }
}

function assertWindowAnchored(ticks, currentTick) {
  assert.ok(Array.isArray(ticks) && ticks.length > 0, 'window ticks')
  for (const tick of ticks) {
    assert.ok(tick <= currentTick, `future tick ${tick} > ${currentTick}`)
  }
  assert.equal(ticks[ticks.length - 1], currentTick, 'last window tick must be current')
}

function lookbackSeries(idlePps, fromTick, toTick, extraByTick = {}) {
  const out = emptyLookback()
  for (const key of ['packetsPerSecond', 'httpRequestsPerMin', 'filesDownloaded', 'failedLoginsPerMin']) {
    out[key] = []
    for (let t = fromTick; t <= toTick; t += 1) {
      const bag = extraByTick[t] ?? tel(idlePps)
      out[key].push({ tick: t, value: bag[key] })
    }
  }
  return out
}

test('TEST 1 — future stale ticks cannot enter the current window', () => {
  const current = 30
  const stale = lookbackSeries(100, 31, 39)
  const endpoints = healthyTrio().map((node) => ({
    ...node,
    lookback: stale,
    telemetry: node.id === 'b' ? tel(8000, 400) : node.telemetry,
  }))
  const input = inputFrom(endpoints, { simulationTick: current })
  const ticks = collectWindowTicks(input)
  assertWindowAnchored(ticks, current)
  assert.equal(ticks.some((t) => t > 30), false)
})

test('TEST 2 — current tick is the last TGNN frame', () => {
  const current = 30
  const stale = lookbackSeries(100, 31, 39)
  const endpoints = [
    ep('a', { criticality: 'critical', lookback: stale }),
    ep('b', { telemetry: tel(80000, 500), lookback: stale }),
    ep('c', { lookback: stale }),
  ]
  const input = inputFrom(endpoints, { simulationTick: current })
  const { ticks, observed } = buildTgnnWindows(input)
  assertWindowAnchored(ticks, current)
  const lastB = observed[observed.length - 1].endpoints.find((e) => e.id === 'b')
  assert.equal(lastB.telemetry.packetsPerSecond, 80000)
})

test('TEST 3 — previous-match SQLite ticks 31–39 do not contaminate match-2 tick 30', () => {
  resetMetricsDbForTests()
  const roomId = 'match-iso'
  for (let t = 1; t <= 39; t += 1) {
    appendDetectionInput(inputFrom(healthyTrio(), { roomId, simulationTick: t }))
  }
  deleteRoomLookbackSamples(roomId)
  const current = 30
  const live = inputFrom(
    [ep('a', { criticality: 'critical' }), attacked('b'), ep('c')],
    { roomId, simulationTick: current }
  )
  appendDetectionInput(live)
  const attached = attachLookback(live, getLookback(roomId, LOOKBACK_TICKS, current))
  for (const node of attached.endpoints) {
    for (const series of Object.values(node.lookback ?? {})) {
      for (const sample of series ?? []) {
        assert.ok(sample.tick <= current, `sqlite lookback tick ${sample.tick}`)
        assert.ok(sample.tick !== 31 && sample.tick !== 39, 'match-1 high ticks must be gone')
      }
    }
  }
  const ticks = collectWindowTicks(attached)
  assertWindowAnchored(ticks, current)
  assert.equal(ticks.includes(39), false)
})

test('getLookback anchored to T=30 ignores leftover ticks 31–39', () => {
  resetMetricsDbForTests()
  const roomId = 'stale-max'
  for (let t = 21; t <= 39; t += 1) {
    const endpoints = t <= 30 ? healthyTrio() : healthyTrio()
    appendDetectionInput(inputFrom(endpoints, { roomId, simulationTick: t }))
  }
  const rows = getLookback(roomId, 10, 30)
  const ticks = new Set()
  for (const series of Object.values(rows.a ?? {})) {
    for (const s of series ?? []) ticks.add(s.tick)
  }
  assert.equal([...ticks].some((t) => t > 30), false)
  assert.ok(ticks.has(30) || ticks.size === 0 || Math.max(0, ...ticks) <= 30)
  assert.ok(!ticks.has(39))
})

test('deleteRoomLookbackSamples does not delete incident rows', () => {
  resetMetricsDbForTests()
  const roomId = 'keep-incidents'
  appendDetectionInput(inputFrom(healthyTrio(), { roomId, simulationTick: 4 }))
  getMetricsDb()
    .prepare(
      `INSERT INTO incidents (
        incident_id, live_incident_id, room_id, status, detected_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, 'open', 1, 1)`
    )
    .run('inc-keep', 'live-keep', roomId)
  deleteRoomLookbackSamples(roomId)
  const samples = getMetricsDb()
    .prepare('SELECT COUNT(*) AS n FROM metric_samples WHERE room_id = ?')
    .get(roomId)
  const incidents = getMetricsDb()
    .prepare('SELECT COUNT(*) AS n FROM incidents WHERE room_id = ?')
    .get(roomId)
  assert.equal(samples.n, 0)
  assert.equal(incidents.n, 1)
})

test('TEST 4 — Attack A then Attack B is not stuck at a stale ~0.15 score', () => {
  resetMetricsDbForTests()
  const roomId = 'a-then-b'
  resetTgnnCalibrator(roomId)
  for (let t = 0; t <= warmup; t += 1) {
    const idle = inputFrom(healthyTrio(), { roomId, simulationTick: t })
    appendDetectionInput(idle)
    runTgnnAnomaly(attachLookback(idle, getLookback(roomId, LOOKBACK_TICKS, t)))
  }
  for (let t = 31; t <= 39; t += 1) {
    appendDetectionInput(
      inputFrom(
        [attacked('a', { criticality: 'critical' }), ep('b'), ep('c')],
        { roomId, simulationTick: t }
      )
    )
  }
  const tA = warmup + 2
  const afterA = inputFrom(
    [attacked('a', { criticality: 'critical' }), ep('b'), ep('c')],
    { roomId, simulationTick: tA }
  )
  appendDetectionInput(afterA)
  const aResult = runDetection(attachLookback(afterA, getLookback(roomId, LOOKBACK_TICKS, tA)))
  assert.ok(aResult.anomalyNodeIds.includes('a'))

  const tB = tA + 1
  const afterB = inputFrom(
    [attacked('a', { criticality: 'critical' }), attacked('b'), ep('c')],
    { roomId, simulationTick: tB }
  )
  appendDetectionInput(afterB)
  const attachedB = attachLookback(afterB, getLookback(roomId, LOOKBACK_TICKS, tB))
  const ticks = collectWindowTicks(attachedB)
  assertWindowAnchored(ticks, tB)
  const lastB = buildTgnnWindows(attachedB).observed.at(-1).endpoints.find((e) => e.id === 'b')
  assert.equal(lastB.telemetry.packetsPerSecond, 8000)
  const bResult = runDetection(attachedB)
  const bScore = bResult.isolationScoresByNodeId.b
  assert.ok(bScore > 0.5, `B score ${bScore} should not remain ~0.12–0.22`)
  assert.ok(bResult.anomalyNodeIds.includes('a'))
  assert.ok(bResult.anomalyNodeIds.includes('b'))
})

test('TEST 5 — idle neighbor of A is not classified; 0.58 gate unchanged', () => {
  assert.equal(threshold, 0.58)
  const roomId = 'idle-neighbor'
  resetTgnnCalibrator(roomId)
  for (let t = 0; t <= warmup; t += 1) {
    runTgnnAnomaly(inputFrom(healthyTrio(), { roomId, simulationTick: t }))
  }
  const after = runDetection(
    inputFrom([attacked('a', { criticality: 'critical' }), ep('b'), ep('c')], {
      roomId,
      simulationTick: warmup + 2,
    })
  )
  assert.ok(after.anomalyNodeIds.includes('a'))
  assert.equal(after.anomalyNodeIds.includes('b'), false)
  assert.equal(typeof after.isolationScoresByNodeId.b, 'number')
})

test('TEST 6 — clearing A while B remains attacking keeps B anomalous', () => {
  const roomId = 'clear-a'
  resetTgnnCalibrator(roomId)
  for (let t = 0; t <= warmup; t += 1) {
    runTgnnAnomaly(inputFrom(healthyTrio(), { roomId, simulationTick: t }))
  }
  const both = runDetection(
    inputFrom([attacked('a', { criticality: 'critical' }), attacked('b'), ep('c')], {
      roomId,
      simulationTick: warmup + 2,
    })
  )
  assert.ok(both.anomalyNodeIds.includes('a'))
  assert.ok(both.anomalyNodeIds.includes('b'))
  const cleared = runDetection(
    inputFrom([ep('a', { criticality: 'critical' }), attacked('b'), ep('c')], {
      roomId,
      simulationTick: warmup + 3,
    })
  )
  assert.equal(cleared.anomalyNodeIds.includes('a'), false)
  assert.ok(cleared.anomalyNodeIds.includes('b'))
})
