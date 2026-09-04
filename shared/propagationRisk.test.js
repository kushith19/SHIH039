import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HOP_PROXIMITY_BY_DISTANCE,
  PROPAGATION_RISK_WEIGHTS,
  comparePropagationAssessments,
  graphRelationshipRisk,
  hopProximityRisk,
  rankPropagationCandidates,
  scorePropagationCandidate,
  selectPrimarySpreadAssessment,
} from './propagationRisk.js'

function metricsMap(entries) {
  return new Map(Object.entries(entries))
}

test('propagation risk weights sum to 1', () => {
  const sum = Object.values(PROPAGATION_RISK_WEIGHTS).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9)
})

test('hop proximity: closer hops score higher', () => {
  assert.equal(hopProximityRisk(1), HOP_PROXIMITY_BY_DISTANCE[1])
  assert.equal(hopProximityRisk(2), HOP_PROXIMITY_BY_DISTANCE[2])
  assert.equal(hopProximityRisk(3), HOP_PROXIMITY_BY_DISTANCE[3])
  assert.ok(hopProximityRisk(1) > hopProximityRisk(2))
  assert.ok(hopProximityRisk(2) > hopProximityRisk(3))
})

test('weighted score matches component formula', () => {
  const a = scorePropagationCandidate({
    candidateId: 'B',
    seedNodeId: 'A',
    hop: 1,
    path: ['A', 'B'],
    edges: [{ source: 'A', target: 'B' }],
    behavioralTrust: 40,
    peerTrust: 20,
    isolationScore: 0.5,
    reachableIds: ['B'],
    seedNodeIds: ['A'],
  })
  assert.equal(a.components.behavioralRisk, 60)
  assert.equal(a.components.peerRisk, 80)
  assert.equal(a.components.residualRisk, 50)
  assert.equal(a.components.hopProximityRisk, 100)
  const w = PROPAGATION_RISK_WEIGHTS
  const expected =
    w.behavioral * 60 +
    w.peer * 80 +
    w.residual * 50 +
    w.graph * a.components.graphRelationshipRisk +
    w.hop * 100
  assert.ok(Math.abs(a.score - expected) < 1e-8)
})

test('direct neighbors no longer automatically tie — riskier B wins over healthy C', () => {
  const edges = [
    { id: 'e-ab', source: 'A', target: 'B' },
    { id: 'e-ac', source: 'A', target: 'C' },
  ]
  const ranked = rankPropagationCandidates({
    edges,
    seedNodeIds: ['A'],
    validNodeIds: new Set(['A', 'B', 'C']),
    peerMetricsByNodeId: metricsMap({
      B: { behavioralComponent: 20, peerTrust: 15 },
      C: { behavioralComponent: 95, peerTrust: 90 },
    }),
    isolationScoresByNodeId: { B: 0.7, C: 0.05 },
  })
  assert.equal(ranked.primarySpreadNodeId, 'B')
  assert.ok(ranked.propagationRiskByNode.B > ranked.propagationRiskByNode.C)
})

test('farther node with much worse risk can beat a closer healthy neighbor', () => {
  const edges = [
    { id: 'e-ab', source: 'A', target: 'B' },
    { id: 'e-bc', source: 'B', target: 'C' },
  ]
  const ranked = rankPropagationCandidates({
    edges,
    seedNodeIds: ['A'],
    validNodeIds: new Set(['A', 'B', 'C']),
    peerMetricsByNodeId: metricsMap({
      B: { behavioralComponent: 98, peerTrust: 95 },
      C: { behavioralComponent: 5, peerTrust: 5 },
    }),
    isolationScoresByNodeId: { B: 0.02, C: 0.85 },
  })
  assert.equal(ranked.primarySpreadNodeId, 'C')
  assert.equal(ranked.assessmentsByNodeId.C.hop, 2)
  assert.equal(ranked.assessmentsByNodeId.B.hop, 1)
})

test('hop proximity still matters when other signals are equal', () => {
  const edges = [
    { id: 'e-ab', source: 'A', target: 'B' },
    { id: 'e-bc', source: 'B', target: 'C' },
  ]
  const equal = { behavioralComponent: 50, peerTrust: 50 }
  const ranked = rankPropagationCandidates({
    edges,
    seedNodeIds: ['A'],
    validNodeIds: new Set(['A', 'B', 'C']),
    peerMetricsByNodeId: metricsMap({ B: equal, C: equal }),
    isolationScoresByNodeId: { B: 0.4, C: 0.4 },
  })
  assert.equal(ranked.primarySpreadNodeId, 'B')
})

test('confirmed seeds are never selected as primarySpreadNodeId', () => {
  const edges = [
    { id: 'e-ab', source: 'A', target: 'B' },
    { id: 'e-ba', source: 'B', target: 'A' },
  ]
  const ranked = rankPropagationCandidates({
    edges,
    seedNodeIds: ['A', 'B'],
    validNodeIds: new Set(['A', 'B']),
    peerMetricsByNodeId: metricsMap({
      A: { behavioralComponent: 0, peerTrust: 0 },
      B: { behavioralComponent: 0, peerTrust: 0 },
    }),
    isolationScoresByNodeId: { A: 0.99, B: 0.99 },
  })
  assert.equal(ranked.primarySpreadNodeId, null)
  assert.deepEqual(ranked.propagatedNodeIds, [])
})

test('peer trust influences ranking without creating anomaly seeds', () => {
  const edges = [
    { id: 'e-ab', source: 'A', target: 'B' },
    { id: 'e-ac', source: 'A', target: 'C' },
  ]
  const ranked = rankPropagationCandidates({
    edges,
    seedNodeIds: ['A'],
    validNodeIds: new Set(['A', 'B', 'C']),
    peerMetricsByNodeId: metricsMap({
      B: { behavioralComponent: 80, peerTrust: 10 },
      C: { behavioralComponent: 80, peerTrust: 95 },
    }),
    isolationScoresByNodeId: { B: 0.2, C: 0.2 },
  })
  assert.equal(ranked.primarySpreadNodeId, 'B')
})

test('behavioral deviation influences ranking', () => {
  const edges = [
    { id: 'e-ab', source: 'A', target: 'B' },
    { id: 'e-ac', source: 'A', target: 'C' },
  ]
  const ranked = rankPropagationCandidates({
    edges,
    seedNodeIds: ['A'],
    validNodeIds: new Set(['A', 'B', 'C']),
    peerMetricsByNodeId: metricsMap({
      B: { behavioralComponent: 10, peerTrust: 70 },
      C: { behavioralComponent: 90, peerTrust: 70 },
    }),
    isolationScoresByNodeId: { B: 0.2, C: 0.2 },
  })
  assert.equal(ranked.primarySpreadNodeId, 'B')
})

test('TGNN residual influences ranking but does not invent seeds', () => {
  const low = scorePropagationCandidate({
    candidateId: 'B',
    seedNodeId: 'A',
    hop: 1,
    path: ['A', 'B'],
    edges: [{ source: 'A', target: 'B' }],
    behavioralTrust: 100,
    peerTrust: 100,
    isolationScore: 0.1,
    reachableIds: ['B'],
    seedNodeIds: ['A'],
  })
  const high = scorePropagationCandidate({
    candidateId: 'B',
    seedNodeId: 'A',
    hop: 1,
    path: ['A', 'B'],
    edges: [{ source: 'A', target: 'B' }],
    behavioralTrust: 100,
    peerTrust: 100,
    isolationScore: 0.9,
    reachableIds: ['B'],
    seedNodeIds: ['A'],
  })
  assert.ok(high.score > low.score)
  assert.equal(high.components.residualRisk, 90)
})

test('graph relationship: direct downstream stronger than multi-hop', () => {
  const direct = graphRelationshipRisk({
    hop: 1,
    path: ['A', 'B'],
    edges: [{ source: 'A', target: 'B' }],
    seedNodeId: 'A',
    candidateId: 'B',
    reachableIds: ['B'],
    seedNodeIds: ['A'],
  })
  const indirect = graphRelationshipRisk({
    hop: 2,
    path: ['A', 'X', 'B'],
    edges: [
      { source: 'A', target: 'X' },
      { source: 'X', target: 'B' },
    ],
    seedNodeId: 'A',
    candidateId: 'B',
    reachableIds: ['X', 'B'],
    seedNodeIds: ['A'],
  })
  assert.ok(direct > indirect)
})

test('multi-seed keeps strongest assessment and is deterministic', () => {
  const edges = [
    { id: 'e-ab', source: 'A', target: 'X' },
    { id: 'e-bx', source: 'B', target: 'X' },
    { id: 'e-by', source: 'B', target: 'Y' },
  ]
  const opts = {
    edges,
    seedNodeIds: ['A', 'B'],
    validNodeIds: new Set(['A', 'B', 'X', 'Y']),
    peerMetricsByNodeId: metricsMap({
      X: { behavioralComponent: 50, peerTrust: 50 },
      Y: { behavioralComponent: 40, peerTrust: 40 },
    }),
    isolationScoresByNodeId: { X: 0.3, Y: 0.35 },
  }
  const ranked = rankPropagationCandidates(opts)
  assert.deepEqual(ranked.propagatedNodeIds, ['X', 'Y'])
  assert.ok(['X', 'Y'].includes(ranked.primarySpreadNodeId))
  const again = rankPropagationCandidates({ ...opts, seedNodeIds: ['B', 'A'] })
  assert.equal(again.primarySpreadNodeId, ranked.primarySpreadNodeId)
})

test('equal scores use deterministic tie-break (nodeId)', () => {
  const a = {
    nodeId: 'Z',
    score: 50,
    hop: 1,
    components: { graphRelationshipRisk: 80, peerRisk: 40 },
  }
  const b = {
    nodeId: 'M',
    score: 50,
    hop: 1,
    components: { graphRelationshipRisk: 80, peerRisk: 40 },
  }
  assert.equal(selectPrimarySpreadAssessment([a, b]).nodeId, 'M')
  assert.ok(comparePropagationAssessments(a, b) > 0)
})

test('upstream-only edges do not create candidates', () => {
  const ranked = rankPropagationCandidates({
    edges: [{ id: 'e', source: 'B', target: 'A' }],
    seedNodeIds: ['A'],
    validNodeIds: new Set(['A', 'B']),
    peerMetricsByNodeId: metricsMap({
      B: { behavioralComponent: 0, peerTrust: 0 },
    }),
    isolationScoresByNodeId: { B: 0.99 },
  })
  assert.equal(ranked.primarySpreadNodeId, null)
  assert.deepEqual(ranked.propagatedNodeIds, [])
})
