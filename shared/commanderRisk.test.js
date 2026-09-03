import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { composeRisk, knowledgeStatusFromRetrieval } from './commanderRisk.js'
import { composeCityPosture } from './commanderPosture.js'
import { answerCommanderQuestion } from './commanderAsk.js'
import { fallbackBriefing } from './commanderBriefing.js'

describe('commander risk compose', () => {
  it('uses deviationPct and does not invent an LLM score', () => {
    const risk = composeRisk({
      anomalyScore: 0.82,
      trustScore: 31,
      criticality: 'critical',
      exposedCount: 3,
      hopCount: 2,
      evidence: [{ deviationPct: 81 }],
    })
    assert.equal(risk.behavioral, 81)
    assert.equal(risk.graph, 82)
    assert.equal(risk.trust, 31)
    assert.equal(risk.criticality, 95)
    assert.ok(risk.overall >= 0 && risk.overall <= 100)
  })

  it('marks empty retrieval as unavailable', () => {
    assert.equal(knowledgeStatusFromRetrieval({ chunkCount: 0, retrievalStatus: 'unavailable' }), 'unavailable')
  })
})

describe('commander ask', () => {
  it('refuses when the snapshot has no facts', () => {
    const r = answerCommanderQuestion('why is this risky?', {})
    assert.equal(r.insufficient, true)
  })

  it('answers from incident evidence', () => {
    const r = answerCommanderQuestion('show me the evidence', {
      incidents: [
        {
          endpointId: 'gw',
          endpointLabel: 'Gateway',
          evidence: [
            {
              code: 'metric_deviation',
              metric: 'packetsPerSecond',
              observed: 1340,
              expected: 420,
              deviationPct: 219,
            },
          ],
        },
      ],
    })
    assert.equal(r.insufficient, false)
    assert.match(r.answer, /Gateway/)
  })
})

describe('fallback briefing', () => {
  it('emits safety-approved plan steps', () => {
    const b = fallbackBriefing({
      campaign: {
        id: 'c1',
        title: 'Cross-sector cascade',
        campaignMatchScore: 0.8,
        propagationPath: ['a', 'b'],
        mitreCandidates: ['T0888'],
      },
      incidents: [{ id: 'inc-a', endpointId: 'a', anomalyScore: 0.7, trustScore: 40, evidence: [] }],
    })
    assert.equal(b.knowledgeStatus, 'unavailable')
    assert.equal(b.mitreCandidates[0].techniqueId, 'T0888')
    assert.ok(b.responsePlan.every((s) => s.safetyStatus === 'approved'))
  })
})

describe('city posture', () => {
  it('is deterministic from room state', () => {
    const p = composeCityPosture({
      detection: {
        incidents: [{ sector: 'Energy', criticality: 'critical', anomalyScore: 0.9, trustScore: 20 }],
        anomalyNodeIds: ['a'],
        riskMomentum: { trajectory: 'rising', exposedCount: 2 },
      },
      campaigns: [{ status: 'correlated', propagationPath: ['a', 'b'], sectors: ['Energy'] }],
    })
    assert.equal(p.source, 'deterministic-posture')
    assert.equal(p.activeIncidents, 1)
    assert.equal(p.activeCampaigns, 1)
  })
})
