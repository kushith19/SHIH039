import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
  publicOrchestrationState,
  refreshOrchestrationFreshness,
  setReplanRequired,
  verifyOrchestrationPlan,
} from './orchestrate.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import { ORCHESTRATION_STATUS } from '../../shared/response/orchestration.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { setNodeQuarantined } from './quarantineNode.js'
import { bindPostExecutionDetection, verifyResponseStep } from './recoveryAgent.js'
import {
  isApprovedScopeContinuation,
  isGenuineReplanState,
  verificationView,
} from '../../src/features/response/orchestrationView.js'

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
    propagatedNodeIds: live.propagatedNodeIds ?? [],
    actionsAlreadyTaken: live.actionsTaken ?? [],
    isExposureIncident: live.isExposureIncident === true,
  }
  return attachAvailableResponseActions(
    attachResponseClassification(base, room.nodes)
  )
}

function roomFive(id = 'S15') {
  const room = createEmptyRoom(id)
  const ids = ['n1', 'n2', 'n3', 'n4', 'n5']
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
    liveCorrelation: { groups: [] },
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

describe('STEP 15 — Verification not Recovery decision-maker', () => {
  it('A: 5 incidents, one approval → never REPLAN_REQUIRED → RECOVERED', () => {
    const room = roomFive('S15-A')
    const statuses = []
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
      onProgress: (s) => statuses.push(s.workflowStatus || s.status),
    })
    assert.equal(approved.ok, true)
    assert.equal(approved.episodeComplete, true)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
    assert.equal(room.responseOrchestration.replanCount, 0)
    assert.equal(
      statuses.includes(ORCHESTRATION_STATUS.REPLAN_REQUIRED),
      false,
      JSON.stringify(statuses)
    )
    const replanWrites = (room.responseOrchestration.workflowTrace || []).filter(
      (t) => t.kind === 'replan_required'
    )
    assert.equal(replanWrites.length, 0)
  })

  it('B: verified step with remaining incidents is continuation, not replan', () => {
    const room = roomFive('S15-B')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const mid = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(mid.verified, true)
    assert.equal(mid.stepVerified, true)
    assert.equal(mid.observational, true)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    assert.equal(room.responseOrchestration.continuationReason, 'execution_complete')
    assert.equal(isApprovedScopeContinuation(room.responseOrchestration), true)
    assert.equal(isGenuineReplanState(room.responseOrchestration), false)
    const view = verificationView(room.responseOrchestration)
    assert.equal(view.stepFailed, false)
    assert.match(String(view.title), /verified/i)
    assert.doesNotMatch(String(view.title), /failed/i)
  })

  it('C: catalog-only actions have zero influence on verification', () => {
    const room = roomFive('S15-C')
    room.nodes = [node('n1'), node('gw')]
    room.detection.incidents = [seedIncident('inc-1', 'n1', { recoveryPriority: 40 })]
    room.detection.anomalyNodeIds = ['n1']
    attachRecoveryImpact(room.detection, {
      nodes: room.nodes,
      edges: room.edges,
      overrides: {},
    })
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    room.responseOrchestration.plan.recommendedActions.push({
      actionId: 'rate-limit-endpoint',
      executable: false,
      availability: 'catalog',
      target: { id: 'n1' },
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const step = verifyResponseStep({
      room,
      plan: room.responseOrchestration.plan,
      execution: room.responseOrchestration.execution,
      baseline: room.responseOrchestration.verificationBaseline,
      approvalScope: room.responseOrchestration.approvalScope,
      detectionSnapshot: room.responseOrchestration.postExecutionDetection,
    })
    assert.equal(step.verified, true)
    assert.ok(step.verification?.catalogActionIds?.includes('rate-limit-endpoint'))
    assert.equal(
      step.checkDetails?.catalogActionsDoNotAffectVerdict,
      true
    )
  })

  it('D: lost quarantine → observational verify failure without REPLAN_REQUIRED', () => {
    const room = roomFive('S15-D')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    setNodeQuarantined(room, 'n1', false)
    bindPostExecutionDetection(room)
    const result = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: true,
      stepDelayMs: 0,
    })
    assert.equal(result.verified, false)
    assert.equal(result.stepVerified, false)
    assert.equal(result.observational, true)
    assert.notEqual(room.responseOrchestration.status, ORCHESTRATION_STATUS.REPLAN_REQUIRED)
    const replanWrites = (room.responseOrchestration.workflowTrace || []).filter(
      (t) => t.kind === 'replan_required'
    )
    assert.equal(replanWrites.length, 0)
    assert.equal(
      result.verification?.checks?.containmentHeld,
      false
    )
  })

  it('E: new out-of-scope incident is observed without REPLAN', () => {
    const room = roomFive('S15-E')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    room.detection = {
      ...room.detection,
      anomalyNodeIds: [...(room.detection.anomalyNodeIds || []), 'extra'],
      incidents: [
        ...(room.detection.incidents || []),
        seedIncident('inc-extra', 'extra', { recoveryPriority: 1 }),
      ],
    }
    // Freeze includes the new anomaly — genuine out-of-scope fail
    bindPostExecutionDetection(room)
    const result = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(result.verified, false)
    assert.equal(result.workflowUnchangedByVerdict, true)
    assert.notEqual(room.responseOrchestration.status, ORCHESTRATION_STATUS.REPLAN_REQUIRED)
    assert.equal(
      room.responseOrchestration.verification?.checks?.noNewOutOfScopeAnomalies,
      false
    )
  })

  it('F: telemetry freshness after VERIFIED must not overwrite continuation', () => {
    const room = roomFive('S15-F')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    verifyOrchestrationPlan(room, { resolveContext, autoContinue: false })
    assert.equal(room.responseOrchestration.continuationReason, 'execution_complete')
    const before = room.responseOrchestration.status

    // Simulate live detection rewrite + freshness tick
    room.detection = {
      ...room.detection,
      anomalyNodeIds: ['n1', 'n2', 'n3', 'n4', 'n5', 'extra'],
    }
    refreshOrchestrationFreshness(room, resolveContext)
    assert.equal(room.responseOrchestration.status, before)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )

    // Even if forced into AWAITING with approvalScope, freshness must not REPLAN
    room.responseOrchestration.workflowStatus = ORCHESTRATION_STATUS.AWAITING_APPROVAL
    room.responseOrchestration.status = ORCHESTRATION_STATUS.AWAITING_APPROVAL
    assert.ok(room.responseOrchestration.approvalScope)
    refreshOrchestrationFreshness(room, resolveContext)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
  })

  it('G: verification writes no REPLAN; explicit execution-path helper records reason', () => {
    const room = roomFive('S15-G')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    setNodeQuarantined(room, 'n1', false)
    bindPostExecutionDetection(room)
    verifyOrchestrationPlan(room, { resolveContext, autoContinue: false })

    const writes = (room.responseOrchestration.workflowTrace || []).filter(
      (t) => t.kind === 'replan_required'
    )
    assert.equal(writes.length, 0)

    // Direct helper also logs
    room.responseOrchestration.workflowStatus = ORCHESTRATION_STATUS.APPROVED
    room.responseOrchestration.status = ORCHESTRATION_STATUS.APPROVED
    setReplanRequired(room, {
      reason: 'manual test reason',
      source: 'test:setReplanRequired',
    })
    const last = (room.responseOrchestration.workflowTrace || [])
      .filter((t) => t.kind === 'replan_required')
      .at(-1)
    assert.equal(last.source, 'test:setReplanRequired')
    assert.equal(last.reason, 'manual test reason')
    assert.ok(publicOrchestrationState(room).workflowTrace)
  })
})
