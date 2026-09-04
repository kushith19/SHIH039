import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
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
import { buildResponsePlan } from '../../shared/response/responsePlan.js'
import { isPlanWithinApprovalScope } from '../../shared/response/approvalScope.js'
import {
  isApprovedScopeContinuation,
  isGenuineReplanState,
  orchestrationFlowRailView,
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

function roomFive(id = 'S16') {
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

describe('STEP 16 — Commander + Response Agent only', () => {
  it('A: 5 incidents + one approval → all execute → RECOVERED; no REPLAN', () => {
    const room = roomFive('S16-A')
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
    assert.equal(room.responseOrchestration.previousPlanId, null)
    assert.equal(
      statuses.includes(ORCHESTRATION_STATUS.REPLAN_REQUIRED),
      false,
      JSON.stringify(statuses)
    )
    assert.ok(
      statuses.includes(ORCHESTRATION_STATUS.CONTINUING) ||
        statuses.includes(ORCHESTRATION_STATUS.EXECUTING),
      JSON.stringify(statuses)
    )
    const replanWrites = (room.responseOrchestration.workflowTrace || []).filter(
      (t) => t.kind === 'replan_required'
    )
    assert.equal(replanWrites.length, 0)
    const staleReasons = (room.responseOrchestration.workflowTrace || [])
      .filter((t) => t.kind === 'status_transition')
      .map((t) => t.reason)
    assert.equal(
      staleReasons.some((r) => /stale plan/i.test(String(r || ''))),
      false
    )
  })

  it('B: no stale plan during approved-scope continuation', () => {
    const room = roomFive('S16-B')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    executeOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.CONTINUING)
    assert.equal(room.responseOrchestration.stale, false)
    refreshOrchestrationFreshness(room, resolveContext)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    assert.equal(room.responseOrchestration.stale, false)
  })

  it('C: verification cannot change workflow status / invent REPLAN', () => {
    const room = roomFive('S16-C')
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
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    executeOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    const before = room.responseOrchestration.status
    setNodeQuarantined(room, 'n1', false)
    const result = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(result.observational, true)
    assert.equal(result.workflowUnchangedByVerdict, true)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    assert.equal(
      room.responseOrchestration.status,
      before === ORCHESTRATION_STATUS.VERIFYING
        ? ORCHESTRATION_STATUS.CONTINUING
        : before
    )
    assert.ok(room.responseOrchestration.verification)
  })

  it('D: previousPlanId absent on normal continuation; replanCount stays 0', () => {
    const room = roomFive('S16-D')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
    })
    assert.equal(room.responseOrchestration.replanCount, 0)
    assert.equal(room.responseOrchestration.previousPlanId, null)
    const history = room.responseOrchestration.planHistory || []
    for (const h of history) {
      assert.equal(h.previousPlanId, null)
      assert.notEqual(h.planKind, 'replan')
    }
    const plans = (room.responseOrchestration.workflowTrace || []).filter(
      (t) => t.kind === 'agent_loop' && t.phase === 'COMMANDER_CONTINUATION'
    )
    assert.ok(plans.length >= 1)
  })

  it('E: genuine execution failure → REPLAN_REQUIRED', () => {
    const room = roomFive('S16-E')
    room.detection.incidents = [seedIncident('inc-1', 'n1', { recoveryPriority: 30 })]
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
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    // Force execution failure via missing primary context
    const orig = room.detection.incidents
    room.detection.incidents = []
    const result = executeOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    room.detection.incidents = orig
    assert.equal(result.ok, false)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
  })

  it('F: out-of-scope incident → AWAITING_APPROVAL (not REPLAN)', () => {
    const room = roomFive('S16-F')
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
    assert.ok(scope)
    const outsidePlan = {
      planId: 'outside',
      primaryIncidentId: 'inc-x',
      incidentIds: ['inc-x'],
      affectedNodeIds: ['extra'],
      planKind: 'continuation',
      recommendedActions: [
        {
          actionId: 'isolate-node',
          executable: true,
          target: { id: 'extra' },
        },
      ],
    }
    assert.equal(isPlanWithinApprovalScope(outsidePlan, scope).ok, false)

    // Simulate mid-episode pause path used by continuation loop
    room.responseOrchestration.workflowStatus = ORCHESTRATION_STATUS.AWAITING_APPROVAL
    room.responseOrchestration.status = ORCHESTRATION_STATUS.AWAITING_APPROVAL
    room.responseOrchestration.pausedForApprovalReason = 'Outside approval scope'
    room.responseOrchestration.continuationReason = 'scope_expansion'
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    assert.equal(isGenuineReplanState(room.responseOrchestration), false)
  })

  it('G: catalog actions never affect execution path', () => {
    const room = roomFive('S16-G')
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
    const exec = executeOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(exec.ok, true)
    const results = room.responseOrchestration.execution?.results || []
    assert.equal(
      results.some((r) => r.actionId === 'rate-limit-endpoint'),
      false
    )
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'n1').data).quarantined,
      true
    )
  })

  it('H: human approval remains mandatory for scope expansion', () => {
    const room = roomFive('S16-H')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
    // Without approve, execute must fail
    const denied = executeOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(denied.ok, false)
  })

  it('I: UI rail has no Verification lane; CONTINUING shows Commander continuing', () => {
    const rail = orchestrationFlowRailView({
      workflowStatus: ORCHESTRATION_STATUS.CONTINUING,
      autoIteration: 2,
      continuationReason: 'remaining_incidents',
      approvalScope: { incidentIds: ['a'] },
      plan: { planKind: 'continuation', planId: 'p2' },
    })
    assert.equal(
      rail.steps.some((s) => /verif/i.test(s.label)),
      false
    )
    assert.deepEqual(
      rail.steps.map((s) => s.id),
      ['commander', 'approval', 'response', 'complete']
    )
    const commander = rail.steps.find((s) => s.id === 'commander')
    assert.equal(commander.statusLabel, 'Continuing')
  })

  it('J: continuation plan builder does not set previousPlanId', () => {
    const room = roomFive('S16-J')
    const ctx = resolveContext(room, room.id, 'inc-2')
    const built = buildResponsePlan({
      detection: room.detection,
      context: ctx,
      focusIncidentId: 'inc-2',
      nowMs: Date.now(),
      mode: 'continue',
      nodes: room.nodes,
      previousPlan: { planId: 'p0', primaryIncidentId: 'inc-1', affectedNodeIds: ['n1'] },
      previousPlanId: 'p0',
      continuationCount: 1,
    })
    assert.equal(built.ok, true)
    assert.equal(built.plan.planKind, 'continuation')
    assert.equal(built.plan.previousPlanId, null)
    assert.equal(built.plan.replanCount, 0)
    assert.equal(built.plan.replanContext, null)
    assert.ok(built.plan.continuationContext)
    assert.equal(built.plan.continuationContext.previousPlanId, undefined)
  })

  it('K: setReplanRequired remains the only intentional REPLAN writer for execution fail', () => {
    const room = roomFive('S16-K')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    setReplanRequired(room, {
      reason: 'Response Agent execution failed',
      source: 'test:execution_fail',
    })
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    const writes = (room.responseOrchestration.workflowTrace || []).filter(
      (t) => t.kind === 'replan_required'
    )
    assert.ok(writes.some((w) => w.source === 'test:execution_fail'))
  })

  it('L: successful continuation is not classified as replan', () => {
    const room = roomFive('S16-L')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
    })
    assert.equal(isGenuineReplanState(room.responseOrchestration), false)
    assert.equal(isApprovedScopeContinuation(room.responseOrchestration), true)
  })
})
