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
    edges: [
      { id: 'e-gw-id', source: 'gw', target: 'id' },
    ],
    campaigns: [],
  }
}

function detectionAt(tick, extra = {}) {
  return {
    simulationTick: tick,
    anomalyNodeIds: extra.anomalyNodeIds ?? ['gw'],
    isolationScoresByNodeId: extra.isolationScoresByNodeId ?? { gw: 0.81 },
    riskMomentum: extra.riskMomentum,
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

test('origin then detect append; origin is not duplicated', () => {
  const room = baseRoom()
  updateAttackStory(room, detectionAt(5))
  const origin = chapterOf(room.attackStory, 'origin')
  const detect = chapterOf(room.attackStory, 'detect')
  assert.equal(origin.title, 'Observed origin')
  assert.equal(origin.clock, '10:00:05')
  assert.equal(origin.nodeLabel, 'Citizen Payment Gateway')
  assert.equal(origin.caption, 'abnormal API traffic')
  assert.equal(detect.title, 'Residual detector')
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
          detectionType: 'behavioural_anomaly',
          severity: 'high',
          anomalyScore: 0.6,
          trustScore: 50,
          evidence: [],
        },
      ],
    })
  )
  assert.equal(chapterOf(room.attackStory, 'lateral'), null)
})

test('risk mutates in place with momentum', () => {
  const room = baseRoom()
  updateAttackStory(room, detectionAt(5))
  const first = chapterOf(room.attackStory, 'risk')
  assert.ok(first)
  assert.equal(first.clock, '10:00:05')

  updateAttackStory(
    room,
    detectionAt(9, {
      primarySpreadNodeId: 'id',
      compromisedNodeIds: ['gw', 'id'],
      atRiskNodeIds: ['fin'],
      riskMomentum: {
        score: 90,
        delta: 23,
        trajectory: 'escalating',
        windowTicks: 10,
      },
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
  assert.equal(risk.impact, 'HIGH')
  assert.equal(risk.financialExposed, 1)
  assert.equal(risk.trajectory, 'escalating')
  assert.match(risk.momentum, /\+23/)
})

test('contained campaign sets story status', () => {
  const room = baseRoom()
  room.campaigns = [
    {
      id: 'cmp-1',
      campaignType: 'financial-service-disruption',
      title: 'Financial service disruption',
      status: 'contained',
      originEndpointId: 'gw',
      endpointIds: ['gw'],
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
  assert.equal(room.attackStory.title, 'Financial service disruption')
})

test('fallback story narrative is origin-only', () => {
  const text = fallbackStoryExplanation({
    origin: 'Citizen Payment Gateway',
  })
  assert.match(text, /Observed traffic anomaly at Citizen Payment Gateway/)
  assert.doesNotMatch(text, /Identity Service|Municipal Finance API|reachability|kill-chain/i)
  assert.doesNotMatch(text, /malware|MITRE|confirmed compromise|Attack begins|altered communication/i)
})

test('story titles are assessment not confirmed attack', () => {
  const room = baseRoom()
  updateAttackStory(room, detectionAt(5))
  const titles = room.attackStory.chapters.map((c) => c.title).join(' ')
  assert.doesNotMatch(titles, /Attack begins|Attack moves|confirmed/i)
})

test('storyExplainPayload describes the origin endpoint', () => {
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
  assert.equal(payload.affectedDependencies.length, 0)
})
