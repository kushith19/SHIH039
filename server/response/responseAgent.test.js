import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEmptyRoom, publicRoomState } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
  publicOrchestrationState,
  resetRoomOrchestration,
} from './orchestrate.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import {
  ORCHESTRATION_STATUS,
  PLAN_APPROVAL_STATUS,
} from '../../shared/response/orchestration.js'
import { executeResponseAction } from './executeAction.js'
import { runtimeStateOf } from '../infrastructureNode.js'

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
    peerExposedNodeIds: extra.peerExposedNodeIds ?? [],
    propagatedNodeIds: extra.propagatedNodeIds ?? [],
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
    propagatedNodeIds: live.propagatedNodeIds ?? [],
    actionsAlreadyTaken: live.actionsTaken ?? [],
    isExposureIncident: live.isExposureIncident === true,
  }
  return attachAvailableResponseActions(
    attachResponseClassification(base, room.nodes)
  )
}

function roomWithIncident(id = 'ORCH-EXEC') {
  const room = createEmptyRoom(id)
  room.nodes = [node('pay', 'critical'), node('gw', 'medium')]
  room.edges = [{ id: 'e1', source: 'pay', target: 'gw' }]
  const incidents = [
    seedIncident('inc-pay', 'pay', {
      peerExposedNodeIds: ['gw'],
    }),
  ]
  room.detection = {
    incidents,
    anomalyNodeIds: ['pay'],
    atRiskNodeIds: ['gw'],
    propagatedNodeIds: [],
    peerExposedNodeIds: ['gw'],
    liveCorrelation: { groups: [] },
  }
  attachRecoveryImpact(room.detection, {
    nodes: room.nodes,
    edges: room.edges,
    overrides: {},
  })
  room.hackSimulator = {
    active: true,
    nodeOverrides: {
      pay: { packetsPerSecond: 900 },
    },
    edgeOverrides: {},
  }
  return room
}

function analyzeAndApprove(room) {
  generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
  const approved = approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
  assert.equal(approved.ok, true)
  assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.APPROVED)
}

describe('server orchestration STEP 3 execute', () => {
  it('A: execution rejected without APPROVED state', () => {
    const room = roomWithIncident('NO-APPROVE')
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    const result = executeOrchestrationPlan(room, { resolveContext })
    assert.equal(result.ok, false)
    assert.ok(String(result.message).includes('APPROVED'))
  })

  it('B/C/H: APPROVED plan starts execution via server plan + executeResponseAction', () => {
    const room = roomWithIncident('EXEC-OK')
    analyzeAndApprove(room)
    const beforePlanId = room.responseOrchestration.plan.planId
    const result = executeOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      clientPlan: { recommendedActions: [{ actionId: 'disable-api-key' }] },
      clientActionIds: ['disable-api-key'],
    })
    assert.equal(result.ok, true)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.CONTINUING)
    assert.equal(room.responseOrchestration.plan.planId, beforePlanId)
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined,
      true
    )
    assert.equal(result.recovered, false)
    assert.equal(result.incidentsClosed, false)
    assert.equal(result.autoRestored, false)
    const pay = room.detection.incidents.find((i) => i.id === 'inc-pay')
    assert.equal(String(pay.status).toLowerCase(), 'open')
  })

  it('D/E/F: client cannot inject action IDs, targets, or extra actions', () => {
    const room = roomWithIncident('NO-INJECT')
    analyzeAndApprove(room)
    const actionsBefore = room.responseOrchestration.plan.recommendedActions.map(
      (a) => a.actionId
    )
    executeOrchestrationPlan(room, {
      resolveContext,
      clientActionIds: ['rate-limit-endpoint', 'disable-api-key'],
      clientPlan: {
        recommendedActions: [
          {
            actionId: 'isolate-node',
            target: { id: 'gw' },
            executable: true,
          },
        ],
      },
    })
    const results = room.responseOrchestration.execution.results
    assert.ok(results.every((r) => actionsBefore.includes(r.actionId)))
    assert.ok(!results.some((r) => r.actionId === 'disable-api-key'))
    assert.ok(
      results.some(
        (r) => r.actionId === 'isolate-node' && r.target?.id === 'pay'
      )
    )
  })

  it('J/K/L: sequential progress persisted; successful action recorded', () => {
    const room = roomWithIncident('PROGRESS')
    analyzeAndApprove(room)
    const snapshots = []
    executeOrchestrationPlan(room, {
      resolveContext,
      onProgress: (orch) => snapshots.push(orch.execution),
    })
    assert.ok(snapshots.length >= 1)
    const final = room.responseOrchestration.execution
    assert.ok(final.totalSteps > 1)
    assert.equal(final.completedSteps, final.totalSteps)
    const isolate = final.results.find((step) => step.actionId === 'isolate-node')
    assert.equal(isolate?.status, 'completed')
    assert.ok(isolate?.result?.status)
  })

  it('M/N: failed action stops remaining and marks REPLAN_REQUIRED', () => {
    const room = roomWithIncident('FAIL-STOP')
    analyzeAndApprove(room)
    // Remove the target from confirmed anomaly seeds so isolate fails policy.
    room.detection.anomalyNodeIds = ['other-node']
    const result = executeOrchestrationPlan(room, { resolveContext })
    assert.equal(result.ok, false)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    const results = room.responseOrchestration.execution.results
    const isolate = results.find((step) => step.actionId === 'isolate-node')
    assert.equal(isolate?.status, 'failed')
  })

  it('O/P/Q/R: success → CONTINUING; no recovery / close / auto-restore', () => {
    const room = roomWithIncident('VERIFY')
    analyzeAndApprove(room)
    const result = executeOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(result.ok, true)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.CONTINUING)
    assert.equal(result.recovered, false)
    assert.equal(result.incidentsClosed, false)
    assert.equal(result.autoRestored, false)
    assert.notEqual(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
    const pay = room.detection.incidents[0]
    assert.equal(String(pay.status).toLowerCase(), 'open')
    // restore-connectivity was not auto-run
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined,
      true
    )
  })

  it('S/T: double execute rejected; concurrent guard', () => {
    const room = roomWithIncident('DOUBLE')
    analyzeAndApprove(room)
    const first = executeOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(first.ok, true)
    const second = executeOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(second.ok, false)
    assert.ok(
      String(second.message).includes('APPROVED') ||
        String(second.message).includes('already')
    )
  })

  it('I: restore-connectivity executes through executeResponseAction after isolate', () => {
    const room = roomWithIncident('RESTORE')
    analyzeAndApprove(room)
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined,
      true
    )

    // Manual restore via authoritative path (Response Console style)
    const ctx = resolveContext(room, room.id, 'inc-pay')
    const restore = executeResponseAction({
      room,
      roomId: room.id,
      incidentId: 'inc-pay',
      actionId: 'restore-connectivity',
      context: ctx,
    })
    assert.equal(restore.ok, true)
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined,
      false
    )
  })

  it('U: existing Response Console path still works independently', () => {
    const room = roomWithIncident('CONSOLE')
    const context = resolveContext(room, room.id, 'inc-pay')
    const result = executeResponseAction({
      room,
      roomId: room.id,
      incidentId: 'inc-pay',
      actionId: 'isolate-node',
      context,
    })
    assert.equal(result.ok, true)
    assert.ok(publicOrchestrationState(room))
    assert.ok(publicRoomState(room).responseOrchestration)
  })

  it('reset clears execution state', () => {
    const room = roomWithIncident('RESET-EXEC')
    analyzeAndApprove(room)
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    resetRoomOrchestration(room)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.IDLE)
    assert.equal(room.responseOrchestration.execution, null)
    assert.equal(room.responseOrchestration.plan, null)
  })
})
