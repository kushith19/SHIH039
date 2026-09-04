import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
  replanOrchestrationPlan,
  verifyOrchestrationPlan,
} from './orchestrate.js'
import { buildContinuationPlan } from './orchestrationLoop.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import { ORCHESTRATION_STATUS } from '../../shared/response/orchestration.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { bindPostExecutionDetection } from './recoveryAgent.js'
import {
  buildApprovalScope,
  isPlanWithinApprovalScope,
} from '../../shared/response/approvalScope.js'
import {
  activeAgentOwnershipView,
  agentLaneView,
  approvalSpotlightView,
  isApprovedScopeContinuation,
  isGenuineReplanState,
  orchestrationFlowRailView,
  planEvolutionView,
  verificationView,
} from '../../src/features/response/orchestrationView.js'
import { buildResponsePlan } from '../../shared/response/responsePlan.js'

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

function roomFive(id = 'S12') {
  const room = createEmptyRoom(id)
  const ids = ['n1', 'n2', 'n3', 'n4', 'n5']
  room.nodes = ids.map((nid) => node(nid, 'high'))
  room.nodes.push(node('gw', 'medium'))
  room.edges = ids.map((nid, i) => ({
    id: `e${i}`,
    source: nid,
    target: 'gw',
  }))
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

function uiFailureCopyPresent(state) {
  const ownership = activeAgentOwnershipView(state)
  const rail = orchestrationFlowRailView(state)
  const lanes = agentLaneView(state)
  const verify = verificationView(state)
  const evolution = planEvolutionView(state)
  const blob = JSON.stringify({
    ownership,
    rail,
    lanes,
    verify: { title: verify.title, reasons: verify.reasons },
    evolution,
  })
  return (
    /Verification failed/i.test(blob) ||
    /Replan required/i.test(blob) ||
    /Re-planning/i.test(blob) ||
    /Failed recovery/i.test(blob)
  )
}

describe('STEP 12 continuation vs genuine replan', () => {
  it('A: 5 incidents + one approval → VERIFIED continuations → RECOVERED, replanCount=0', () => {
    const room = roomFive('S12-A')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
    })
    assert.equal(approved.ok, true)
    assert.equal(approved.episodeComplete, true)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.RECOVERED
    )
    assert.equal(room.responseOrchestration.replanCount, 0)
    assert.ok(room.responseOrchestration.autoIteration >= 4)
    const history = room.responseOrchestration.planHistory || []
    assert.ok(
      history.some((h) => h.outcome === 'continued' || h.outcome === 'step_verified')
    )
    assert.ok(!history.some((h) => h.outcome === 'verification_failed'))
    for (const nid of ['n1', 'n2', 'n3', 'n4', 'n5']) {
      assert.equal(
        runtimeStateOf(room.nodes.find((n) => n.id === nid).data).quarantined,
        true,
        nid
      )
    }
  })

  it('B: normal continuation never produces REPLAN_REQUIRED', () => {
    const room = roomFive('S12-B')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
    })
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    assert.ok(
      !(approved.continuationLog || []).some(
        (e) =>
          e.event === 'step_verify_failed' ||
          String(e.reason || '').includes('verification_failed_replan')
      )
    )
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.RECOVERED
    )
  })

  it('C: UI does not show Verification failed / Replan required during continuation', () => {
    const continuingState = {
      workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
      autoIteration: 2,
      replanCount: 0,
      continuationReason: 'remaining_incidents',
      previousPlanId: null,
      approvalScope: {
        incidentIds: ['inc-1', 'inc-2', 'inc-3', 'inc-4', 'inc-5'],
      },
      planHistory: [
        {
          planId: 'plan-1',
          outcome: 'continued',
          verificationVerdict: 'VERIFIED',
          planKind: 'fresh',
        },
      ],
      plan: {
        planId: 'plan-2',
        previousPlanId: null,
        planKind: 'continuation',
        replanCount: 0,
        continuationContext: { continuationCount: 2 },
        recommendedActions: [
          { actionId: 'isolate-node', executable: true, target: { id: 'n3' } },
        ],
      },
      verification: {
        verdict: 'VERIFIED',
        primaryReason: 'Containment held on isolate targets.',
        failReasons: [],
        passNotes: ['Containment held on isolate targets.'],
        reasons: ['Containment held on isolate targets.'],
      },
    }
    assert.equal(isApprovedScopeContinuation(continuingState), true)
    assert.equal(isGenuineReplanState(continuingState), false)
    assert.equal(uiFailureCopyPresent(continuingState), false)

    const ownership = activeAgentOwnershipView(continuingState)
    assert.match(ownership.headline, /Planner preparing next response/i)
    assert.doesNotMatch(ownership.headline, /replan|failed/i)

    const rail = orchestrationFlowRailView(continuingState)
    assert.equal(rail.steps[0].statusLabel, 'Continuing')
    assert.equal(rail.steps[3].statusLabel, 'Locked')
    assert.notEqual(rail.steps[2].phase, 'failed')

    const lane = agentLaneView(continuingState).lanes.find((l) => l.id === 'commander')
    assert.equal(lane.slotLabel, 'Continuing')
  })

  it('D: previousPlanId alone does not classify a plan as a replan', () => {
    const state = {
      workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
      replanCount: 0,
      autoIteration: 0,
      previousPlanId: 'old',
      plan: {
        planId: 'new',
        previousPlanId: 'old',
        planKind: 'continuation',
        continuationContext: { previousPlanId: 'old' },
        policyStatus: 'ALLOWED',
        recommendedActions: [{ actionId: 'isolate-node', executable: true }],
      },
    }
    assert.equal(isGenuineReplanState(state), false)
    assert.equal(isApprovedScopeContinuation(state), true)
    const spotlight = approvalSpotlightView(state)
    assert.equal(spotlight.isReplan, false)
    assert.equal(spotlight.buttonLabel, 'Approve Response')

    const built = buildResponsePlan({
      detection: {
        incidents: [seedIncident('inc-a', 'pay', { recoveryPriority: 10 })],
      },
      context: attachAvailableResponseActions(
        attachResponseClassification(
          {
            incidentId: 'inc-a',
            liveIncidentId: 'inc-a',
            incidentType: 'behavioral_anomaly',
            severity: 'high',
            status: 'open',
            affectedAsset: { id: 'pay', summary: 'PAY', quarantined: false },
            riskScore: 0.9,
            trustScore: 35,
            anomalyEvidence: [],
            peerExposure: [],
            propagatedNodeIds: [],
            actionsAlreadyTaken: [],
          },
          [node('pay')]
        )
      ),
      mode: 'continue',
      previousPlan: { planId: 'p0', primaryIncidentId: 'inc-z', affectedNodeIds: ['z'] },
      previousPlanId: 'p0',
      continuationCount: 1,
      nodes: [node('pay')],
    })
    assert.equal(built.ok, true)
    assert.equal(built.plan.planKind, 'continuation')
    assert.equal(built.plan.previousPlanId, null)
    assert.equal(built.plan.replanCount, 0)
    assert.equal(built.plan.replanContext, null)
    assert.ok(built.plan.continuationContext)
  })

  it('E: verification failure remains observational and does not produce REPLAN_REQUIRED', () => {
    const room = roomFive('S12-E')
    room.detection.incidents = [seedIncident('inc-1', 'n1', { recoveryPriority: 30 })]
    room.detection.anomalyNodeIds = ['n1']
    room.hackSimulator.nodeOverrides = { n1: { packetsPerSecond: 900 } }
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
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })

    // Out-of-scope new anomaly → hard fail (authoritative detection update)
    room.detection.incidents.push(
      seedIncident('inc-out', 'n2', { recoveryPriority: 99 })
    )
    room.detection.anomalyNodeIds = ['n1', 'n2']
    room.hackSimulator.nodeOverrides.n2 = { packetsPerSecond: 900 }
    attachRecoveryImpact(room.detection, {
      nodes: room.nodes,
      edges: room.edges,
      overrides: {},
    })
    bindPostExecutionDetection(room)

    const result = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: true,
      stepDelayMs: 0,
    })
    assert.equal(result.stepVerified, false)
    assert.equal(result.observational, true)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    assert.equal(isGenuineReplanState(room.responseOrchestration), false)
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'n2').data).quarantined,
      false
    )

    const ownership = activeAgentOwnershipView(room.responseOrchestration)
    assert.doesNotMatch(ownership.headline, /Verification failed|replan|re-analysis/i)
  })

  it('F: new work outside approvalScope still requires human approval', () => {
    const room = roomFive('S12-F')
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

    // Scope from the approved plan must not silently cover arbitrary new targets
    const rebuilt = buildApprovalScope({
      plan: room.responseOrchestration.plan,
      detection: room.detection,
      approvedAtMs: Date.now(),
    })
    assert.equal(isPlanWithinApprovalScope(outsidePlan, rebuilt).ok, false)
  })

  it('G: episode RECOVERED only when no remaining approved-scope response work', () => {
    const room = roomFive('S12-G')
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
      stepDelayMs: 0,
    })
    assert.equal(mid.stepVerified, true)
    assert.equal(mid.episodeComplete, false)
    assert.equal(mid.remainingWork, true)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.RECOVERED
    )

    const finished = roomFive('S12-G2')
    generateOrchestrationPlan(finished, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    const done = approveOrchestrationPlan(finished, {
      resolveContext,
      stepDelayMs: 0,
    })
    assert.equal(done.episodeComplete, true)
    assert.equal(
      finished.responseOrchestration.status,
      ORCHESTRATION_STATUS.RECOVERED
    )
  })

  it('buildContinuationPlan uses continue mode (not replan) for remaining incidents', () => {
    const room = roomFive('S12-CONT')
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
    verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    const previousPlan = room.responseOrchestration.plan
    const built = buildContinuationPlan(room, {
      resolveContext,
      previousPlan,
      verification: room.responseOrchestration.verification,
      continuationCount: 1,
      planMode: 'continue',
    })
    assert.equal(built.ok, true)
    assert.equal(built.plan.planKind, 'continuation')
    assert.equal(built.plan.replanCount, 0)
    assert.equal(built.plan.replanContext, null)
    assert.equal(built.plan.previousPlanId, null)
    assert.ok(built.plan.continuationContext)
  })

  it('genuine execution failure can replan and increments replanCount', () => {
    const room = roomFive('S12-REPLAN')
    room.detection.incidents = [seedIncident('inc-1', 'n1', { recoveryPriority: 30 })]
    room.detection.anomalyNodeIds = ['n1']
    room.hackSimulator.nodeOverrides = { n1: { packetsPerSecond: 900 } }
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
    const originalIncidents = room.detection.incidents
    room.detection.incidents = []
    const failed = executeOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    room.detection.incidents = originalIncidents
    assert.equal(failed.ok, false)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    const prevId = room.responseOrchestration.plan.planId
    const replanned = replanOrchestrationPlan(room, { resolveContext })
    assert.equal(replanned.ok, true)
    assert.equal(room.responseOrchestration.plan.planKind, 'replan')
    assert.ok(room.responseOrchestration.replanCount >= 1)
    assert.equal(room.responseOrchestration.plan.previousPlanId, prevId)
    assert.ok(room.responseOrchestration.plan.replanContext)
    assert.equal(room.responseOrchestration.plan.continuationContext, null)
  })
})
