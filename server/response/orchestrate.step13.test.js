import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
  verifyOrchestrationPlan,
} from './orchestrate.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import { ORCHESTRATION_STATUS } from '../../shared/response/orchestration.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import {
  isApprovedScopeContinuation,
  isGenuineReplanState,
  orchestrationFlowRailView,
  selectAuthoritativeOrchestrationState,
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

function roomFive(id = 'S13') {
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

describe('STEP 13 forensic blip — no transient REPLAN_REQUIRED', () => {
  it('A: 5 incidents capture transitions — never REPLAN_REQUIRED; ends RECOVERED', () => {
    const room = roomFive('S13-A')
    const transitions = []
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
      onProgress: (s) => {
        transitions.push({
          status: s.workflowStatus || s.status,
          reason: s.continuationReason,
          verdict: s.verification?.verdict ?? null,
          replanCount: s.replanCount,
        })
      },
    })
    assert.equal(approved.ok, true)
    assert.equal(approved.episodeComplete, true)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)

    const statuses = transitions.map((t) => t.status)
    assert.ok(statuses.includes(ORCHESTRATION_STATUS.APPROVED))
    assert.ok(statuses.includes(ORCHESTRATION_STATUS.EXECUTING))
    assert.ok(statuses.includes(ORCHESTRATION_STATUS.CONTINUING))
    assert.ok(statuses.includes(ORCHESTRATION_STATUS.RECOVERED))
    assert.equal(
      statuses.includes(ORCHESTRATION_STATUS.REPLAN_REQUIRED),
      false,
      `unexpected REPLAN_REQUIRED in ${JSON.stringify(statuses)}`
    )
    assert.ok(
      transitions.some(
        (t) =>
          t.status === ORCHESTRATION_STATUS.CONTINUING &&
          (t.reason === 'execution_complete' ||
            t.reason === 'response_executed' ||
            t.reason === 'remaining_incidents')
      )
    )
  })

  it('B: every broadcast snapshot on success never exposes REPLAN_REQUIRED', () => {
    const room = roomFive('S13-B')
    const broadcasts = []
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
      onProgress: (s) => broadcasts.push(s),
    })
    for (const snap of broadcasts) {
      assert.notEqual(snap.workflowStatus, ORCHESTRATION_STATUS.REPLAN_REQUIRED)
      assert.notEqual(snap.status, ORCHESTRATION_STATUS.REPLAN_REQUIRED)
      assert.equal(Number(snap.replanCount) || 0, 0)
    }
  })

  it('C: VERIFIED + remaining → direct continuation (ANALYZING), not REPLAN', () => {
    const room = roomFive('S13-C')
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
    assert.equal(mid.remainingWork, true)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    assert.equal(room.responseOrchestration.continuationReason, 'execution_complete')
    assert.equal(isApprovedScopeContinuation(room.responseOrchestration), true)
  })

  it('D: failed verification is observational and never writes REPLAN_REQUIRED', () => {
    const room = roomFive('S13-D')
    room.detection.incidents = [
      seedIncident('inc-1', 'n1', { recoveryPriority: 30 }),
    ]
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
    room.detection.anomalyNodeIds = ['n1', 'extra']
    room.detection.incidents.push(
      seedIncident('inc-extra', 'extra', { recoveryPriority: 99 })
    )
    attachRecoveryImpact(room.detection, {
      nodes: room.nodes,
      edges: room.edges,
      overrides: {},
    })
    // Poison BEFORE freeze by clearing post-execution snapshot path: re-execute
    // Fresh execute freezes current (poisoned) detection → genuine fail
    // Instead poison after execute: overwrite frozen snapshot to simulate pre-freeze race
    room.responseOrchestration.postExecutionDetection = {
      ...room.detection,
      anomalyNodeIds: ['n1', 'extra'],
      incidents: [...room.detection.incidents],
    }
    const transitions = []
    const result = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: true,
      stepDelayMs: 0,
      onProgress: (s) => transitions.push(s.workflowStatus || s.status),
    })
    assert.equal(result.stepVerified, false)
    assert.equal(result.observational, true)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    const replanHits = [
      ...transitions,
      room.responseOrchestration.status,
    ].filter((s) => s === ORCHESTRATION_STATUS.REPLAN_REQUIRED)
    assert.equal(replanHits.length, 0)
    assert.equal(isGenuineReplanState(room.responseOrchestration), false)
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'extra').data).quarantined,
      false
    )
  })

  it('E: telemetry tick after execute freeze does not create false REPLAN', () => {
    const room = roomFive('S13-E')
    const transitions = []
    let poisoned = false
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
      onProgress: (s) => {
        transitions.push(s.workflowStatus || s.status)
        if (
          !poisoned &&
          (s.workflowStatus === ORCHESTRATION_STATUS.CONTINUING ||
            s.status === ORCHESTRATION_STATUS.CONTINUING) &&
          s.postExecutionDetection
        ) {
          poisoned = true
          room.detection.anomalyNodeIds = [
            ...new Set([...(room.detection.anomalyNodeIds || []), 'extra']),
          ]
          room.detection.incidents.push(
            seedIncident('inc-extra', 'extra', { recoveryPriority: 99 })
          )
          attachRecoveryImpact(room.detection, {
            nodes: room.nodes,
            edges: room.edges,
            overrides: {},
          })
        }
      },
    })
    assert.equal(poisoned, true)
    assert.equal(
      transitions.includes(ORCHESTRATION_STATUS.REPLAN_REQUIRED),
      false
    )
    // May pause for scope expansion later — must not false-fail the frozen verify
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
  })

  it('F: HTTP localOverride older than socket never pins false Replan Required UI', () => {
    const staleHttp = {
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      status: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      updatedAtMs: 1000,
      replanCount: 0,
      verification: { verdict: 'FAILED', failReasons: ['stale'] },
    }
    const liveSocket = {
      workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
      status: ORCHESTRATION_STATUS.ANALYZING,
      updatedAtMs: 2000,
      autoIteration: 2,
      continuationReason: 'remaining_incidents',
      replanCount: 0,
      plan: { planKind: 'continuation', previousPlanId: null },
      verification: { verdict: 'VERIFIED', failReasons: [] },
    }
    const chosen = selectAuthoritativeOrchestrationState(staleHttp, liveSocket)
    assert.equal(chosen.workflowStatus, ORCHESTRATION_STATUS.ANALYZING)
    assert.equal(isGenuineReplanState(chosen), false)
    const rail = orchestrationFlowRailView(chosen)
    assert.notEqual(rail.steps[2].statusLabel, 'Replan required')
    assert.equal(rail.steps[3].phase, 'locked')
  })

  it('G: replanCount remains 0 throughout successful multi-incident continuation', () => {
    const room = roomFive('S13-G')
    const counts = []
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
      onProgress: (s) => counts.push(Number(s.replanCount) || 0),
    })
    assert.ok(counts.every((c) => c === 0))
    assert.equal(room.responseOrchestration.replanCount, 0)
  })

  it('H: previousPlanId does not cause replan UI/state during continuation', () => {
    const state = {
      workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
      autoIteration: 1,
      replanCount: 0,
      continuationReason: 'remaining_incidents',
      previousPlanId: null,
      plan: {
        planId: 'next',
        previousPlanId: null,
        planKind: 'continuation',
        continuationContext: {},
      },
      verification: { verdict: 'VERIFIED', failReasons: [] },
    }
    assert.equal(isGenuineReplanState(state), false)
    assert.equal(isApprovedScopeContinuation(state), true)
    const verify = verificationView(state)
    assert.equal(verify.stepFailed, false)
    assert.equal(verify.title, 'Response verified — remaining approved incidents')
    const rail = orchestrationFlowRailView(state)
    assert.equal(rail.steps[0].statusLabel, 'Continuing')
    assert.notEqual(rail.steps[2].statusLabel, 'Replan required')
    assert.notEqual(rail.steps[2].statusLabel, 'Verification failed')
  })
})
