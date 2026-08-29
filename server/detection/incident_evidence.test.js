import assert from 'node:assert/strict'
import test from 'node:test'
import { formatEvidenceItem } from '../../shared/incidents.js'
import { emptyLookback } from './types.js'
import { promoteIncidents } from './incident.js'

function tel(pps, http = 10, files = 1, logins = 1) {
  return {
    packetsPerSecond: pps,
    httpRequestsPerMin: http,
    filesDownloaded: files,
    failedLoginsPerMin: logins,
  }
}

function ep(id, extra = {}) {
  const baseline = extra.baselineTelemetry ?? tel(100)
  return {
    id,
    type: 'gateway',
    label: id,
    sector: extra.sector ?? 'water',
    criticality: extra.criticality ?? 'critical',
    telemetry: extra.telemetry ?? baseline,
    baselineTelemetry: baseline,
    expectedTelemetry: extra.expectedTelemetry ?? baseline,
    runtimeState: {
      quarantined: false,
      provenance: 'legitimate',
      matchLocked: false,
    },
    behaviour: { attackOverrideActive: false, intrinsicTrust: 70 },
    activeContexts: {
      phase: 'playing',
      matchActive: false,
      overrideActive: false,
      cityContext: 'normal_day',
    },
    lookback: extra.lookback ?? emptyLookback(),
    neighborLookback: extra.neighborLookback ?? [],
    ...extra,
    telemetry: extra.telemetry ?? baseline,
    expectedTelemetry: extra.expectedTelemetry ?? baseline,
  }
}

function dep(id, source, target, pps, expected) {
  return {
    id,
    source,
    target,
    packetsPerSecond: pps,
    baselinePacketsPerSecond: expected,
    expectedPacketsPerSecond: expected,
  }
}

test('formatEvidenceItem compact labels', () => {
  assert.equal(
    formatEvidenceItem({
      code: 'metric_deviation',
      metric: 'packetsPerSecond',
      deviationPct: 63,
    }),
    'packetsPerSecond deviation: +63%'
  )
  assert.equal(
    formatEvidenceItem({ code: 'peer_trust_decrease', previous: 82, current: 54 }),
    'peer trust decreased: 82 → 54'
  )
  assert.equal(
    formatEvidenceItem({ code: 'neighbor_set_change', neighborDelta: 3, windowSeconds: 8 }),
    '3 neighbouring nodes changed within 8 seconds'
  )
  assert.equal(
    formatEvidenceItem({ code: 'critical_infrastructure', criticality: 'critical' }),
    'endpoint is critical infrastructure'
  )
})

test('promoteIncidents attaches numeric Level-1 evidence', () => {
  const input = {
    roomId: 'TEST',
    timestamp: '2026-08-29T00:00:00.000Z',
    tsMs: Date.parse('2026-08-29T00:00:00.000Z'),
    simulationTick: 10,
    cityContext: 'normal_day',
    simHour: 10,
    matchActive: false,
    endpoints: [
      ep('node-a', {
        telemetry: tel(163, 10, 1, 1),
        neighborLookback: [
          { tick: 2, tsMs: 0, neighborIds: ['node-b'] },
        ],
      }),
      ep('node-b', {
        criticality: 'medium',
        sector: 'water',
        telemetry: tel(400, 80, 1, 1),
      }),
      ep('node-c', { criticality: 'medium', telemetry: tel(100) }),
      ep('node-d', { criticality: 'medium', telemetry: tel(100) }),
      ep('node-e', { criticality: 'medium', telemetry: tel(100) }),
    ],
    dependencies: [
      dep('e-ab', 'node-a', 'node-b', 80, 80),
      dep('e-ac', 'node-a', 'node-c', 80, 80),
      dep('e-ad', 'node-a', 'node-d', 80, 80),
      dep('e-ae', 'node-a', 'node-e', 80, 80),
    ],
  }

  const result = {
    anomalyNodeIds: ['node-a'],
    reasonsByNodeId: { 'node-a': ['telemetry_spike:packetsPerSecond'] },
    fusedScoresByNodeId: { 'node-a': 0.8 },
    isolationScoresByNodeId: { 'node-a': 0.6 },
    temporalScoresByNodeId: { 'node-a': 0.7 },
    spreadEdgeIds: [],
    atRiskEdgeIds: [],
    compromisedNodeIds: [],
    atRiskNodeIds: [],
    primarySpreadNodeId: null,
    timestamp: input.timestamp,
  }

  const incidents = promoteIncidents(result, input)
  assert.equal(incidents.length, 1)
  assert.equal(incidents[0].id, 'inc-node-a')
  const ev = incidents[0].evidence
  assert.ok(ev.length > 0)

  const metric = ev.find((e) => e.code === 'metric_deviation' && e.metric === 'packetsPerSecond')
  assert.ok(metric)
  assert.equal(metric.expected, 100)
  assert.equal(metric.observed, 163)
  assert.equal(metric.deviationPct, 63)

  const spike = ev.find((e) => e.code === 'telemetry_spike')
  assert.ok(spike)
  assert.equal(spike.deviationPct, 63)

  const trust = ev.find((e) => e.code === 'peer_trust_decrease')
  assert.ok(trust)
  assert.ok(trust.current < trust.previous)

  const neighbors = ev.find((e) => e.code === 'neighbor_set_change')
  assert.ok(neighbors)
  assert.equal(neighbors.neighborDelta, 3)
  assert.equal(neighbors.windowSeconds, 8)

  const crit = ev.find((e) => e.code === 'critical_infrastructure')
  assert.ok(crit)
  assert.equal(crit.criticality, 'critical')

  assert.equal(
    formatEvidenceItem(metric),
    'packetsPerSecond deviation: +63%'
  )
})
