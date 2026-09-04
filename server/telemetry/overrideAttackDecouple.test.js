import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCityModelFromDisk } from '../loadCityModel.js'
import {
  applyCityModelOverlay,
  CITY_CONTEXTS,
  expectedTelemetry,
} from '../../shared/cityContext.js'
import { buildCitySnapshot } from './citySnapshot.js'
import { adaptCitySnapshot } from '../detection/adapter.js'
import { runTgnnAnomaly } from '../detection/tgnn.js'
import { createCalibrator } from '../detection/calibrator.js'
import { computePresetOverrides } from '../../shared/attackPresets.js'
import { yamlIdForCatalogType } from '../../shared/cityModel/endpointMap.js'
import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { maxMetricDeviation } from '../../shared/trustModel.js'
import { GAME_METRIC_KEYS } from '../../shared/telemetryKeys.js'

const model = loadCityModelFromDisk()
applyCityModelOverlay(model)

const BASE = {
  packetsPerSecond: 5000,
  httpRequestsPerMin: 40,
  filesDownloaded: 0,
  failedLoginsPerMin: 1,
}

function roomFixture({
  filesOverride = undefined,
  attackState = false,
  presetOverride = null,
  tick = 20,
  cityContextOverride = null,
} = {}) {
  const type = 'traffic_management'
  const node = {
    id: 'n1',
    data: {
      type,
      label: 'Traffic',
      sector: 'Transportation',
      criticality: 'high',
      ...BASE,
      cityEndpointId: yamlIdForCatalogType(type),
      intrinsicTrust: 80,
    },
  }
  const nodeOverrides = {}
  if (filesOverride !== undefined) {
    nodeOverrides.n1 = { filesDownloaded: filesOverride }
  }
  if (presetOverride) {
    nodeOverrides.n1 = { ...(nodeOverrides.n1 ?? {}), ...presetOverride }
  }
  return {
    id: 'diag',
    phase: 'playing',
    simulationTick: tick,
    cityContextOverride,
    matchNodeIds: ['n1'],
    nodes: [node],
    edges: [],
    hackSimulator: {
      active: true,
      nodeOverrides,
      edgeOverrides: {},
      nodeAttackStates: attackState ? { n1: true } : {},
      nodeScenarioBaselines: { n1: { ...BASE } },
      edgeScenarioBaselines: {},
    },
  }
}

function detect(room, calibrator) {
  const snap = buildCitySnapshot(room)
  const input = adaptCitySnapshot(snap)
  input.matchActive = true
  return { snap, input, result: runTgnnAnomaly(input, { calibrator }) }
}

function warm(calibrator, ticks = 15) {
  for (let t = 1; t <= ticks; t++) {
    const room = roomFixture({ tick: t })
    detect(room, calibrator)
  }
}

test('telemetry override alone does not enter under_attack sampling', () => {
  const room = roomFixture({ filesOverride: 1, attackState: false })
  const snap = buildCitySnapshot(room)
  const ep = snap.endpoints.find((e) => e.id === 'n1')
  assert.equal(ep.behaviour.telemetryOverrideActive, true)
  assert.equal(ep.behaviour.attackOverrideActive, false)
  assert.equal(ep.activeContexts.overrideActive, true)
  // Observed PPS stays near expected (no ~1.4× under_attack amp).
  const ppsRatio = ep.telemetry.packetsPerSecond / ep.expectedTelemetry.packetsPerSecond
  assert.ok(ppsRatio < 1.05, `PPS ratio ${ppsRatio} implies under_attack amplification`)
  assert.equal(ep.telemetry.filesDownloaded, 1)
  assert.equal(ep.expectedTelemetry.filesDownloaded, 0)
})

test('explicit attack state still applies under_attack multiplier', () => {
  const healthy = buildCitySnapshot(roomFixture({ attackState: false })).endpoints.find(
    (e) => e.id === 'n1'
  )
  const attacked = buildCitySnapshot(
    roomFixture({
      attackState: true,
      presetOverride: computePresetOverrides('traffic_flood', BASE),
    })
  ).endpoints.find((e) => e.id === 'n1')
  assert.equal(attacked.behaviour.attackOverrideActive, true)
  assert.ok(
    attacked.telemetry.packetsPerSecond > healthy.expectedTelemetry.packetsPerSecond * 1.2,
    'attack path should elevate observed PPS via state and/or preset'
  )
})

test('filesDownloaded 0→1 override is not an automatic TGNN anomaly', () => {
  const cal = createCalibrator()
  warm(cal)
  const { result } = detect(roomFixture({ filesOverride: 1 }), cal)
  const row = result.nodeResults.find((r) => r.id === 'n1')
  assert.equal(row.debug.attackStateActive, false)
  assert.equal(row.debug.telemetryOverrideActive, true)
  assert.equal(result.anomalyNodeIds.includes('n1'), false)
})

test('larger file increases raise deviation progressively', () => {
  const cal = createCalibrator()
  warm(cal)
  const scores = []
  for (const v of [1, 5, 10, 20]) {
    const { input, result } = detect(roomFixture({ filesOverride: v }), cal)
    const ep = input.endpoints.find((e) => e.id === 'n1')
    const maxDev = maxMetricDeviation(ep.expectedTelemetry, ep.telemetry, GAME_METRIC_KEYS)
    scores.push({
      v,
      maxDev,
      anomaly: result.anomalyNodeIds.includes('n1'),
      score: result.isolationScoresByNodeId.n1,
    })
  }
  assert.ok(scores[0].maxDev < scores[1].maxDev)
  assert.ok(scores[1].maxDev < scores[2].maxDev)
  assert.ok(scores[2].maxDev < scores[3].maxDev)
  assert.equal(scores[0].anomaly, false)
  assert.equal(scores[3].anomaly, true)
})

test('failed login +1 is not equivalent to a spray', () => {
  const cal = createCalibrator()
  warm(cal)
  const mild = detect(
    roomFixture({
      filesOverride: undefined,
      presetOverride: { failedLoginsPerMin: 2 },
    }),
    cal
  )
  assert.equal(mild.result.anomalyNodeIds.includes('n1'), false)

  const spray = detect(
    roomFixture({
      presetOverride: { failedLoginsPerMin: 20 },
    }),
    cal
  )
  assert.equal(spray.result.anomalyNodeIds.includes('n1'), true)
})

test('PPS ±1% / ±5% stay below anomaly; ±10% can flag', () => {
  const cal = createCalibrator()
  warm(cal)
  const cases = [
    { pps: 5050, expectAnomaly: false },
    { pps: 5250, expectAnomaly: false },
    { pps: 5500, expectAnomaly: true },
  ]
  for (const c of cases) {
    const { result } = detect(
      roomFixture({ presetOverride: { packetsPerSecond: c.pps } }),
      cal
    )
    assert.equal(
      result.anomalyNodeIds.includes('n1'),
      c.expectAnomaly,
      `PPS=${c.pps}`
    )
  }
})

test('healthy context-consistent telemetry is not anomalous for all six contexts', () => {
  for (const ctx of CITY_CONTEXTS) {
    const cal = createCalibrator()
    for (let t = 1; t <= 15; t++) {
      detect(roomFixture({ tick: t, cityContextOverride: ctx }), cal)
    }
    const { result } = detect(roomFixture({ tick: 20, cityContextOverride: ctx }), cal)
    assert.equal(
      result.anomalyNodeIds.includes('n1'),
      false,
      `${ctx} should be idle-normal`
    )
  }
})

test('explicit attack preset still produces TGNN anomaly', () => {
  const cal = createCalibrator()
  warm(cal)
  const flood = computePresetOverrides('traffic_flood', BASE)
  const { result, snap } = detect(
    roomFixture({ attackState: true, presetOverride: flood }),
    cal
  )
  const ep = snap.endpoints.find((e) => e.id === 'n1')
  assert.equal(ep.behaviour.attackOverrideActive, true)
  assert.equal(result.anomalyNodeIds.includes('n1'), true)
})

test('adaptCitySnapshot drops yamlOnly endpoints from detection input', () => {
  const snap = buildCitySnapshot(roomFixture())
  assert.ok(snap.endpoints.some((e) => e.yamlOnly === true))
  const input = adaptCitySnapshot(snap)
  assert.equal(
    input.endpoints.some((e) => String(e.id).startsWith('yaml:')),
    false
  )
  assert.ok(input.endpoints.some((e) => e.id === 'n1'))
})

test('expected telemetry follows city context multipliers', () => {
  const meta = {
    id: 'n1',
    type: 'traffic_management',
    sector: 'Transportation',
    cityEndpointId: yamlIdForCatalogType('traffic_management'),
    tick: 20,
  }
  const normal = expectedTelemetry(BASE, 'normal_day', meta)
  const rush = expectedTelemetry(BASE, 'rush_hour', meta)
  assert.ok(rush.packetsPerSecond > normal.packetsPerSecond)
})
