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
  captureVerificationBaseline,
  cloneDetectionSnapshot,
  runRecoveryAgent,
  VERIFICATION_VERDICT,
} from './recoveryAgent.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import { ORCHESTRATION_STATUS } from '../../shared/response/orchestration.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { setNodeQuarantined } from './quarantineNode.js'

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

function roomWithIncident(id = 'ORCH-REC') {
  const room = createEmptyRoom(id)
  room.nodes = [node('pay', 'critical'), node('gw', 'medium')]
  room.edges = [{ id: 'e1', source: 'pay', target: 'gw' }]
  room.detection = {
    incidents: [
      seedIncident('inc-pay', 'pay', {
        peerExposedNodeIds: ['gw'],
        recoveryImpact: {
          certainNodeIds: ['pay'],
          reliefCandidateIds: ['gw'],
          excludedIndependentIds: [],
          excludedQuarantinedIds: [],
          score: 12,
          explanation: {
            headline: 'Resolve PAY first',
            certain: { count: 1 },
            exposureRelief: { count: 1, criticalCount: 0 },
            excludedIndependent: { count: 0 },
            excludedQuarantined: { count: 0 },
            reasons: [],
          },
        },
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

function toVerifying(room) {
  generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
  approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
  const exec = executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
  assert.equal(exec.ok, true)
  assert.equal(room.responseOrchestration.status, ORCHESTRATION_STATUS.CONTINUING)
  // Simulate post-sync detection: seed no longer anomalous while quarantined
  room.detection.anomalyNodeIds = []
  room.detection.isolationScoresByNodeId = { pay: 0.4, gw: 0.1 }
}

describe('Recovery Agent STEP 4', () => {
  it('rejects verify before response execution', () => {
    const room = roomWithIncident('NO-V')
    const result = verifyOrchestrationPlan(room)
    assert.equal(result.ok, false)
    assert.ok(/execute|continuing|verification/i.test(String(result.message)))
  })

  it('captures baseline before execute mutations', () => {
    const room = roomWithIncident('BASE')
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined,
      false
    )
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const baseline = room.responseOrchestration.verificationBaseline
    assert.ok(baseline)
    assert.equal(baseline.quarantineByTarget.pay, false)
    assert.ok(baseline.anomalyNodeIds.includes('pay'))
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined,
      true
    )
  })

  it('RECOVERED when containment held and no new out-of-scope anomalies', () => {
    const room = roomWithIncident('OK')
    toVerifying(room)
    const result = verifyOrchestrationPlan(room)
    assert.equal(result.ok, true)
    assert.equal(result.verdict, VERIFICATION_VERDICT.RECOVERED)
    assert.equal(result.observational, true)
    assert.notEqual(room.responseOrchestration.status, ORCHESTRATION_STATUS.REPLAN_REQUIRED)
    assert.equal(result.autoRestored, false)
    assert.equal(result.incidentsClosed, false)
    assert.equal(result.mutatedQuarantine, false)
    // Still quarantined — agent did not restore
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined,
      true
    )
    // Incident not closed by agent
    assert.equal(
      String(room.detection.incidents[0].status).toLowerCase(),
      'open'
    )
    assert.ok(
      (result.verification.recommendedNextActions || []).some(
        (a) => a.actionId === 'restore-connectivity' && a.autoExecute === false
      )
    )
  })

  it('observes missing quarantine without writing REPLAN_REQUIRED', () => {
    const room = roomWithIncident('NO-Q')
    toVerifying(room)
    setNodeQuarantined(room, 'pay', false)
    const result = verifyOrchestrationPlan(room)
    assert.equal(result.observational, true)
    assert.equal(result.verdict, VERIFICATION_VERDICT.REPLAN_REQUIRED)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
  })

  it('observes a new out-of-scope anomaly without workflow mutation', () => {
    const room = roomWithIncident('NEW-A')
    toVerifying(room)
    const outsideNodeId = 'brand-new-outside-scope-node'
    assert.equal(
      room.responseOrchestration.approvalScope.targetNodeIds.includes(outsideNodeId),
      false
    )
    room.detection.anomalyNodeIds = [outsideNodeId]
    // Authoritative post-response detection update (not a racing tick)
    room.responseOrchestration.postExecutionDetection = cloneDetectionSnapshot(
      room.detection
    )
    const result = verifyOrchestrationPlan(room)
    assert.equal(result.workflowUnchangedByVerdict, true)
    assert.equal(result.verdict, VERIFICATION_VERDICT.REPLAN_REQUIRED)
  })

  it('runRecoveryAgent does not mutate room quarantine or incidents', () => {
    const room = roomWithIncident('PURE')
    toVerifying(room)
    const qBefore = runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined
    const statusBefore = room.detection.incidents[0].status
    const overridesBefore = JSON.stringify(room.hackSimulator.nodeOverrides)
    runRecoveryAgent({
      room,
      plan: room.responseOrchestration.plan,
      execution: room.responseOrchestration.execution,
      baseline: room.responseOrchestration.verificationBaseline,
    })
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined,
      qBefore
    )
    assert.equal(room.detection.incidents[0].status, statusBefore)
    assert.equal(JSON.stringify(room.hackSimulator.nodeOverrides), overridesBefore)
  })

  it('captureVerificationBaseline is compact and deterministic', () => {
    const room = roomWithIncident('SNAP')
    const plan = {
      primaryIncidentId: 'inc-pay',
      incidentIds: ['inc-pay'],
      affectedNodeIds: ['pay'],
      expectedImpact: { recoveryPriority: 12, reliefCandidateIds: ['gw'] },
    }
    const a = captureVerificationBaseline(room, plan)
    const b = captureVerificationBaseline(room, plan)
    assert.deepEqual(a.anomalyNodeIds, b.anomalyNodeIds)
    assert.deepEqual(a.affectedNodeIds, ['pay'])
    assert.equal(a.quarantineByTarget.pay, false)
  })
})

describe('Recovery Agent STEP 10 verification semantics', () => {
  it('1: isolate succeeds + target remains quarantined → verification passes', () => {
    const room = roomWithIncident('S10-1')
    toVerifying(room)
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined,
      true
    )
    const result = runRecoveryAgent({
      room,
      plan: room.responseOrchestration.plan,
      execution: room.responseOrchestration.execution,
      baseline: room.responseOrchestration.verificationBaseline,
    })
    assert.equal(result.verdict, VERIFICATION_VERDICT.RECOVERED)
    assert.equal(result.checks.containmentHeld, true)
    assert.equal(result.failReasons.length, 0)
    assert.ok(result.passNotes.some((n) => /Containment maintained/i.test(n)))
    assert.ok(!/Containment held/i.test(result.primaryReason || ''))
  })

  it('1b: REPLAN_REQUIRED never surfaces containment-maintained as primaryReason', () => {
    const room = roomWithIncident('S10-1b')
    toVerifying(room)
    room.detection.anomalyNodeIds = ['gw']
    const result = runRecoveryAgent({
      room,
      plan: room.responseOrchestration.plan,
      execution: room.responseOrchestration.execution,
      baseline: room.responseOrchestration.verificationBaseline,
    })
    assert.equal(result.verdict, VERIFICATION_VERDICT.REPLAN_REQUIRED)
    assert.equal(result.checks.containmentHeld, true)
    assert.equal(result.checks.noNewOutOfScopeAnomalies, false)
    assert.ok(!/Containment maintained|Containment held/i.test(result.primaryReason))
    assert.ok(/New out-of-scope/i.test(result.primaryReason))
    assert.equal(result.reasons[0], result.primaryReason)
  })

  it('2: incidents decrease + containment remains → continuation proceeds', () => {
    const room = createEmptyRoom('S10-2')
    room.nodes = [node('pay', 'critical'), node('water', 'high'), node('gw', 'medium')]
    room.edges = [
      { id: 'e1', source: 'pay', target: 'gw' },
      { id: 'e2', source: 'water', target: 'gw' },
    ]
    room.detection = {
      incidents: [
        seedIncident('inc-a', 'pay', {
          peerExposedNodeIds: ['gw'],
          recoveryPriority: 30,
        }),
        seedIncident('inc-b', 'water', { recoveryPriority: 20 }),
      ],
      anomalyNodeIds: ['pay', 'water'],
      atRiskNodeIds: ['gw'],
      peerExposedNodeIds: ['gw'],
      propagatedNodeIds: [],
      isolationScoresByNodeId: { pay: 0.9, water: 0.85, gw: 0.2 },
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
      },
      edgeOverrides: {},
    }

    generateOrchestrationPlan(room, { focusIncidentId: 'inc-a', resolveContext })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    room.detection.isolationScoresByNodeId = { pay: 0.4, water: 0.85, gw: 0.1 }

    const verified = verifyOrchestrationPlan(room, {
      resolveContext,
      autoContinue: true,
    })
    assert.equal(verified.stepVerified, true)
    assert.equal(verified.mutatedQuarantine, false)
    assert.equal(verified.autoRestored, false)
    assert.notEqual(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.REPLAN_REQUIRED
    )
    assert.equal(
      runtimeStateOf(room.nodes.find((n) => n.id === 'pay').data).quarantined,
      true
    )
    assert.ok(
      [
        ORCHESTRATION_STATUS.RECOVERED,
        ORCHESTRATION_STATUS.CONTINUING,
        ORCHESTRATION_STATUS.AWAITING_APPROVAL,
        ORCHESTRATION_STATUS.APPROVED,
        ORCHESTRATION_STATUS.ANALYZING,
      ].includes(room.responseOrchestration.status)
    )
    if (room.responseOrchestration.status === ORCHESTRATION_STATUS.RECOVERED) {
      assert.equal(
        runtimeStateOf(room.nodes.find((n) => n.id === 'water').data).quarantined,
        true
      )
    }
  })

  it('3: genuinely new independent incident → REPLAN_REQUIRED', () => {
    const room = roomWithIncident('S10-3')
    toVerifying(room)
    room.detection.incidents.push(
      seedIncident('inc-new', 'gw', { recoveryPriority: 5 })
    )
    room.detection.anomalyNodeIds = ['gw']
    const result = runRecoveryAgent({
      room,
      plan: room.responseOrchestration.plan,
      execution: room.responseOrchestration.execution,
      baseline: room.responseOrchestration.verificationBaseline,
    })
    assert.equal(result.verdict, VERIFICATION_VERDICT.REPLAN_REQUIRED)
    assert.ok(
      result.failReasons.some((r) => /New out-of-scope|New independent open/i.test(r))
    )
    assert.ok(!/Containment maintained|Containment held/i.test(result.primaryReason))
  })

  it('4: failed execution → REPLAN_REQUIRED', () => {
    const room = roomWithIncident('S10-4')
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    approveOrchestrationPlan(room, { resolveContext, autoContinue: false })
    executeOrchestrationPlan(room, { resolveContext, autoContinue: false })
    const execution = {
      ...room.responseOrchestration.execution,
      results: (room.responseOrchestration.execution.results || []).map((r) => ({
        ...r,
        status: 'failed',
        error: 'simulated failure',
      })),
    }
    const result = runRecoveryAgent({
      room,
      plan: room.responseOrchestration.plan,
      execution,
      baseline: room.responseOrchestration.verificationBaseline,
    })
    assert.equal(result.verdict, VERIFICATION_VERDICT.REPLAN_REQUIRED)
    assert.equal(result.checks.executionComplete, false)
    assert.ok(/Not all approved actions completed/i.test(result.primaryReason))
  })

  it('5: no remaining response work → RECOVERED', () => {
    const room = roomWithIncident('S10-5')
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    const result = approveOrchestrationPlan(room, { resolveContext })
    assert.equal(result.ok, true)
    assert.equal(result.episodeComplete, true)
    assert.equal(result.recovered, true)
    assert.equal(
      room.responseOrchestration.status,
      ORCHESTRATION_STATUS.RECOVERED
    )
    assert.equal(result.autoRestored, false)
    assert.equal(result.mutatedQuarantine, false)
  })

  it('preserve MAY language for exposure relief in plan impact', () => {
    const room = roomWithIncident('S10-MAY')
    generateOrchestrationPlan(room, { focusIncidentId: 'inc-pay', resolveContext })
    const impact = room.responseOrchestration.plan.expectedImpact
    assert.ok(
      (impact.reasons || []).some((r) => /May reduce exposure/i.test(r)) ||
        Number(impact.mayReduceExposureCount) > 0
    )
  })
})
