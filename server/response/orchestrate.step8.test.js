import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
  publicOrchestrationState,
  replanOrchestrationPlan,
  startNewOrchestrationCycle,
  verifyOrchestrationPlan,
} from './orchestrate.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import {
  ORCHESTRATION_STATUS,
  canTransitionOrchestration,
} from '../../shared/response/orchestration.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { setNodeQuarantined } from './quarantineNode.js'
import {
  bindPostExecutionDetection,
  runRecoveryAgent,
  VERIFICATION_VERDICT,
} from './recoveryAgent.js'

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

function roomWithIncident(id = 'STEP8') {
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
    liveCorrelation: { groups: [] },
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

function toRecovered(room) {
  generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
  approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
  executeOrchestrationPlan(room, { resolveContext })
  room.detection.anomalyNodeIds = []
  room.detection.isolationScoresByNodeId = { pay: 0.3, gw: 0.1 }
  const verified = verifyOrchestrationPlan(room)
  assert.equal(verified.verdict, VERIFICATION_VERDICT.RECOVERED)
}

describe('STEP 8 FSM / lineage / new-cycle / residual', () => {
  it('FSM allows replan ANALYZING → AWAITING_APPROVAL and rejects illegal jumps', () => {
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.REPLAN_REQUIRED,
        ORCHESTRATION_STATUS.ANALYZING
      ),
      true
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.ANALYZING,
        ORCHESTRATION_STATUS.AWAITING_APPROVAL
      ),
      true
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.IDLE,
        ORCHESTRATION_STATUS.APPROVED
      ),
      false
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.RECOVERED,
        ORCHESTRATION_STATUS.EXECUTING
      ),
      false
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.RECOVERED,
        ORCHESTRATION_STATUS.IDLE
      ),
      true
    )
  })

  it('fresh analyze clears lineage; execution-failure replan preserves it', () => {
    const room = roomWithIncident('LINEAGE')
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const originalIncidents = room.detection.incidents
    room.detection.incidents = []
    const failed = executeOrchestrationPlan(room, { resolveContext })
    room.detection.incidents = originalIncidents
    assert.equal(failed.ok, false)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    const prevId = room.responseOrchestration.plan.planId
    room.detection.anomalyNodeIds = ['pay']
    room.hackSimulator.nodeOverrides.pay = { packetsPerSecond: 900 }
    replanOrchestrationPlan(room, { resolveContext, nowMs: 5000 })
    assert.equal(room.responseOrchestration.previousPlanId, prevId)
    assert.equal(room.responseOrchestration.replanCount, 1)
    assert.ok(room.responseOrchestration.planHistory.length >= 1)
    assert.ok(room.responseOrchestration.plan.previousPlanId)

    // Fresh analyze from awaiting clears lineage
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-pay',
      resolveContext,
      nowMs: 6000,
    })
    assert.equal(room.responseOrchestration.previousPlanId, null)
    assert.equal(room.responseOrchestration.replanCount, 0)
    assert.deepEqual(room.responseOrchestration.planHistory, [])
    assert.equal(room.responseOrchestration.verification, null)
    assert.equal(room.responseOrchestration.plan?.previousPlanId ?? null, null)
    assert.equal(room.responseOrchestration.plan?.replanContext ?? null, null)
  })

  it('RECOVERED requires new-cycle; old plan cannot execute', () => {
    const room = roomWithIncident('NEWCYC')
    toRecovered(room)
    const gen = generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-pay',
      resolveContext,
    })
    assert.equal(gen.ok, false)
    assert.ok(String(gen.message).includes('new cycle'))

    const exec = executeOrchestrationPlan(room, { resolveContext })
    assert.equal(exec.ok, false)

    const started = startNewOrchestrationCycle(room, { nowMs: 7000 })
    assert.equal(started.ok, true)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.IDLE
    )
    assert.equal(room.responseOrchestration.plan, null)
    assert.equal(room.responseOrchestration.previousPlanId, null)
    assert.equal(room.responseOrchestration.replanCount, 0)
    assert.deepEqual(room.responseOrchestration.planHistory, [])
    assert.equal(room.responseOrchestration.verification, null)
    assert.equal(room.responseOrchestration.approvedAtMs, null)

    const again = generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-pay',
      resolveContext,
    })
    assert.equal(again.ok, true)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
  })

  it('new-cycle rejected unless RECOVERED', () => {
    const room = roomWithIncident('NOCYC')
    const result = startNewOrchestrationCycle(room)
    assert.equal(result.ok, false)
    assert.ok(publicOrchestrationState(room))
  })

  it('residual worsening prevents RECOVERED verdict', () => {
    const room = roomWithIncident('RESID')
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    executeOrchestrationPlan(room, { resolveContext })
    // Keep containment; worsen residual on target vs baseline
    room.detection.anomalyNodeIds = []
    room.detection.isolationScoresByNodeId = { pay: 0.99, gw: 0.1 }
    const baseline = room.responseOrchestration.verificationBaseline
    baseline.residualByTarget = { pay: 0.4 }
    const result = runRecoveryAgent({
      room,
      plan: room.responseOrchestration.plan,
      execution: room.responseOrchestration.execution,
      baseline,
    })
    assert.equal(result.verdict, VERIFICATION_VERDICT.REPLAN_REQUIRED)
    assert.equal(result.checks.residualNotWorsening, false)
    assert.ok(
      result.reasons.some((r) => /Residual worsened|residual/i.test(r))
    )
  })
})
