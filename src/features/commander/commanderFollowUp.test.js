import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { COMMANDER_MODES } from '../../../shared/commanderIncidentIntel.js'
import { answerCommanderQuestion } from '../../../shared/commanderAsk.js'
import { liveFactsFromContext } from '../../../shared/commanderKnowledgeQuery.js'
import {
  FOLLOW_UP_SUGGESTIONS,
  appendFollowUpTurn,
  buildFollowUpAskBody,
  followUpMessagesForIncident,
  followUpResponseIsInformationalOnly,
  formatFollowUpAnswerBlocks,
  buildObservedEvidenceOpener,
  observedEvidenceChatMessages,
  buildKnowledgeOpener,
  investigateChatSeedMessages,
  mergeInvestigateChatSeed,
  shouldShowCommanderFollowUp,
  splitFollowUpInlineParts,
} from './commanderFollowUp.js'

const payContext = () => ({
  incidentId: 'inc-pay-1',
  incidentType: 'behavioral_anomaly',
  severity: 'high',
  riskScore: 0.82,
  trustScore: 40,
  anomalyScore: 0.91,
  affectedAsset: { id: 'pay-1', summary: 'Payment processing gateway', sector: 'finance' },
  anomalyEvidence: [
    {
      code: 'metric_deviation',
      metric: 'packetsPerSecond',
      observed: 9000,
      expected: 400,
      deviationPct: 2150,
    },
  ],
  primaryPathLabels: ['Payment processing gateway', 'Core Banking'],
  propagatedNodeIds: ['core-banking-1'],
  peerNodeIds: ['municipal-it-1'],
  financialExposure: {
    simulated: true,
    exposureLabel: '₹12.4L',
    breakdown: [{ id: 'pay-1', label: 'Payment processing gateway', exposureLabel: '₹8L' }],
  },
  responseClassification: 'investigate_contain',
})

describe('commander follow-up Investigate visibility', () => {
  it('Follow-up visible in Investigate', () => {
    assert.equal(
      shouldShowCommanderFollowUp({
        focused: true,
        mode: COMMANDER_MODES.INVESTIGATE,
      }),
      true
    )
  })

  it('Follow-up hidden in Respond', () => {
    assert.equal(
      shouldShowCommanderFollowUp({
        focused: true,
        mode: COMMANDER_MODES.RESPOND,
      }),
      false
    )
  })
})

describe('observed evidence as opening chat turn', () => {
  it('formats Level-1 facts as the first Commander message', () => {
    const text = buildObservedEvidenceOpener([
      'packetsPerSecond deviation: +317%',
      'endpoint is critical infrastructure',
    ])
    assert.match(text, /^Observed evidence/)
    assert.match(text, /not retrieved knowledge/)
    assert.match(text, /- packetsPerSecond deviation: \+317%/)
    assert.deepEqual(observedEvidenceChatMessages(['tgnn_embed']), [
      { role: 'assistant', text: buildObservedEvidenceOpener(['tgnn_embed']) },
    ])
  })

  it('does not invent evidence when none was supplied', () => {
    const text = buildObservedEvidenceOpener([])
    assert.match(text, /No Level-1 evidence items were supplied/)
    assert.ok(!text.includes('- '))
  })
})

describe('retrieved knowledge as opening chat turn', () => {
  it('places knowledge after observed evidence in the seed transcript', () => {
    const seed = investigateChatSeedMessages(
      ['tgnn_embed'],
      {
        retrieved: true,
        knowledgeStatus: 'success',
        relevantKnowledge: ['Closer Look section on infrastructure dependencies.'],
        sources: [{ document: 'Infra Resilience Planning Framework', page: 15 }],
      }
    )
    assert.equal(seed.length, 2)
    assert.equal(seed[0].role, 'assistant')
    assert.equal(seed[1].role, 'assistant')
    assert.match(seed[0].text, /^Observed evidence/)
    assert.match(seed[1].text, /^Knowledge/)
    assert.match(seed[1].text, /Closer Look section/)
    assert.match(seed[1].text, /Infra Resilience Planning Framework/)
    assert.match(seed[1].text, /not observed detection/)
  })

  it('does not invent retrieved knowledge when unavailable', () => {
    const text = buildKnowledgeOpener({ retrieved: false, knowledgeStatus: 'unavailable' })
    assert.match(text, /Knowledge retrieval unavailable/)
    assert.ok(!text.includes('Attack pattern'))
  })

  it('keeps user follow-up turns when knowledge seed arrives later', () => {
    const evidenceOnly = investigateChatSeedMessages(['tgnn_embed'], { retrieved: false })
    const withUser = [
      ...evidenceOnly,
      { role: 'user', text: 'What evidence triggered the anomaly?' },
      { role: 'assistant', text: 'Observed metric deviations.' },
    ]
    const withKnowledge = investigateChatSeedMessages(['tgnn_embed'], {
      retrieved: true,
      knowledgeStatus: 'success',
      relevantKnowledge: ['Pattern guidance.'],
    })
    const merged = mergeInvestigateChatSeed(withUser, withKnowledge)
    assert.equal(merged[0].text, withKnowledge[0].text)
    assert.match(merged[1].text, /Pattern guidance/)
    assert.equal(merged[2].role, 'user')
    assert.equal(merged[3].text, 'Observed metric deviations.')
  })
})

describe('commander follow-up ask body + conversation', () => {
  it('suggested question sends the correct incident context', () => {
    const hint = FOLLOW_UP_SUGGESTIONS[0]
    assert.equal(hint, 'What evidence triggered the anomaly?')
    assert.deepEqual(
      buildFollowUpAskBody({ question: hint, incidentId: 'inc-pay-1' }),
      { question: hint, incidentId: 'inc-pay-1' }
    )
    assert.ok(!('actionId' in buildFollowUpAskBody({ question: hint, incidentId: 'inc-pay-1' })))
  })

  it('custom question works', () => {
    const body = buildFollowUpAskBody({
      question: '  What does this pattern mean for OT?  ',
      incidentId: 'inc-pay-1',
    })
    assert.equal(body.question, 'What does this pattern mean for OT?')
    assert.equal(body.incidentId, 'inc-pay-1')
  })

  it('answer uses current incident context', () => {
    const ctx = payContext()
    const r = answerCommanderQuestion('What evidence triggered the anomaly?', {
      incidentContext: ctx,
    })
    assert.equal(r.insufficient, false)
    assert.match(r.answer, /packetsPerSecond/)
    assert.match(r.answer, /Payment processing gateway/)

    const banking = answerCommanderQuestion('Why is Core Banking at risk?', {
      incidentContext: ctx,
    })
    assert.equal(banking.insufficient, false)
    assert.match(banking.answer, /Core Banking/)
    assert.match(banking.answer, /propagat/i)

    const facts = liveFactsFromContext(ctx)
    assert.equal(facts.incidentId, 'inc-pay-1')
    assert.ok(facts.evidence.some((e) => /packetsPerSecond/.test(e)))
    assert.deepEqual(facts.primaryPathLabels, [
      'Payment processing gateway',
      'Core Banking',
    ])
    assert.equal(facts.financialExposure?.exposureLabel, '₹12.4L')
    assert.equal(facts.responseClassification, 'investigate_contain')
  })

  it('switching incidents clears previous conversation', () => {
    const prior = appendFollowUpTurn([], {
      question: 'What evidence triggered the anomaly?',
      answer: 'Observed on Payment…',
    })
    assert.equal(prior.length, 2)
    const cleared = followUpMessagesForIncident('inc-1', 'inc-2', prior)
    assert.deepEqual(cleared, [])
    const same = followUpMessagesForIncident('inc-1', 'inc-1', prior)
    assert.equal(same.length, 2)
  })

  it('No response action/actionId can be generated or executed through follow-up', () => {
    const body = buildFollowUpAskBody({
      question: FOLLOW_UP_SUGGESTIONS[2],
      incidentId: 'inc-pay-1',
    })
    assert.equal(Object.keys(body).sort().join(','), 'incidentId,question')

    const r = answerCommanderQuestion(FOLLOW_UP_SUGGESTIONS[2], {
      incidentContext: payContext(),
    })
    assert.equal(followUpResponseIsInformationalOnly(r), true)
    assert.equal(r.actionId, undefined)
    assert.equal(r.availableActions, undefined)
    assert.equal(r.execute, undefined)
    assert.match(r.answer, /does not execute|advisory|propagated|confirmed anomaly/i)

    assert.equal(
      followUpResponseIsInformationalOnly({
        answer: 'ok',
        actionId: 'isolate-node',
      }),
      false
    )
    assert.equal(
      followUpResponseIsInformationalOnly({
        answer: 'ok',
        availableActions: ['isolate'],
      }),
      false
    )
  })
})

describe('commander follow-up answer readability', () => {
  it('renders natural paragraphs; bullets only for real multi-item lists', () => {
    const prose = formatFollowUpAnswerBlocks(
      [
        'The payment gateway is flagged on residual detection.',
        'From knowledge-base guidance, rate floods are often used for resource exhaustion — that is guidance, not live proof.',
      ].join('\n\n')
    )
    assert.ok(prose.every((b) => b.type === 'p'))
    assert.equal(prose.length, 2)

    const withList = formatFollowUpAnswerBlocks(
      [
        'The anomaly was triggered by observed metric deviations.',
        [
          '• packetsPerSecond: observed 9000, expected 400 (2150% deviation)',
          '• httpRequestsPerMin: observed 1200, expected 80',
        ].join('\n'),
        'That’s an assessment from residual detection — not a confirmed attack attribution.',
      ].join('\n\n')
    )
    assert.ok(withList.some((b) => b.type === 'p' && /anomaly was triggered/i.test(b.text)))
    assert.ok(withList.some((b) => b.type === 'ul' && b.items.some((i) => /packetsPerSecond/.test(i))))
    assert.ok(withList.some((b) => b.type === 'p' && /not a confirmed attack/i.test(b.text)))
  })

  it('highlights important numbers and money in inline parts', () => {
    const parts = splitFollowUpInlineParts('SIMULATED EXPOSURE ₹12.4L with 2150% deviation')
    const highlighted = parts.filter((p) => p.highlight).map((p) => p.text)
    assert.ok(highlighted.some((t) => /₹12\.4L/.test(t)))
    assert.ok(highlighted.some((t) => /2150%/.test(t)))
  })

  it('keeps suggested-question answers concise and conversational', () => {
    const ctx = payContext()
    for (const q of FOLLOW_UP_SUGGESTIONS) {
      const r = answerCommanderQuestion(q, { incidentContext: ctx })
      assert.equal(r.insufficient, false)
      const blocks = formatFollowUpAnswerBlocks(r.answer)
      assert.ok(blocks.length >= 2 && blocks.length <= 6)
      assert.ok(blocks.some((b) => b.type === 'p'))
      // Single-evidence answers stay paragraph-first; multi-item lists may use bullets.
      assert.ok(!r.answer.includes('Evidence:'))
      assert.ok(!r.answer.includes('Knowledge:'))
    }
  })
})
