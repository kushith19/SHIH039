import assert from 'node:assert/strict'
import test from 'node:test'
import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { computeFinancialExposure } from '../../shared/financialExposure.js'
import { peerExposureFromFlags } from '../../shared/trustModel.js'
import { propagateGraphRisk } from '../../shared/graphPropagation.js'
import { applyManualPreset } from '../campaign/engine.js'
import { emptyLookback } from './types.js'
import { resetTgnnCalibrator } from './calibrator.js'
import { runDetection } from './engine.js'
import { promoteIncidents } from './incident.js'

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

const warmup = TRUST_CONFIG.tgnn.warmupTicks ?? 15

const DISJOINT_DEPS = [
  dep('e-pay-gw', 'pay', 'gw'),
  dep('e-gw-core', 'gw', 'core'),
  dep('e-road-traffic', 'road', 'traffic'),
]

function disjointHealthy() {
  return [
    ep('pay', { type: 'payment_processing_system', sector: 'finance', criticality: 'critical' }),
    ep('gw', { type: 'bank_gateway', sector: 'finance' }),
    ep('core', { type: 'banking_financial', sector: 'finance', criticality: 'critical' }),
    ep('road', { type: 'road_infrastructure', sector: 'transport', criticality: 'high' }),
    ep('traffic', { type: 'traffic_management', sector: 'transport' }),
    ep('lonely', { type: 'gateway', sector: 'water' }),
  ]
}

function inputFrom(endpoints, extra = {}) {
  return {
    roomId: extra.roomId ?? 'multi-seed',
    timestamp: '2026-09-04T00:00:00.000Z',
    tsMs: Date.parse('2026-09-04T00:00:00.000Z'),
    simulationTick: extra.simulationTick ?? 20,
    cityContext: 'normal_day',
    simHour: 10,
    matchActive: true,
    endpoints,
    dependencies: extra.dependencies ?? DISJOINT_DEPS,
  }
}

function warmupRoom(roomId, endpoints, dependencies) {
  resetTgnnCalibrator(roomId)
  for (let t = 0; t <= warmup; t += 1) {
    runDetection(inputFrom(endpoints, { simulationTick: t, roomId, dependencies }))
  }
}

test('single seed propagation still works', () => {
  const roomId = 'ms-single'
  warmupRoom(roomId, disjointHealthy(), DISJOINT_DEPS)
  const after = runDetection(
    inputFrom(
      [
        attacked('pay', { type: 'payment_processing_system', sector: 'finance', criticality: 'critical' }),
        ep('gw', { type: 'bank_gateway', sector: 'finance' }),
        ep('core', { type: 'banking_financial', sector: 'finance', criticality: 'critical' }),
        ep('road', { type: 'road_infrastructure', sector: 'transport', criticality: 'high' }),
        ep('traffic', { type: 'traffic_management', sector: 'transport' }),
        ep('lonely'),
      ],
      { simulationTick: warmup + 2, roomId }
    )
  )
  assert.deepEqual([...after.anomalyNodeIds].sort(), ['pay'])
  assert.ok(after.peerExposedNodeIds.includes('gw'))
  assert.ok(after.propagatedNodeIds.includes('gw'))
  assert.ok(after.propagatedNodeIds.includes('core'))
  assert.equal(after.propagatedNodeIds.includes('traffic'), false)
})

test('two simultaneous seeds are both retained with union peer and propagation', () => {
  const roomId = 'ms-two'
  warmupRoom(roomId, disjointHealthy(), DISJOINT_DEPS)
  const t0 = runDetection(
    inputFrom(
      [
        attacked('pay', { type: 'payment_processing_system', sector: 'finance', criticality: 'critical' }),
        ep('gw', { type: 'bank_gateway', sector: 'finance' }),
        ep('core', { type: 'banking_financial', sector: 'finance', criticality: 'critical' }),
        ep('road', { type: 'road_infrastructure', sector: 'transport', criticality: 'high' }),
        ep('traffic', { type: 'traffic_management', sector: 'transport' }),
        ep('lonely'),
      ],
      { simulationTick: warmup + 2, roomId }
    )
  )
  assert.ok(t0.anomalyNodeIds.includes('pay'))
  assert.ok(t0.propagatedNodeIds.includes('core'))

  const t1 = runDetection(
    inputFrom(
      [
        attacked('pay', { type: 'payment_processing_system', sector: 'finance', criticality: 'critical' }),
        ep('gw', { type: 'bank_gateway', sector: 'finance' }),
        ep('core', { type: 'banking_financial', sector: 'finance', criticality: 'critical' }),
        attacked('road', { type: 'road_infrastructure', sector: 'transport', criticality: 'high' }),
        ep('traffic', { type: 'traffic_management', sector: 'transport' }),
        ep('lonely'),
      ],
      { simulationTick: warmup + 3, roomId }
    )
  )
  assert.ok(t1.anomalyNodeIds.includes('pay'))
  assert.ok(t1.anomalyNodeIds.includes('road'))
  assert.ok(t1.propagatedNodeIds.includes('core'), 'pay downstream remains')
  assert.ok(t1.propagatedNodeIds.includes('traffic'), 'road downstream is added')
  assert.ok(t1.peerExposedNodeIds.includes('gw'))
  assert.ok(t1.peerExposedNodeIds.includes('traffic'))
  assert.equal(t1.incidents.length, 2)
})

test('a node with no valid downstream edge remains isolated', () => {
  const edges = [
    { source: 'hub', target: 'spoke' },
  ]
  const prop = propagateGraphRisk({
    edges,
    seedNodeIds: ['leaf'],
    validNodeIds: new Set(['hub', 'spoke', 'leaf']),
    maxHops: 3,
  })
  assert.deepEqual(prop.propagatedNodeIds, [])
  const peer = peerExposureFromFlags(edges, ['leaf'], new Set(['hub', 'spoke', 'leaf']))
  assert.deepEqual(peer.atRiskNodeIds, [])
})

test('cycles do not contaminate an independent second seed', () => {
  const edges = [
    { source: 'A', target: 'B' },
    { source: 'B', target: 'C' },
    { source: 'C', target: 'A' },
    { source: 'X', target: 'Y' },
  ]
  const result = propagateGraphRisk({
    edges,
    seedNodeIds: ['A', 'X'],
    maxHops: 3,
  })
  assert.ok(result.propagatedNodeIds.includes('B'))
  assert.ok(result.propagatedNodeIds.includes('C'))
  assert.ok(result.propagatedNodeIds.includes('Y'))
  assert.equal(result.propagatedNodeIds.includes('A'), false)
  assert.equal(result.propagatedNodeIds.includes('X'), false)
  assert.deepEqual(result.propagationPaths.Y, ['X', 'Y'])
})

test('attacking node B does not overwrite node A override', () => {
  const room = {
    nodes: [
      { id: 'pay', data: { telemetry: tel(420, 80, 5, 2) } },
      { id: 'road', data: { telemetry: tel(200, 40, 2, 1) } },
    ],
    hackSimulator: {
      active: true,
      nodeOverrides: {},
      edgeOverrides: {},
      nodeScenarioBaselines: {
        pay: tel(420, 80, 5, 2),
        road: tel(200, 40, 2, 1),
      },
    },
  }
  assert.equal(applyManualPreset(room, 'pay', 'traffic_flood').ok, true)
  assert.equal(applyManualPreset(room, 'road', 'api_abuse').ok, true)
  assert.ok(room.hackSimulator.nodeOverrides.pay)
  assert.ok(room.hackSimulator.nodeOverrides.road)
  assert.notEqual(room.hackSimulator.nodeOverrides.pay, room.hackSimulator.nodeOverrides.road)
})

test('financial exposure uses the union of both seeds and their blast', () => {
  const detection = {
    riskMomentum: { score: 90, available: true },
    anomalyNodeIds: ['pay', 'road'],
    peerExposedNodeIds: ['gw', 'traffic'],
    propagatedNodeIds: ['gw', 'core', 'traffic'],
    atRiskNodeIds: ['gw', 'core', 'traffic'],
    incidents: [{ endpointId: 'pay' }, { endpointId: 'road' }],
  }
  const nodes = [
    { id: 'pay', data: { type: 'payment_processing_system', criticality: 'critical' } },
    { id: 'gw', data: { type: 'bank_gateway', criticality: 'high' } },
    { id: 'core', data: { type: 'banking_financial', criticality: 'critical' } },
    { id: 'road', data: { type: 'road_infrastructure', criticality: 'high' } },
    { id: 'traffic', data: { type: 'traffic_management', criticality: 'medium' } },
  ]
  const view = computeFinancialExposure({
    detection,
    nodes,
    edges: [
      { source: 'pay', target: 'gw' },
      { source: 'gw', target: 'core' },
      { source: 'road', target: 'traffic' },
    ],
  })
  assert.ok(view.lakhs >= 80 + 30 + 120)
  assert.ok(view.affectedServiceIds.includes('payment-processing-system'))
  assert.ok(view.affectedServiceIds.includes('core-banking-system'))
  assert.ok(view.blastRadius >= 5)
})

test('promoteIncidents seed-scopes blast; detection union is separate', () => {
  const input = inputFrom(disjointHealthy(), { matchActive: false })
  input.matchActive = false
  const result = {
    anomalyNodeIds: ['pay', 'road'],
    peerExposedNodeIds: ['gw', 'traffic'],
    propagatedNodeIds: ['gw', 'core', 'traffic'],
    propagationPaths: {
      gw: ['pay', 'gw'],
      core: ['pay', 'gw', 'core'],
      traffic: ['road', 'traffic'],
    },
    reasonsByNodeId: { pay: ['tgnn_embed'], road: ['tgnn_embed'] },
    isolationScoresByNodeId: { pay: 0.9, road: 0.85 },
    timestamp: input.timestamp,
  }
  const incidents = promoteIncidents(result, input)
  const pay = incidents.find((i) => i.endpointId === 'pay')
  const road = incidents.find((i) => i.endpointId === 'road')
  assert.equal(pay.propagatedNodeIds.includes('traffic'), false)
  assert.equal(road.propagatedNodeIds.includes('core'), false)
  assert.ok(pay.propagatedNodeIds.includes('core'))
  assert.ok(road.propagatedNodeIds.includes('traffic'))
})
