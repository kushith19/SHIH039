import assert from 'node:assert/strict'
import test from 'node:test'
import {
  correlateRecognizedCampaigns,
  hopDistance,
  scoreCampaignCluster,
} from './correlator.js'
import { CAMPAIGN_CATALOG } from '../../../shared/campaignCatalog.js'

function node(id, sector, extra = {}) {
  return {
    id,
    data: {
      label: id,
      sector,
      type: extra.type ?? '',
      criticality: extra.criticality ?? 'medium',
    },
  }
}

function inc(id, tick, extra = {}) {
  return {
    id: `inc-${id}`,
    endpointId: id,
    endpointLabel: id,
    tick,
    detectionType: extra.detectionType ?? 'behavioural_anomaly',
    detectionTypes: extra.detectionTypes ?? [],
    sector: extra.sector ?? 'Finance',
    type: extra.type ?? 'payment_gateway',
    criticality: extra.criticality ?? 'high',
    trustScore: extra.trustScore ?? 50,
    severity: extra.severity ?? 'high',
    confidence: 0.8,
    anomalyScore: 0.7,
    evidence: extra.evidence ?? [{ code: 'metric_deviation', metric: 'httpRequestsPerMin' }],
  }
}

function roomWith(nodes, edges) {
  return {
    id: 'DEMO',
    simulationTick: 0,
    nodes,
    edges,
    campaigns: [],
    incidentLedger: [],
  }
}

function detectionAt(tick, incidents, extra = {}) {
  return {
    simulationTick: tick,
    incidents: incidents.map((i) => ({ ...i })),
    isolationScoresByNodeId: extra.isolationScoresByNodeId ?? { a: 0.4, b: 0.5 },
    primarySpreadNodeId: extra.primarySpreadNodeId ?? null,
    anomalyNodeIds: extra.anomalyNodeIds ?? incidents.map((i) => i.endpointId),
  }
}

test('hop distance is undirected and infinite when disconnected', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ]
  assert.equal(hopDistance(edges, 'a', 'b'), 1)
  assert.equal(hopDistance(edges, 'c', 'a'), 2)
  assert.equal(hopDistance(edges, 'a', 'z'), Infinity)
})

test('unrelated endpoints with no edge do not form a campaign', () => {
  const room = roomWith(
    [node('a', 'Finance'), node('b', 'Finance')],
    []
  )
  const detection = detectionAt(10, [
    inc('a', 10),
    inc('b', 10),
  ])
  const iso = detection.isolationScoresByNodeId
  correlateRecognizedCampaigns(room, detection)
  assert.equal((room.campaigns ?? []).filter((c) => c.status !== 'expired').length, 0)
  assert.equal(detection.incidents.every((i) => i.campaignId == null), true)
  assert.equal(detection.isolationScoresByNodeId, iso)
})

test('close in time but hops above max do not form a campaign', () => {
  const room = roomWith(
    [node('a', 'Finance'), node('b', 'Energy'), node('c', 'Water'), node('d', 'Finance')],
    [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
    ]
  )
  const detection = detectionAt(8, [inc('a', 8), inc('d', 8, { sector: 'Finance' })])
  correlateRecognizedCampaigns(room, detection)
  const live = (room.campaigns ?? []).filter((c) => c.status !== 'expired')
  assert.equal(live.length, 0)
})

test('two neighbors with required types and sectors form one campaign', () => {
  const room = roomWith(
    [node('pay', 'Finance'), node('bank', 'Finance')],
    [{ source: 'pay', target: 'bank' }]
  )
  const detection = detectionAt(6, [
    inc('pay', 6),
    inc('bank', 6),
  ])
  correlateRecognizedCampaigns(room, detection)
  const live = room.campaigns.filter((c) => c.campaignType === 'financial-service-disruption')
  assert.equal(live.length, 1)
  assert.ok(['suspected', 'correlated', 'escalating'].includes(live[0].status))
  assert.deepEqual([...live[0].incidentIds].sort(), ['inc-bank', 'inc-pay'])
  assert.equal(detection.incidents[0].campaignId, live[0].id)
  assert.equal(detection.incidents[1].campaignId, live[0].id)
  assert.ok(live[0].campaignMatchScore >= 0.72)
  assert.ok(live[0].scores.topology > 0)
})

test('path into finance matches lateral-toward-finance', () => {
  const room = roomWith(
    [
      node('gw', 'Telecommunications', { type: 'gateway' }),
      node('pay', 'Finance', { type: 'payment_gateway' }),
    ],
    [{ source: 'gw', target: 'pay' }]
  )
  const detection = detectionAt(7, [
    inc('gw', 7, { sector: 'Telecommunications', type: 'gateway', detectionType: 'behavioural_anomaly' }),
    inc('pay', 7, {
      sector: 'Finance',
      type: 'payment_gateway',
      detectionType: 'dependency_anomaly',
    }),
  ])
  correlateRecognizedCampaigns(room, detection)
  const types = room.campaigns.map((c) => c.campaignType)
  assert.ok(types.includes('lateral-toward-finance') || types.includes('financial-service-disruption'))
  const lat = room.campaigns.find((c) => c.campaignType === 'lateral-toward-finance')
  assert.ok(lat)
  assert.deepEqual(lat.propagationPath, [])
})

test('third incident updates the same campaign id', () => {
  const room = roomWith(
    [node('a', 'Finance'), node('b', 'Finance'), node('c', 'Finance')],
    [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]
  )
  correlateRecognizedCampaigns(
    room,
    detectionAt(5, [inc('a', 5), inc('b', 5)])
  )
  const first = room.campaigns.find((c) => c.campaignType === 'financial-service-disruption')
  assert.ok(first)
  const id = first.id
  correlateRecognizedCampaigns(
    room,
    detectionAt(6, [inc('a', 6), inc('b', 6), inc('c', 6)])
  )
  const again = room.campaigns.filter((c) => c.campaignType === 'financial-service-disruption')
  assert.equal(again.length, 1)
  assert.equal(again[0].id, id)
  assert.ok(again[0].endpointIds.includes('c'))
})

test('idle past the catalog window expires the campaign; a new cluster gets a new id', () => {
  const room = roomWith(
    [node('a', 'Finance'), node('b', 'Finance'), node('e', 'Finance'), node('f', 'Finance')],
    [
      { source: 'a', target: 'b' },
      { source: 'e', target: 'f' },
    ]
  )
  correlateRecognizedCampaigns(room, detectionAt(4, [inc('a', 4), inc('b', 4)]))
  const firstId = room.campaigns[0].id
  correlateRecognizedCampaigns(room, detectionAt(17, []))
  const expired = room.campaigns.find((c) => c.id === firstId)
  assert.equal(expired.status, 'expired')
  correlateRecognizedCampaigns(room, detectionAt(18, [inc('e', 18), inc('f', 18)]))
  const live = room.campaigns.filter((c) => c.status !== 'expired')
  assert.ok(live.some((c) => c.id !== firstId))
})

test('score is deterministic for a fixture graph', () => {
  const entry = CAMPAIGN_CATALOG.find((e) => e.id === 'financial-service-disruption')
  const room = roomWith(
    [node('a', 'Finance'), node('b', 'Finance')],
    [{ source: 'a', target: 'b' }]
  )
  const members = [inc('a', 3), inc('b', 4)]
  const s1 = scoreCampaignCluster(entry, members, room, {})
  const s2 = scoreCampaignCluster(entry, members, room, {})
  assert.deepEqual(s1, s2)
  assert.ok(s1.campaignMatchScore >= 0 && s1.campaignMatchScore <= 1)
})

test('correlate does not mutate isolation scores or trust fields on detection', () => {
  const room = roomWith(
    [node('a', 'Finance'), node('b', 'Finance')],
    [{ source: 'a', target: 'b' }]
  )
  const isolationScoresByNodeId = { a: 0.11, b: 0.22 }
  const detection = detectionAt(3, [inc('a', 3), inc('b', 3)], { isolationScoresByNodeId })
  detection.trustConfig = { intrinsic: 0.25, peer: 0.3 }
  correlateRecognizedCampaigns(room, detection)
  assert.equal(detection.isolationScoresByNodeId, isolationScoresByNodeId)
  assert.deepEqual(detection.isolationScoresByNodeId, { a: 0.11, b: 0.22 })
  assert.deepEqual(detection.trustConfig, { intrinsic: 0.25, peer: 0.3 })
})

test('overlapping generic catalog entries keep one best match from the residual seed', () => {
  const room = roomWith(
    [
      node('energy', 'Energy', { criticality: 'critical' }),
      node('transport', 'Transportation', { criticality: 'high' }),
      node('telecom', 'Telecommunications', { criticality: 'high' }),
      node('water', 'Water', { criticality: 'high' }),
    ],
    [
      { source: 'energy', target: 'transport' },
      { source: 'transport', target: 'telecom' },
      { source: 'telecom', target: 'water' },
    ]
  )
  const detection = detectionAt(
    20,
    [
      inc('transport', 18, {
        sector: 'Transportation',
        type: 'traffic_management',
        criticality: 'high',
        detectionType: 'communication_anomaly',
      }),
      inc('energy', 20, {
        sector: 'Energy',
        type: 'power_substation',
        criticality: 'critical',
        detectionType: 'structural_anomaly',
      }),
      inc('telecom', 20, {
        sector: 'Telecommunications',
        type: 'telecom_gateway',
        criticality: 'high',
        detectionType: 'communication_anomaly',
      }),
      inc('water', 20, {
        sector: 'Water',
        type: 'water_supply',
        criticality: 'high',
        detectionType: 'communication_anomaly',
      }),
    ],
    { anomalyNodeIds: ['energy'] }
  )
  correlateRecognizedCampaigns(room, detection)
  const live = (room.campaigns ?? []).filter((c) => c.status !== 'expired')
  assert.equal(live.length, 1)
  assert.equal(live[0].campaignType, 'cross-sector-cascade')
  assert.equal(live[0].originEndpointId, 'energy')
  assert.deepEqual(live[0].propagationPath, [])
  assert.equal(new Set(detection.incidents.map((i) => i.campaignId)).size, 1)
  assert.equal(detection.incidents[0].campaignId, live[0].id)
})
