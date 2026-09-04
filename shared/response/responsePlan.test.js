import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildExpectedImpactFromIncident,
  buildRecommendedActionsFromContext,
  buildResponsePlan,
  correlatedIncidentIds,
  revalidatePlanAgainstContext,
  selectPrimaryIncidentForPlan,
} from './responsePlan.js'
import {
  CAPABILITY_AVAILABILITY,
  PLAN_APPROVAL_STATUS,
  normalizePlanAction,
} from './orchestration.js'
import { attachAvailableResponseActions } from '../responseActions.js'
import { attachResponseClassification } from '../responsePolicy.js'
import { attachRecoveryImpact } from '../recovery/recoveryImpact.js'
import { attachLiveCorrelation } from '../correlation/liveCorrelation.js'

function node(id, criticality = 'medium') {
  return {
    id,
    data: {
      label: id.toUpperCase(),
      criticality,
      runtimeState: { quarantined: false },
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
    anomalyScore: 0.85,
    criticality: 'high',
    detectionType: 'behavioral_anomaly',
    evidence: [
      {
        code: 'metric_deviation',
        metric: 'packetsPerSecond',
        observed: 900,
        expected: 100,
        deviationPct: 800,
      },
    ],
    peerExposedNodeIds: extra.peerExposedNodeIds ?? [],
    propagatedNodeIds: extra.propagatedNodeIds ?? [],
    correlation: { groupId: null, relatedLiveIds: [], reasons: [] },
    ...extra,
  }
}

function contextFor(incident, nodes) {
  const base = {
    incidentId: incident.persistentId || incident.id,
    liveIncidentId: incident.id,
    incidentType: incident.detectionType,
    severity: incident.severity,
    status: incident.status,
    affectedAsset: { id: incident.endpointId, summary: incident.endpointLabel },
    riskScore: incident.anomalyScore,
    trustScore: 40,
    anomalyEvidence: incident.evidence ?? [],
    peerExposure: incident.peerExposedNodeIds ?? [],
    propagatedNodeIds: incident.propagatedNodeIds ?? [],
    actionsAlreadyTaken: incident.actionsTaken ?? [],
    isExposureIncident: incident.isExposureIncident === true,
  }
  return attachAvailableResponseActions(attachResponseClassification(base, nodes))
}

describe('responsePlan builder', () => {
  it('selects highest recovery-priority incident as primary', () => {
    const nodes = [node('a', 'high'), node('b', 'medium'), node('c', 'critical')]
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]
    const incidents = [
      seedIncident('inc-b', 'b', { severity: 'medium', anomalyScore: 0.5 }),
      seedIncident('inc-a', 'a', {
        severity: 'high',
        anomalyScore: 0.9,
        peerExposedNodeIds: ['b'],
        propagatedNodeIds: ['c'],
        criticality: 'high',
      }),
    ]
    const detection = { incidents, anomalyNodeIds: ['a', 'b'] }
    attachLiveCorrelation(detection, { edges })
    attachRecoveryImpact(detection, { nodes, edges, overrides: {} })

    const primary = selectPrimaryIncidentForPlan(detection, null)
    assert.equal(primary.id, 'inc-a')
    assert.ok(Number(primary.recoveryPriority) >= Number(incidents[0].recoveryPriority || 0))
  })

  it('includes correlated group members in incidentIds', () => {
    const nodes = [node('a'), node('b')]
    const edges = [{ source: 'a', target: 'b' }]
    const incidents = [
      seedIncident('inc-a', 'a', { peerExposedNodeIds: ['b'] }),
      seedIncident('inc-b', 'b'),
    ]
    const detection = { incidents, anomalyNodeIds: ['a', 'b'] }
    attachLiveCorrelation(detection, { edges })
    attachRecoveryImpact(detection, { nodes, edges, overrides: {} })
    const primary = selectPrimaryIncidentForPlan(detection, 'inc-a')
    const ids = correlatedIncidentIds(detection, primary)
    assert.ok(ids.includes('inc-a'))
  })

  it('expectedImpact uses MAY language for exposure relief', () => {
    const impact = buildExpectedImpactFromIncident({
      recoveryPriority: 12,
      recoveryImpact: {
        score: 12,
        certainNodeIds: ['a'],
        reliefCandidateIds: ['b', 'c'],
        excludedIndependentIds: ['d'],
        excludedQuarantinedIds: ['e'],
        explanation: {
          headline: 'Resolve A first',
          certain: { count: 1 },
          exposureRelief: { count: 2, criticalCount: 1 },
          excludedIndependent: { count: 1 },
          excludedQuarantined: { count: 1 },
          reasons: ['May reduce exposure across 2 downstream endpoints'],
        },
      },
    })
    assert.equal(impact.certainRecoveryCount, 1)
    assert.equal(impact.mayReduceExposureCount, 2)
    assert.equal(impact.criticalExposureReliefCount, 1)
    assert.ok(impact.summaryLines.some((l) => l.includes('May reduce exposure')))
    assert.ok(!impact.summaryLines.some((l) => /will recover 2/i.test(l)))
  })

  it('only registry actions are executable; catalog cannot become executable', () => {
    const nodes = [node('pay', 'critical')]
    const incident = seedIncident('inc-pay', 'pay')
    const ctx = contextFor(incident, nodes)
    const steps = buildRecommendedActionsFromContext(ctx)
    assert.ok(steps.length >= 1)
    assert.equal(steps[0].actionId, 'isolate-node')
    assert.equal(steps[0].executable, true)
    assert.equal(steps[0].policyStatus, 'ALLOWED')

    const fake = normalizePlanAction({
      actionId: 'rate-limit-endpoint',
      executable: true,
    })
    assert.equal(fake.executable, false)
    assert.equal(fake.availability, CAPABILITY_AVAILABILITY.CATALOG)
  })

  it('buildResponsePlan produces APPROVAL-ready structure without executing', () => {
    const nodes = [node('pay', 'critical')]
    const edges = []
    const incident = seedIncident('inc-pay', 'pay')
    const detection = { incidents: [incident], anomalyNodeIds: ['pay'] }
    attachRecoveryImpact(detection, { nodes, edges, overrides: {} })
    const ctx = contextFor(detection.incidents[0], nodes)
    const built = buildResponsePlan({
      detection,
      context: ctx,
      focusIncidentId: 'inc-pay',
      nowMs: 1_700_000_000_000,
    })
    assert.equal(built.ok, true)
    assert.ok(built.plan.planId)
    assert.equal(built.plan.primaryIncidentId, 'inc-pay')
    assert.ok(built.executableCount >= 1)
    assert.equal(built.plan.approvalStatus, PLAN_APPROVAL_STATUS.NONE)
    assert.ok(built.plan.recommendedActions.every((a) => a.executable === true))
    assert.ok(built.fingerprint)
  })

  it('revalidate rejects plan with injected non-registry executable action', () => {
    const nodes = [node('pay', 'critical')]
    const incident = seedIncident('inc-pay', 'pay')
    const ctx = contextFor(incident, nodes)
    const plan = {
      primaryIncidentId: 'inc-pay',
      recommendedActions: [
        {
          actionId: 'disable-api-key',
          executable: true,
          availability: 'available',
        },
      ],
    }
    const reval = revalidatePlanAgainstContext(plan, ctx, { incidents: [incident] })
    assert.equal(reval.ok, false)
  })
})
