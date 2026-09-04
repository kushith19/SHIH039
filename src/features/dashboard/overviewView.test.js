import test from 'node:test'
import assert from 'node:assert/strict'
import {
  attackPathView,
  buildOverviewModel,
  detectionTags,
  meshPosture,
  metricEvidenceHighlight,
  RISK_PRESENTATION,
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

test('score 100 with confirmed anomalies may use active critical / plateau language', () => {
  const active = riskTrajectoryCopy(
    {
      available: true,
      score: 100,
      delta: 0,
      trajectory: 'critical',
      series: [{ tick: 1, score: 100, value: 100 }],
      windowTicks: 10,
    },
    { anomalyCount: 1, openIncidentCount: 1 }
  )
  assert.equal(active.score, 100)
  assert.equal(active.headline, 'PLATEAUED')
  assert.equal(active.presentation, RISK_PRESENTATION.ACTIVE)
  assert.match(active.narrative, /active anomalous activity/)
})

test('score 100 with no anomalies or open incidents must not claim active anomalous activity', () => {
  const residual = riskTrajectoryCopy(
    {
      available: true,
      score: 100,
      delta: 0,
      trajectory: 'critical',
      series: [{ tick: 1, score: 100, value: 100 }],
      windowTicks: 10,
    },
    { anomalyCount: 0, openIncidentCount: 0 }
  )
  assert.equal(residual.score, 100)
  assert.equal(residual.peak, 100)
  assert.equal(residual.headline, 'ELEVATED RESIDUAL')
  assert.equal(residual.presentation, RISK_PRESENTATION.RESIDUAL)
  assert.equal(residual.confirmedThreat, false)
  assert.match(residual.narrative, /Residual remains elevated after containment/)
  assert.equal(/active anomalous activity/i.test(residual.narrative), false)
  assert.notEqual(residual.headline, 'PLATEAUED')
})

test('falling residual with no confirmed anomalies uses recovery language', () => {
  const recovering = riskTrajectoryCopy(
    {
      available: true,
      score: 55,
      delta: -20,
      trajectory: 'stable',
      series: [],
      windowTicks: 10,
    },
    { anomalyCount: 0, openIncidentCount: 0 }
  )
  assert.equal(recovering.headline, 'RECOVERING')
  assert.equal(recovering.presentation, RISK_PRESENTATION.RECOVERING)
  assert.match(recovering.narrative, /recovering/)
  assert.equal(/active anomalous activity/i.test(recovering.narrative), false)
})

test('score 100 and near-zero delta with anomalies gone is post-containment residual', () => {
  const post = riskTrajectoryCopy(
    {
      available: true,
      score: 100,
      delta: 0,
      trajectory: 'critical',
      series: [
        { tick: 10, score: 100, value: 100 },
        { tick: 20, score: 100, value: 100 },
      ],
      windowTicks: 10,
    },
    { anomalyCount: 0, openIncidentCount: 0 }
  )
  assert.equal(post.presentation, RISK_PRESENTATION.RESIDUAL)
  assert.equal(post.headline, 'ELEVATED RESIDUAL')
  assert.match(post.narrative, /no confirmed anomalous activity/)
})

test('Peak remains recent-series maximum when current residual falls', () => {
  const copy = riskTrajectoryCopy(
    {
      available: true,
      score: 35,
      delta: -65,
      trajectory: 'stable',
      series: [
        { tick: 1, score: 100, value: 100 },
        { tick: 2, score: 80, value: 80 },
        { tick: 3, score: 35, value: 35 },
      ],
      windowTicks: 10,
    },
    { anomalyCount: 0, openIncidentCount: 0 }
  )
  assert.equal(copy.score, 35)
  assert.equal(copy.peak, 100)
  assert.equal(copy.presentation, RISK_PRESENTATION.RECOVERING)
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

test('buildOverviewModel residual high without anomalies is not an active-threat copy', () => {
  const model = buildOverviewModel({
    detection: {
      anomalyNodeIds: [],
      atRiskNodeIds: [],
      incidents: [],
      riskMomentum: {
        available: true,
        score: 100,
        delta: 0,
        trajectory: 'critical',
        series: [{ tick: 1, score: 100, value: 100 }],
        windowTicks: 10,
      },
    },
    nodes: [{ id: 'pay', data: { type: 'payment_processing_system', label: 'Pay' } }],
    edges: [],
    phase: 'playing',
    feedStatus: 'ok',
  })
  assert.equal(model.posture.label, 'HEALTHY')
  assert.equal(model.stats.confirmedAnomalies, 0)
  assert.equal(model.stats.activeIncidents, 0)
  assert.equal(model.risk.score, 100)
  assert.equal(model.risk.peak, 100)
  assert.equal(model.risk.headline, 'ELEVATED RESIDUAL')
  assert.equal(/active anomalous activity/i.test(model.risk.narrative), false)
})

test('buildOverviewModel attack uses current gated residual as active threat copy', () => {
  const model = buildOverviewModel({
    detection: {
      anomalyNodeIds: ['pay'],
      atRiskNodeIds: ['gw'],
      incidents: [{ endpointId: 'pay', severity: 'critical', status: 'open', anomalyScore: 0.99 }],
      riskMomentum: {
        available: true,
        score: 100,
        delta: 0,
        trajectory: 'critical',
        series: [{ tick: 1, score: 100, value: 100 }],
        windowTicks: 10,
      },
    },
    nodes: [{ id: 'pay', data: { type: 'payment_processing_system', label: 'Pay' } }],
    edges: [],
    phase: 'playing',
    feedStatus: 'ok',
  })
  assert.equal(model.stats.confirmedAnomalies, 1)
  assert.equal(model.risk.score, 100)
  assert.equal(model.risk.peak, 100)
  assert.equal(model.risk.presentation, RISK_PRESENTATION.ACTIVE)
  assert.match(model.risk.narrative, /active anomalous activity/)
})

test('buildOverviewModel after clear is current 0 with historical peak, not active-threat copy', () => {
  const model = buildOverviewModel({
    detection: {
      anomalyNodeIds: [],
      atRiskNodeIds: [],
      incidents: [],
      riskMomentum: {
        available: true,
        score: 0,
        delta: -100,
        trajectory: 'stable',
        series: [
          { tick: 1, score: 100, value: 100 },
          { tick: 2, score: 0, value: 0 },
        ],
        windowTicks: 10,
      },
    },
    nodes: [{ id: 'pay', data: { type: 'payment_processing_system', label: 'Pay' } }],
    edges: [],
    phase: 'playing',
    feedStatus: 'ok',
  })
  assert.equal(model.posture.label, 'HEALTHY')
  assert.equal(model.stats.confirmedAnomalies, 0)
  assert.equal(model.stats.activeIncidents, 0)
  assert.equal(model.risk.score, 0)
  assert.equal(model.risk.peak, 100)
  assert.equal(model.risk.presentation, RISK_PRESENTATION.RECOVERING)
  assert.equal(/active anomalous activity/i.test(model.risk.narrative), false)
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
