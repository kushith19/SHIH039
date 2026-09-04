import assert from 'node:assert/strict'
import test from 'node:test'
import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { computeFinancialExposure } from '../../shared/financialExposure.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { applyManualPreset, abortAndClearAttacks } from '../campaign/engine.js'
import { buildCitySnapshot } from '../telemetry/citySnapshot.js'
import { adaptCitySnapshot } from '../detection/adapter.js'
import { runDetection } from '../detection/engine.js'
import { createCalibrator } from '../detection/calibrator.js'
import { runTgnnAnomaly } from '../detection/tgnn.js'
import { resetMetricsDbForTests } from '../metrics/store.js'
import {
  commanderContextFor,
  getIncident,
  listIncidentHistory,
  persistDetectionIncidents,
} from '../metrics/incidents.js'
import { setNodeQuarantined } from './quarantineNode.js'
import {
  EXECUTION_STATUS,
  executeResponseAction,
} from './executeAction.js'

const warmup = TRUST_CONFIG.tgnn.warmupTicks ?? 15

function tel(pps, http = 80, files = 5, logins = 2) {
  return {
    packetsPerSecond: pps,
    httpRequestsPerMin: http,
    filesDownloaded: files,
    failedLoginsPerMin: logins,
  }
}

function makeFinanceRoom(id = 'CONTAIN') {
  return {
    id,
    phase: 'playing',
    simulationTick: 0,
    matchNodeIds: ['pay', 'gw', 'core', 'water'],
    matchEdgeIds: ['e1', 'e2'],
    nodes: [
      {
        id: 'pay',
        data: {
          label: 'Payment Processing System',
          type: 'payment_processing_system',
          sector: 'finance',
          criticality: 'critical',
          cityEndpointId: 'payment-processing-system',
          telemetry: tel(420),
          runtimeState: { provenance: 'legitimate', quarantined: false },
          behaviour: { intrinsicTrust: 75 },
        },
      },
      {
        id: 'gw',
        data: {
          label: 'Bank Gateway',
          type: 'bank_gateway',
          sector: 'finance',
          criticality: 'high',
          cityEndpointId: 'bank-gateway',
          telemetry: tel(300, 60, 3, 1),
          runtimeState: { provenance: 'legitimate', quarantined: false },
        },
      },
      {
        id: 'core',
        data: {
          label: 'Core Banking',
          type: 'banking_financial',
          sector: 'finance',
          criticality: 'critical',
          cityEndpointId: 'core-banking-system',
          telemetry: tel(500, 100, 4, 1),
          runtimeState: { provenance: 'legitimate', quarantined: false },
        },
      },
      {
        id: 'water',
        data: {
          label: 'Water Gateway',
          type: 'gateway',
          sector: 'water',
          criticality: 'high',
          telemetry: tel(200, 40, 2, 1),
          runtimeState: { provenance: 'legitimate', quarantined: false },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'pay', target: 'gw', data: { packetsPerSecond: 200 } },
      { id: 'e2', source: 'gw', target: 'core', data: { packetsPerSecond: 180 } },
    ],
    hackSimulator: {
      active: true,
      nodeOverrides: {},
      edgeOverrides: {},
      nodeScenarioBaselines: {},
      edgeScenarioBaselines: {},
    },
    detection: { incidents: [] },
  }
}

function lockBaselines(room) {
  for (const n of room.nodes) {
    room.hackSimulator.nodeScenarioBaselines[n.id] = { ...n.data.telemetry }
  }
}

function payEp(snap) {
  return snap.endpoints.find((e) => e.id === 'pay')
}

function waterEp(snap) {
  return snap.endpoints.find((e) => e.id === 'water')
}

test('isolate-node clears target attack override so telemetry is no longer attack-dominated', () => {
  const room = makeFinanceRoom()
  lockBaselines(room)
  assert.equal(applyManualPreset(room, 'pay', 'traffic_flood').ok, true)
  const before = payEp(buildCitySnapshot(room))
  assert.ok(before.telemetry.packetsPerSecond >= 50_000)
  assert.equal(before.behaviour.attackOverrideActive, true)

  const q = setNodeQuarantined(room, 'pay', true)
  assert.equal(q.ok, true)
  assert.equal(q.overrideCleared, true)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined, true)
  assert.equal(room.hackSimulator.nodeOverrides.pay, undefined)

  const after = payEp(buildCitySnapshot(room))
  assert.equal(after.runtimeState.quarantined, true)
  assert.equal(after.behaviour.attackOverrideActive, false)
  assert.ok(
    after.telemetry.packetsPerSecond < before.telemetry.packetsPerSecond * 0.2,
    `expected PPS drop, got ${after.telemetry.packetsPerSecond} vs ${before.telemetry.packetsPerSecond}`
  )
})

test('defender quarantine path also clears the target override', () => {
  const room = makeFinanceRoom()
  lockBaselines(room)
  applyManualPreset(room, 'pay', 'api_abuse')
  assert.ok(room.hackSimulator.nodeOverrides.pay)

  // Same helper used by socket defender:quarantine
  const result = setNodeQuarantined(room, 'pay', true)
  assert.equal(result.ok, true)
  assert.equal(result.already, false)
  assert.equal(room.hackSimulator.nodeOverrides.pay, undefined)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined, true)
})

test('new attacks against quarantined node remain blocked', () => {
  const room = makeFinanceRoom()
  lockBaselines(room)
  setNodeQuarantined(room, 'pay', true)
  const blocked = applyManualPreset(room, 'pay', 'traffic_flood')
  assert.equal(blocked.ok, false)
  assert.match(blocked.message, /quarantined/i)
  assert.equal(room.hackSimulator.nodeOverrides.pay, undefined)
})

test('isolating Node A does not clear Node B override', () => {
  const room = makeFinanceRoom()
  lockBaselines(room)
  assert.equal(applyManualPreset(room, 'pay', 'traffic_flood').ok, true)
  assert.equal(applyManualPreset(room, 'water', 'credential_spray').ok, true)
  const waterBefore = waterEp(buildCitySnapshot(room)).telemetry.failedLoginsPerMin

  setNodeQuarantined(room, 'pay', true)
  assert.equal(room.hackSimulator.nodeOverrides.pay, undefined)
  assert.ok(room.hackSimulator.nodeOverrides.water)
  const waterAfter = waterEp(buildCitySnapshot(room))
  assert.equal(waterAfter.behaviour.attackOverrideActive, true)
  assert.ok(waterAfter.telemetry.failedLoginsPerMin >= waterBefore * 0.9)
})

test('repeated isolation is idempotent and does not re-mutate', () => {
  const room = makeFinanceRoom()
  lockBaselines(room)
  applyManualPreset(room, 'pay', 'traffic_flood')
  const first = setNodeQuarantined(room, 'pay', true)
  assert.equal(first.already, false)
  assert.equal(first.overrideCleared, true)
  const simRef = room.hackSimulator
  const second = setNodeQuarantined(room, 'pay', true)
  assert.equal(second.already, true)
  assert.equal(second.overrideCleared, false)
  assert.equal(room.hackSimulator, simRef)
})

test('execute isolate-node then detection recalculates without forced healthy scores', () => {
  resetMetricsDbForTests()
  const room = makeFinanceRoom('EXEC')
  lockBaselines(room)
  const calibrator = createCalibrator()
  for (let t = 0; t < warmup; t++) {
    room.simulationTick = t
    runTgnnAnomaly(adaptCitySnapshot(buildCitySnapshot(room)), { calibrator })
  }

  applyManualPreset(room, 'pay', 'traffic_flood')
  room.simulationTick = warmup
  const attackInput = adaptCitySnapshot(buildCitySnapshot(room))
  const attackTgnn = runTgnnAnomaly(attackInput, { calibrator })
  const attackDet = runDetection(attackInput)
  assert.ok(attackTgnn.anomalyNodeIds.includes('pay'))
  assert.ok(attackDet.peerExposedNodeIds.includes('gw'))
  assert.ok(attackDet.propagatedNodeIds.length > 0)
  const financeBefore = computeFinancialExposure({
    detection: attackDet,
    nodes: room.nodes,
    edges: room.edges,
  })
  assert.ok(financeBefore.lakhs > 0)

  room.detection = attackDet
  persistDetectionIncidents(room, attackDet)
  const exec = executeResponseAction({
    room,
    roomId: 'EXEC',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context: commanderContextFor('EXEC', 'inc-pay'),
    onRoomMutated: () => {},
  })
  assert.equal(exec.ok, true)
  assert.equal(exec.status, EXECUTION_STATUS.EXECUTED)
  assert.equal(room.hackSimulator.nodeOverrides.pay, undefined)

  // Post-containment ticks — natural recalculation (no forced scores)
  let last = null
  for (let i = 1; i <= 8; i++) {
    room.simulationTick = warmup + i
    const input = adaptCitySnapshot(buildCitySnapshot(room))
    const tgnn = runTgnnAnomaly(input, { calibrator })
    const det = runDetection(input)
    last = {
      tgnn,
      det,
      finance: computeFinancialExposure({
        detection: det,
        nodes: room.nodes,
        edges: room.edges,
      }),
      pps: payEp(buildCitySnapshot(room)).telemetry.packetsPerSecond,
    }
  }

  assert.ok(last.pps < 5_000, `post-containment PPS should normalize, got ${last.pps}`)
  assert.equal(last.tgnn.anomalyNodeIds.includes('pay'), false)
  assert.equal(last.det.peerExposedNodeIds.includes('gw'), false)
  assert.ok(
    last.det.propagatedNodeIds.length < attackDet.propagatedNodeIds.length ||
      last.det.propagatedNodeIds.length === 0
  )
  assert.ok(
    last.finance.lakhs < financeBefore.lakhs,
    `finance should drop via flagged-set, before=${financeBefore.lakhs} after=${last.finance.lakhs}`
  )

  // Incident clears via existing empty-promotion lifecycle
  persistDetectionIncidents(room, {
    ...last.det,
    incidents: [],
    anomalyNodeIds: last.tgnn.anomalyNodeIds,
  })
  const open = getIncident('EXEC', 'inc-pay')
  assert.equal(open.status, 'cleared')
})

test('ALREADY_EXECUTED via execute path remains idempotent', () => {
  resetMetricsDbForTests()
  const room = makeFinanceRoom('IDEMP')
  lockBaselines(room)
  applyManualPreset(room, 'pay', 'traffic_flood')
  const det = {
    anomalyNodeIds: ['pay'],
    peerExposedNodeIds: ['gw'],
    propagatedNodeIds: ['gw', 'core'],
    propagationPaths: { gw: ['pay', 'gw'], core: ['pay', 'gw', 'core'] },
    incidents: [
      {
        id: 'inc-pay',
        endpointId: 'pay',
        endpointLabel: 'Payment Processing System',
        severity: 'high',
        detectionType: 'behavioural_anomaly',
        anomalyScore: 0.9,
        trustScore: 40,
        evidence: [{ code: 'tgnn_embed', detail: 'tgnn_embed' }],
        peerExposedNodeIds: ['gw'],
        propagatedNodeIds: ['gw', 'core'],
        propagationPaths: { gw: ['pay', 'gw'], core: ['pay', 'gw', 'core'] },
      },
    ],
  }
  persistDetectionIncidents(room, det)
  const first = executeResponseAction({
    room,
    roomId: 'IDEMP',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context: commanderContextFor('IDEMP', 'inc-pay'),
  })
  assert.equal(first.status, EXECUTION_STATUS.EXECUTED)
  const overrides = { ...room.hackSimulator.nodeOverrides }
  const second = executeResponseAction({
    room,
    roomId: 'IDEMP',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context: commanderContextFor('IDEMP', 'inc-pay'),
    approvedPlanStep: true,
  })
  assert.equal(second.status, EXECUTION_STATUS.ALREADY_EXECUTED)
  assert.deepEqual(room.hackSimulator.nodeOverrides, overrides)
})

test('clear attacks also lifts quarantine so nodes return to normal', () => {
  resetMetricsDbForTests()
  const room = makeFinanceRoom('CLEAR')
  lockBaselines(room)
  assert.equal(applyManualPreset(room, 'pay', 'traffic_flood').ok, true)
  assert.equal(applyManualPreset(room, 'water', 'credential_spray').ok, true)
  setNodeQuarantined(room, 'pay', true)
  setNodeQuarantined(room, 'gw', true)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined, true)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'gw').data).quarantined, true)
  assert.equal(room.hackSimulator.nodeOverrides.pay, undefined)
  assert.ok(room.hackSimulator.nodeOverrides.water)

  abortAndClearAttacks(room)

  assert.deepEqual(room.hackSimulator.nodeOverrides, {})
  assert.deepEqual(room.hackSimulator.edgeOverrides, {})
  for (const n of room.nodes) {
    assert.equal(
      runtimeStateOf(n.data).quarantined,
      false,
      `${n.id} should not remain quarantined after clear attacks`
    )
  }
})

test('quarantined node ignores restored attack override and is not re-seeded', () => {
  const room = makeFinanceRoom('HOLD')
  lockBaselines(room)
  assert.equal(applyManualPreset(room, 'pay', 'traffic_flood').ok, true)
  setNodeQuarantined(room, 'pay', true)
  assert.equal(room.hackSimulator.nodeOverrides.pay, undefined)

  // Stale attacker sim:patch re-inserts the flood override while still quarantined
  room.hackSimulator.nodeOverrides.pay = {
    packetsPerSecond: 80_000,
    httpRequestsPerMin: 900,
  }

  const snap = buildCitySnapshot(room)
  const pay = payEp(snap)
  assert.equal(pay.runtimeState.quarantined, true)
  assert.equal(pay.behaviour.attackOverrideActive, false)
  assert.ok(
    pay.telemetry.packetsPerSecond < 5_000,
    `quarantine must suppress override PPS, got ${pay.telemetry.packetsPerSecond}`
  )

  const calibrator = createCalibrator()
  for (let t = 0; t < warmup; t++) {
    room.simulationTick = t
    // warm up without override noise
    const warm = makeFinanceRoom('HOLD')
    warm.hackSimulator = room.hackSimulator
    warm.nodes = room.nodes
    warm.simulationTick = t
    runTgnnAnomaly(adaptCitySnapshot(buildCitySnapshot(warm)), { calibrator })
  }
  room.simulationTick = warmup
  const det = runDetection(adaptCitySnapshot(snap))
  assert.equal(det.anomalyNodeIds.includes('pay'), false)
})

test('after isolate, incident clears and stays cleared across ticks (no reopen loop)', () => {
  resetMetricsDbForTests()
  const room = makeFinanceRoom('LOOP')
  lockBaselines(room)
  const calibrator = createCalibrator()
  for (let t = 0; t < warmup; t++) {
    room.simulationTick = t
    runTgnnAnomaly(adaptCitySnapshot(buildCitySnapshot(room)), { calibrator })
  }

  applyManualPreset(room, 'pay', 'traffic_flood')
  room.simulationTick = warmup
  const attackDet = runDetection(adaptCitySnapshot(buildCitySnapshot(room)))
  assert.ok(attackDet.anomalyNodeIds.includes('pay'))
  room.detection = attackDet
  persistDetectionIncidents(room, attackDet)
  assert.equal(getIncident('LOOP', 'inc-pay').status, 'open')

  executeResponseAction({
    room,
    roomId: 'LOOP',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context: commanderContextFor('LOOP', 'inc-pay'),
  })

  let reopenCount = 0
  for (let i = 1; i <= 12; i++) {
    room.simulationTick = warmup + i
    // Stale override race each tick — must not re-open the episode
    room.hackSimulator.nodeOverrides.pay = {
      packetsPerSecond: 80_000,
      httpRequestsPerMin: 900,
    }
    const input = adaptCitySnapshot(buildCitySnapshot(room))
    runTgnnAnomaly(input, { calibrator })
    const det = runDetection(input)
    assert.equal(
      det.anomalyNodeIds.includes('pay'),
      false,
      `tick ${room.simulationTick}: quarantined pay must not be an anomaly seed`
    )
    persistDetectionIncidents(room, {
      ...det,
      incidents: det.incidents ?? [],
      anomalyNodeIds: det.anomalyNodeIds ?? [],
    })
    const open = listIncidentHistory('LOOP').filter((r) => r.status === 'open')
    reopenCount = Math.max(reopenCount, open.length)
  }

  const history = listIncidentHistory('LOOP')
  assert.equal(history.filter((r) => r.status === 'open').length, 0)
  assert.ok(history.some((r) => r.status === 'cleared'))
  assert.equal(
    history.filter((r) => String(r.liveIncidentId) === 'inc-pay').length,
    1,
    'should not create repeated inc-pay episodes after containment'
  )
  assert.equal(reopenCount, 0)
})

test('clear attacks preserves persisted incident history', () => {
  resetMetricsDbForTests()
  const room = makeFinanceRoom('CLEAR-HIST')
  persistDetectionIncidents(room, {
    anomalyNodeIds: ['pay'],
    peerExposedNodeIds: [],
    propagatedNodeIds: [],
    incidents: [
      {
        id: 'inc-pay',
        endpointId: 'pay',
        endpointLabel: 'Payment Processing System',
        severity: 'high',
        detectionType: 'behavioural_anomaly',
        anomalyScore: 0.9,
        trustScore: 40,
        evidence: [{ code: 'tgnn_anomaly', detail: 'residual' }],
      },
    ],
  })
  assert.equal(listIncidentHistory('CLEAR-HIST').length, 1)

  abortAndClearAttacks(room)

  assert.equal(listIncidentHistory('CLEAR-HIST').length, 1)
})
