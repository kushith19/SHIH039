import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fingerprintIncident,
  fallbackExplanation,
  mapDetectionType,
  ollamaFallbackEnabled,
  toDetectionInput,
  toOllamaExplainPayload,
  attachExplanations,
  enqueueIncidentExplanations,
  clearExplanationCache,
  _openCommanderCircuitForTests,
  _resetCommanderCircuitForTests,
  _seedExplanationCacheForTests,
  _explanationQueueLengthForTests,
} from './client.js'

test('mapDetectionType maps UK spelling', () => {
  assert.equal(mapDetectionType('behavioural_anomaly'), 'behavioral_anomaly')
  assert.equal(mapDetectionType('communication_anomaly'), 'communication_anomaly')
  assert.equal(mapDetectionType('graph_propagation'), 'graph_propagation')
})

test('toDetectionInput maps a JS incident to Commander DetectionInput', () => {
  const incident = {
    id: 'inc-water-1-behavioural_anomaly',
    timestamp: '2026-08-29T00:00:00.000Z',
    endpointId: 'water-1',
    endpointLabel: 'Water PLC',
    severity: 'high',
    confidence: 0.82,
    anomalyScore: 0.77,
    detectionType: 'behavioural_anomaly',
    cityContext: 'rush_hour',
    criticality: 'high',
    sector: 'Water',
    cityEndpointId: 'water-treatment-control',
    affectedDependencies: [
      { id: 'dep-1', source: 'water-1', target: 'ep-telecom_gateway', role: 'downstream' },
    ],
    evidence: [
      {
        code: 'metric_deviation',
        metric: 'packetsPerSecond',
        expected: 100,
        observed: 163,
        deviationPct: 63,
      },
    ],
  }
  const body = toDetectionInput(incident)
  assert.equal(body.incidentId, incident.id)
  assert.equal(body.detectionType, 'behavioral_anomaly')
  assert.equal(body.severity, 'high')
  assert.equal(body.confidence, 0.82)
  assert.equal(body.riskScore, 0.77)
  assert.ok(body.affectedEndpoints.includes('water-1'))
  assert.ok(body.affectedEndpoints.includes('ep-telecom_gateway'))
  assert.equal(body.metadata.cityContext, 'rush_hour')
  assert.equal(body.metadata.sector, 'Water')
  assert.equal(body.metadata.affectedDependencies.length, 1)
  assert.equal(body.evidence.length, 1)
  assert.equal(body.evidence[0].deviationPct, 63)
  assert.equal(fingerprintIncident(incident), fingerprintIncident({ ...incident, anomalyScore: 0.11 }))
  assert.equal(
    fingerprintIncident(incident),
    fingerprintIncident({
      ...incident,
      evidence: [{ ...incident.evidence[0], deviationPct: 61, observed: 200, current: 99 }],
    })
  )
  assert.equal(
    fingerprintIncident(incident),
    fingerprintIncident({
      ...incident,
      evidence: [{ ...incident.evidence[0], deviationPct: 80, previous: 1 }],
    })
  )
  assert.notEqual(
    fingerprintIncident(incident),
    fingerprintIncident({
      ...incident,
      evidence: [{ ...incident.evidence[0], code: 'graph_spread' }],
    })
  )
  const fallback = fallbackExplanation(incident)
  assert.match(fallback, /Water PLC/)
  assert.match(fallback, /packetsPerSecond/)
})

test('fingerprint stays stable for the same incident id when only live metrics drift', () => {
  const a = {
    id: 'water-1:behavioural_anomaly',
    detectionType: 'behavioural_anomaly',
    evidence: [
      { code: 'metric_deviation', metric: 'packetsPerSecond', current: 10, previous: 2, deviationPct: 20 },
    ],
  }
  const b = {
    ...a,
    evidence: [
      { code: 'metric_deviation', metric: 'packetsPerSecond', current: 90, previous: 2, deviationPct: 400 },
    ],
  }
  assert.equal(fingerprintIncident(a), fingerprintIncident(b))
})

test('toOllamaExplainPayload omits full detection metadata', () => {
  const incident = {
    id: 'inc-1',
    detectionType: 'behavioural_anomaly',
    severity: 'high',
    endpointId: 'water-1',
    affectedDependencies: [{ id: 'dep-1', source: 'a', target: 'b' }],
    evidence: [
      {
        code: 'metric_deviation',
        metric: 'packetsPerSecond',
        expected: 100,
        observed: 163,
        deviationPct: 63,
        detail: 'pps spike',
      },
    ],
  }
  const payload = toOllamaExplainPayload(incident)
  assert.equal(payload.incidentId, 'inc-1')
  assert.equal(payload.detectionType, 'behavioral_anomaly')
  assert.equal(payload.severity, 'high')
  assert.deepEqual(payload.evidence, [
    { code: 'metric_deviation', metric: 'packetsPerSecond', detail: 'pps spike' },
  ])
  assert.equal('affectedEndpoints' in payload, false)
  assert.equal('metadata' in payload, false)
})

test('ollama fallback is off unless OLLAMA_FALLBACK is set', () => {
  assert.equal(ollamaFallbackEnabled(), false)
})

test('fallbackExplanation dedupes repeated metrics and keeps top signals', () => {
  const text = fallbackExplanation({
    endpointLabel: 'Power Substation',
    detectionType: 'behavioural_anomaly',
    severity: 'critical',
    evidence: [
      { code: 'metric_deviation', metric: 'httpRequestsPerMin', deviationPct: 821 },
      { code: 'edge_pps', metric: 'packetsPerSecond', deviationPct: 121 },
      { code: 'metric_deviation', metric: 'packetsPerSecond', deviationPct: 121 },
      { code: 'metric_deviation', metric: 'filesDownloaded', deviationPct: 80000 },
      { code: 'metric_deviation', metric: 'cpu_usage', deviationPct: 37 },
      { code: 'metric_deviation', metric: 'memory_usage', deviationPct: 38 },
      { code: 'metric_deviation', metric: 'voltage', deviationPct: 38 },
      { code: 'metric_deviation', metric: 'frequency', deviationPct: 5 },
      { code: 'tgnn_embed' },
      { code: 'context_mismatch:heavy_rain' },
      { code: 'critical_infrastructure' },
    ],
  })
  assert.match(text, /Power Substation/)
  assert.match(text, /filesDownloaded/)
  assert.match(text, /tgnn_embed/)
  assert.match(text, /critical infrastructure/)
  assert.equal(text.split('packetsPerSecond').length - 1, 1)
  assert.equal(text.includes('frequency'), false)
})

test('circuit-open path does not mark ready', () => {
  _resetCommanderCircuitForTests()
  clearExplanationCache('room-circuit')
  _openCommanderCircuitForTests()
  const incident = {
    id: 'inc-power-behavioural_anomaly',
    endpointId: 'power-1',
    endpointLabel: 'Power Substation',
    detectionType: 'behavioural_anomaly',
    severity: 'critical',
    evidence: [{ code: 'metric_deviation', metric: 'httpRequestsPerMin', deviationPct: 821 }],
  }
  const room = { id: 'room-circuit', detection: { incidents: [incident] } }
  enqueueIncidentExplanations(room)
  attachExplanations(room, room.detection.incidents)
  assert.equal(room.detection.incidents[0].explanationStatus, 'fallback')
  assert.match(room.detection.incidents[0].explanation, /Power Substation/)
  _resetCommanderCircuitForTests()
  clearExplanationCache('room-circuit')
})

function liveIncident(overrides = {}) {
  return {
    id: 'inc-water-1',
    endpointId: 'water-1',
    endpointLabel: 'Water PLC',
    detectionType: 'behavioural_anomaly',
    severity: 'high',
    evidence: [{ code: 'metric_deviation', metric: 'packetsPerSecond', deviationPct: 63 }],
    ...overrides,
  }
}

test('enqueue does not regenerate when live evidence or type changes after ready or pending', () => {
  _resetCommanderCircuitForTests()
  clearExplanationCache('room-churn')
  const original = liveIncident()
  const drifted = liveIncident({
    detectionType: 'graph_propagation',
    evidence: [
      { code: 'metric_deviation', metric: 'packetsPerSecond', deviationPct: 80 },
      { code: 'graph_propagation' },
    ],
  })
  assert.notEqual(fingerprintIncident(original), fingerprintIncident(drifted))

  _seedExplanationCacheForTests('room-churn', original.id, {
    fingerprint: fingerprintIncident(original),
    status: 'ready',
    summary: 'Stable explanation.',
  })
  const readyRoom = { id: 'room-churn', detection: { incidents: [liveIncident(drifted)] } }
  enqueueIncidentExplanations(readyRoom)
  assert.equal(_explanationQueueLengthForTests(), 0)
  assert.notEqual(readyRoom.detection.incidents[0].explanationStatus, 'pending')
  attachExplanations(readyRoom, readyRoom.detection.incidents)
  assert.equal(readyRoom.detection.incidents[0].explanationStatus, 'ready')
  assert.equal(readyRoom.detection.incidents[0].explanation, 'Stable explanation.')

  _resetCommanderCircuitForTests()
  clearExplanationCache('room-churn')
  _seedExplanationCacheForTests('room-churn', original.id, {
    fingerprint: fingerprintIncident(original),
    status: 'pending',
    summary: 'Generating…',
  })
  const pendingRoom = { id: 'room-churn', detection: { incidents: [liveIncident(drifted)] } }
  enqueueIncidentExplanations(pendingRoom)
  assert.equal(_explanationQueueLengthForTests(), 0)
  assert.notEqual(pendingRoom.detection.incidents[0].explanationStatus, 'pending')

  _resetCommanderCircuitForTests()
  clearExplanationCache('room-churn')
})

test('fallback does not immediately re-enqueue when the commander circuit closes', () => {
  _resetCommanderCircuitForTests()
  clearExplanationCache('room-fallback-backoff')
  _openCommanderCircuitForTests()
  const incident = liveIncident({
    id: 'inc-power-1',
    endpointId: 'power-1',
    endpointLabel: 'Power Substation',
    severity: 'critical',
    evidence: [{ code: 'metric_deviation', metric: 'httpRequestsPerMin', deviationPct: 821 }],
  })
  const room = { id: 'room-fallback-backoff', detection: { incidents: [incident] } }
  enqueueIncidentExplanations(room)
  assert.equal(room.detection.incidents[0].explanationStatus, 'fallback')

  _resetCommanderCircuitForTests()
  const retried = liveIncident({
    id: 'inc-power-1',
    endpointId: 'power-1',
    endpointLabel: 'Power Substation',
    severity: 'critical',
    evidence: [
      { code: 'metric_deviation', metric: 'httpRequestsPerMin', deviationPct: 821 },
      { code: 'graph_propagation' },
    ],
  })
  const room2 = { id: 'room-fallback-backoff', detection: { incidents: [retried] } }
  enqueueIncidentExplanations(room2)
  assert.equal(_explanationQueueLengthForTests(), 0)
  assert.notEqual(room2.detection.incidents[0].explanationStatus, 'pending')
  attachExplanations(room2, room2.detection.incidents)
  assert.equal(room2.detection.incidents[0].explanationStatus, 'fallback')

  _resetCommanderCircuitForTests()
  clearExplanationCache('room-fallback-backoff')
})

test('attachExplanations uses fallback status when cache is empty', () => {
  clearExplanationCache('room-empty')
  const incidents = [
    {
      id: 'inc-1',
      endpointLabel: 'Water PLC',
      detectionType: 'behavioural_anomaly',
      severity: 'high',
      evidence: [{ code: 'metric_deviation', metric: 'packetsPerSecond', deviationPct: 63 }],
    },
  ]
  attachExplanations({ id: 'room-empty' }, incidents)
  assert.equal(incidents[0].explanationStatus, 'fallback')
  assert.match(incidents[0].explanation, /Water PLC/)
  clearExplanationCache('room-empty')
})
