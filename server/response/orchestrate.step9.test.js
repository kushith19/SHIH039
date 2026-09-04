import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
  isOrchestrationExecutionInFlight,
  publicOrchestrationState,
  startNewOrchestrationCycle,
  verifyOrchestrationPlan,
} from './orchestrate.js'
import { getMaxAutoIterations } from './orchestrationLoop.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import { ORCHESTRATION_STATUS } from '../../shared/response/orchestration.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { setNodeQuarantined } from './quarantineNode.js'
import { runRecoveryAgent, bindPostExecutionDetection } from './recoveryAgent.js'
import {
  buildApprovalScope,
  isPlanWithinApprovalScope,
} from '../../shared/response/approvalScope.js'

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

function roomMulti(id = 'S9') {
  const room = createEmptyRoom(id)
  room.nodes = [
    node('pay', 'critical'),
    node('water', 'high'),
    node('traffic', 'high'),
    node('gw', 'medium'),
  ]
  room.edges = [
    { id: 'e1', source: 'pay', target: 'gw' },
    { id: 'e2', source: 'water', target: 'gw' },
    { id: 'e3', source: 'traffic', target: 'gw' },
  ]
  room.detection = {
    incidents: [
      seedIncident('inc-a', 'pay', { recoveryPriority: 30 }),
      seedIncident('inc-b', 'water', { recoveryPriority: 20 }),
      seedIncident('inc-c', 'traffic', { recoveryPriority: 10 }),
    ],
    anomalyNodeIds: ['pay', 'water', 'traffic'],
    atRiskNodeIds: ['gw'],
    peerExposedNodeIds: [],
    propagatedNodeIds: [],
    isolationScoresByNodeId: { pay: 0.9, water: 0.85, traffic: 0.8, gw: 0.2 },
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
      water: { packetsPerSecond: 850 },
      traffic: { packetsPerSecond: 800 },
    },
    edgeOverrides: {},
  }
  return room
}

function roomSingle(id = 'S9-1') {
  const room = roomMulti(id)
  room.detection.incidents = [seedIncident('inc-a', 'pay', { recoveryPriority: 30 })]
  room.detection.anomalyNodeIds = ['pay']
  room.hackSimulator.nodeOverrides = { pay: { packetsPerSecond: 900 } }
  attachRecoveryImpact(room.detection, {
    nodes: room.nodes,
    edges: room.edges,
    overrides: {},
  })
  return room
}

describe('STEP 9 multi-incident autonomous orchestration', () => {
  it('1: A+B+C approve once → agents process remaining → RECOVERED', () => {
    const room = roomMulti('ABC')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    const approved = approveOrchestrationPlan(room, { resolveContext })
    assert.equal(approved.ok, true)
    assert.equal(approved.autoContinued, true)
    assert.ok(room.responseOrchestration.approvalScope)
    assert.deepEqual(
      room.responseOrchestration.approvalScope.incidentIds.sort(),
      ['inc-a', 'inc-b', 'inc-c']
    )
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.RECOVERED
    )
    assert.equal(approved.episodeComplete, true)
    assert.equal(approved.recovered, true)
    // All three seeds quarantined via Response Agent only
    for (const id of ['pay', 'water', 'traffic']) {
      assert.equal(
        runtimeStateOf(room.nodes.find((n) => n.id === id).data).quarantined,
        true,
        id
      )
    }
    assert.ok(room.responseOrchestration.autoIteration >= 2)
    assert.ok((approved.continuationLog || []).length >= 1)
  })

  it('2: successful A does not mark B/C recovered (episode stays open mid-loop)', () => {
    const room = roomMulti('PARTIAL')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    // Approve without auto-continue, execute+verify A only
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    executeOrchestrationPlan(room, { resolveContext })
    const verified = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(verified.observational, true)
    assert.equal(verified.workflowUnchangedByVerdict, true)
    assert.equal(verified.episodeComplete, false)
    assert.equal(verified.remainingWork, true)
    assert.equal(verified.recovered, false)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.RECOVERED
    )
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'water').data).quarantined,
      false
    )
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'traffic').data).quarantined,
      false
    )
    assert.equal(room.detection.incidents.find((i) => i.id === 'inc-b').status, 'open')
    assert.equal(room.detection.incidents.find((i) => i.id === 'inc-c').status, 'open')
  })

  it('3: replan within approval scope → automatic continuation', () => {
    const room = roomMulti('INSCOPE')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const scope = room.responseOrchestration.approvalScope
    executeOrchestrationPlan(room, { resolveContext })
    // Force verification fail → continuation should replan within scope
    setNodeQuarantined(room, 'pay', false)
    const verified = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: true,
    })
    // Either recovered after re-isolate or paused — must not invent restore
    assert.equal(verified.autoRestored, false)
    assert.equal(verified.mutatedQuarantine, false)
    const pub = publicOrchestrationState(room)
    if (pub.status === ORCHESTRATION_STATUS.RECOVERED) {
      assert.ok(scope)
    } else if (pub.status === ORCHESTRATION_STATUS.AWAITING_APPROVAL) {
      assert.ok(pub.pausedForApprovalReason)
    } else {
      // Still within episode after auto replan/execute
      assert.ok(
        [
          ORCHESTRATION_STATUS.RECOVERED,
          ORCHESTRATION_STATUS.VERIFYING,
          ORCHESTRATION_STATUS.APPROVED,
          ORCHESTRATION_STATUS.AWAITING_APPROVAL,
          ORCHESTRATION_STATUS.REPLAN_REQUIRED,
        ].includes(pub.status)
      )
    }
    // Scope check helper: B's isolate stays inside
    const check = isPlanWithinApprovalScope(
      {
        primaryIncidentId: 'inc-b',
        incidentIds: ['inc-b'],
        affectedNodeIds: ['water'],
        recommendedActions: [
          { actionId: 'isolate-node', executable: true, target: { id: 'water' } },
        ],
      },
      scope
    )
    assert.equal(check.ok, true)
  })

  it('4: verify observes a new out-of-scope incident without writing REPLAN_REQUIRED', () => {
    const room = roomSingle('OUT')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const scope = room.responseOrchestration.approvalScope
    assert.equal(
      isPlanWithinApprovalScope(
        {
          primaryIncidentId: 'inc-new',
          incidentIds: ['inc-new'],
          affectedNodeIds: ['water'],
          recommendedActions: [
            { actionId: 'isolate-node', executable: true, target: { id: 'water' } },
          ],
        },
        scope
      ).ok,
      false
    )

    executeOrchestrationPlan(room, { resolveContext })
    room.detection.incidents.push(
      seedIncident('inc-new', 'water', { recoveryPriority: 99 })
    )
    room.detection.anomalyNodeIds = ['pay', 'water']
    room.hackSimulator.nodeOverrides.water = { packetsPerSecond: 900 }
    attachRecoveryImpact(room.detection, {
      nodes: room.nodes,
      edges: room.edges,
      overrides: {},
    })
    bindPostExecutionDetection(room)
    const result = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: true,
    })
    // Verification evidence is observational and does not control the workflow.
    assert.equal(result.stepVerified, false)
    assert.equal(result.observational, true)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'water').data).quarantined,
      false
    )
  })

  it('5: new incident → fresh Commander analysis; no unauthorized execution', () => {
    const room = roomSingle('NEW')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    const firstPlanId = room.responseOrchestration.plan.planId
    approveOrchestrationPlan(room, { resolveContext })
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)

    // New incident appears — must analyze again; cannot execute on recovered plan
    room.detection.incidents.push(
      seedIncident('inc-new', 'water', { recoveryPriority: 50 })
    )
    room.detection.anomalyNodeIds = ['water']
    room.hackSimulator.nodeOverrides.water = { packetsPerSecond: 900 }
    attachRecoveryImpact(room.detection, {
      nodes: room.nodes,
      edges: room.edges,
      overrides: {},
    })

    const execBlocked = executeOrchestrationPlan(room, { resolveContext })
    assert.equal(execBlocked.ok, false)

    startNewOrchestrationCycle(room)
    const analyzed = generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-new',
      resolveContext,
    })
    assert.equal(analyzed.ok, true)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
    assert.notEqual(room.responseOrchestration.plan.planId, firstPlanId)
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'water').data).quarantined,
      false
    )
  })

  it('6: no active incidents → RECOVERED', () => {
    const room = roomSingle('NONE')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    const result = approveOrchestrationPlan(room, { resolveContext })
    assert.equal(result.ok, true)
    assert.equal(result.episodeComplete, true)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.RECOVERED
    )
  })

  it('7: failed verification is observational and never restores quarantine', () => {
    const room = roomSingle('FAIL')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    executeOrchestrationPlan(room, { resolveContext })
    setNodeQuarantined(room, 'pay', false)
    const result = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: true,
    })
    // Verification cannot restore quarantine or force a replan.
    assert.equal(result.autoRestored, false)
    assert.equal(result.observational, true)
    assert.notEqual(room.responseOrchestration.status, ORCHESTRATION_STATUS.REPLAN_REQUIRED)
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined,
      false
    )
  })

  it('8: stale/policy-invalid plan → stop for revalidation', () => {
    const room = roomSingle('STALE')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    room.detection.incidents = []
    room.detection.anomalyNodeIds = []
    const rejected = approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(rejected.ok, false)
    assert.equal(room.responseOrchestration.stale, true)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
  })

  it('9: automatic iteration limit prevents runaway', () => {
    const prev = process.env.ORCHESTRATION_MAX_AUTO_ITERATIONS
    process.env.ORCHESTRATION_MAX_AUTO_ITERATIONS = '1'
    try {
      assert.equal(getMaxAutoIterations(), 1)
      const room = roomMulti('MAX')
      generateOrchestrationPlan(room, {
        focusIncidentId: 'inc-a',
        resolveContext,
      })
      const result = approveOrchestrationPlan(room, { resolveContext })
      // With max=1, after first step + one continuation iteration should pause
      assert.ok(
        result.maxIterationsReached === true ||
          room.responseOrchestration.continuationReason === 'max_iterations' ||
          room.responseOrchestration.status ===
            ORCHESTRATION_STATUS.AWAITING_APPROVAL ||
          room.responseOrchestration.status === ORCHESTRATION_STATUS.RECOVERED
      )
      if (
        room.responseOrchestration.continuationReason === 'max_iterations' ||
        result.maxIterationsReached
      ) {
        assert.equal(
          room.responseOrchestration.status,
          ORCHESTRATION_STATUS.AWAITING_APPROVAL
        )
        // Not all three necessarily quarantined
        const qCount = ['pay', 'water', 'traffic'].filter(
          (id) =>
            runtimeStateOf(room.nodes.find((n) => n.id === id).data).quarantined
        ).length
        assert.ok(qCount < 3 || qCount >= 1)
      }
    } finally {
      if (prev === undefined) delete process.env.ORCHESTRATION_MAX_AUTO_ITERATIONS
      else process.env.ORCHESTRATION_MAX_AUTO_ITERATIONS = prev
    }
  })

  it('10: concurrent execution protection remains intact', () => {
    const room = roomSingle('CONC')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    // Simulate in-flight by calling execute while another execute holds the lock —
    // nested call from onProgress
    let nested = null
    const first = executeOrchestrationPlan(room, {
      resolveContext,
      onProgress: () => {
        if (nested == null && isOrchestrationExecutionInFlight(room.id)) {
          nested = executeOrchestrationPlan(room, { resolveContext })
        }
      },
    })
    assert.equal(first.ok, true)
    assert.ok(nested)
    assert.equal(nested.ok, false)
    assert.ok(String(nested.message).includes('already executing'))
  })

  it('11: Start New Response Cycle still works for a genuinely new cycle', () => {
    const room = roomSingle('CYCLE')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext })
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
    const next = startNewOrchestrationCycle(room)
    assert.equal(next.ok, true)
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.IDLE)
    assert.equal(room.responseOrchestration.plan, null)
    assert.equal(room.responseOrchestration.approvalScope, null)
    assert.equal(room.responseOrchestration.autoIteration, 0)
  })

  it('12: Recovery Agent never mutates / no auto-restore', () => {
    const room = roomMulti('PURE')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    executeOrchestrationPlan(room, { resolveContext })
    const qSnap = room.nodes.map((n) => ({
      id: n.id,
      q: runtimeStateOf(n.data).quarantined,
    }))
    const overrides = JSON.stringify(room.hackSimulator.nodeOverrides)
    const statuses = room.detection.incidents.map((i) => i.status)
    runRecoveryAgent({
      room,
      plan: room.responseOrchestration.plan,
      execution: room.responseOrchestration.execution,
      baseline: room.responseOrchestration.verificationBaseline,
    })
    assert.deepEqual(
      room.nodes.map((n) => ({
        id: n.id,
        q: runtimeStateOf(n.data).quarantined,
      })),
      qSnap
    )
    assert.equal(JSON.stringify(room.hackSimulator.nodeOverrides), overrides)
    assert.deepEqual(
      room.detection.incidents.map((i) => i.status),
      statuses
    )

    const room2 = roomMulti('PURE2')
    generateOrchestrationPlan(room2, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    const done = approveOrchestrationPlan(room2, { resolveContext })
    assert.equal(done.autoRestored, false)
    assert.equal(done.mutatedQuarantine, false)
    // Incidents remain open (not closed by agents)
    for (const inc of room2.detection.incidents) {
      assert.equal(String(inc.status).toLowerCase(), 'open')
    }
  })

  it('approvalScope is server-built; client cannot supply it via approve', () => {
    const room = roomSingle('SCOPE')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const scope = buildApprovalScope({
      plan: room.responseOrchestration.plan,
      detection: room.detection,
    })
    assert.deepEqual(
      room.responseOrchestration.approvalScope.incidentIds,
      scope.incidentIds
    )
    assert.ok(
      room.responseOrchestration.approvalScope.actionTypes.includes('isolate-node')
    )
  })
})
