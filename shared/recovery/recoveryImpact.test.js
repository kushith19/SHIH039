import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CRITICALITY_WEIGHT,
  RECOVERY_IMPACT_WEIGHTS,
  attachRecoveryImpact,
  calculateRecoveryImpact,
  criticalityWeight,
  directedDownstreamReachable,
} from './recoveryImpact.js'
import { compareByRecoveryPriority, rankIncidentsByRecoveryPriority } from './priorityRank.js'

function node(id, criticality = 'medium', extra = {}) {
  return {
    id,
    data: {
      label: id.toUpperCase(),
      criticality,
      runtimeState: { quarantined: false, ...(extra.runtimeState ?? {}) },
      ...extra.data,
    },
  }
}

function inc(id, endpointId, extra = {}) {
  return {
    id,
    endpointId,
    endpointLabel: endpointId.toUpperCase(),
    status: 'open',
    severity: 'medium',
    anomalyScore: 0.6,
    criticality: 'medium',
    peerExposedNodeIds: [],
    propagatedNodeIds: [],
    correlation: { groupId: null, relatedLiveIds: [], reasons: [] },
    ...extra,
  }
}

const edgesABC = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
]

test('directedDownstreamReachable follows provider→dependent and handles cycles', () => {
  const depths = directedDownstreamReachable(edgesABC, 'a')
  assert.equal(depths.get('b'), 1)
  assert.equal(depths.get('c'), 2)
  assert.equal(depths.has('a'), false)

  const cycle = directedDownstreamReachable(
    [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ],
    'a'
  )
  assert.equal(cycle.get('b'), 1)
  assert.equal(cycle.size, 1)
})

test('TEST 1: only A open — relief only if B/C in A exposure context', () => {
  const nodes = [node('a', 'high'), node('b', 'medium'), node('c', 'critical')]
  const withoutExposure = calculateRecoveryImpact({
    incident: inc('inc-a', 'a', { criticality: 'high' }),
    incidents: [inc('inc-a', 'a')],
    nodes,
    edges: edgesABC,
    overrides: {},
  })
  assert.deepEqual(withoutExposure.certainNodeIds, ['a'])
  assert.deepEqual(withoutExposure.reliefCandidateIds, [])

  const withExposure = calculateRecoveryImpact({
    incident: inc('inc-a', 'a', {
      criticality: 'high',
      peerExposedNodeIds: ['b'],
      propagatedNodeIds: ['c'],
    }),
    incidents: [inc('inc-a', 'a')],
    nodes,
    edges: edgesABC,
    overrides: {},
  })
  assert.deepEqual(withExposure.certainNodeIds, ['a'])
  assert.deepEqual(withExposure.reliefCandidateIds, ['b', 'c'])
  assert.ok(withExposure.score > withoutExposure.score)
})

test('TEST 2: A and C open — C excluded as independent for A', () => {
  const nodes = [node('a'), node('b'), node('c', 'critical')]
  const incidents = [
    inc('inc-a', 'a', { peerExposedNodeIds: ['b'], propagatedNodeIds: ['c'] }),
    inc('inc-c', 'c'),
  ]
  const impact = calculateRecoveryImpact({
    incident: incidents[0],
    incidents,
    nodes,
    edges: edgesABC,
    overrides: {},
  })
  assert.deepEqual(impact.certainNodeIds, ['a'])
  assert.ok(impact.reliefCandidateIds.includes('b'))
  assert.ok(!impact.reliefCandidateIds.includes('c'))
  assert.ok(impact.excludedIndependentIds.includes('c'))
})

test('TEST 3: incident B — C relief only with B exposure and no independent C', () => {
  const nodes = [node('a'), node('b', 'high'), node('c', 'medium')]
  const withExposure = calculateRecoveryImpact({
    incident: inc('inc-b', 'b', { criticality: 'high', propagatedNodeIds: ['c'] }),
    incidents: [inc('inc-b', 'b')],
    nodes,
    edges: edgesABC,
    overrides: {},
  })
  assert.deepEqual(withExposure.certainNodeIds, ['b'])
  assert.deepEqual(withExposure.reliefCandidateIds, ['c'])

  const noExposure = calculateRecoveryImpact({
    incident: inc('inc-b', 'b', { criticality: 'high' }),
    incidents: [inc('inc-b', 'b')],
    nodes,
    edges: edgesABC,
    overrides: {},
  })
  assert.deepEqual(noExposure.reliefCandidateIds, [])
})

test('TEST 4: branch A→B and A→C both eligible when exposed', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'c' },
  ]
  const nodes = [node('a', 'critical'), node('b', 'high'), node('c', 'high')]
  const impact = calculateRecoveryImpact({
    incident: inc('inc-a', 'a', {
      criticality: 'critical',
      peerExposedNodeIds: ['b', 'c'],
    }),
    incidents: [inc('inc-a', 'a')],
    nodes,
    edges,
    overrides: {},
  })
  assert.deepEqual(impact.reliefCandidateIds, ['b', 'c'])
})

test('TEST 5: cycle A↔B finite traversal', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'a' },
  ]
  const impact = calculateRecoveryImpact({
    incident: inc('inc-a', 'a', { peerExposedNodeIds: ['b'] }),
    incidents: [inc('inc-a', 'a')],
    nodes: [node('a'), node('b')],
    edges,
    overrides: {},
  })
  assert.deepEqual(impact.certainNodeIds, ['a'])
  assert.deepEqual(impact.reliefCandidateIds, ['b'])
})

test('TEST 6: quarantined C not counted as relief', () => {
  const nodes = [
    node('a'),
    node('b'),
    node('c', 'critical', { runtimeState: { quarantined: true } }),
  ]
  const impact = calculateRecoveryImpact({
    incident: inc('inc-a', 'a', { propagatedNodeIds: ['b', 'c'] }),
    incidents: [inc('inc-a', 'a')],
    nodes,
    edges: edgesABC,
    overrides: {},
  })
  assert.ok(impact.reliefCandidateIds.includes('b'))
  assert.ok(!impact.reliefCandidateIds.includes('c'))
  assert.ok(impact.excludedQuarantinedIds.includes('c'))
})

test('TEST 7: B with active override excluded as independent', () => {
  const impact = calculateRecoveryImpact({
    incident: inc('inc-a', 'a', { peerExposedNodeIds: ['b'], propagatedNodeIds: ['c'] }),
    incidents: [inc('inc-a', 'a')],
    nodes: [node('a'), node('b'), node('c')],
    edges: edgesABC,
    overrides: { b: { packetsPerSecond: 99999 } },
  })
  assert.ok(!impact.reliefCandidateIds.includes('b'))
  assert.ok(impact.excludedIndependentIds.includes('b'))
  assert.ok(impact.reliefCandidateIds.includes('c'))
})

test('TEST 8: B with own open incident excluded from A relief', () => {
  const incidents = [
    inc('inc-a', 'a', { peerExposedNodeIds: ['b'], propagatedNodeIds: ['c'] }),
    inc('inc-b', 'b'),
  ]
  const impact = calculateRecoveryImpact({
    incident: incidents[0],
    incidents,
    nodes: [node('a'), node('b'), node('c')],
    edges: edgesABC,
    overrides: {},
  })
  assert.ok(!impact.reliefCandidateIds.includes('b'))
  assert.ok(impact.excludedIndependentIds.includes('b'))
})

test('TEST 9: equal severity — more critical downstream relief ranks higher', () => {
  const nodes = [
    node('x', 'medium'),
    node('y', 'low'),
    node('p', 'medium'),
    node('q', 'critical'),
    node('r', 'critical'),
  ]
  const edges = [
    { source: 'x', target: 'y' },
    { source: 'p', target: 'q' },
    { source: 'p', target: 'r' },
  ]
  const lowRelief = {
    ...inc('inc-x', 'x', {
      severity: 'high',
      criticality: 'medium',
      peerExposedNodeIds: ['y'],
    }),
  }
  const highRelief = {
    ...inc('inc-p', 'p', {
      severity: 'high',
      criticality: 'medium',
      peerExposedNodeIds: ['q', 'r'],
    }),
  }
  const a = calculateRecoveryImpact({
    incident: lowRelief,
    incidents: [lowRelief],
    nodes,
    edges,
    overrides: {},
  })
  const b = calculateRecoveryImpact({
    incident: highRelief,
    incidents: [highRelief],
    nodes,
    edges,
    overrides: {},
  })
  assert.equal(lowRelief.severity, highRelief.severity)
  assert.ok(b.score > a.score, `expected ${b.score} > ${a.score}`)
  lowRelief.recoveryPriority = a.score
  highRelief.recoveryPriority = b.score
  const ranked = rankIncidentsByRecoveryPriority([lowRelief, highRelief])
  assert.equal(ranked[0].id, 'inc-p')
})

test('TEST 10: recovery impact can beat higher severity isolated incident', () => {
  const nodes = [
    node('iso', 'medium'),
    node('hub', 'medium'),
    node('c1', 'critical'),
    node('c2', 'critical'),
    node('c3', 'critical'),
  ]
  const edges = [
    { source: 'hub', target: 'c1' },
    { source: 'hub', target: 'c2' },
    { source: 'hub', target: 'c3' },
  ]
  const isolated = inc('inc-iso', 'iso', {
    severity: 'critical',
    anomalyScore: 0.95,
    criticality: 'medium',
  })
  const hub = inc('inc-hub', 'hub', {
    severity: 'medium',
    anomalyScore: 0.55,
    criticality: 'medium',
    peerExposedNodeIds: ['c1', 'c2', 'c3'],
  })
  const isoImpact = calculateRecoveryImpact({
    incident: isolated,
    incidents: [isolated],
    nodes,
    edges,
    overrides: {},
  })
  const hubImpact = calculateRecoveryImpact({
    incident: hub,
    incidents: [hub],
    nodes,
    edges,
    overrides: {},
  })
  assert.ok(
    hubImpact.score > isoImpact.score,
    `hub ${hubImpact.score} should beat isolated critical ${isoImpact.score}`
  )
  isolated.recoveryPriority = isoImpact.score
  hub.recoveryPriority = hubImpact.score
  assert.equal(rankIncidentsByRecoveryPriority([isolated, hub])[0].id, 'inc-hub')
})

test('TEST 11: no downstream exposure still yields non-zero certain priority', () => {
  const impact = calculateRecoveryImpact({
    incident: inc('inc-a', 'a', { severity: 'low', criticality: 'low' }),
    incidents: [inc('inc-a', 'a')],
    nodes: [node('a', 'low')],
    edges: edgesABC,
    overrides: {},
  })
  assert.deepEqual(impact.reliefCandidateIds, [])
  assert.ok(impact.score > 0)
  assert.equal(impact.score, RECOVERY_IMPACT_WEIGHTS.certain * CRITICALITY_WEIGHT.low)
})

test('TEST 12: correlation membership is small contextual signal only', () => {
  const nodes = [node('a'), node('b'), node('c')]
  const incidents = [
    inc('inc-a', 'a', {
      peerExposedNodeIds: ['b'],
      propagatedNodeIds: ['c'],
      correlation: { groupId: 'corr-live-x', relatedLiveIds: ['inc-c'], reasons: [] },
    }),
    inc('inc-c', 'c', {
      correlation: { groupId: 'corr-live-x', relatedLiveIds: ['inc-a'], reasons: [] },
    }),
  ]
  const impact = calculateRecoveryImpact({
    incident: incidents[0],
    incidents,
    nodes,
    edges: edgesABC,
    overrides: {},
  })
  assert.ok(impact.excludedIndependentIds.includes('c'))
  assert.ok(!impact.reliefCandidateIds.includes('c'))
  assert.ok(impact.relatedOpenIncidentIds.includes('inc-c'))
  assert.equal(impact.explanation.relatedMayEase.count, 1)
  // Must not claim resolve language for C
  const blob = JSON.stringify(impact.explanation).toLowerCase()
  assert.ok(!blob.includes('resolves c'))
  assert.ok(!blob.includes('will restore'))
  assert.ok(!blob.includes('attack chain'))
  assert.ok(!blob.includes('caused by'))
})

test('TEST 13: financial/illustrative signal is secondary and labeled simulated', () => {
  const base = calculateRecoveryImpact({
    incident: inc('inc-a', 'a', { criticality: 'medium' }),
    incidents: [inc('inc-a', 'a')],
    nodes: [node('a', 'medium')],
    edges: [],
    overrides: {},
  })
  const withFinance = calculateRecoveryImpact({
    incident: inc('inc-a', 'a', {
      criticality: 'medium',
      financialContext: { currentExposure: 1_000_000, simulated: true },
    }),
    incidents: [inc('inc-a', 'a')],
    nodes: [node('a', 'medium')],
    edges: [],
    overrides: {},
  })
  assert.ok(withFinance.score >= base.score)
  assert.ok(withFinance.score - base.score <= RECOVERY_IMPACT_WEIGHTS.financeCap)
  assert.equal(withFinance.explanation.financialSignal, 'simulated')
})

test('TEST 14: no mutation of overrides, quarantine, incident status, or nodes', () => {
  const overrides = Object.freeze({
    a: Object.freeze({ packetsPerSecond: 50000 }),
  })
  const nodes = Object.freeze([
    Object.freeze({
      id: 'a',
      data: Object.freeze({
        label: 'A',
        criticality: 'high',
        runtimeState: Object.freeze({ quarantined: false }),
      }),
    }),
    Object.freeze({
      id: 'b',
      data: Object.freeze({
        label: 'B',
        criticality: 'medium',
        runtimeState: Object.freeze({ quarantined: true }),
      }),
    }),
  ])
  const edges = Object.freeze([{ source: 'a', target: 'b' }])
  const incident = inc('inc-a', 'a', {
    peerExposedNodeIds: Object.freeze(['b']),
    status: 'open',
  })
  const incidents = [incident]
  const beforeOverrides = JSON.stringify(overrides)
  const beforeNodes = JSON.stringify(nodes)
  const beforeStatus = incident.status

  calculateRecoveryImpact({
    incident,
    incidents,
    nodes,
    edges,
    overrides,
  })

  assert.equal(JSON.stringify(overrides), beforeOverrides)
  assert.equal(JSON.stringify(nodes), beforeNodes)
  assert.equal(incident.status, beforeStatus)
  assert.equal(incident.recoveryImpact, undefined)
})

test('attachRecoveryImpact stamps priority and group primaryIncidentId', () => {
  const detection = {
    incidents: [
      inc('inc-a', 'a', {
        severity: 'medium',
        criticality: 'medium',
        peerExposedNodeIds: ['b', 'c'],
        correlation: { groupId: 'corr-live-1', relatedLiveIds: ['inc-iso'], reasons: [] },
      }),
      inc('inc-iso', 'iso', {
        severity: 'critical',
        criticality: 'low',
        correlation: { groupId: 'corr-live-1', relatedLiveIds: ['inc-a'], reasons: [] },
      }),
    ],
    liveCorrelation: {
      groups: [
        {
          groupId: 'corr-live-1',
          incidentIds: ['inc-a', 'inc-iso'],
          nodeIds: ['a', 'iso'],
          primaryIncidentId: null,
        },
      ],
    },
  }
  const nodes = [
    node('a', 'medium'),
    node('b', 'critical'),
    node('c', 'critical'),
    node('iso', 'low'),
  ]
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'c' },
  ]
  attachRecoveryImpact(detection, { nodes, edges, overrides: {} })
  assert.ok(Number.isFinite(detection.incidents[0].recoveryPriority))
  assert.ok(detection.incidents[0].recoveryImpact)
  assert.equal(detection.liveCorrelation.groups[0].primaryIncidentId, 'inc-a')
  // correlation / severity untouched as fields
  assert.equal(detection.incidents[0].severity, 'medium')
  assert.ok(detection.incidents[0].correlation)
})

test('compareByRecoveryPriority tie-breaks severity then anomaly then label', () => {
  const a = { recoveryPriority: 10, severity: 'high', anomalyScore: 0.5, endpointLabel: 'B' }
  const b = { recoveryPriority: 10, severity: 'critical', anomalyScore: 0.4, endpointLabel: 'A' }
  assert.ok(compareByRecoveryPriority(b, a) < 0)
  const c = { recoveryPriority: 10, severity: 'high', anomalyScore: 0.9, endpointLabel: 'Z' }
  const d = { recoveryPriority: 10, severity: 'high', anomalyScore: 0.1, endpointLabel: 'A' }
  assert.ok(compareByRecoveryPriority(c, d) < 0)
})

test('explanation avoids causal / guaranteed recovery language', () => {
  const impact = calculateRecoveryImpact({
    incident: inc('inc-a', 'a', {
      criticality: 'critical',
      peerExposedNodeIds: ['b'],
      propagatedNodeIds: ['c'],
    }),
    incidents: [inc('inc-a', 'a')],
    nodes: [node('a', 'critical'), node('b'), node('c')],
    edges: edgesABC,
    overrides: {},
  })
  const text = JSON.stringify(impact).toLowerCase()
  assert.ok(text.includes('may reduce exposure') || text.includes('potential'))
  assert.ok(!text.includes('will restore'))
  assert.ok(!text.includes('guaranteed'))
  assert.ok(!text.includes('caused by'))
  assert.ok(!text.includes('attack chain'))
  assert.ok(!text.includes('kill-chain'))
})

test('criticalityWeight uses existing taxonomy only', () => {
  assert.equal(criticalityWeight('critical'), CRITICALITY_WEIGHT.critical)
  assert.equal(criticalityWeight('unknown'), CRITICALITY_WEIGHT.medium)
})
