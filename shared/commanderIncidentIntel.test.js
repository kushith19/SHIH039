import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  COMMANDER_MODES,
  buildIncidentInvestigation,
  buildIncidentResponsePlan,
  buildIncidentIntel,
  responsePriorityFromContext,
} from './commanderIncidentIntel.js'
import { answerCommanderQuestion } from './commanderAsk.js'

function payContext(overrides = {}) {
  return {
    incidentId: 'pers-pay',
    liveIncidentId: 'inc-pay',
    incidentType: 'behavioural_anomaly',
    severity: 'high',
    status: 'open',
    currentStatus: 'open',
    affectedAsset: {
      id: 'pay',
      summary: 'Payment Processing System',
    },
    riskScore: 0.87,
    trustScore: 42,
    anomalyEvidence: [
      {
        code: 'metric_deviation',
        metric: 'packetsPerSecond',
        observed: 1340,
        expected: 420,
        deviationPct: 219,
      },
      { code: 'tgnn_embed', detail: 'tgnn_embed' },
    ],
    peerExposure: ['gw'],
    propagatedNodeIds: ['gw', 'core'],
    propagationPaths: {
      gw: ['pay', 'gw'],
      core: ['pay', 'gw', 'core'],
    },
    primaryPath: ['pay', 'gw', 'core'],
    primaryPathLabels: [
      'Payment Processing System',
      'Bank Gateway',
      'Core Banking',
    ],
    blastRadius: 3,
    hopDistance: 2,
    financialExposure: {
      simulated: true,
      exposureLabel: '₹2.4 Cr',
      affectedServiceIds: ['payment-processing-system', 'core-banking-system'],
      explanation:
        'High cyber residual is flagging mapped financial services (₹2.4 Cr simulated).',
    },
    relatedIncidents: [
      {
        incidentId: 'rel-gw',
        summary: 'Bank Gateway',
        severity: 'medium',
        incidentType: 'dependency_anomaly',
        affectedNodeId: 'gw',
      },
    ],
    campaignId: 'cmp-1',
    ...overrides,
  }
}

describe('commander incident intel', () => {
  it('builds INVESTIGATE without inventing evidence', () => {
    const inv = buildIncidentInvestigation(payContext())
    assert.equal(inv.mode, COMMANDER_MODES.INVESTIGATE)
    assert.match(inv.sections.incidentSummary, /Payment Processing System/)
    assert.ok(inv.sections.whySuspicious.some((l) => /packetsPerSecond/.test(l)))
    assert.deepEqual(inv.sections.graphImpact.pathLabels, [
      'Payment Processing System',
      'Bank Gateway',
      'Core Banking',
    ])
    assert.match(inv.sections.graphImpact.distinction, /peer exposure/)
    assert.equal(inv.sections.financialImpact.simulated, true)
    assert.match(inv.sections.financialImpact.narrative, /SIMULATED EXPOSURE/)
    assert.equal(inv.sections.currentState.riskScore, 87)
    assert.equal(inv.sections.currentState.trustScore, 42)
    assert.equal(inv.sections.relatedIncidents[0].role, 'context')
    assert.equal(inv.knowledgeStatus, 'unavailable')
  })

  it('builds RESPOND that contains origin only and protects downstream', () => {
    const plan = buildIncidentResponsePlan(payContext())
    assert.equal(plan.mode, COMMANDER_MODES.RESPOND)
    assert.equal(plan.priority, 'HIGH')
    assert.equal(plan.plan.length, 4)
    assert.match(plan.plan[0].action, /Payment Processing System/)
    assert.match(plan.plan[0].rationale, /Do not automatically isolate/)
    assert.match(plan.plan[1].action, /Bank Gateway/)
    assert.match(plan.plan[1].action, /Core Banking/)
    assert.equal(plan.plan.every((s) => s.executable === false), true)
    assert.equal(plan.plan.every((s) => s.recommended === true), true)
  })

  it('maps severity to priority without a new formula', () => {
    assert.equal(responsePriorityFromContext({ severity: 'critical' }), 'CRITICAL')
    assert.equal(responsePriorityFromContext({ severity: 'low' }), 'LOW')
    assert.equal(responsePriorityFromContext(payContext()), 'HIGH')
  })

  it('does not invent financial exposure when absent', () => {
    const inv = buildIncidentInvestigation(
      payContext({ financialExposure: null })
    )
    assert.equal(inv.sections.financialImpact.available, false)
    assert.match(inv.sections.financialImpact.narrative, /No simulated/)
  })

  it('buildIncidentIntel switches modes', () => {
    const ctx = payContext()
    assert.equal(buildIncidentIntel(ctx, 'investigate').mode, 'investigate')
    assert.equal(buildIncidentIntel(ctx, 'respond').mode, 'respond')
  })
})

describe('commander ask with incident context', () => {
  it('answers financial follow-ups as simulated', () => {
    const r = answerCommanderQuestion('Why is the financial exposure high?', {
      incidentContext: payContext(),
    })
    assert.equal(r.insufficient, false)
    assert.match(r.answer, /SIMULATED EXPOSURE/)
    assert.match(r.answer, /not actual/)
  })

  it('explains why not to isolate every propagated node', () => {
    const r = answerCommanderQuestion("Why shouldn't I isolate Core Banking?", {
      incidentContext: payContext(),
    })
    assert.equal(r.insufficient, false)
    assert.match(r.answer, /confirmed anomaly/)
    assert.match(r.answer, /propagated|exposed/i)
  })

  it('returns evidence from incident context', () => {
    const r = answerCommanderQuestion('What evidence triggered the anomaly?', {
      incidentContext: payContext(),
    })
    assert.equal(r.insufficient, false)
    assert.match(r.answer, /packetsPerSecond/)
  })

  it('still refuses when no facts exist', () => {
    const r = answerCommanderQuestion('why is this risky?', {})
    assert.equal(r.insufficient, true)
  })
})
