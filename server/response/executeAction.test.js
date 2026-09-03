import assert from 'node:assert/strict'
import test from 'node:test'
import { resetMetricsDbForTests } from '../metrics/store.js'
import {
  commanderContextFor,
  getIncident,
  persistDetectionIncidents,
} from '../metrics/incidents.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { setNodeQuarantined } from './quarantineNode.js'
import {
  EXECUTION_STATUS,
  executeResponseAction,
} from './executeAction.js'

function payRoom() {
  return {
    id: 'DEMO',
    nodes: [
      {
        id: 'pay',
        data: {
          label: 'Payment Processing System',
          type: 'payment_processing_system',
          cityEndpointId: 'payment-processing-system',
          runtimeState: { provenance: 'legitimate', quarantined: false },
        },
      },
      { id: 'gw', data: { label: 'Bank Gateway', type: 'bank_gateway' } },
      { id: 'core', data: { label: 'Core Banking', type: 'banking_financial' } },
    ],
    edges: [
      { id: 'e1', source: 'pay', target: 'gw' },
      { id: 'e2', source: 'gw', target: 'core' },
    ],
    detection: { incidents: [] },
  }
}

function payDetection() {
  return {
    anomalyNodeIds: ['pay'],
    peerExposedNodeIds: ['gw'],
    propagatedNodeIds: ['gw', 'core'],
    propagationPaths: {
      gw: ['pay', 'gw'],
      core: ['pay', 'gw', 'core'],
    },
    propagationRiskByNode: { gw: 50, core: 25 },
    atRiskNodeIds: ['core', 'gw'],
    incidents: [
      {
        id: 'inc-pay',
        endpointId: 'pay',
        endpointLabel: 'Payment Processing System',
        severity: 'high',
        detectionType: 'behavioural_anomaly',
        anomalyScore: 0.87,
        trustScore: 42,
        evidence: [{ code: 'tgnn_embed', detail: 'tgnn_embed' }],
        peerExposedNodeIds: ['gw'],
        propagatedNodeIds: ['gw', 'core'],
        propagationPaths: {
          gw: ['pay', 'gw'],
          core: ['pay', 'gw', 'core'],
        },
      },
    ],
  }
}

test('valid incident + isolate-node executes quarantine', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, payDetection())
  const context = commanderContextFor('DEMO', 'inc-pay')
  let synced = 0
  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context,
    onRoomMutated: () => {
      synced += 1
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.status, EXECUTION_STATUS.EXECUTED)
  assert.equal(result.actionId, 'isolate-node')
  assert.equal(result.actionType, 'ISOLATE_NODE')
  assert.equal(result.target.id, 'pay')
  assert.match(result.target.name, /Payment/)
  assert.equal(typeof result.executedAtMs, 'number')
  assert.ok(result.incidentId)
  assert.equal(synced, 1)
  const pay = room.nodes.find((n) => n.id === 'pay')
  assert.equal(runtimeStateOf(pay.data).quarantined, true)
})

test('unknown action is rejected', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, payDetection())
  const context = commanderContextFor('DEMO', 'inc-pay')
  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'shutdown-grid',
    context,
  })
  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 400)
  assert.match(result.message, /Unknown action/i)
  assert.equal(runtimeStateOf(room.nodes[0].data).quarantined, false)
})

test('incident without valid target is rejected', () => {
  const room = payRoom()
  const context = {
    incidentId: 'orphan',
    affectedAsset: { id: '', summary: '' },
    availableActions: [],
  }
  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'orphan',
    actionId: 'isolate-node',
    context,
  })
  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 400)
  assert.match(result.message, /affected node/i)
})

test('invalid incident is rejected', () => {
  const room = payRoom()
  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'missing',
    actionId: 'isolate-node',
    context: null,
  })
  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 404)
  assert.match(result.message, /Incident not found/i)
})

test('already quarantined returns ALREADY_EXECUTED without re-mutating', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, payDetection())
  const context = commanderContextFor('DEMO', 'inc-pay')
  const first = setNodeQuarantined(room, 'pay', true)
  assert.equal(first.ok, true)
  assert.equal(first.already, false)
  const nodeRef = room.nodes.find((n) => n.id === 'pay')
  let synced = 0
  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context,
    onRoomMutated: () => {
      synced += 1
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.status, EXECUTION_STATUS.ALREADY_EXECUTED)
  assert.equal(synced, 0)
  assert.equal(room.nodes.find((n) => n.id === 'pay'), nodeRef)
  assert.equal(runtimeStateOf(nodeRef.data).quarantined, true)
})

test('execution uses the same quarantine mechanism as defender path', () => {
  const room = payRoom()
  const viaHelper = setNodeQuarantined(room, 'gw', true)
  assert.equal(viaHelper.ok, true)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'gw').data).quarantined, true)

  resetMetricsDbForTests()
  const room2 = payRoom()
  persistDetectionIncidents(room2, payDetection())
  executeResponseAction({
    room: room2,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context: commanderContextFor('DEMO', 'inc-pay'),
  })
  assert.equal(
    runtimeStateOf(room2.nodes.find((n) => n.id === 'pay').data).quarantined,
    true
  )
})

test('result includes incidentId, actionId, target, and status', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, payDetection())
  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context: commanderContextFor('DEMO', 'inc-pay'),
  })
  assert.equal(result.ok, true)
  assert.ok(result.incidentId)
  assert.equal(result.actionId, 'isolate-node')
  assert.equal(result.target.id, 'pay')
  assert.ok(result.target.name)
  assert.equal(result.status, 'EXECUTED')
})

test('actions_taken_json records the executed action', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, payDetection())
  const before = getIncident('DEMO', 'inc-pay')
  assert.ok(before)
  assert.deepEqual(before.actionsTaken ?? [], [])

  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context: commanderContextFor('DEMO', 'inc-pay'),
  })
  assert.equal(result.ok, true)

  const after = getIncident('DEMO', 'inc-pay')
  assert.equal(after.actionsTaken.length, 1)
  assert.equal(after.actionsTaken[0].actionId, 'isolate-node')
  assert.equal(after.actionsTaken[0].status, 'EXECUTED')
  assert.equal(after.actionsTaken[0].targetNodeId, 'pay')
  assert.equal(typeof after.actionsTaken[0].executedAtMs, 'number')
})

test('missing target node in room graph is rejected', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  room.nodes = room.nodes.filter((n) => n.id !== 'pay')
  persistDetectionIncidents(room, payDetection())
  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context: commanderContextFor('DEMO', 'inc-pay'),
  })
  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 404)
  assert.match(result.message, /not found/i)
})

test('exposure incidents cannot execute isolate-node', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, {
    ...payDetection(),
    incidents: [
      {
        id: 'inc-gw',
        endpointId: 'gw',
        endpointLabel: 'Bank Gateway',
        severity: 'medium',
        detectionType: 'dependency_anomaly',
        anomalyScore: 0.4,
        trustScore: 60,
        evidence: [{ code: 'peer_exposure', kind: 'dependency_anomaly', hopDistance: 1 }],
        peerExposedNodeIds: ['gw'],
        propagatedNodeIds: ['core'],
        isExposureIncident: true,
      },
    ],
  })
  room.detection = { anomalyNodeIds: ['pay'], incidents: [] }
  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-gw',
    actionId: 'isolate-node',
    context: commanderContextFor('DEMO', 'inc-gw'),
  })
  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 400)
  assert.match(result.message, /confirmed anomaly/i)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'gw').data).quarantined, false)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined, false)
})

test('execute against a live non-seed target is rejected', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, payDetection())
  room.detection = { anomalyNodeIds: ['pay'], incidents: room.detection.incidents }
  const context = {
    ...commanderContextFor('DEMO', 'inc-pay'),
    affectedAsset: { id: 'gw', summary: 'Bank Gateway' },
  }
  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context,
  })
  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 400)
  assert.match(result.message, /confirmed anomaly/i)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'gw').data).quarantined, false)
})

test('isolate then restore clears quarantine only', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  room.hackSimulator = {
    active: true,
    nodeOverrides: {
      pay: { packetsPerSecond: 80_000, httpRequestsPerMin: 900 },
    },
    edgeOverrides: {},
  }
  persistDetectionIncidents(room, payDetection())
  room.detection = { ...payDetection(), anomalyNodeIds: ['pay'] }

  const isolate = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context: commanderContextFor('DEMO', 'inc-pay', { nodes: room.nodes }),
  })
  assert.equal(isolate.ok, true)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined, true)
  assert.equal(room.hackSimulator.nodeOverrides.pay, undefined)

  let synced = 0
  const restore = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'restore-connectivity',
    context: commanderContextFor('DEMO', 'inc-pay', { nodes: room.nodes }),
    onRoomMutated: () => {
      synced += 1
    },
  })
  assert.equal(restore.ok, true)
  assert.equal(restore.status, EXECUTION_STATUS.EXECUTED)
  assert.equal(restore.actionId, 'restore-connectivity')
  assert.equal(restore.actionType, 'RESTORE_CONNECTIVITY')
  assert.equal(synced, 1)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined, false)
  assert.equal(room.hackSimulator.nodeOverrides.pay, undefined)

  const after = getIncident('DEMO', 'inc-pay')
  assert.ok(after.actionsTaken.some((a) => a.actionId === 'isolate-node'))
  assert.ok(after.actionsTaken.some((a) => a.actionId === 'restore-connectivity'))
  assert.equal(
    after.actionsTaken.find((a) => a.actionId === 'restore-connectivity').status,
    'EXECUTED'
  )
})

test('restore unavailable before isolation', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, payDetection())
  setNodeQuarantined(room, 'pay', true)
  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'restore-connectivity',
    context: commanderContextFor('DEMO', 'inc-pay', { nodes: room.nodes }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 400)
  assert.match(result.message, /not available/i)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined, true)
})

test('restore unavailable when node is not quarantined', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, payDetection())
  executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context: commanderContextFor('DEMO', 'inc-pay', { nodes: room.nodes }),
  })
  setNodeQuarantined(room, 'pay', false)
  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'restore-connectivity',
    context: commanderContextFor('DEMO', 'inc-pay', { nodes: room.nodes }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.status, EXECUTION_STATUS.ALREADY_EXECUTED)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined, false)
})

test('restore unavailable for exposure-only and peer targets', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, {
    ...payDetection(),
    incidents: [
      {
        id: 'inc-gw',
        endpointId: 'gw',
        endpointLabel: 'Bank Gateway',
        severity: 'medium',
        detectionType: 'dependency_anomaly',
        anomalyScore: 0.4,
        trustScore: 60,
        evidence: [{ code: 'peer_exposure', kind: 'dependency_anomaly', hopDistance: 1 }],
        peerExposedNodeIds: ['gw'],
        propagatedNodeIds: ['core'],
        isExposureIncident: true,
      },
    ],
  })
  setNodeQuarantined(room, 'gw', true)
  const result = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-gw',
    actionId: 'restore-connectivity',
    context: commanderContextFor('DEMO', 'inc-gw', { nodes: room.nodes }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 400)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'gw').data).quarantined, true)
})

test('repeated restore is idempotent', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, payDetection())
  room.detection = { ...payDetection(), anomalyNodeIds: ['pay'] }
  executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context: commanderContextFor('DEMO', 'inc-pay', { nodes: room.nodes }),
  })
  const first = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'restore-connectivity',
    context: commanderContextFor('DEMO', 'inc-pay', { nodes: room.nodes }),
  })
  assert.equal(first.ok, true)
  assert.equal(first.status, EXECUTION_STATUS.EXECUTED)

  let synced = 0
  const nodeRef = room.nodes.find((n) => n.id === 'pay')
  const second = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'restore-connectivity',
    context: commanderContextFor('DEMO', 'inc-pay', { nodes: room.nodes }),
    onRoomMutated: () => {
      synced += 1
    },
  })
  assert.equal(second.ok, true)
  assert.equal(second.status, EXECUTION_STATUS.ALREADY_EXECUTED)
  assert.equal(synced, 0)
  assert.equal(room.nodes.find((n) => n.id === 'pay'), nodeRef)
  assert.equal(runtimeStateOf(nodeRef.data).quarantined, false)
})

test('Stage 4B: restore remains available and executes after clear + detection upserts', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  room.hackSimulator = {
    active: true,
    nodeOverrides: {
      pay: { packetsPerSecond: 80_000, filesDownloaded: 900 },
    },
    edgeOverrides: {},
  }
  persistDetectionIncidents(room, payDetection())
  room.detection = { ...payDetection(), anomalyNodeIds: ['pay'] }

  const isolate = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'isolate-node',
    context: commanderContextFor('DEMO', 'inc-pay', { nodes: room.nodes }),
  })
  assert.equal(isolate.ok, true)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined, true)
  assert.equal(room.hackSimulator.nodeOverrides.pay, undefined)

  // Subsequent detection ticks must not erase isolate history
  for (let i = 0; i < 4; i += 1) {
    persistDetectionIncidents(room, payDetection())
  }
  assert.ok(
    getIncident('DEMO', 'inc-pay').actionsTaken.some((a) => a.actionId === 'isolate-node')
  )

  // Incident clears (graph recovered) — Commander history must survive
  persistDetectionIncidents(room, {
    ...payDetection(),
    incidents: [],
    anomalyNodeIds: [],
    peerExposedNodeIds: [],
    propagatedNodeIds: [],
  })
  const cleared = getIncident('DEMO', 'inc-pay')
  assert.equal(cleared.status, 'cleared')
  assert.ok(cleared.actionsTaken.some((a) => a.actionId === 'isolate-node'))

  const fresh = commanderContextFor('DEMO', 'inc-pay', { nodes: room.nodes })
  assert.ok(fresh.actionsAlreadyTaken.some((a) => a.actionId === 'isolate-node'))
  assert.equal(fresh.affectedAsset.quarantined, true)
  assert.equal(fresh.responseClassification?.isSeed, true)
  assert.equal(fresh.responseClassification?.isExposureOnly, false)
  assert.ok(
    fresh.availableActions.some((a) => a.actionId === 'restore-connectivity'),
    'fresh policy must still offer restore after clear'
  )

  const restore = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'restore-connectivity',
    context: fresh,
  })
  assert.equal(restore.ok, true)
  assert.equal(restore.status, EXECUTION_STATUS.EXECUTED)
  assert.equal(runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined, false)
  assert.equal(room.hackSimulator.nodeOverrides.pay, undefined)
})

test('Stage 4B: exposure-only and quarantined-without-isolate still cannot restore', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, {
    ...payDetection(),
    incidents: [
      {
        id: 'inc-gw',
        endpointId: 'gw',
        endpointLabel: 'Bank Gateway',
        severity: 'medium',
        detectionType: 'dependency_anomaly',
        anomalyScore: 0.4,
        trustScore: 60,
        evidence: [{ code: 'peer_exposure', kind: 'dependency_anomaly', hopDistance: 1 }],
        peerExposedNodeIds: ['gw'],
        propagatedNodeIds: ['core'],
        isExposureIncident: true,
      },
    ],
  })
  setNodeQuarantined(room, 'gw', true)
  const exposureCtx = commanderContextFor('DEMO', 'inc-gw', { nodes: room.nodes })
  assert.equal(
    exposureCtx.availableActions.some((a) => a.actionId === 'restore-connectivity'),
    false
  )
  const exposureRestore = executeResponseAction({
    room,
    roomId: 'DEMO',
    incidentId: 'inc-gw',
    actionId: 'restore-connectivity',
    context: exposureCtx,
  })
  assert.equal(exposureRestore.ok, false)

  resetMetricsDbForTests()
  const seedRoom = payRoom()
  persistDetectionIncidents(seedRoom, payDetection())
  setNodeQuarantined(seedRoom, 'pay', true)
  const noIsolateCtx = commanderContextFor('DEMO', 'inc-pay', { nodes: seedRoom.nodes })
  assert.equal(
    noIsolateCtx.availableActions.some((a) => a.actionId === 'restore-connectivity'),
    false
  )
  const noIsolateRestore = executeResponseAction({
    room: seedRoom,
    roomId: 'DEMO',
    incidentId: 'inc-pay',
    actionId: 'restore-connectivity',
    context: noIsolateCtx,
  })
  assert.equal(noIsolateRestore.ok, false)
  assert.match(noIsolateRestore.message, /not available/i)
  assert.equal(runtimeStateOf(seedRoom.nodes.find((n) => n.id === 'pay').data).quarantined, true)
})
