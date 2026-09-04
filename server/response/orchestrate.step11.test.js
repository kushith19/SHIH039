import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
  verifyOrchestrationPlan,
} from './orchestrate.js'
import {
  isStepVerified,
  runRecoveryAgent,
  VERIFICATION_VERDICT,
  bindPostExecutionDetection,
} from './recoveryAgent.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import { ORCHESTRATION_STATUS } from '../../shared/response/orchestration.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { setNodeQuarantined } from './quarantineNode.js'
import {
  activeAgentOwnershipView,
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
    propagatedNodeIds: [],
    actionsAlreadyTaken: [],
    isExposureIncident: false,
  }
  return attachAvailableResponseActions(
    attachResponseClassification(base, room.nodes)
  )
}

function roomMulti(id = 'S11') {
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

describe('STEP 11 step verified vs episode recovered', () => {
  it('A+B+C approve once → each iteration VERIFIED → continuation → episode RECOVERED', () => {
    const room = roomMulti('ABC')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    const approved = approveOrchestrationPlan(room, { resolveContext })
    assert.equal(approved.ok, true)
    assert.equal(approved.episodeComplete, true)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.RECOVERED
    )
    assert.ok(
      (approved.continuationLog || []).every(
        (e) => e.event !== 'step_verify_failed'
      )
    )
    assert.ok(room.responseOrchestration.autoIteration >= 2)
    for (const id of ['pay', 'water', 'traffic']) {
      assert.equal(
        runtimeStateOf(room.nodes.find((n) => n.id === id).data).quarantined,
        true,
        id
      )
    }
    // Successful multi-incident continuation must not look like replans
    assert.equal(room.responseOrchestration.replanCount, 0)
  })

  it('remaining approved-scope incidents do not cause REPLAN_REQUIRED', () => {
    const room = roomMulti('REM')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    // Keep B/C anomalous — still in approvalScope / baseline
    const verified = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(verified.stepVerified, true)
    assert.equal(isStepVerified(verified.verdict), true)
    assert.equal(verified.verdict, VERIFICATION_VERDICT.VERIFIED)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    assert.equal(verified.remainingWork, true)
    assert.equal(verified.recovered, false)
  })

  it('remaining incidents not in plan.affectedNodeIds but in approvalScope are valid', () => {
    const room = roomMulti('SCOPE')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    assert.ok(
      room.responseOrchestration.approvalScope.targetNodeIds.includes('water')
    )
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    assert.deepEqual(room.responseOrchestration.plan.affectedNodeIds, ['pay'])
    // Water appears as anomaly but is in approvalScope — not a hard fail
    room.detection.anomalyNodeIds = ['water', 'traffic']
    const result = runRecoveryAgent({
      room,
      plan: room.responseOrchestration.plan,
      execution: room.responseOrchestration.execution,
      baseline: room.responseOrchestration.verificationBaseline,
      approvalScope: room.responseOrchestration.approvalScope,
    })
    assert.equal(result.verdict, VERIFICATION_VERDICT.VERIFIED)
    assert.equal(result.checks.noNewOutOfScopeAnomalies, true)
  })

  it('new incident outside approvalScope is observational during verify', () => {
    const room = roomMulti('NEW')
    room.detection.incidents = [
      seedIncident('inc-a', 'pay', { recoveryPriority: 30 }),
    ]
    room.detection.anomalyNodeIds = ['pay']
    attachRecoveryImpact(room.detection, {
      nodes: room.nodes,
      edges: room.edges,
      overrides: {},
    })
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    room.detection.incidents.push(
      seedIncident('inc-x', 'gw', { recoveryPriority: 5 })
    )
    room.detection.anomalyNodeIds = ['gw']
    bindPostExecutionDetection(room)
    const result = verifyOrchestrationPlan(room, { autoContinue: false })
    assert.equal(result.stepVerified, false)
    assert.equal(result.verdict, VERIFICATION_VERDICT.FAILED)
    assert.equal(result.observational, true)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
  })

  it('lost quarantine is reported without controlling workflow', () => {
    const room = roomMulti('LOST')
    room.detection.incidents = [
      seedIncident('inc-a', 'pay', { recoveryPriority: 30 }),
    ]
    room.detection.anomalyNodeIds = ['pay']
    attachRecoveryImpact(room.detection, {
      nodes: room.nodes,
      edges: room.edges,
      overrides: {},
    })
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    setNodeQuarantined(room, 'pay', false)
    const result = verifyOrchestrationPlan(room, { autoContinue: false })
    assert.equal(result.stepVerified, false)
    assert.equal(result.verdict, VERIFICATION_VERDICT.FAILED)
    assert.equal(result.workflowUnchangedByVerdict, true)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
  })

  it('execution failure → FAILED', () => {
    const room = roomMulti('EXEC')
    room.detection.incidents = [
      seedIncident('inc-a', 'pay', { recoveryPriority: 30 }),
    ]
    room.detection.anomalyNodeIds = ['pay']
    attachRecoveryImpact(room.detection, {
      nodes: room.nodes,
      edges: room.edges,
      overrides: {},
    })
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const execution = {
      ...room.responseOrchestration.execution,
      results: (room.responseOrchestration.execution.results || []).map((r) => ({
        ...r,
        status: 'failed',
      })),
    }
    const result = runRecoveryAgent({
      room,
      plan: room.responseOrchestration.plan,
      execution,
      baseline: room.responseOrchestration.verificationBaseline,
      approvalScope: room.responseOrchestration.approvalScope,
    })
    assert.equal(result.verdict, VERIFICATION_VERDICT.FAILED)
    assert.equal(result.checks.executionComplete, false)
  })

  it('real residual worsening → FAILED', () => {
    const room = roomMulti('RES')
    room.detection.incidents = [
      seedIncident('inc-a', 'pay', { recoveryPriority: 30 }),
    ]
    room.detection.anomalyNodeIds = ['pay']
    attachRecoveryImpact(room.detection, {
      nodes: room.nodes,
      edges: room.edges,
      overrides: {},
    })
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    room.detection.isolationScoresByNodeId = { pay: 0.99 }
    const baseline = room.responseOrchestration.verificationBaseline
    baseline.residualByTarget = { pay: 0.4 }
    const result = runRecoveryAgent({
      room,
      plan: room.responseOrchestration.plan,
      execution: room.responseOrchestration.execution,
      baseline,
      approvalScope: room.responseOrchestration.approvalScope,
    })
    assert.equal(result.verdict, VERIFICATION_VERDICT.FAILED)
    assert.equal(result.checks.residualNotWorsening, false)
  })

  it('successful continuation does not increment replanCount', () => {
    const room = roomMulti('RP')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext })
    assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.RECOVERED)
    assert.equal(room.responseOrchestration.replanCount, 0)
  })

  it('final RECOVERED only when no remaining response work', () => {
    const room = roomMulti('FIN')
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const mid = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
    })
    assert.equal(mid.stepVerified, true)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.RECOVERED
    )
    const done = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: true,
    })
    // CONTINUING starts the remaining approved-scope work without a verify gate.
    assert.ok(
      done.episodeComplete === true ||
        room.responseOrchestration.status === ORCHESTRATION_STATUS.RECOVERED
    )
  })

  it('UI distinguishes Step Verified, Replanning Required, and Episode Recovered', () => {
    const stepView = verificationView({
      workflowStatus: ORCHESTRATION_STATUS.VERIFYING,
      continuationReason: 'remaining_incidents',
      verification: {
        verdict: 'VERIFIED',
        reasons: ['Step verified'],
        checks: { containmentHeld: true },
      },
    })
    assert.equal(stepView.title, 'Response verified — remaining approved incidents')
    assert.equal(stepView.stepVerified, true)

    const failView = verificationView({
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      verification: {
        verdict: 'FAILED',
        verified: false,
        reasons: ['Containment not held'],
        primaryReason: 'Containment not held',
        checks: { containmentHeld: false },
      },
    })
    assert.equal(failView.title, 'Verification failed')
    assert.equal(failView.stepFailed, true)

    const episodeView = verificationView({
      workflowStatus: ORCHESTRATION_STATUS.RECOVERED,
      verification: {
        verdict: 'VERIFIED',
        reasons: ['Step verified'],
        checks: { containmentHeld: true },
      },
    })
    assert.equal(episodeView.title, 'Episode recovered')
    assert.equal(episodeView.episodeRecovered, true)

    const ownership = activeAgentOwnershipView({
      workflowStatus: ORCHESTRATION_STATUS.VERIFYING,
      continuationReason: 'remaining_incidents',
      replanCount: 0,
    })
    assert.match(ownership.headline, /verified|continuing|remaining/i)
  })
})
