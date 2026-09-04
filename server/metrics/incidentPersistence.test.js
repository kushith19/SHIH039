/**
 * Durable incident history — survives match start, Clear Attacks, and teardown.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { abortAndClearAttacks } from '../campaign/engine.js'
import {
  ACTIVITY_RANGES,
  buildAttackActivitySeries,
  buildOverviewDashboardMetrics,
  buildOverviewKpis,
  mergeIncidentCorpus,
} from '../../src/features/dashboard/overviewDashboardMetrics.js'
import { resetMetricsDbForTests, deleteRoomMetrics } from './store.js'
import {
  beginMatchSession,
  listIncidentHistory,
  persistDetectionIncidents,
} from './incidents.js'

function room(id = 'PERSIST') {
  return {
    id,
    currentMatchId: null,
    matchStartedAtMs: null,
    nodes: [
      {
        id: 'pay',
        data: {
          label: 'Payment Processing System',
          type: 'payment_processing_system',
          sector: 'Finance',
        },
      },
    ],
    edges: [],
  }
}

function detection(overrides = {}) {
  return {
    anomalyNodeIds: ['pay'],
    peerExposedNodeIds: [],
    propagatedNodeIds: [],
    atRiskNodeIds: ['pay'],
    incidents: [
      {
        id: 'inc-pay',
        endpointId: 'pay',
        endpointLabel: 'Payment Processing System',
        sector: 'Finance',
        severity: 'critical',
        detectionType: 'behavioural_anomaly',
        anomalyScore: 0.9,
        trustScore: 40,
        status: 'open',
        evidence: [{ code: 'tgnn_embed', detail: 'residual' }],
        ...overrides.incident,
      },
    ],
    ...overrides,
  }
}

test('incidents survive new match, clear attacks, and room teardown', async () => {
  resetMetricsDbForTests()
  const r = room('SURVIVE')
  beginMatchSession(r)
  persistDetectionIncidents(r, detection())
  assert.equal(listIncidentHistory('SURVIVE').length, 1)

  await new Promise((res) => setTimeout(res, 2))
  persistDetectionIncidents(r, { ...detection(), incidents: [], anomalyNodeIds: [] })
  assert.equal(listIncidentHistory('SURVIVE')[0].status, 'cleared')

  beginMatchSession(r)
  assert.equal(listIncidentHistory('SURVIVE').length, 1, 'new match must not delete history')

  persistDetectionIncidents(r, detection())
  assert.equal(listIncidentHistory('SURVIVE').length, 2)

  abortAndClearAttacks(r)
  assert.equal(listIncidentHistory('SURVIVE').length, 2, 'Clear Attacks must not delete history')

  deleteRoomMetrics('SURVIVE')
  assert.equal(listIncidentHistory('SURVIVE').length, 2, 'teardown must not delete history')
})

test('Overview KPIs use durable history; active stays live-only', () => {
  resetMetricsDbForTests()
  const r = room('OV')
  const t0 = Date.now() - 2 * 24 * 60 * 60 * 1000
  beginMatchSession(r, t0)
  persistDetectionIncidents(r, detection())
  // Force older timestamp for window tests
  const hist = listIncidentHistory('OV')
  assert.equal(hist.length, 1)

  beginMatchSession(r)
  persistDetectionIncidents(r, detection())
  const history = listIncidentHistory('OV')
  assert.equal(history.length, 2)

  const open = history.find((h) => h.status === 'open') || history[history.length - 1]
  const live = [
    {
      id: 'inc-pay',
      persistentId: open.incidentId,
      endpointId: 'pay',
      endpointLabel: 'Payment Processing System',
      severity: 'critical',
      detectionType: 'behavioural_anomaly',
      status: 'open',
      detectedAtMs: Date.now(),
    },
  ]

  const corpus = mergeIncidentCorpus({ live, history, nodes: r.nodes })
  assert.equal(corpus.length, 2, 'must not double-count live+history for same episode')

  // Live id matches newest open — merge by liveIncidentId keeps 2 episodes
  const model = buildOverviewDashboardMetrics({
    live,
    history,
    nodes: r.nodes,
    detection: { anomalyNodeIds: ['pay'], atRiskNodeIds: [] },
    activityRangeId: 'month',
    nowMs: Date.now(),
  })
  assert.equal(model.kpis.totalAttacks, 2)
  assert.equal(model.kpis.activeIncidents, 1)
  assert.equal(model.kpis.devicesAtRisk, 1)
  assert.ok(model.kpis.resolved >= 0)

  const week = buildAttackActivitySeries(corpus, {
    rangeId: 'week',
    nowMs: Date.now(),
  })
  assert.equal(week.total, 2)
  assert.equal(ACTIVITY_RANGES.today.windowMs, 24 * 60 * 60 * 1000)
})

test('Overview taxonomy/sector/resolved from history alone after clear', () => {
  resetMetricsDbForTests()
  const r = room('OV-HIST')
  r.nodes[0].data.sector = 'Healthcare'
  beginMatchSession(r)
  const det = detection()
  det.incidents[0].sector = 'Healthcare'
  det.incidents[0].detectionType = 'temporal_anomaly'
  det.incidents[0].severity = 'medium'
  persistDetectionIncidents(r, det)
  persistDetectionIncidents(r, { ...det, incidents: [], anomalyNodeIds: [], atRiskNodeIds: [] })

  const history = listIncidentHistory('OV-HIST')
  assert.equal(history.length, 1)
  assert.equal(history[0].sector, 'Healthcare')
  assert.equal(history[0].status, 'cleared')

  const model = buildOverviewDashboardMetrics({
    live: [],
    history,
    nodes: [],
    detection: { anomalyNodeIds: [], atRiskNodeIds: [] },
    activityRangeId: 'month',
    nowMs: Date.now(),
  })
  assert.equal(model.kpis.totalAttacks, 1)
  assert.equal(model.kpis.resolved, 1)
  assert.equal(model.kpis.activeIncidents, 0)
  assert.equal(model.typeDistribution.rows[0]?.id, 'temporal_anomaly')
  assert.equal(model.sectorImpact.rows[0]?.sector, 'Healthcare')
  assert.equal(model.activity.total, 1)
})

test('Today / Week / Month filter on detectedAtMs wall-clock windows', () => {
  const now = Date.parse('2026-09-05T12:00:00.000Z')
  const corpus = [
    { detectedAtMs: now - 1 * 60 * 60 * 1000, detectionType: 'behavioural_anomaly', severity: 'high' },
    { detectedAtMs: now - 3 * 24 * 60 * 60 * 1000, detectionType: 'structural_anomaly', severity: 'low' },
    { detectedAtMs: now - 20 * 24 * 60 * 60 * 1000, detectionType: 'communication_anomaly', severity: 'medium' },
  ]
  assert.equal(buildAttackActivitySeries(corpus, { rangeId: 'today', nowMs: now }).total, 1)
  assert.equal(buildAttackActivitySeries(corpus, { rangeId: 'week', nowMs: now }).total, 2)
  assert.equal(buildAttackActivitySeries(corpus, { rangeId: 'month', nowMs: now }).total, 3)

  const kpis = buildOverviewKpis({
    corpus,
    live: [{ status: 'open', severity: 'high' }],
    detection: { anomalyNodeIds: [], atRiskNodeIds: [] },
  })
  assert.equal(kpis.totalAttacks, 3)
  assert.equal(kpis.activeIncidents, 1)
})
