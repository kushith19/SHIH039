import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAttackActivitySeries,
  buildOverviewDashboardMetrics,
  buildOverviewKpis,
  buildResponseOpsFunnel,
  buildResponsePerformance,
  buildSectorImpact,
  buildSeverityDistribution,
  buildTypeDistribution,
  formatCompactDuration,
  mergeIncidentCorpus,
} from './overviewDashboardMetrics.js'

const NOW = Date.parse('2026-09-05T12:00:00.000Z')

test('mergeIncidentCorpus dedupes history vs live by liveIncidentId', () => {
  const corpus = mergeIncidentCorpus({
    history: [
      {
        incidentId: 'h1',
        liveIncidentId: 'inc-pay',
        incidentType: 'behavioural_anomaly',
        severity: 'critical',
        status: 'open',
        affectedNodeId: 'pay',
        detectedAtMs: NOW - 60_000,
        updatedAtMs: NOW - 30_000,
      },
    ],
    live: [
      {
        id: 'inc-pay',
        endpointId: 'pay',
        endpointLabel: 'Payment Gateway',
        sector: 'Finance',
        detectionType: 'behavioural_anomaly',
        severity: 'critical',
        status: 'open',
      },
    ],
    nodes: [{ id: 'pay', data: { label: 'Pay', sector: 'Finance' } }],
  })
  assert.equal(corpus.length, 1)
  assert.equal(corpus[0].endpointLabel, 'Payment Gateway')
  assert.equal(corpus[0].sector, 'Finance')
})

test('mergeIncidentCorpus prefers open episode when liveIncidentId repeats', () => {
  const corpus = mergeIncidentCorpus({
    history: [
      {
        incidentId: 'inc-pay:new',
        liveIncidentId: 'inc-pay',
        status: 'open',
        severity: 'high',
        detectedAtMs: NOW,
        affectedNodeId: 'pay',
      },
      {
        incidentId: 'inc-pay:old',
        liveIncidentId: 'inc-pay',
        status: 'cleared',
        severity: 'high',
        detectedAtMs: NOW - 60_000,
        affectedNodeId: 'pay',
      },
    ],
    live: [
      {
        id: 'inc-pay',
        status: 'open',
        severity: 'critical',
        endpointLabel: 'Live Pay',
        detectionType: 'behavioural_anomaly',
      },
    ],
  })
  assert.equal(corpus.length, 2)
  const open = corpus.find((r) => r.incidentId === 'inc-pay:new')
  assert.equal(open.status, 'open')
  assert.equal(open.severity, 'critical')
  assert.equal(open.endpointLabel, 'Live Pay')
  assert.equal(corpus.find((r) => r.incidentId === 'inc-pay:old').status, 'cleared')
})

test('mergeIncidentCorpus dedupes when live uses persistentId', () => {
  const corpus = mergeIncidentCorpus({
    history: [
      {
        incidentId: 'inc-pay:100',
        liveIncidentId: 'inc-pay',
        incidentType: 'behavioural_anomaly',
        severity: 'high',
        status: 'open',
        affectedNodeId: 'pay',
        detectedAtMs: NOW - 10_000,
      },
    ],
    live: [
      {
        id: 'inc-pay',
        persistentId: 'inc-pay:100',
        endpointId: 'pay',
        severity: 'high',
        status: 'open',
        detectionType: 'behavioural_anomaly',
      },
    ],
  })
  assert.equal(corpus.length, 1)
  assert.equal(corpus[0].incidentId, 'inc-pay:100')
})

test('KPIs derive from corpus without hardcoded totals', () => {
  const corpus = [
    { severity: 'critical', status: 'open', detectionType: 'behavioural_anomaly' },
    { severity: 'high', status: 'cleared', detectionType: 'communication_anomaly' },
    { severity: 'medium', status: 'resolved', detectionType: 'behavioural_anomaly' },
  ]
  const kpis = buildOverviewKpis({
    corpus,
    live: [{ severity: 'critical', status: 'open' }],
    detection: { atRiskNodeIds: ['a', 'b'], anomalyNodeIds: ['pay'] },
    performance: { recoveryRate: 66.7 },
    sectorImpact: { zoneCount: 2 },
  })
  assert.equal(kpis.totalAttacks, 3)
  assert.equal(kpis.activeIncidents, 1)
  assert.equal(kpis.criticalIncidents, 1)
  assert.equal(kpis.resolved, 2)
  assert.equal(kpis.devicesAtRisk, 3)
  assert.equal(kpis.responseSuccess, 66.7)
})

test('type distribution uses detection taxonomy labels', () => {
  const dist = buildTypeDistribution([
    { detectionType: 'behavioural_anomaly' },
    { detectionType: 'behavioural_anomaly' },
    { detectionType: 'structural_anomaly' },
  ])
  assert.equal(dist.total, 3)
  assert.equal(dist.rows[0].id, 'behavioural_anomaly')
  assert.equal(dist.rows[0].count, 2)
  assert.match(dist.rows[0].label, /Behavioural/i)
})

test('severity distribution covers all bands', () => {
  const sev = buildSeverityDistribution([
    { severity: 'critical' },
    { severity: 'low' },
    { severity: 'low' },
  ])
  assert.equal(sev.rows.find((r) => r.id === 'critical').count, 1)
  assert.equal(sev.rows.find((r) => r.id === 'low').count, 2)
  assert.equal(sev.rows.find((r) => r.id === 'high').count, 0)
})

test('sector impact groups by sector with critical counts', () => {
  const impact = buildSectorImpact([
    { sector: 'Energy', severity: 'critical' },
    { sector: 'Energy', severity: 'high' },
    { sector: 'Healthcare', severity: 'medium' },
  ])
  assert.equal(impact.rows[0].sector, 'Energy')
  assert.equal(impact.rows[0].incidents, 2)
  assert.equal(impact.rows[0].critical, 1)
  assert.equal(impact.zoneCount, 2)
})

test('attack activity buckets short match spans by minute', () => {
  const series = buildAttackActivitySeries(
    [
      { detectedAtMs: NOW - 5 * 60_000 },
      { detectedAtMs: NOW - 5 * 60_000 },
      { detectedAtMs: NOW - 2 * 60_000 },
    ],
    { rangeId: 'today', nowMs: NOW }
  )
  assert.equal(series.mode, 'minute')
  assert.equal(series.total, 3)
  assert.equal(series.peak, 2)
  assert.match(series.peakLabel, /Peak activity: 2/)
})

test('response performance uses cleared timestamps for avg recovery', () => {
  const perf = buildResponsePerformance([
    {
      status: 'cleared',
      detectedAtMs: NOW - 120_000,
      updatedAtMs: NOW - 60_000,
    },
    { status: 'open', detectedAtMs: NOW - 10_000, updatedAtMs: 0 },
  ])
  assert.equal(perf.resolved, 1)
  assert.equal(perf.active, 1)
  assert.equal(perf.avgRecoveryMs, 60_000)
  assert.equal(formatCompactDuration(60_000), '1m')
  assert.equal(perf.mttdAvailable, false)
})

test('response ops funnel counts unique workflow stages', () => {
  const funnel = buildResponseOpsFunnel({
    corpus: [{ key: 'a' }, { key: 'b' }],
    orchestration: {
      workflowStatus: 'EXECUTING',
      currentIncidentId: 'inc-1',
      completedIncidentIds: ['inc-0'],
      workflowTrace: [
        {
          kind: 'agent_loop',
          phase: 'COMMANDER_PLAN',
          primaryIncidentId: 'inc-1',
          planSource: 'llm',
        },
        {
          kind: 'status_transition',
          newStatus: 'AWAITING_APPROVAL',
          primaryIncidentId: 'inc-1',
        },
        {
          kind: 'agent_loop',
          phase: 'HUMAN_APPROVED',
          primaryIncidentId: 'inc-1',
        },
        {
          kind: 'agent_loop',
          phase: 'RESPONSE_EXECUTING',
          primaryIncidentId: 'inc-1',
        },
        {
          kind: 'agent_loop',
          phase: 'EPISODE_RECOVERED',
          primaryIncidentId: 'inc-0',
        },
      ],
    },
  })
  const byId = Object.fromEntries(funnel.stages.map((s) => [s.id, s.count]))
  assert.equal(byId.detected, 2)
  assert.ok(byId.planned >= 1)
  assert.ok(byId.approved >= 1)
  assert.ok(byId.responded >= 1)
  assert.ok(byId.recovered >= 1)
})

test('buildOverviewDashboardMetrics returns presentation bundle', () => {
  const model = buildOverviewDashboardMetrics({
    live: [
      {
        id: 'inc-1',
        endpointId: 'grid',
        endpointLabel: 'Power Grid',
        sector: 'Energy',
        detectionType: 'behavioural_anomaly',
        severity: 'critical',
        status: 'open',
        timestamp: new Date(NOW - 15_000).toISOString(),
      },
    ],
    history: [],
    nodes: [{ id: 'grid', data: { label: 'Power Grid', sector: 'Energy' } }],
    detection: { anomalyNodeIds: ['grid'], atRiskNodeIds: ['sub'] },
    orchestration: null,
    activityRangeId: 'today',
    nowMs: NOW,
  })
  assert.equal(model.kpis.totalAttacks, 1)
  assert.equal(model.kpis.activeIncidents, 1)
  assert.equal(model.liveThreat.active, true)
  assert.equal(model.sectorImpact.rows[0].sector, 'Energy')
  assert.equal(model.recent.length, 1)
})
