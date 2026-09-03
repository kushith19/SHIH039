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
      breakdown: [
        {
          id: 'core-banking-system',
          label: 'Core Banking',
          lakhs: 120,
          exposureLabel: '₹1.2 Cr',
        },
        {
          id: 'payment-processing-system',
          label: 'Payment Processing',
          lakhs: 80,
          exposureLabel: '₹80 L',
        },
      ],
      affectedServices: 2,
      explanation:
        'High cyber residual is flagging economically consequential services (₹2.4 Cr simulated).',
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
    assert.match(plan.plan[0].action, /packet-rate|traffic-flood|Isolate Node/i)
    assert.match(plan.plan[0].rationale, /Do not automatically isolate/)
    assert.match(plan.plan[1].action, /Bank Gateway/)
    assert.match(plan.plan[1].action, /Core Banking/)
    assert.equal(plan.plan.every((s) => s.executable === false), true)
    assert.equal(plan.plan.every((s) => s.recommended === true), true)
    assert.equal(plan.plan.every((s) => s.actionId == null), true)
  })

  it('produces profile-specific RESPOND plans for different incidents', () => {
    const flood = buildIncidentResponsePlan(
      payContext({
        anomalyEvidence: [
          {
            code: 'metric_deviation',
            metric: 'packetsPerSecond',
            deviationPct: 400,
          },
        ],
      })
    )
    const credential = buildIncidentResponsePlan(
      payContext({
        affectedAsset: {
          id: 'id',
          summary: 'Identity Access',
          type: 'identity_access',
        },
        anomalyEvidence: [
          {
            code: 'metric_deviation',
            metric: 'failedLoginsPerMin',
            deviationPct: 300,
          },
        ],
        financialExposure: null,
        primaryPathLabels: ['Identity Access', 'Bank Gateway'],
      })
    )
    const exfil = buildIncidentResponsePlan(
      payContext({
        anomalyEvidence: [
          {
            code: 'metric_deviation',
            metric: 'filesDownloaded',
            deviationPct: 280,
          },
        ],
      })
    )
    const api = buildIncidentResponsePlan(
      payContext({
        anomalyEvidence: [
          {
            code: 'metric_deviation',
            metric: 'httpRequestsPerMin',
            deviationPct: 500,
          },
        ],
        financialExposure: null,
      })
    )

    assert.match(flood.plan[0].action, /traffic-flood|packet-rate/i)
    assert.match(credential.plan[0].action, /failed-login|credential|identity/i)
    assert.match(credential.plan[0].action, /not a network flood/i)
    assert.match(exfil.plan[0].action, /file-transfer|filesDownloaded|bulk file/i)
    assert.match(api.plan[0].action, /HTTP\/API|httpRequestsPerMin|request volume/i)

    assert.notEqual(flood.plan[0].action, credential.plan[0].action)
    assert.notEqual(credential.plan[0].action, exfil.plan[0].action)
    assert.notEqual(exfil.plan[0].action, api.plan[0].action)
  })

  it('finance plan keeps simulated-exposure language; OT plan is safety-aware', () => {
    const finance = buildIncidentResponsePlan(
      payContext({
        affectedAsset: {
          id: 'pay',
          summary: 'Payment Processing System',
          type: 'payment_processing_system',
          sector: 'Finance',
        },
        anomalyEvidence: [{ code: 'tgnn_embed', detail: 'tgnn_embed' }],
      })
    )
    assert.match(finance.plan[0].action, /finance|simulated financial exposure/i)
    assert.match(finance.plan[2].action, /simulated financial exposure|not actual loss/i)

    const ot = buildIncidentResponsePlan(
      payContext({
        affectedAsset: {
          id: 'pwr',
          summary: 'Power Grid',
          type: 'power_grid',
          sector: 'Energy',
        },
        anomalyEvidence: [{ code: 'tgnn_embed' }],
        financialExposure: null,
        primaryPathLabels: ['Power Grid', 'Substation'],
      })
    )
    assert.match(ot.plan[0].action, /OT\/ICS|operational safety/i)
    assert.match(ot.plan[0].action, /Do not shut down the plant/i)
  })

  it('propagated exposure plan does not recommend isolating the exposed node', () => {
    const plan = buildIncidentResponsePlan(
      payContext({
        isExposureIncident: true,
        anomalyEvidence: [{ code: 'graph_propagation' }],
        affectedAsset: { id: 'core', summary: 'Core Banking', type: 'banking_financial' },
        financialExposure: null,
      })
    )
    assert.equal(plan.plan.length, 4)
    assert.match(plan.plan[0].action, /Do not isolate/i)
    assert.doesNotMatch(plan.plan[0].action, /Recommended action: Isolate Node/i)
    assert.match(plan.plan[2].action, /independent/i)
    assert.equal(plan.plan.every((s) => s.executable === false), true)
    assert.match(plan.sections.graphImpact.distinction, /Exposed|propagated/i)
  })

  it('general residual still yields a four-phase advisory plan', () => {
    const plan = buildIncidentResponsePlan(
      payContext({
        affectedAsset: {
          id: 'road',
          summary: 'Road Infrastructure',
          type: 'road_infrastructure',
        },
        anomalyEvidence: [{ code: 'tgnn_embed' }],
        financialExposure: null,
        primaryPathLabels: ['Road Infrastructure'],
        peerExposure: [],
        propagatedNodeIds: [],
      })
    )
    assert.equal(plan.plan.length, 4)
    assert.deepEqual(
      plan.plan.map((p) => p.title),
      ['CONTAIN', 'PROTECT', 'VERIFY', 'RECOVER']
    )
    assert.match(plan.plan[0].action, /general residual|Isolate Node/i)
    assert.equal(plan.plan.every((s) => s.actionId == null), true)
  })

  it('changing responseClassification changes plan content', () => {
    const base = payContext({
      anomalyEvidence: [{ code: 'tgnn_embed' }],
      financialExposure: null,
      affectedAsset: { id: 'n1', summary: 'Node One', type: 'road_infrastructure' },
    })
    const a = buildIncidentResponsePlan({
      ...base,
      responseClassification: {
        responseProfile: 'NETWORK_TRAFFIC_FLOOD',
        classificationConfidence: 'high',
        reasons: ['forced'],
        dominantMetric: 'packetsPerSecond',
        isSeed: true,
        isExposureOnly: false,
        otSafety: false,
      },
    })
    const b = buildIncidentResponsePlan({
      ...base,
      responseClassification: {
        responseProfile: 'IDENTITY_CREDENTIAL_ATTACK',
        classificationConfidence: 'high',
        reasons: ['forced'],
        dominantMetric: 'failedLoginsPerMin',
        isSeed: true,
        isExposureOnly: false,
        otSafety: false,
      },
    })
    assert.notEqual(a.plan[0].action, b.plan[0].action)
    assert.match(a.plan[0].action, /traffic-flood|packet-rate/i)
    assert.match(b.plan[0].action, /failed-login|credential/i)
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
    assert.match(inv.sections.financialImpact.narrative, /No simulated economic/)
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
