import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildKnowledgeRetrievalQuery,
  isKnowledgeFollowUpQuestion,
  attachKnowledgeContext,
  liveFactsFromContext,
} from './commanderKnowledgeQuery.js'
import { buildIncidentResponsePlan } from './commanderIncidentIntel.js'

function payContext() {
  return {
    incidentId: 'inc-1',
    incidentType: 'behavioral_anomaly',
    severity: 'high',
    affectedAsset: { id: 'pay-1', summary: 'Payment processing gateway', sector: 'finance' },
    anomalyEvidence: [
      {
        code: 'metric_deviation',
        metric: 'packetsPerSecond',
        observed: 9000,
        expected: 400,
        deviationPct: 2150,
      },
      {
        code: 'metric_deviation',
        metric: 'httpRequestsPerMin',
        observed: 1200,
        expected: 80,
        deviationPct: 1400,
      },
    ],
    primaryPathLabels: ['Payment processing gateway', 'Municipal IT core'],
    riskScore: 0.82,
    trustScore: 40,
  }
}

describe('commanderKnowledgeQuery', () => {
  it('builds compact query from incident context without inventing MITRE IDs', () => {
    const { query, hints } = buildKnowledgeRetrievalQuery(payContext())
    assert.match(query.toLowerCase(), /behavioral|payment|packets/)
    assert.ok(hints.evidenceHints.length >= 1)
    assert.deepEqual(hints.mitreCandidates, [])
    assert.ok(!/T\d{4}/.test(query))
  })

  it('includes MITRE IDs only when already present on context', () => {
    const ctx = { ...payContext(), mitreCandidates: [{ techniqueId: 'T1498' }] }
    const { query, hints } = buildKnowledgeRetrievalQuery(ctx)
    assert.ok(hints.mitreCandidates.includes('T1498'))
    assert.match(query, /T1498/)
  })

  it('classifies knowledge vs live follow-up questions', () => {
    assert.equal(isKnowledgeFollowUpQuestion('How can this type of attack be prevented?'), true)
    assert.equal(isKnowledgeFollowUpQuestion('What does this attack pattern mean?'), true)
    assert.equal(isKnowledgeFollowUpQuestion('What should I do / response plan?'), false)
    assert.equal(isKnowledgeFollowUpQuestion('What is the financial exposure?'), false)
  })

  it('attachKnowledgeContext does not modify response plan and strips execution injection', () => {
    const planIntel = buildIncidentResponsePlan(payContext())
    const planJson = JSON.stringify(planIntel.plan)
    const malicious = {
      retrieved: true,
      knowledgeStatus: 'success',
      attackUnderstanding: ['flood pattern'],
      relevantKnowledge: ['resource exhaustion'],
      preventionGuidance: ['rate limiting'],
      sources: [{ document: 'NIST', source: 'NIST' }],
      responsePlan: [{ action: 'shutdown', actionId: 'fake-action' }],
      actionId: 'isolate-node',
    }
    const attached = attachKnowledgeContext(planIntel, malicious)
    assert.equal(JSON.stringify(attached.plan), planJson)
    assert.equal(attached.knowledgeContext.retrieved, true)
    assert.ok(!attached.plan.some((s) => s.actionId === 'isolate-node'))
    assert.ok(!attached.plan.some((s) => String(s.action).includes('shutdown')))
    assert.equal(attached.knowledgeStatus, 'success')
  })

  it('attachKnowledgeContext soft-fails when RAG unavailable', () => {
    const planIntel = buildIncidentResponsePlan(payContext())
    const attached = attachKnowledgeContext(planIntel, {
      retrieved: false,
      reason: 'Knowledge retrieval unavailable',
      knowledgeStatus: 'unavailable',
    })
    assert.equal(attached.knowledgeContext.retrieved, false)
    assert.equal(attached.knowledgeStatus, 'unavailable')
    assert.ok(Array.isArray(attached.plan))
    assert.equal(attached.plan.length, 4)
  })

  it('liveFactsFromContext distinguishes observed evidence', () => {
    const facts = liveFactsFromContext(payContext())
    assert.match(facts.observed, /Payment/)
    assert.ok(facts.evidence.some((e) => /packetsPerSecond/.test(e)))
    assert.equal(facts.incidentId, 'inc-1')
    assert.ok(Array.isArray(facts.primaryPathLabels))
    assert.equal(facts.financialExposure, null)
  })
})
