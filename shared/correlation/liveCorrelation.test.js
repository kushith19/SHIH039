import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIVE_CORRELATION,
  REASON_TYPES,
  attachLiveCorrelation,
  correlateLiveIncidentPair,
  correlateLiveIncidents,
  correlatedGroupId,
  normalizeOpenIncidents,
  undirectedHopDistance,
} from './liveCorrelation.js'

const T0 = Date.parse('2026-09-04T12:00:00.000Z')

function inc(id, endpointId, extra = {}) {
  return {
    id,
    endpointId,
    status: 'open',
    timestamp: new Date(T0).toISOString(),
    detectedAtMs: T0,
    detectionType: 'structural_anomaly',
    evidence: [{ code: 'tgnn_embed', kind: 'structural_anomaly' }],
    peerExposedNodeIds: [],
    propagatedNodeIds: [],
    ...extra,
  }
}

function reasonTypes(pair) {
  return (pair.reasons ?? []).map((r) => r.type)
}

test('undirectedHopDistance handles missing and cycles without looping forever', () => {
  assert.equal(undirectedHopDistance([], 'a', 'b'), Infinity)
  assert.equal(undirectedHopDistance([{ source: 'a', target: 'b' }], 'a', 'b'), 1)
  const cycle = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'a' },
  ]
  assert.equal(undirectedHopDistance(cycle, 'a', 'b'), 1)
  assert.equal(undirectedHopDistance(cycle, 'a', 'a'), 0)
})

test('direct dependency A → B correlates', () => {
  const edges = [{ source: 'a', target: 'b' }]
  const pair = correlateLiveIncidentPair(inc('inc-a', 'a'), inc('inc-b', 'b'), edges, {
    nowMs: T0,
  })
  assert.equal(pair.linked, true)
  assert.ok(pair.score >= LIVE_CORRELATION.minPairScore)
  assert.ok(reasonTypes(pair).includes(REASON_TYPES.DIRECT_DEPENDENCY))
  assert.ok(!JSON.stringify(pair).toLowerCase().includes('caused'))
  assert.ok(!JSON.stringify(pair).toLowerCase().includes('kill-chain'))
})

test('reverse dependency B → A correlates', () => {
  const edges = [{ source: 'b', target: 'a' }]
  const pair = correlateLiveIncidentPair(inc('inc-a', 'a'), inc('inc-b', 'b'), edges, {
    nowMs: T0,
  })
  assert.equal(pair.linked, true)
  assert.ok(reasonTypes(pair).includes(REASON_TYPES.DIRECT_DEPENDENCY))
})

test('temporal + undirected proximity (2 hops) can correlate', () => {
  const edges = [
    { source: 'a', target: 'mid' },
    { source: 'mid', target: 'b' },
  ]
  const pair = correlateLiveIncidentPair(inc('inc-a', 'a'), inc('inc-b', 'b'), edges, {
    nowMs: T0,
  })
  assert.equal(pair.linked, true)
  assert.ok(reasonTypes(pair).includes(REASON_TYPES.TEMPORAL_PROXIMITY))
  assert.ok(reasonTypes(pair).includes(REASON_TYPES.GRAPH_PROXIMITY))
})

test('temporal alone does not link', () => {
  const pair = correlateLiveIncidentPair(inc('inc-a', 'a'), inc('inc-b', 'b'), [], {
    nowMs: T0,
  })
  assert.equal(pair.linked, false)
  assert.ok(reasonTypes(pair).includes(REASON_TYPES.TEMPORAL_PROXIMITY))
})

test('weak evidence similarity alone does not link', () => {
  const a = inc('inc-a', 'a', {
    detectedAtMs: T0,
    timestamp: new Date(T0).toISOString(),
  })
  const b = inc('inc-b', 'b', {
    detectedAtMs: T0 + LIVE_CORRELATION.temporalWindowMs + 60_000,
    timestamp: new Date(T0 + LIVE_CORRELATION.temporalWindowMs + 60_000).toISOString(),
    detectionType: 'structural_anomaly',
    evidence: [{ code: 'tgnn_embed' }],
  })
  const pair = correlateLiveIncidentPair(a, b, [], { nowMs: T0 })
  assert.equal(pair.linked, false)
  assert.ok(reasonTypes(pair).includes(REASON_TYPES.EVIDENCE_SIMILARITY))
  assert.ok(pair.score < LIVE_CORRELATION.minPairScore)
})

test('exposure overlap contributes and can link at threshold', () => {
  const a = inc('inc-a', 'a', {
    detectedAtMs: T0 - LIVE_CORRELATION.temporalWindowMs - 1,
    peerExposedNodeIds: ['x', 'y'],
    propagatedNodeIds: [],
  })
  const b = inc('inc-b', 'b', {
    detectedAtMs: T0,
    peerExposedNodeIds: ['y'],
    propagatedNodeIds: ['z'],
  })
  const pair = correlateLiveIncidentPair(a, b, [], { nowMs: T0 })
  assert.ok(reasonTypes(pair).includes(REASON_TYPES.EXPOSURE_OVERLAP))
  assert.equal(pair.linked, true)
})

test('shared dependency context: seed of A appears in B exposure', () => {
  const a = inc('inc-a', 'a')
  const b = inc('inc-b', 'b', { propagatedNodeIds: ['a'] })
  const pair = correlateLiveIncidentPair(a, b, [], { nowMs: T0 })
  assert.ok(reasonTypes(pair).includes(REASON_TYPES.SHARED_DEPENDENCY_CONTEXT))
  assert.equal(pair.linked, true)
})

test('A → B → C forms one group via union-find without attack-chain language', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ]
  const incidents = [inc('inc-a', 'a'), inc('inc-b', 'b'), inc('inc-c', 'c')]
  const { groups, pairs } = correlateLiveIncidents(incidents, { edges, nowMs: T0 })
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].incidentIds, ['inc-a', 'inc-b', 'inc-c'])
  assert.deepEqual(groups[0].nodeIds, ['a', 'b', 'c'])
  assert.equal(groups[0].primaryIncidentId, null)
  assert.ok(groups[0].groupId.startsWith('corr-live-'))
  assert.ok(!groups[0].groupId.startsWith('camp-h-'))
  const blob = JSON.stringify(groups)
  assert.ok(!blob.toLowerCase().includes('attack chain'))
  assert.ok(!blob.toLowerCase().includes('caused by'))
  // A–C may or may not be a direct linked pair; group still merges through B
  const ac = pairs.find(
    (p) =>
      (p.incidentAId === 'inc-a' && p.incidentBId === 'inc-c') ||
      (p.incidentAId === 'inc-c' && p.incidentBId === 'inc-a')
  )
  assert.ok(ac)
  assert.equal(
    pairs.filter((p) => p.linked).length >= 2,
    true,
    'at least A-B and B-C should link'
  )
})

test('branch A→B and A→C can correlate B and C via shared context', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'c' },
  ]
  const incidents = [
    inc('inc-a', 'a', { propagatedNodeIds: ['b', 'c'] }),
    inc('inc-b', 'b', { peerExposedNodeIds: ['a'] }),
    inc('inc-c', 'c', { peerExposedNodeIds: ['a'] }),
  ]
  const { groups } = correlateLiveIncidents(incidents, { edges, nowMs: T0 })
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].incidentIds, ['inc-a', 'inc-b', 'inc-c'])
})

test('cycle A↔B correlates without infinite traversal', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'a' },
  ]
  const { groups } = correlateLiveIncidents([inc('inc-a', 'a'), inc('inc-b', 'b')], {
    edges,
    nowMs: T0,
  })
  assert.equal(groups.length, 1)
  assert.equal(groups[0].openIncidentCount, 2)
})

test('single incident publishes no group', () => {
  const { groups } = correlateLiveIncidents([inc('inc-a', 'a')], {
    edges: [{ source: 'a', target: 'b' }],
    nowMs: T0,
  })
  assert.deepEqual(groups, [])
})

test('cleared incidents are excluded from live correlation', () => {
  const edges = [{ source: 'a', target: 'b' }]
  const { groups } = correlateLiveIncidents(
    [inc('inc-a', 'a'), { ...inc('inc-b', 'b'), status: 'cleared' }],
    { edges, nowMs: T0 }
  )
  assert.deepEqual(groups, [])
})

test('two groups merge when a bridging incident appears', () => {
  const disconnected = [
    { source: 'a', target: 'b' },
    { source: 'c', target: 'd' },
  ]
  const before = correlateLiveIncidents(
    [inc('inc-a', 'a'), inc('inc-b', 'b'), inc('inc-c', 'c'), inc('inc-d', 'd')],
    { edges: disconnected, nowMs: T0 }
  )
  assert.equal(before.groups.length, 2)

  // Bridge topology + new open incident E connects the two components.
  const bridged = [
    ...disconnected,
    { source: 'b', target: 'e' },
    { source: 'e', target: 'c' },
  ]
  const after = correlateLiveIncidents(
    [
      inc('inc-a', 'a'),
      inc('inc-b', 'b'),
      inc('inc-c', 'c'),
      inc('inc-d', 'd'),
      inc('inc-e', 'e'),
    ],
    { edges: bridged, nowMs: T0 }
  )
  assert.equal(after.groups.length, 1)
  assert.deepEqual(after.groups[0].incidentIds, [
    'inc-a',
    'inc-b',
    'inc-c',
    'inc-d',
    'inc-e',
  ])
})

test('same endpoint duplicate collapses to one correlation member', () => {
  const open = normalizeOpenIncidents([
    inc('inc-a', 'a'),
    { ...inc('inc-a', 'a'), timestamp: new Date(T0 + 1000).toISOString() },
  ])
  assert.equal(open.length, 1)
  const { groups } = correlateLiveIncidents(
    [inc('inc-a', 'a'), { ...inc('inc-a-dup', 'a'), id: 'inc-a-dup' }, inc('inc-b', 'b')],
    { edges: [{ source: 'a', target: 'b' }], nowMs: T0 }
  )
  assert.equal(groups.length, 1)
  assert.equal(groups[0].incidentIds.filter((id) => id.includes('a')).length, 1)
})

test('groupId is deterministic for the same membership', () => {
  const ids = ['inc-c', 'inc-a', 'inc-b']
  assert.equal(correlatedGroupId(ids), correlatedGroupId(['inc-a', 'inc-b', 'inc-c']))
  assert.notEqual(correlatedGroupId(ids), correlatedGroupId(['inc-a', 'inc-b']))
})

test('attachLiveCorrelation writes detection.liveCorrelation and per-incident correlation', () => {
  const detection = {
    incidents: [inc('inc-a', 'a'), inc('inc-b', 'b')],
  }
  attachLiveCorrelation(detection, {
    edges: [{ source: 'a', target: 'b' }],
    nowMs: T0,
  })
  assert.ok(detection.liveCorrelation)
  assert.equal(detection.liveCorrelation.groups.length, 1)
  assert.equal(detection.incidents[0].correlation.groupId, detection.liveCorrelation.groups[0].groupId)
  assert.deepEqual(detection.incidents[0].correlation.relatedLiveIds, ['inc-b'])
  // history fields untouched
  assert.equal(detection.incidents[0].campaignId, undefined)
  assert.equal(detection.incidents[0].relatedIncidents, undefined)
})

test('group dissolves when membership drops below two open incidents', () => {
  const edges = [{ source: 'a', target: 'b' }]
  const withBoth = correlateLiveIncidents([inc('inc-a', 'a'), inc('inc-b', 'b')], {
    edges,
    nowMs: T0,
  })
  assert.equal(withBoth.groups.length, 1)
  const afterClear = correlateLiveIncidents(
    [inc('inc-a', 'a'), { ...inc('inc-b', 'b'), status: 'cleared' }],
    { edges, nowMs: T0 }
  )
  assert.deepEqual(afterClear.groups, [])
})

test('historical relationship is a weak prior and does not alone force a group', () => {
  const a = inc('inc-a', 'a', {
    detectedAtMs: T0,
    relatedIncidents: [{ liveIncidentId: 'inc-b', incidentId: 'inc-b:1' }],
  })
  const b = inc('inc-b', 'b', {
    detectedAtMs: T0 + LIVE_CORRELATION.temporalWindowMs + 1,
  })
  // Far in time, no edges, no exposure — historical alone should not link
  const pair = correlateLiveIncidentPair(a, b, [], {
    nowMs: T0,
    historicalKeys: new Set(['inc-a|inc-b']),
  })
  assert.ok(reasonTypes(pair).includes(REASON_TYPES.HISTORICAL_RELATIONSHIP))
  assert.equal(pair.linked, false)
})
