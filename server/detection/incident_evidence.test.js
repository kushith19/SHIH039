import assert from 'node:assert/strict'
import test from 'node:test'
import { formatEvidenceItem } from '../../shared/incidents.js'
import { setYamlMetricNames } from '../../shared/telemetryKeys.js'
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
    isolationScoresByNodeId: { 'node-a': 0.6 },
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
  assert.equal(incidents[0].anomalyScore, 0.6)
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

test('finance node promotion does not crash on metricFacts object (illustrativeImpact)', () => {
  const input = {
    roomId: 'TEST',
    timestamp: '2026-08-29T00:00:00.000Z',
    tsMs: Date.parse('2026-08-29T00:00:00.000Z'),
    simulationTick: 10,
    cityContext: 'normal_day',
    simHour: 10,
    matchActive: false,
    endpoints: [
      ep('pay', {
        type: 'payment_processing_system',
        sector: 'finance',
        criticality: 'critical',
        telemetry: tel(8000, 400, 1, 1),
        expectedTelemetry: tel(420, 80, 5, 2),
      }),
    ],
    dependencies: [],
  }
  const result = {
    anomalyNodeIds: ['pay'],
    reasonsByNodeId: { pay: ['tgnn_embed'] },
    isolationScoresByNodeId: { pay: 0.9 },
    spreadEdgeIds: [],
    atRiskEdgeIds: [],
    compromisedNodeIds: [],
    atRiskNodeIds: [],
    primarySpreadNodeId: null,
    timestamp: input.timestamp,
  }
  const incidents = promoteIncidents(result, input)
  assert.equal(incidents.length, 1)
  assert.equal(incidents[0].endpointId, 'pay')
  assert.ok(incidents[0].illustrativeImpact)
  assert.equal(incidents[0].illustrativeImpact.kind, 'illustrative')
  assert.equal(typeof incidents[0].illustrativeImpact.value, 'number')
})

test('metric_deviation evidence is limited to live encoder game keys', () => {
  setYamlMetricNames(['cpu_usage', 'active_power', 'controller_response_latency'])
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
        telemetry: {
          ...tel(163, 10, 1, 1),
          cpu_usage: 90,
          active_power: 400,
          controller_response_latency: 80,
        },
        expectedTelemetry: {
          ...tel(100, 10, 1, 1),
          cpu_usage: 40,
          active_power: 200,
          controller_response_latency: 10,
        },
      }),
    ],
    dependencies: [],
  }
  const result = {
    anomalyNodeIds: ['node-a'],
    reasonsByNodeId: { 'node-a': ['telemetry_spike:packetsPerSecond'] },
    isolationScoresByNodeId: { 'node-a': 0.6 },
    spreadEdgeIds: [],
    atRiskEdgeIds: [],
    compromisedNodeIds: [],
    atRiskNodeIds: [],
    primarySpreadNodeId: null,
    timestamp: input.timestamp,
  }
  const incidents = promoteIncidents(result, input)
  const metrics = (incidents[0]?.evidence ?? [])
    .filter((e) => e.code === 'metric_deviation')
    .map((e) => e.metric)
  assert.ok(metrics.includes('packetsPerSecond'))
  assert.equal(metrics.includes('cpu_usage'), false)
  assert.equal(metrics.includes('active_power'), false)
  assert.equal(metrics.includes('controller_response_latency'), false)
  setYamlMetricNames([])
})

test('one TGNN seed promotes exactly one confirmed incident; peer and propagation stay on context', () => {
  const input = {
    roomId: 'TEST',
    timestamp: '2026-08-29T00:00:00.000Z',
    tsMs: Date.parse('2026-08-29T00:00:00.000Z'),
    simulationTick: 10,
    cityContext: 'normal_day',
    simHour: 10,
    matchActive: false,
    endpoints: [
      ep('pay', {
        type: 'payment_processing_system',
        sector: 'finance',
        label: 'Payment Processing',
        criticality: 'critical',
        telemetry: tel(8000, 400, 1, 1),
        expectedTelemetry: tel(420, 80, 5, 2),
      }),
      ep('gw', { type: 'bank_gateway', sector: 'finance', label: 'Bank Gateway' }),
      ep('core', { type: 'banking_financial', sector: 'finance', label: 'Core Banking' }),
      ep('hospital', { type: 'hospital_gateway', sector: 'healthcare', label: 'Hospital Gateway' }),
      ep('auth', { type: 'hospital_auth', sector: 'healthcare', label: 'Hospital Auth' }),
      ep('emr', { type: 'hospital_emr', sector: 'healthcare', label: 'Hospital EMR' }),
    ],
    dependencies: [
      dep('e-pay-gw', 'pay', 'gw', 80, 80),
      dep('e-gw-core', 'gw', 'core', 80, 80),
      dep('e-pay-hosp', 'pay', 'hospital', 80, 80),
      dep('e-hosp-auth', 'hospital', 'auth', 80, 80),
      dep('e-auth-emr', 'auth', 'emr', 80, 80),
    ],
  }
  const result = {
    anomalyNodeIds: ['pay'],
    peerExposedNodeIds: ['gw', 'hospital'],
    propagatedNodeIds: ['gw', 'core', 'hospital', 'auth', 'emr'],
    propagationPaths: {
      gw: ['pay', 'gw'],
      core: ['pay', 'gw', 'core'],
      hospital: ['pay', 'hospital'],
      auth: ['pay', 'hospital', 'auth'],
      emr: ['pay', 'hospital', 'auth', 'emr'],
    },
    propagationRiskByNode: { gw: 50, core: 25, hospital: 50, auth: 25, emr: 12.5 },
    primarySpreadNodeId: 'hospital',
    primarySpreadEdgeId: 'e-pay-hosp',
    reasonsByNodeId: { pay: ['tgnn_embed'] },
    isolationScoresByNodeId: { pay: 0.9 },
    timestamp: input.timestamp,
  }

  const incidents = promoteIncidents(result, input)
  assert.equal(incidents.length, 1)
  const inc = incidents[0]
  assert.equal(inc.endpointId, 'pay')
  assert.equal(inc.id, 'inc-pay')
  assert.notEqual(inc.isExposureIncident, true)
  assert.deepEqual([...inc.peerExposedNodeIds].sort(), ['gw', 'hospital'])
  assert.deepEqual(
    [...inc.propagatedNodeIds].sort(),
    ['auth', 'core', 'emr', 'gw', 'hospital']
  )
  assert.deepEqual(inc.propagationPaths.emr, ['pay', 'hospital', 'auth', 'emr'])
  assert.equal(inc.primarySpreadNodeId, 'hospital')
  assert.ok(inc.affectedDependencies.length > 0)
})

test('two independent TGNN seeds promote two confirmed incidents', () => {
  const input = {
    roomId: 'TEST',
    timestamp: '2026-08-29T00:00:00.000Z',
    tsMs: Date.parse('2026-08-29T00:00:00.000Z'),
    simulationTick: 10,
    cityContext: 'normal_day',
    simHour: 10,
    matchActive: false,
    endpoints: [
      ep('pay', { type: 'payment_processing_system', sector: 'finance', label: 'Pay' }),
      ep('road', { type: 'road_infrastructure', sector: 'transport', label: 'Road' }),
      ep('gw', { type: 'bank_gateway', sector: 'finance' }),
      ep('traffic', { type: 'traffic_management', sector: 'transport' }),
    ],
    dependencies: [
      dep('e-pay-gw', 'pay', 'gw', 80, 80),
      dep('e-road-traffic', 'road', 'traffic', 80, 80),
    ],
  }
  const result = {
    anomalyNodeIds: ['pay', 'road'],
    peerExposedNodeIds: ['gw', 'traffic'],
    propagatedNodeIds: ['gw', 'traffic'],
    propagationPaths: {
      gw: ['pay', 'gw'],
      traffic: ['road', 'traffic'],
    },
    reasonsByNodeId: { pay: ['tgnn_embed'], road: ['tgnn_embed'] },
    isolationScoresByNodeId: { pay: 0.9, road: 0.8 },
    timestamp: input.timestamp,
  }
  const incidents = promoteIncidents(result, input)
  assert.equal(incidents.length, 2)
  assert.deepEqual(incidents.map((i) => i.endpointId).sort(), ['pay', 'road'])
  assert.ok(incidents.every((i) => i.isExposureIncident !== true))
  const payInc = incidents.find((i) => i.endpointId === 'pay')
  const roadInc = incidents.find((i) => i.endpointId === 'road')
  assert.deepEqual(payInc.peerExposedNodeIds, ['gw'])
  assert.deepEqual(payInc.propagatedNodeIds, ['gw'])
  assert.deepEqual(payInc.propagationPaths.gw, ['pay', 'gw'])
  assert.deepEqual(roadInc.peerExposedNodeIds, ['traffic'])
  assert.deepEqual(roadInc.propagatedNodeIds, ['traffic'])
  assert.deepEqual(roadInc.propagationPaths.traffic, ['road', 'traffic'])
})
