import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
  publicOrchestrationState,
  replanOrchestrationPlan,
  verifyOrchestrationPlan,
} from './orchestrate.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import {
  ORCHESTRATION_STATUS,
  PLAN_APPROVAL_STATUS,
} from '../../shared/response/orchestration.js'
import { getRepositoryAction } from '../../shared/response/responseActionRepository.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { setNodeQuarantined } from './quarantineNode.js'
import { bindPostExecutionDetection } from './recoveryAgent.js'

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

function roomWithIncident(id = 'ORCH-RP') {
  const room = createEmptyRoom(id)
  room.nodes = [node('pay', 'critical'), node('gw', 'medium')]
  room.edges = [{ id: 'e1', source: 'pay', target: 'gw' }]
  room.detection = {
    incidents: [
      seedIncident('inc-pay', 'pay', {
        peerExposedNodeIds: ['gw'],
        recoveryPriority: 12,
      }),
    ],
    anomalyNodeIds: ['pay'],
    atRiskNodeIds: ['gw'],
    peerExposedNodeIds: ['gw'],
    propagatedNodeIds: [],
    isolationScoresByNodeId: { pay: 0.9, gw: 0.2 },
  }
  attachRecoveryImpact(room.detection, {
    nodes: room.nodes,
    edges: room.edges,
    overrides: {},
  })
  room.hackSimulator = {
    active: true,
    nodeOverrides: { pay: { packetsPerSecond: 900 } },
    edgeOverrides: {},
  }
  return room
}

function forceReplanRequired(room, { keepPayQuarantined = true } = {}) {
  generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
  approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
  const originalIncidents = room.detection.incidents
  room.detection.incidents = []
  const exec = executeOrchestrationPlan(room, { resolveContext })
  room.detection.incidents = originalIncidents
  assert.equal(exec.ok, false)
  if (!keepPayQuarantined) setNodeQuarantined(room, 'pay', false)
  assert.equal(
    room.responseOrchestration.status,
    ORCHESTRATION_STATUS.REPLAN_REQUIRED
  )
  return room
}

describe('Commander re-planning STEP 5', () => {
  it('1: REPLAN_REQUIRED can trigger Commander re-analysis', () => {
    const room = forceReplanRequired(roomWithIncident('RP1'))
    // Keep pay anomalous so isolate remains available after replan focus
    room.detection.anomalyNodeIds = ['pay']
    room.hackSimulator.nodeOverrides.pay = { packetsPerSecond: 900 }
    const result = replanOrchestrationPlan(room, { resolveContext, nowMs: 5000 })
    assert.equal(result.ok, true)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
    assert.equal(result.executed, false)
    assert.equal(result.autoApproved, false)
  })

  it('2: re-plan uses fresh incident state', () => {
    const room = forceReplanRequired(roomWithIncident('RP2'))
    // Fresh second open incident with higher priority — replan should prefer it
    room.detection.incidents.push(
      seedIncident('inc-gw', 'gw', {
        recoveryPriority: 99,
        anomalyScore: 0.95,
        peerExposedNodeIds: [],
      })
    )
    room.detection.anomalyNodeIds = ['gw']
    room.hackSimulator.nodeOverrides.gw = { packetsPerSecond: 700 }
    // pay already quarantined from execute — adaptive selection prefers gw
    const result = replanOrchestrationPlan(room, { resolveContext, nowMs: 6000 })
    assert.equal(result.ok, true)
    assert.equal(room.responseOrchestration.plan.primaryIncidentId, 'inc-gw')
    assert.ok(
      room.responseOrchestration.plan.affectedNodeIds.includes('gw')
    )
  })

  it('3/4/5: new planId, previousPlanId preserved, replanCount increments', () => {
    const room = forceReplanRequired(roomWithIncident('RP3'))
    const oldId = room.responseOrchestration.plan.planId
    room.detection.anomalyNodeIds = ['pay']
    room.hackSimulator.nodeOverrides.pay = { packetsPerSecond: 900 }
    const result = replanOrchestrationPlan(room, { resolveContext, nowMs: 7000 })
    assert.equal(result.ok, true)
    const plan = room.responseOrchestration.plan
    assert.notEqual(plan.planId, oldId)
    assert.equal(room.responseOrchestration.previousPlanId, oldId)
    assert.equal(plan.previousPlanId, oldId)
    assert.equal(room.responseOrchestration.replanCount, 1)
    assert.equal(plan.replanCount, 1)
  })

  it('6/7: execution failure is context; previous plan not authoritative', () => {
    const room = forceReplanRequired(roomWithIncident('RP4'))
    assert.equal(room.responseOrchestration.verification, null)
    room.detection.anomalyNodeIds = ['pay']
    room.hackSimulator.nodeOverrides.pay = { packetsPerSecond: 900 }
    replanOrchestrationPlan(room, { resolveContext, nowMs: 8000 })
    const plan = room.responseOrchestration.plan
    assert.ok(plan.replanContext)
    assert.ok(
      String(plan.reasoning || '').includes('Previous response') ||
        String(plan.reasoning || '').includes('did not sufficiently')
    )
    // New plan has pending approval — not carrying previous APPROVED as authority
    assert.equal(plan.approvalStatus, PLAN_APPROVAL_STATUS.PENDING)
  })

  it('8: policy-approved actions determine executable steps', () => {
    const room = forceReplanRequired(roomWithIncident('RP5'))
    room.detection.anomalyNodeIds = ['pay']
    room.hackSimulator.nodeOverrides.pay = { packetsPerSecond: 900 }
    replanOrchestrationPlan(room, { resolveContext })
    const actions = room.responseOrchestration.plan.recommendedActions
    for (const a of actions) {
      assert.equal(getRepositoryAction(a.actionId)?.supported, true)
      assert.equal(a.executable, true)
    }
    assert.ok(!actions.some((a) => a.actionId === 'disable-camera'))
  })

  it('9/10: client cannot inject actionIds or targets', () => {
    const room = forceReplanRequired(roomWithIncident('RP6'))
    room.detection.anomalyNodeIds = ['pay']
    room.hackSimulator.nodeOverrides.pay = { packetsPerSecond: 900 }
    replanOrchestrationPlan(room, {
      resolveContext,
      clientActionIds: ['disable-api-key', 'rate-limit-endpoint'],
      clientTargets: ['bank-core', 'evil-node'],
      clientPlan: {
        planId: 'injected',
        recommendedActions: [{ actionId: 'disable-api-key', executable: true }],
      },
    })
    const plan = room.responseOrchestration.plan
    assert.notEqual(plan.planId, 'injected')
    assert.ok(!plan.recommendedActions.some((a) => a.actionId === 'disable-api-key'))
    assert.ok(!plan.affectedNodeIds.includes('evil-node'))
  })

  it('11/12/13: re-plan does not execute, quarantine, or mutate overrides', () => {
    const room = forceReplanRequired(roomWithIncident('RP7'))
    const qBefore = runtimeStateOf(
      room.nodes.find((n) => n.id === 'pay').data
    ).quarantined
    const overridesBefore = JSON.stringify(room.hackSimulator.nodeOverrides)
    room.detection.anomalyNodeIds = ['pay']
    room.hackSimulator.nodeOverrides.pay = { packetsPerSecond: 900 }
    const result = replanOrchestrationPlan(room, { resolveContext })
    assert.equal(result.ok, true)
    assert.equal(result.executed, false)
    assert.equal(result.mutatedQuarantine, false)
    assert.equal(result.mutatedOverrides, false)
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined,
      qBefore
    )
    assert.equal(
      JSON.stringify(room.hackSimulator.nodeOverrides),
      JSON.stringify({ ...JSON.parse(overridesBefore), pay: { packetsPerSecond: 900 } })
    )
  })

  it('14/15: human approval still required; approval → APPROVED only', () => {
    const room = forceReplanRequired(roomWithIncident('RP8'))
    room.detection.anomalyNodeIds = ['pay']
    room.hackSimulator.nodeOverrides.pay = { packetsPerSecond: 900 }
    replanOrchestrationPlan(room, { resolveContext })
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.APPROVED
    )
    const approved = approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    assert.equal(approved.ok, true)
    assert.equal(approved.executed, false)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.APPROVED
    )
  })

  it('16: re-plan respects stale-plan detection on approval', () => {
    const room = forceReplanRequired(roomWithIncident('RP9'))
    room.detection.anomalyNodeIds = ['pay']
    room.hackSimulator.nodeOverrides.pay = { packetsPerSecond: 900 }
    replanOrchestrationPlan(room, { resolveContext })
    // Environment change after replan
    room.detection.incidents = []
    room.detection.anomalyNodeIds = []
    const result = approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    assert.equal(result.ok, false)
    assert.equal(room.responseOrchestration.stale, true)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
  })

  it('17: re-plan can produce a different response from previous plan', () => {
    const room = forceReplanRequired(roomWithIncident('RP10'))
    const prevTargets = [
      ...(room.responseOrchestration.plan.affectedNodeIds || []),
    ]
    room.detection.incidents.push(
      seedIncident('inc-gw', 'gw', {
        recoveryPriority: 50,
        anomalyScore: 0.92,
      })
    )
    room.detection.anomalyNodeIds = ['gw']
    room.hackSimulator.nodeOverrides.gw = { packetsPerSecond: 650 }
    replanOrchestrationPlan(room, { resolveContext })
    const newTargets = room.responseOrchestration.plan.affectedNodeIds || []
    assert.ok(newTargets.includes('gw'))
    assert.ok(!prevTargets.includes('gw') || newTargets[0] !== prevTargets[0])
    assert.equal(room.responseOrchestration.plan.primaryIncidentId, 'inc-gw')
  })

  it('18: no valid action → remains REPLAN_REQUIRED', () => {
    const room = forceReplanRequired(roomWithIncident('RP11'))
    // Clear anomalies / make exposure-only style: close seed anomaly path
    room.detection.incidents = room.detection.incidents.map((inc) => ({
      ...inc,
      isExposureIncident: true,
      severity: 'low',
      anomalyScore: 0.1,
    }))
    room.detection.anomalyNodeIds = []
    // Quarantine everything so isolate is unavailable
    setNodeQuarantined(room, 'pay', true)
    setNodeQuarantined(room, 'gw', true)
    const result = replanOrchestrationPlan(room, { resolveContext })
    assert.equal(result.ok, false)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    const msg = `${result.message || ''} ${room.responseOrchestration.lastReplanReason || ''}`
    assert.ok(
      /No policy-approved|No open|context|No suitable primary|No remaining|exposure|executable/i.test(
        msg
      ),
      `unexpected replan message: ${msg}`
    )
  })

  it('19: multiple re-plan cycles preserve previous plan identity', () => {
    const room = forceReplanRequired(roomWithIncident('RP12'))
    room.detection.anomalyNodeIds = ['pay']
    room.hackSimulator.nodeOverrides.pay = { packetsPerSecond: 900 }
    const firstId = room.responseOrchestration.plan.planId
    replanOrchestrationPlan(room, { resolveContext, nowMs: 9000 })
    const secondId = room.responseOrchestration.plan.planId
    assert.equal(room.responseOrchestration.previousPlanId, firstId)
    assert.equal(room.responseOrchestration.replanCount, 1)
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const originalIncidents = room.detection.incidents
    room.detection.incidents = []
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    room.detection.incidents = originalIncidents
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    room.detection.anomalyNodeIds = ['pay']
    room.hackSimulator.nodeOverrides.pay = { packetsPerSecond: 900 }
    replanOrchestrationPlan(room, { resolveContext, nowMs: 10000 })
    assert.equal(room.responseOrchestration.previousPlanId, secondId)
    assert.equal(room.responseOrchestration.replanCount, 2)
    assert.notEqual(room.responseOrchestration.plan.planId, secondId)
    assert.ok(room.responseOrchestration.planHistory.length >= 2)
  })

  it('rejects replan unless REPLAN_REQUIRED', () => {
    const room = roomWithIncident('RP-IDLE')
    const result = replanOrchestrationPlan(room, { resolveContext })
    assert.equal(result.ok, false)
    assert.ok(String(result.message).includes('REPLAN_REQUIRED'))
  })

  it('analyze is blocked while REPLAN_REQUIRED (use replan)', () => {
    const room = forceReplanRequired(roomWithIncident('RP-AN'))
    const result = generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-pay',
      resolveContext,
    })
    assert.equal(result.ok, false)
    assert.ok(String(result.message).includes('replan'))
  })

  it('no open incidents → remain REPLAN_REQUIRED with evidence preserved', () => {
    const room = forceReplanRequired(roomWithIncident('RP-NONE'))
    const verification = room.responseOrchestration.verification
    room.detection.incidents = []
    const result = replanOrchestrationPlan(room, { resolveContext })
    assert.equal(result.ok, false)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    assert.equal(
      room.responseOrchestration.verification?.verdict,
      verification?.verdict
    )
    assert.ok(publicOrchestrationState(room).previousPlanId)
  })
})
