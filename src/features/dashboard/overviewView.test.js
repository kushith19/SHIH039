import test from 'node:test'
import assert from 'node:assert/strict'
import {
  attackPathView,
  buildOverviewModel,
  detectionTags,
  meshPosture,
  metricEvidenceHighlight,
  responseLifecycle,
  riskTrajectoryCopy,
  selectPrimaryIncident,
  telemetryHealthView,
} from './overviewView.js'

test('meshPosture uses concrete counts and HEALTHY empty state', () => {
  const clear = meshPosture({})
  assert.equal(clear.label, 'HEALTHY')
  assert.equal(clear.empty, true)
  assert.match(clear.summary, /No confirmed anomalies/)

  const crit = meshPosture({
    incidents: [{ severity: 'critical', status: 'open' }],
    anomalyCount: 1,
    atRiskCount: 10,
    quarantinedCount: 2,
  })
  assert.equal(crit.label, 'CRITICAL')
  assert.match(crit.summary, /1 confirmed anomaly/)
  assert.match(crit.summary, /10 nodes at risk/)
  assert.match(crit.summary, /2 quarantined/)
})

test('selectPrimaryIncident prefers open anomaly seeds by severity', () => {
  const primary = selectPrimaryIncident(
    [
      { id: 'a', endpointId: 'road', severity: 'medium', anomalyScore: 0.9, status: 'open' },
      { id: 'b', endpointId: 'pay', severity: 'critical', anomalyScore: 0.5, status: 'open' },
      { id: 'c', endpointId: 'gw', severity: 'high', anomalyScore: 0.8, status: 'cleared' },
    ],
    ['road', 'pay']
  )
  assert.equal(primary.endpointId, 'pay')
})

test('metricEvidenceHighlight reads observed evidence only', () => {
  const hit = metricEvidenceHighlight({
    evidence: [
      {
        code: 'metric_deviation',
        metric: 'packetsPerSecond',
        observed: 117000,
        expected: 42000,
        deviationPct: 178,
      },
    ],
  })
  assert.equal(hit.observed, 117000)
  assert.equal(hit.expected, 42000)
  assert.equal(hit.deviationPct, 178)

  assert.equal(metricEvidenceHighlight({ evidence: [] }), null)
})

test('detectionTags stay in operator language', () => {
  const tags = detectionTags({
    detectionType: 'behavioural_anomaly',
    evidence: [
      { code: 'telemetry_drift:packetsPerSecond' },
      { code: 'metric_deviation', metric: 'packetsPerSecond', deviationPct: 50 },
      { code: 'tgnn_embed' },
    ],
  })
  assert.ok(tags.includes('Behavioral drift'))
  assert.ok(tags.includes('Metric spike'))
  assert.ok(tags.includes('Graph residual anomaly'))
  assert.equal(tags.some((t) => /TGNN|Isolation/i.test(t)), false)
})

test('riskTrajectoryCopy uses operator narrative not ML jargon as primary', () => {
  const rising = riskTrajectoryCopy(
    { available: true, score: 80, delta: 15, trajectory: 'escalating', series: [], windowTicks: 10 },
    { anomalyCount: 1 }
  )
  assert.match(rising.narrative, /accelerating/)
  assert.equal(rising.techHint.includes('residual'), true)

  const recovering = riskTrajectoryCopy(
    { available: true, score: 20, delta: -10, trajectory: 'stable', series: [], windowTicks: 10 },
    { anomalyCount: 0 }
  )
  assert.match(recovering.narrative, /recovering/)
})

test('attackPathView distinguishes confirmed vs exposed', () => {
  const view = attackPathView(
    {
      endpointId: 'road',
      propagationPaths: { hospital: ['road', 'traffic', 'telecom', 'hospital'] },
      propagatedNodeIds: ['traffic', 'telecom', 'hospital'],
      peerExposedNodeIds: ['traffic'],
    },
    [
      { id: 'road', data: { label: 'Road Infrastructure' } },
      { id: 'traffic', data: { label: 'Traffic Management' } },
      { id: 'telecom', data: { label: 'Telecom Gateway' } },
      { id: 'hospital', data: { label: 'Hospital Gateway' } },
    ],
    {
      anomalyNodeIds: ['road'],
      atRiskNodeIds: ['traffic', 'telecom', 'hospital'],
      propagatedNodeIds: ['traffic', 'telecom', 'hospital'],
      peerExposedNodeIds: ['traffic'],
    }
  )
  assert.equal(view.confirmedCount, 1)
  assert.equal(view.exposedCount, 3)
  assert.equal(view.hopDepth, 3)
  assert.deepEqual(view.labels[0], 'Road Infrastructure')
})

test('responseLifecycle does not claim recovery from quarantine alone while anomaly active', () => {
  const active = responseLifecycle({
    detection: { anomalyNodeIds: ['pay'] },
    nodes: [
      { id: 'pay', data: { runtimeState: { quarantined: true } } },
    ],
    incidents: [{ endpointId: 'pay', status: 'open' }],
  })
  assert.equal(active.containmentExecuted, true)
  assert.equal(active.incidentCleared, false)
  assert.equal(active.stages.find((s) => s.id === 'containment').detail, 'Executed')

  const cleared = responseLifecycle({
    detection: { anomalyNodeIds: [] },
    nodes: [
      { id: 'pay', data: { runtimeState: { quarantined: true } } },
    ],
    incidents: [{ endpointId: 'pay', status: 'cleared' }],
  })
  assert.equal(cleared.incidentCleared, true)
  assert.equal(cleared.stages.find((s) => s.id === 'recovery').state, 'done')
})

test('telemetryHealthView does not invent device counts', () => {
  const empty = telemetryHealthView({ nodes: [], rows: [], phase: 'lobby' })
  assert.equal(empty.reportingLabel, null)
  assert.equal(empty.feed, 'STANDBY')

  const live = telemetryHealthView({
    nodes: [{ id: 'a' }, { id: 'b' }],
    rows: [
      { id: 'a', catalogBaseline: false },
      { id: 'b', catalogBaseline: true },
    ],
    feedStatus: 'ok',
    phase: 'playing',
    sampleTicks: 88,
    quarantinedCount: 2,
  })
  assert.equal(live.feed, 'LIVE')
  assert.equal(live.reportingLabel, '1 / 2')
  assert.equal(live.pipeline, 'HEALTHY')
  assert.equal(live.quarantinedCount, 2)
})

test('buildOverviewModel reuses computeFinancialExposure and zero exposure is calm', () => {
  const model = buildOverviewModel({
    detection: {
      anomalyNodeIds: [],
      atRiskNodeIds: [],
      incidents: [],
      riskMomentum: { available: true, score: 5, delta: 0, trajectory: 'stable', series: [] },
    },
    nodes: [{ id: 'road', data: { type: 'road_infrastructure', label: 'Road' } }],
    edges: [],
    phase: 'playing',
    feedStatus: 'ok',
  })
  assert.equal(model.finance.exposureLabel, '₹0')
  assert.equal(model.finance.lakhs, 0)
  assert.equal(model.posture.label, 'HEALTHY')
  assert.equal(model.primaryIncident, null)
  assert.equal(model.path.active, false)
})
