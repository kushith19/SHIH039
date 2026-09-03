import assert from 'node:assert/strict'
import test from 'node:test'
import {
  intelRequestIdentity,
  mergeIntelKnowledge,
  shouldApplyIntelUpdate,
} from './commanderIntelApply.js'

function intel({ incidentId, mode = 'investigate', retrieved, status = 'unavailable', sources = [] }) {
  return {
    mode,
    primary: { incidentId },
    knowledgeStatus: status,
    knowledgeContext: retrieved
      ? {
          retrieved: true,
          knowledgeStatus: status,
          relevantKnowledge: ['chunk excerpt'],
          sources,
        }
      : {
          retrieved: false,
          knowledgeStatus: 'unavailable',
          reason: 'Knowledge retrieval unavailable',
          relevantKnowledge: [],
          sources: [],
        },
  }
}

test('shouldApplyIntelUpdate only accepts the latest seq+identity', () => {
  assert.equal(
    shouldApplyIntelUpdate({
      requestSeq: 2,
      latestSeq: 2,
      identity: 'DEMO::inc-1::investigate',
      latestIdentity: 'DEMO::inc-1::investigate',
    }),
    true
  )
  assert.equal(
    shouldApplyIntelUpdate({
      requestSeq: 1,
      latestSeq: 2,
      identity: 'DEMO::inc-1::investigate',
      latestIdentity: 'DEMO::inc-1::investigate',
    }),
    false
  )
  assert.equal(
    shouldApplyIntelUpdate({
      requestSeq: 2,
      latestSeq: 2,
      identity: 'DEMO::inc-1::investigate',
      latestIdentity: 'DEMO::inc-2::investigate',
    }),
    false
  )
})

test('retrieved:false then retrieved:true replaces stale unavailable', () => {
  const unavailable = intel({ incidentId: 'inc-1', retrieved: false })
  const success = intel({
    incidentId: 'inc-1',
    retrieved: true,
    status: 'success',
    sources: [{ document: 'NIST.SP.800-82r3', source: 'NIST' }],
  })
  const merged = mergeIntelKnowledge(unavailable, success)
  assert.equal(merged.knowledgeContext.retrieved, true)
  assert.equal(merged.knowledgeStatus, 'success')
  assert.equal(merged.knowledgeContext.sources.length, 1)
})

test('stale unavailable cannot overwrite newer successful RAG', () => {
  const success = intel({
    incidentId: 'inc-1',
    retrieved: true,
    status: 'success',
    sources: [{ document: 'ICS-ATTCK', source: 'MITRE' }],
  })
  const staleFail = intel({ incidentId: 'inc-1', retrieved: false })
  const merged = mergeIntelKnowledge(success, staleFail)
  assert.equal(merged.knowledgeContext.retrieved, true)
  assert.equal(merged.knowledgeContext.sources[0].document, 'ICS-ATTCK')
  assert.equal(merged.knowledgeStatus, 'success')
})

test('successful knowledge from a different incident is not preserved', () => {
  const prev = intel({
    incidentId: 'inc-old',
    retrieved: true,
    status: 'success',
    sources: [{ document: 'old-doc', source: 'NIST' }],
  })
  const next = intel({ incidentId: 'inc-new', retrieved: false })
  const merged = mergeIntelKnowledge(prev, next)
  assert.equal(merged.primary.incidentId, 'inc-new')
  assert.equal(merged.knowledgeContext.retrieved, false)
})

test('RAG failure soft-fail still yields intel without throwing', () => {
  const base = intel({ incidentId: 'inc-1', retrieved: false })
  assert.equal(base.knowledgeContext.retrieved, false)
  assert.match(base.knowledgeContext.reason, /unavailable/i)
  const identity = intelRequestIdentity({
    roomId: 'DEMO',
    incidentId: 'inc-1',
    mode: 'investigate',
  })
  assert.equal(identity, 'DEMO::inc-1::investigate')
})

test('knowledge sources survive successful merge into Commander UI state shape', () => {
  const phase1 = {
    mode: 'investigate',
    primary: { incidentId: 'inc-pay' },
    knowledgeStatus: 'unavailable',
    knowledgeContext: null,
  }
  const phase2 = intel({
    incidentId: 'inc-pay',
    retrieved: true,
    status: 'success',
    sources: [
      { document: 'NIST.SP.800-82r3', source: 'NIST', section: 'ICS' },
      { document: 'ICS ATT&CK', source: 'MITRE' },
    ],
  })
  const uiIntel = mergeIntelKnowledge(phase1, phase2)
  assert.equal(uiIntel.knowledgeContext.retrieved, true)
  assert.equal(uiIntel.knowledgeStatus, 'success')
  assert.ok(uiIntel.knowledgeContext.sources.length >= 1)
  // Mirrors KnowledgeSection render gate
  assert.equal(uiIntel.knowledgeContext.retrieved === true, true)
})
