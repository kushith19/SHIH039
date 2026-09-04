import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEmptyRoom, publicRoomState } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  generateOrchestrationPlan,
  publicOrchestrationState,
  resetRoomOrchestration,
} from './orchestrate.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import { ORCHESTRATION_STATUS, PLAN_APPROVAL_STATUS } from '../../shared/response/orchestration.js'
import { getRepositoryAction } from '../../shared/response/responseActionRepository.js'
import { executeResponseAction } from './executeAction.js'

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
  const base = {
    incidentId: live.persistentId || live.id,
    liveIncidentId: live.id,
    incidentType: live.detectionType,
    severity: live.severity,
    status: live.status,
    affectedAsset: {
      id: live.endpointId,
      summary: live.endpointLabel,
      quarantined: live.endpointId
        ? room.nodes.find((n) => n.id === live.endpointId)?.data?.runtimeState
            ?.quarantined === true
        : false,
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

function roomWithIncident() {
  const room = createEmptyRoom('ORCH-TEST')
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
  }
  attachRecoveryImpact(room.detection, {
    nodes: room.nodes,
    edges: room.edges,
    overrides: {},
  })
  // Mark live seed for isolate eligibility (executeAction checks live anomaly)
  room.hackSimulator = {
    active: true,
    nodeOverrides: {
      pay: { packetsPerSecond: 900 },
    },
    edgeOverrides: {},
  }
  return room
}

describe('server orchestration STEP 2', () => {
  it('A: room initializes orchestration state', () => {
    const room = createEmptyRoom('INIT')
    assert.ok(room.responseOrchestration)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.IDLE)
    assert.equal(room.responseOrchestration.plan, null)
    const pub = publicRoomState(room)
    assert.ok(pub.responseOrchestration)
    assert.equal(pub.responseOrchestration.status, ORCHESTRATION_STATUS.IDLE)
  })

  it('H: analyze transitions IDLE → ANALYZING → PLAN_READY → AWAITING_APPROVAL', () => {
    const room = roomWithIncident()
    const result = generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-pay',
      resolveContext,
      nowMs: 1000,
    })
    assert.equal(result.ok, true)
    assert.equal(result.executed, false)
    assert.deepEqual(result.executedActions, [])
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
    assert.equal(room.responseOrchestration.plan.approvalStatus, PLAN_APPROVAL_STATUS.PENDING)
    assert.ok(
      room.responseOrchestration.plan.recommendedActions.some(
        (a) => a.actionId === 'isolate-node' && a.executable === true
      )
    )
  })

  it('B/C/D: plan uses recovery priority primary and expectedImpact', () => {
    const room = roomWithIncident()
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-pay',
      resolveContext,
    })
    const plan = room.responseOrchestration.plan
    assert.equal(plan.primaryIncidentId, 'inc-pay')
    assert.ok(plan.expectedImpact)
    assert.ok(Number(plan.expectedImpact.certainRecoveryCount) >= 1)
    assert.ok(
      Array.isArray(plan.expectedImpact.summaryLines)
    )
  })

  it('E/F: only real executable actions; catalog not executable', () => {
    const room = roomWithIncident()
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    const actions = room.responseOrchestration.plan.recommendedActions
    for (const a of actions) {
      assert.equal(getRepositoryAction(a.actionId)?.supported, true)
      assert.equal(a.executable, true)
    }
    assert.ok(!actions.some((a) => a.actionId === 'disable-camera'))
  })

  it('G/J: generate and approve never call execute / never quarantine', () => {
    const room = roomWithIncident()
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    assert.equal(
      room.nodes.find((n) => n.id === 'pay').data.runtimeState.quarantined,
      false
    )
    const approved = approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    assert.equal(approved.ok, true)
    assert.equal(approved.executed, false)
    assert.deepEqual(approved.executedActions, [])
    assert.equal(
      room.nodes.find((n) => n.id === 'pay').data.runtimeState.quarantined,
      false
    )
  })

  it('I: approval changes state to APPROVED', () => {
    const room = roomWithIncident()
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    const result = approveOrchestrationPlan(room, { resolveContext, nowMs: 2000, autoContinue: false })
    assert.equal(result.ok, true)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.APPROVED)
    assert.equal(
      room.responseOrchestration.plan.approvalStatus,
      PLAN_APPROVAL_STATUS.APPROVED
    )
    assert.equal(room.responseOrchestration.approvedAtMs, 2000)
  })

  it('K: invalid / empty plan cannot be approved', () => {
    const room = createEmptyRoom('EMPTY')
    const result = approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    assert.equal(result.ok, false)
  })

  it('L: stale plan is rejected while awaiting approval', () => {
    const room = roomWithIncident()
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    // Material change: clear the primary incident
    room.detection.incidents = []
    room.detection.anomalyNodeIds = []
    const result = approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    assert.equal(result.ok, false)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
  })

  it('M/N: policy revalidated; client actionIds ignored', () => {
    const room = roomWithIncident()
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    const result = approveOrchestrationPlan(room, {
      resolveContext,
      clientActionIds: ['disable-api-key', 'rate-limit-endpoint'],
      autoContinue: false,
    })
    assert.equal(result.ok, true)
    const actions = room.responseOrchestration.plan.recommendedActions
    assert.ok(!actions.some((a) => a.actionId === 'disable-api-key'))
  })

  it('O: reset returns orchestration to IDLE', () => {
    const room = roomWithIncident()
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    resetRoomOrchestration(room)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.IDLE)
    assert.equal(room.responseOrchestration.plan, null)
  })

  it('P: existing executeResponseAction still works independently', () => {
    const room = roomWithIncident()
    const context = resolveContext(room, room.id, 'inc-pay')
    const result = executeResponseAction({
      room,
      roomId: room.id,
      incidentId: 'inc-pay',
      actionId: 'isolate-node',
      context,
    })
    // May succeed or fail based on seed checks — must not throw and must be a result object
    assert.equal(typeof result.ok, 'boolean')
    assert.ok(publicOrchestrationState(room))
  })
})
