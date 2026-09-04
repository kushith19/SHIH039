import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
  isOrchestrationLoopInFlight,
  publicOrchestrationState,
  refreshOrchestrationFreshness,
  verifyOrchestrationPlan,
} from './orchestrate.js'
import {
  ORCHESTRATION_STEP_DELAY_MS,
  getOrchestrationStepDelayMs,
  runOrchestrationContinuation,
} from './orchestrationLoop.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import { ORCHESTRATION_STATUS } from '../../shared/response/orchestration.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { setNodeQuarantined } from './quarantineNode.js'
import { bindPostExecutionDetection } from './recoveryAgent.js'
import { remainingResponseCandidates } from '../../shared/response/approvalScope.js'
import { activeAgentOwnershipView } from '../../src/features/response/orchestrationView.js'

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

function roomMulti(id = 'S14') {
  const room = createEmptyRoom(id)
  room.nodes = [
    node('pay', 'critical'),
    node('water', 'high'),
    node('traffic', 'high'),
  ]
  room.edges = [
    { id: 'e1', source: 'pay', target: 'water' },
    { id: 'e2', source: 'pay', target: 'traffic' },
  ]
  room.detection = {
    incidents: [
      seedIncident('inc-a', 'pay', { recoveryPriority: 30 }),
      seedIncident('inc-b', 'water', { recoveryPriority: 20 }),
      seedIncident('inc-c', 'traffic', { recoveryPriority: 10 }),
    ],
    anomalyNodeIds: ['pay', 'water', 'traffic'],
    peerExposedNodeIds: [],
    propagatedNodeIds: [],
    atRiskNodeIds: [],
    isolationScoresByNodeId: { pay: 0.9, water: 0.85, traffic: 0.8 },
  }
  room.hackSimulator = {
    nodeOverrides: {
      pay: { packetsPerSecond: 900 },
      water: { packetsPerSecond: 700 },
      traffic: { packetsPerSecond: 600 },
    },
    edgeOverrides: {},
  }
  attachRecoveryImpact(room.detection, {
    nodes: room.nodes,
    edges: room.edges,
    overrides: {},
  })
  return room
}

function roomFive(id = 'S14-5') {
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

function roomWithExposure(id = 'S14-EXP') {
  const room = createEmptyRoom(id)
  room.nodes = [
    node('pay', 'critical'),
    node('water', 'high'),
    node('traffic', 'high'),
    node('gw', 'medium'),
  ]
  room.edges = [
    { id: 'e1', source: 'pay', target: 'water' },
    { id: 'e2', source: 'pay', target: 'traffic' },
    { id: 'e3', source: 'water', target: 'gw' },
  ]
  room.detection = {
    incidents: [
      seedIncident('inc-pay', 'pay', {
        recoveryPriority: 40,
        peerExposedNodeIds: ['water', 'traffic'],
      }),
      seedIncident('inc-water', 'water', { recoveryPriority: 20 }),
      seedIncident('inc-traffic', 'traffic', { recoveryPriority: 10 }),
      seedIncident('inc-gw', 'gw', {
        recoveryPriority: 100,
        isExposureIncident: true,
        detectionType: 'peer_exposure',
      }),
    ],
    anomalyNodeIds: ['pay', 'water', 'traffic'],
    peerExposedNodeIds: ['water', 'traffic', 'gw'],
    propagatedNodeIds: ['gw'],
    atRiskNodeIds: ['gw'],
    isolationScoresByNodeId: { pay: 0.95, water: 0.8, traffic: 0.75, gw: 0.4 },
  }
  room.hackSimulator = {
    nodeOverrides: {
      pay: { packetsPerSecond: 900 },
      water: { packetsPerSecond: 700 },
      traffic: { packetsPerSecond: 600 },
    },
    edgeOverrides: {},
  }
  attachRecoveryImpact(room.detection, {
    nodes: room.nodes,
    edges: room.edges,
    overrides: {},
  })
  return room
}

describe('STEP 14 orchestration workflow pacing', () => {
  it('exports configurable ORCHESTRATION_STEP_DELAY_MS default 3500', () => {
    assert.equal(ORCHESTRATION_STEP_DELAY_MS, 3500)
    assert.equal(getOrchestrationStepDelayMs(), 0)
  })

  it('approval still requires human action (autoContinue false stays APPROVED)', () => {
    const room = roomMulti('S14-APPROVE')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    assert.equal(approved.ok, true)
    assert.equal(approved.autoContinued, false)
    assert.equal(approved.executed, false)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.APPROVED)
  })

  it('automatic continuation still processes all approved-scope incidents', () => {
    const room = roomMulti('S14-FULL')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
    })
    assert.equal(approved.ok, true)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
    for (const id of ['pay', 'water', 'traffic']) {
      assert.equal(
        runtimeStateOf(room.nodes.find((n) => n.id === id).data).quarantined,
        true,
        id
      )
    }
  })

  it('pacing emits real stage pauses without fabricating results', () => {
    const room = roomMulti('S14-PACE')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    const snapshots = []
    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 25,
      onProgress: (state) => {
        snapshots.push({
          status: state.status,
          reason: state.continuationReason,
        })
      },
    })
    assert.equal(approved.ok, true)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
    const paced = (approved.continuationLog || []).filter((e) => e.event === 'paced')
    assert.ok(paced.length >= 3)
    assert.ok(paced.every((e) => e.delayMs === 25))
    const ownership = activeAgentOwnershipView({
      workflowStatus: ORCHESTRATION_STATUS.APPROVED,
      continuationReason: 'pacing_after_approval',
    })
    assert.match(ownership.headline, /approval complete/i)
  })

  it('pacing does not change execution/verification semantics', () => {
    const roomA = roomMulti('S14-SEM-A')
    const roomB = roomMulti('S14-SEM-B')
    for (const room of [roomA, roomB]) {
      generateOrchestrationPlan(room, {
        focusIncidentId: 'inc-a',
        resolveContext,
      })
    }
    approveOrchestrationPlan(roomA, { resolveContext, stepDelayMs: 0 })
    approveOrchestrationPlan(roomB, { resolveContext, stepDelayMs: 20 })
    assert.equal(roomA.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
    assert.equal(roomB.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
  })

  it('verification failures are observational and add no post-fail pacing', () => {
    const room = roomMulti('S14-FAIL')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    setNodeQuarantined(room, 'pay', false)
    const t0 = Date.now()
    const verified = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 200,
    })
    assert.equal(verified.stepVerified, false)
    assert.equal(verified.observational, true)
    assert.notEqual(room.responseOrchestration.status, ORCHESTRATION_STATUS.REPLAN_REQUIRED)
    assert.ok(Date.now() - t0 < 150)
  })

  it('no duplicate execution / concurrent loop during delays', () => {
    const room = roomMulti('S14-NEST')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    let nested = null
    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 40,
      onProgress: () => {
        if (nested == null && isOrchestrationLoopInFlight(room.id)) {
          nested = runOrchestrationContinuation(room, {
            resolveContext,
            stepDelayMs: 0,
            mode: 'from_approved',
            writeState: () => room.responseOrchestration,
            publicOrchestrationState,
            executeOrchestrationPlan,
            verifyOrchestrationPlan,
            markEpisodeRecovered: () => {},
          })
        }
      },
    })
    assert.equal(approved.ok, true)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
    assert.ok(nested)
    assert.equal(nested.ok, false)
    assert.match(String(nested.message), /already in progress/i)
  })
})

describe('STEP 14 forensic Recovery + false REPLAN root cause', () => {
  it('5-incident run: every isolate VERIFIED, CONTINUE then RECOVERED, replanCount=0', () => {
    const room = roomFive('S14-5A')
    const statuses = []
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-1',
      resolveContext,
    })
    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
      onProgress: (s) => {
        statuses.push({
          status: s.workflowStatus || s.status,
          verdict: s.verification?.verdict ?? null,
        })
      },
    })
    assert.equal(approved.ok, true)
    assert.equal(approved.episodeComplete, true)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
    assert.equal(room.responseOrchestration.replanCount, 0)
    assert.equal(
      statuses.some((s) => s.status === ORCHESTRATION_STATUS.REPLAN_REQUIRED),
      false
    )

    const iterations = (room.responseOrchestration.workflowTrace || []).filter(
      (t) => t.kind === 'agent_loop' && t.phase === 'COMMANDER_CONTINUATION'
    )
    assert.ok(iterations.length >= 1)
    for (const it of iterations) {
      assert.equal(it.previousPlanId ?? null, null)
      assert.notEqual(it.planKind, 'replan')
    }
  })

  it('exposure-only incidents never become remaining work or false REPLAN via freshness', () => {
    const room = roomWithExposure('S14-EXP-A')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-pay',
      resolveContext,
    })
    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      stepDelayMs: 0,
    })
    assert.equal(approved.ok, true)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
    assert.equal(room.responseOrchestration.replanCount, 0)
    assert.equal(
      remainingResponseCandidates(room).some((i) => i.id === 'inc-gw'),
      false
    )
    refreshOrchestrationFreshness(room, resolveContext)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
  })

  it('freshness does not convert planning_failed pause into REPLAN_REQUIRED', () => {
    const room = roomWithExposure('S14-EXP-B')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-pay',
      resolveContext,
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const verified = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(verified.verdict, 'VERIFIED')

    room.responseOrchestration.workflowStatus = ORCHESTRATION_STATUS.AWAITING_APPROVAL
    room.responseOrchestration.status = ORCHESTRATION_STATUS.AWAITING_APPROVAL
    room.responseOrchestration.continuationReason = 'planning_failed'
    room.responseOrchestration.pausedForApprovalReason =
      'No policy-approved response action is currently available'

    refreshOrchestrationFreshness(room, resolveContext)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
  })

  it('deliberate containment loss → observational FAILED without REPLAN_REQUIRED', () => {
    const room = roomFive('S14-HARDFAIL')
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
    assert.equal(result.stepVerified, false)
    assert.equal(result.verdict, 'FAILED')
    assert.equal(result.observational, true)
    assert.notEqual(room.responseOrchestration.status, ORCHESTRATION_STATUS.REPLAN_REQUIRED)
    assert.equal(
      result.verification?.checks?.containmentHeld,
      false
    )
    assert.equal(
      result.verification?.checkDetails?.containmentHeld?.passed,
      false
    )
    assert.notEqual(room.responseOrchestration.continuationReason, 'verification_failed')
  })

  it('catalog-only actions never enter execution or affect Recovery verdict', () => {
    const room = roomMulti('S14-CAT')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    room.responseOrchestration.plan.recommendedActions.push({
      actionId: 'rate-limit-endpoint',
      executable: false,
      availability: 'catalog',
      target: { id: 'pay' },
    })
    approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      stepDelayMs: 0,
    })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const execIds = (room.responseOrchestration.execution?.results || []).map(
      (r) => r.actionId
    )
    assert.equal(execIds.includes('rate-limit-endpoint'), false)
    assert.ok(execIds.includes('isolate-node'))

    const verified = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(verified.verdict, 'VERIFIED')
    assert.deepEqual(verified.verification?.catalogActionIds || [], [
      'rate-limit-endpoint',
    ])
    assert.equal(
      verified.verification?.checkDetails?.catalogActionsDoNotAffectVerdict,
      true
    )
  })
})
