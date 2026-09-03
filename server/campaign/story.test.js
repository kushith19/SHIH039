import assert from 'node:assert/strict'
import test from 'node:test'
import { updateAttackStory, storyExplainPayload } from './story.js'
import { chapterOf } from '../../shared/attackStory.js'
import { fallbackStoryExplanation } from '../../shared/attackStory.js'
import { formatStoryClock } from '../../shared/cityContext.js'

function node(id, label, extra = {}) {
  return { id, data: { label, sector: extra.sector ?? '', type: extra.type ?? '' } }
}

function baseRoom() {
  return {
    id: 'DEMO',
    simulationTick: 5,
    nodes: [
      node('gw', 'Citizen Payment Gateway', { sector: 'finance', type: 'payment_gateway' }),
      node('id', 'Identity Service', { sector: 'government', type: 'identity_access' }),
      node('fin', 'Municipal Finance API', { sector: 'finance', type: 'finance_api' }),
    ],
    campaigns: [],
  }
}

function detectionAt(tick, extra = {}) {
  return {
    simulationTick: tick,
    anomalyNodeIds: extra.anomalyNodeIds ?? ['gw'],
    isolationScoresByNodeId: extra.isolationScoresByNodeId ?? { gw: 0.81 },
    compromisedNodeIds: extra.compromisedNodeIds ?? ['gw'],
    atRiskNodeIds: extra.atRiskNodeIds ?? [],
    primarySpreadNodeId: extra.primarySpreadNodeId ?? null,
    incidents: extra.incidents ?? [
      {
        id: 'inc-gw',
        endpointId: 'gw',
        endpointLabel: 'Citizen Payment Gateway',
        detectionType: 'behavioural_anomaly',
        severity: 'high',
        anomalyScore: 0.81,
        trustScore: 63,
        evidence: [{ code: 'metric_deviation', metric: 'httpRequestsPerMin', deviationPct: 40 }],
        campaignId: extra.campaignId ?? null,
      },
    ],
  }
}

test('formatStoryClock uses city hour and tick-as-seconds', () => {
  assert.equal(formatStoryClock(5), '10:00:05')
  assert.equal(formatStoryClock(65), '18:01:05')
})

test('origin then detect then lateral append; origin is not duplicated', () => {
  const room = baseRoom()
  updateAttackStory(room, detectionAt(5))
  const origin = chapterOf(room.attackStory, 'origin')
  const detect = chapterOf(room.attackStory, 'detect')
  assert.equal(origin.title, 'Attack begins')
  assert.equal(origin.clock, '10:00:05')
  assert.equal(origin.nodeLabel, 'Citizen Payment Gateway')
  assert.equal(origin.caption, 'abnormal API traffic')
  assert.equal(detect.title, 'Graph detects it')
  assert.equal(detect.detectionLabel, 'Behavioural')
  assert.equal(detect.tgnn, 0.81)
  assert.equal(detect.trust, 63)
  assert.equal(chapterOf(room.attackStory, 'lateral'), null)

  updateAttackStory(room, detectionAt(5))
  assert.equal(room.attackStory.chapters.filter((c) => c.kind === 'origin').length, 1)

  updateAttackStory(
    room,
    detectionAt(7, {
      primarySpreadNodeId: 'id',
      compromisedNodeIds: ['gw', 'id'],
      atRiskNodeIds: ['fin'],
      incidents: [
        {
          id: 'inc-gw',
          endpointId: 'gw',
          endpointLabel: 'Citizen Payment Gateway',
          detectionType: 'behavioural_anomaly',
          severity: 'high',
          anomalyScore: 0.81,
          trustScore: 63,
          evidence: [{ metric: 'httpRequestsPerMin' }],
        },
        {
          id: 'inc-id',
          endpointId: 'id',
          endpointLabel: 'Identity Service',
          detectionType: 'graph_propagation',
          severity: 'high',
          anomalyScore: 0.6,
          trustScore: 50,
          evidence: [],
        },
      ],
    })
  )
  const lateral = chapterOf(room.attackStory, 'lateral')
  assert.ok(lateral)
  assert.equal(lateral.title, 'Attack moves')
  assert.equal(lateral.clock, '10:00:07')
  assert.deepEqual(
    lateral.path.map((p) => p.label),
    ['Citizen Payment Gateway', 'Identity Service', 'Municipal Finance API']
  )
  assert.equal(room.attackStory.chapters.filter((c) => c.kind === 'lateral').length, 1)
  updateAttackStory(
    room,
    detectionAt(8, {
      primarySpreadNodeId: 'id',
      compromisedNodeIds: ['gw', 'id'],
      atRiskNodeIds: ['fin'],
    })
  )
  assert.equal(chapterOf(room.attackStory, 'lateral').clock, '10:00:07')
})

test('risk mutates in place as hops grow', () => {
  const room = baseRoom()
  updateAttackStory(room, detectionAt(5))
  const first = chapterOf(room.attackStory, 'risk')
  assert.ok(first)
  assert.equal(first.clock, '10:00:05')
  const hop1 = first.hopCount

  updateAttackStory(
    room,
    detectionAt(9, {
      primarySpreadNodeId: 'id',
      compromisedNodeIds: ['gw', 'id'],
      atRiskNodeIds: ['fin'],
      incidents: [
        {
          id: 'inc-gw',
          endpointId: 'gw',
          detectionType: 'behavioural_anomaly',
          severity: 'critical',
          anomalyScore: 0.9,
          trustScore: 40,
          evidence: [{ metric: 'httpRequestsPerMin' }],
        },
      ],
    })
  )
  const risk = chapterOf(room.attackStory, 'risk')
  assert.equal(risk.clock, '10:00:05')
  assert.ok(risk.hopCount > hop1)
  assert.equal(risk.impact, 'HIGH')
  assert.equal(risk.financialExposed, 3)
  assert.match(risk.momentum, /↑/)
})

test('contained campaign sets story status', () => {
  const room = baseRoom()
  room.campaigns = [
    {
      id: 'cmp-1',
      playbookId: 'payments_disruption',
      title: 'Payments disruption',
      status: 'contained',
      seedNodeId: 'gw',
      stages: [
        { presetId: 'api_abuse', status: 'applied', targetNodeId: 'gw' },
      ],
    },
  ]
  updateAttackStory(
    room,
    detectionAt(6, {
      campaignId: 'cmp-1',
      incidents: [
        {
          id: 'inc-gw',
          endpointId: 'gw',
          endpointLabel: 'Citizen Payment Gateway',
          detectionType: 'behavioural_anomaly',
          severity: 'medium',
          anomalyScore: 0.7,
          trustScore: 55,
          evidence: [{ metric: 'httpRequestsPerMin' }],
          campaignId: 'cmp-1',
        },
      ],
    })
  )
  assert.equal(room.attackStory.status, 'contained')
  assert.equal(room.attackStory.campaignId, 'cmp-1')
  assert.equal(room.attackStory.title, 'Payments disruption')
})

test('fallback story narrative for a 3-node path', () => {
  const text = fallbackStoryExplanation({
    origin: 'Citizen Payment Gateway',
    next: 'Identity Service',
    tail: 'Municipal Finance API',
  })
  assert.match(text, /originated at Citizen Payment Gateway/)
  assert.match(text, /Identity Service/)
  assert.match(text, /Municipal Finance API/)
  assert.doesNotMatch(text, /malware|MITRE|confirmed compromise/i)
})

test('storyExplainPayload describes the path not a single node', () => {
  const room = baseRoom()
  updateAttackStory(
    room,
    detectionAt(7, {
      primarySpreadNodeId: 'id',
      atRiskNodeIds: ['fin'],
    })
  )
  const payload = storyExplainPayload(room)
  assert.ok(payload.id.startsWith('story-'))
  assert.equal(payload._story.origin, 'Citizen Payment Gateway')
  assert.equal(payload._story.next, 'Identity Service')
  assert.ok(payload.affectedDependencies.length >= 1)
})
