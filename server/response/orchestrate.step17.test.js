import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
} from './orchestrate.js'
import { executeResponseAction } from './executeAction.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import { ORCHESTRATION_STATUS } from '../../shared/response/orchestration.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import {
  getRepositoryAction,
  listRepositoryActions,
} from '../../shared/response/responseActionRepository.js'
import { selectPlaybookId } from '../../shared/response/responsePlaybooks.js'
import { publicResponseRuntime } from './responseRuntime.js'

function node(id, criticality = 'high') {
  return {
    id,
    data: {
      label: id.toUpperCase(),
      criticality,
      runtimeState: { quarantined: false, provenance: 'catalog' },
    },
  }
}

function seedIncident(id, endpointId, extra = {}) {
  return {
    id,
    endpointId,
    endpointLabel: endpointId.toUpperCase(),
    status: 'open',
    severity: 'high',
    anomalyScore: 0.9,
    criticality: 'high',
    detectionType: 'behavioral_anomaly',
    evidence: [
      {
        code: 'metric_deviation',
        metric: 'packetsPerSecond',
        observed: 800,
        expected: 80,
        deviationPct: 900,
      },
    ],
    peerExposedNodeIds: [],
    propagatedNodeIds: [],
    actionsTaken: [],
    ...extra,
  }
}

function resolveContext(room, _roomId, incidentId) {
  const live = (room.detection?.incidents ?? []).find(
    (inc) => inc.id === incidentId || inc.persistentId === incidentId
  )
  if (!live) return null
  const n = room.nodes.find((x) => x.id === live.endpointId)
  const base = {
    incidentId: live.persistentId || live.id,
    liveIncidentId: live.id,
    incidentType: live.detectionType,
    severity: live.severity,
    status: live.status,
    affectedAsset: {
      id: live.endpointId,
      summary: live.endpointLabel,
      quarantined: n ? runtimeStateOf(n.data).quarantined === true : false,
    },
    riskScore: live.anomalyScore,
    trustScore: 35,
    anomalyEvidence: live.evidence ?? [],
    peerExposure: live.peerExposedNodeIds ?? [],
    peerExposedNodeIds: live.peerExposedNodeIds ?? [],
    propagatedNodeIds: live.propagatedNodeIds ?? [],
    actionsAlreadyTaken: live.actionsTaken ?? [],
    isExposureIncident: live.isExposureIncident === true,
  }
  return attachAvailableResponseActions(
    attachResponseClassification(base, room.nodes)
  )
}

function roomMulti(id = 'S17') {
  const room = createEmptyRoom(id)
  const ids = ['n1', 'n2', 'n3']
  room.nodes = ids.map((nid) => node(nid)).concat([node('gw', 'medium'), node('extra')])
  room.edges = [
    ...ids.map((nid, i) => ({ id: `e${i}`, source: nid, target: 'gw' })),
    { id: 'ex', source: 'extra', target: 'gw' },
  ]
  room.detection = {
    incidents: ids.map((nid, i) =>
      seedIncident(`inc-${i + 1}`, nid, { recoveryPriority: 50 - i })
    ),
    anomalyNodeIds: [...ids],
    atRiskNodeIds: ['gw'],
    peerExposedNodeIds: [],
    propagatedNodeIds: [],
    isolationScoresByNodeId: Object.fromEntries([
      ...ids.map((nid) => [nid, 0.9]),
      ['gw', 0.2],
      ['extra', 0.2],
    ]),
  }
  attachRecoveryImpact(room.detection, {
    nodes: room.nodes,
    edges: room.edges,
    overrides: {},
  })
  room.hackSimulator = {
    active: true,
    nodeOverrides: Object.fromEntries(
      ids.map((nid) => [nid, { packetsPerSecond: 900 }])
    ),
    edgeOverrides: {},
  }
  return room
}

describe('STEP 17 — Autonomous response + action repository', () => {
  it('A: approve once → autonomous loop → RECOVERED (no extra frontend commands)', () => {
    const room = roomMulti('S17-A')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
    })
    assert.equal(approved.ok, true)
    assert.equal(approved.autoContinued, true)
    assert.equal(approved.episodeComplete, true)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
    assert.equal(room.responseOrchestration.replanCount, 0)
    assert.equal(
      (room.responseOrchestration.workflowTrace || []).some(
        (t) => t.kind === 'replan_required'
      ),
      false
    )
  })

  it('B: in-scope actions auto-execute; out-of-scope target requires approval', () => {
    const room = roomMulti('S17-B')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    const scope = room.responseOrchestration.approvalScope
    assert.ok(scope.actionTypes.includes('isolate-node'))
    assert.ok(scope.actionTypes.includes('block-peer'))
    assert.equal(scope.autoContinue, true)
    assert.equal(scope.targetNodeIds.includes('extra'), false)
  })

  it('C: repository — registered executes; unsupported/unknown rejected', () => {
    const room = roomMulti('S17-C')
    room.detection.incidents = [seedIncident('inc-1', 'n1')]
    room.detection.anomalyNodeIds = ['n1']
    attachRecoveryImpact(room.detection, {
      nodes: room.nodes,
      edges: room.edges,
      overrides: {},
    })
    const ctx = resolveContext(room, room.id, 'inc-1')
    assert.equal(getRepositoryAction('isolate-node').supported, true)
    assert.equal(getRepositoryAction('disable-camera').supported, false)
    assert.equal(
      listRepositoryActions({ supportedOnly: true }).some(
        (a) => a.actionId === 'disable-camera'
      ),
      false
    )

    const ok = executeResponseAction({
      room,
      roomId: room.id,
      incidentId: 'inc-1',
      actionId: 'isolate-node',
      context: ctx,
    })
    assert.equal(ok.ok, true)

    const unsupported = executeResponseAction({
      room,
      roomId: room.id,
      incidentId: 'inc-1',
      actionId: 'disable-camera',
      context: ctx,
    })
    assert.equal(unsupported.ok, false)

    const unknown = executeResponseAction({
      room,
      roomId: room.id,
      incidentId: 'inc-1',
      actionId: 'totally-fake-action',
      context: ctx,
    })
    assert.equal(unknown.ok, false)
  })

  it('D: read-only diagnostic does not mutate quarantine/topology edges', () => {
    const room = roomMulti('S17-D')
    room.detection.incidents = [
      seedIncident('inc-1', 'n1', { peerExposedNodeIds: ['gw'] }),
    ]
    room.detection.anomalyNodeIds = ['n1']
    attachRecoveryImpact(room.detection, {
      nodes: room.nodes,
      edges: room.edges,
      overrides: {},
    })
    const edgeCount = room.edges.length
    const ctx = resolveContext(room, room.id, 'inc-1')
    // Force diagnostic via approved plan step path
    const result = executeResponseAction({
      room,
      roomId: room.id,
      incidentId: 'inc-1',
      actionId: 'inspect-peer-history',
      context: ctx,
      approvedPlanStep: true,
    })
    assert.equal(result.ok, true)
    assert.equal(result.mutation, false)
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'n1').data).quarantined,
      false
    )
    assert.equal(room.edges.length, edgeCount)
    assert.ok(publicResponseRuntime(room).diagnosticCount >= 1)
  })

  it('E: playbook selection is incident-aware (peers → lateral movement)', () => {
    assert.equal(selectPlaybookId('GENERAL_RESIDUAL_ANOMALY', {}), 'DEFAULT_CONTAIN')
    assert.equal(
      selectPlaybookId('GENERAL_RESIDUAL_ANOMALY', { peerExposedNodeIds: ['gw'] }),
      'LATERAL_MOVEMENT'
    )
    assert.equal(selectPlaybookId('DATA_EXFILTRATION', {}), 'EXTERNAL_C2')
    assert.equal(selectPlaybookId('OT_INFRASTRUCTURE_ANOMALY', {}), 'OT_SOFT_CONTAIN')
  })

  it('F: block-peer mutates responseRuntime without quarantine', () => {
    const room = roomMulti('S17-F')
    room.detection.incidents = [
      seedIncident('inc-1', 'n1', { peerExposedNodeIds: ['gw'] }),
    ]
    room.detection.anomalyNodeIds = ['n1']
    attachRecoveryImpact(room.detection, {
      nodes: room.nodes,
      edges: room.edges,
      overrides: {},
    })
    const ctx = resolveContext(room, room.id, 'inc-1')
    const result = executeResponseAction({
      room,
      roomId: room.id,
      incidentId: 'inc-1',
      actionId: 'block-peer',
      context: ctx,
      peerTargetId: 'gw',
      approvedPlanStep: true,
    })
    assert.equal(result.ok, true)
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'n1').data).quarantined,
      false
    )
    assert.ok(
      publicResponseRuntime(room).peerBlocks.some(
        (b) => b.sourceId === 'n1' && b.targetId === 'gw'
      )
    )
  })

  it('G: genuine execution failure → REPLAN_REQUIRED; continuation ≠ replan', () => {
    const room = roomMulti('S17-G')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    room.detection.incidents = []
    const fail = executeOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(fail.ok, false)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )

    const room2 = roomMulti('S17-G2')
    generateOrchestrationPlan(room2, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room2, {
      resolveContext,
      stepDelayMs: 0,
    })
    assert.equal(room2.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
    assert.equal(room2.responseOrchestration.replanCount, 0)
    assert.equal(room2.responseOrchestration.previousPlanId, null)
  })

  it('H: client cannot inject actionIds or bypass approval', () => {
    const room = roomMulti('S17-H')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    const denied = executeOrchestrationPlan(room, {
      resolveContext,
      clientActionIds: ['block-peer'],
      autoContinue: false,
    })
    assert.equal(denied.ok, false)
    assert.match(String(denied.message), /APPROVED/i)
  })

  it('I: workflow trace includes ACTION_EXECUTED and autonomous phases', () => {
    const room = roomMulti('S17-I')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
    })
    const phases = (room.responseOrchestration.workflowTrace || [])
      .filter((t) => t.kind === 'agent_loop')
      .map((t) => t.phase)
    assert.ok(phases.includes('HUMAN_APPROVED'))
    assert.ok(phases.includes('ACTION_EXECUTED') || phases.includes('RESPONSE_COMPLETED'))
    assert.ok(phases.includes('EPISODE_RECOVERED'))
  })
})
