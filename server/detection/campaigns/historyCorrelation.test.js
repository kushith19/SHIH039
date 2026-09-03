import assert from 'node:assert/strict'
import test from 'node:test'
import { resetMetricsDbForTests } from '../../metrics/store.js'
import { listIncidentHistory, persistDetectionIncidents } from '../../metrics/incidents.js'
import {
  HISTORY_CORRELATION,
  correlateIncidentCampaigns,
  correlateIncidentPair,
} from './historyCorrelation.js'

const T0 = 1_700_000_000_000

function incident(id, nodeId, extra = {}) {
  return {
    incidentId: id,
    roomId: extra.roomId ?? 'DEMO',
    affectedNodeId: nodeId,
    incidentType: extra.incidentType ?? 'behavioural_anomaly',
    severity: extra.severity ?? 'high',
    status: extra.status ?? 'open',
    detectedAtMs: extra.detectedAtMs ?? T0,
    evidence: extra.evidence ?? [{ code: 'tgnn_embed' }],
    graphContext: extra.graphContext ?? {
      peerExposedNodeIds: extra.peerExposedNodeIds ?? [],
      propagatedNodeIds: extra.propagatedNodeIds ?? [],
      propagationPaths: extra.propagationPaths ?? {},
      primaryPath: extra.primaryPath ?? [nodeId],
    },
    attackName: extra.attackName,
    presetName: extra.presetName,
  }
}

const LINE = [
  { source: 'pay', target: 'gw' },
  { source: 'gw', target: 'core' },
]

test('single incident yields no campaign', () => {
  const { campaigns, pairs } = correlateIncidentCampaigns([incident('inc-a', 'pay')], {
    roomId: 'DEMO',
    edges: LINE,
  })
  assert.equal(campaigns.length, 0)
  assert.equal(pairs.length, 0)
})

test('two temporally close but graph-unrelated incidents do not form a campaign', () => {
  const { campaigns, pairs } = correlateIncidentCampaigns(
    [incident('inc-a', 'pay'), incident('inc-b', 'water', { detectedAtMs: T0 + 1000 })],
    { roomId: 'DEMO', edges: LINE }
  )
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].temporal, true)
  assert.equal(pairs[0].graphRelated, false)
  assert.equal(pairs[0].propagationRelated, false)
  assert.equal(pairs[0].linked, false)
  assert.ok(pairs[0].score < HISTORY_CORRELATION.minPairScore || !pairs[0].graphRelated)
  assert.equal(campaigns.length, 0)
})

test('two graph-connected incidents correlate', () => {
  const { campaigns, pairs } = correlateIncidentCampaigns(
    [incident('inc-pay', 'pay'), incident('inc-gw', 'gw', { detectedAtMs: T0 + 2000 })],
    { roomId: 'DEMO', edges: LINE }
  )
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].graphRelated, true)
  assert.equal(pairs[0].temporal, true)
  assert.equal(pairs[0].linked, true)
  assert.ok(pairs[0].reasons.some((r) => /city graph/i.test(r)))
  assert.equal(campaigns.length, 1)
  assert.deepEqual(campaigns[0].incidentIds, ['inc-gw', 'inc-pay'])
  assert.deepEqual(campaigns[0].affectedNodeIds, ['gw', 'pay'])
  assert.equal(campaigns[0].roomId, 'DEMO')
  assert.match(campaigns[0].campaignId, /^camp-h-/)
  assert.equal(campaigns[0].status, 'suspected')
})

test('incidents connected through propagation correlate', () => {
  const seed = incident('inc-pay', 'pay', {
    graphContext: {
      peerExposedNodeIds: ['gw'],
      propagatedNodeIds: ['gw', 'core'],
      propagationPaths: { gw: ['pay', 'gw'], core: ['pay', 'gw', 'core'] },
      primaryPath: ['pay', 'gw', 'core'],
    },
  })
  const hop = incident('inc-core', 'core', {
    incidentType: 'dependency_anomaly',
    detectedAtMs: T0 + 1500,
    graphContext: {
      peerExposedNodeIds: [],
      propagatedNodeIds: [],
      propagationPaths: {},
      primaryPath: ['core'],
    },
  })
  const { campaigns, pairs } = correlateIncidentCampaigns([seed, hop], {
    roomId: 'DEMO',
    edges: LINE,
  })
  assert.equal(pairs[0].propagationRelated, true)
  assert.equal(pairs[0].linked, true)
  assert.equal(campaigns.length, 1)
  assert.ok(campaigns[0].correlationReasons.some((r) => /propagation/i.test(r)))
})

test('multiple related incidents form one campaign candidate', () => {
  const { campaigns } = correlateIncidentCampaigns(
    [
      incident('inc-pay', 'pay'),
      incident('inc-gw', 'gw', { detectedAtMs: T0 + 10 }),
      incident('inc-core', 'core', { detectedAtMs: T0 + 20 }),
    ],
    { roomId: 'DEMO', edges: LINE }
  )
  assert.equal(campaigns.length, 1)
  assert.deepEqual(campaigns[0].incidentIds, ['inc-core', 'inc-gw', 'inc-pay'])
  assert.deepEqual(campaigns[0].affectedNodeIds, ['core', 'gw', 'pay'])
  assert.equal(campaigns[0].firstDetectedAtMs, T0)
  assert.equal(campaigns[0].lastDetectedAtMs, T0 + 20)
})

test('unrelated clusters stay separate campaign candidates', () => {
  const edges = [...LINE, { source: 'water', target: 'pump' }]
  const { campaigns } = correlateIncidentCampaigns(
    [
      incident('inc-pay', 'pay'),
      incident('inc-gw', 'gw', { detectedAtMs: T0 + 10 }),
      incident('inc-water', 'water', { detectedAtMs: T0 + 10 }),
      incident('inc-pump', 'pump', { detectedAtMs: T0 + 20 }),
    ],
    { roomId: 'DEMO', edges }
  )
  assert.equal(campaigns.length, 2)
  const groups = campaigns.map((c) => c.affectedNodeIds.join(',')).sort()
  assert.deepEqual(groups, ['gw,pay', 'pump,water'])
})

test('attacker preset name alone cannot create a campaign', () => {
  const { campaigns } = correlateIncidentCampaigns(
    [
      incident('inc-a', 'pay', { attackName: 'ransomware-blast', presetName: 'ransomware-blast' }),
      incident('inc-b', 'water', {
        detectedAtMs: T0 + 500,
        attackName: 'ransomware-blast',
        presetName: 'ransomware-blast',
        incidentType: 'other',
        evidence: [{ code: 'unrelated' }],
      }),
    ],
    { roomId: 'DEMO', edges: LINE },
    { attackName: 'ransomware-blast', playbookId: 'ransomware-blast', scenarioName: 'ransomware-blast' }
  )
  assert.equal(campaigns.length, 0)

  const one = correlateIncidentCampaigns(
    [incident('inc-only', 'pay', { attackName: 'ddos' })],
    { roomId: 'DEMO', edges: LINE },
    { presetName: 'ddos' }
  )
  assert.equal(one.campaigns.length, 0)
})

test('results are deterministic', () => {
  const input = [
    incident('inc-core', 'core', { detectedAtMs: T0 + 20 }),
    incident('inc-pay', 'pay'),
    incident('inc-gw', 'gw', { detectedAtMs: T0 + 10 }),
  ]
  const a = correlateIncidentCampaigns(input, { roomId: 'DEMO', edges: LINE })
  const b = correlateIncidentCampaigns([...input].reverse(), { roomId: 'DEMO', edges: LINE })
  assert.deepEqual(a.campaigns, b.campaigns)
  assert.deepEqual(a.pairs, b.pairs)
  const pair = correlateIncidentPair(input[0], input[1], LINE)
  const swapped = correlateIncidentPair(input[1], input[0], LINE)
  assert.equal(pair.incidentIdA, swapped.incidentIdA)
  assert.equal(pair.score, swapped.score)
})

test('persisted history stamps a shared campaign_id on related incidents only', () => {
  resetMetricsDbForTests()
  const room = {
    id: 'DEMO',
    edges: LINE,
    nodes: [{ id: 'pay' }, { id: 'gw' }, { id: 'core' }],
  }
  persistDetectionIncidents(room, {
    incidents: [
      {
        id: 'inc-pay',
        endpointId: 'pay',
        endpointLabel: 'pay',
        severity: 'high',
        detectionType: 'behavioural_anomaly',
        anomalyScore: 0.8,
        trustScore: 40,
        evidence: [{ code: 'tgnn_embed' }],
        peerExposedNodeIds: ['gw'],
        propagatedNodeIds: ['gw', 'core'],
        propagationPaths: { gw: ['pay', 'gw'], core: ['pay', 'gw', 'core'] },
      },
      {
        id: 'inc-gw',
        endpointId: 'gw',
        endpointLabel: 'gw',
        severity: 'medium',
        detectionType: 'dependency_anomaly',
        anomalyScore: 0.4,
        trustScore: 55,
        evidence: [{ code: 'graph_propagation' }],
        peerExposedNodeIds: [],
        propagatedNodeIds: ['core'],
        propagationPaths: { core: ['gw', 'core'] },
      },
    ],
  })
  const history = listIncidentHistory('DEMO', { order: 'asc' })
  assert.equal(history.length, 2)
  assert.ok(history[0].campaignId)
  assert.equal(history[0].campaignId, history[1].campaignId)
  assert.match(history[0].campaignId, /^camp-h-/)
})
