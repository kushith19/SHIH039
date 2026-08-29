import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fingerprintIncident,
  fallbackExplanation,
  mapDetectionType,
  ollamaFallbackEnabled,
  toDetectionInput,
  toOllamaExplainPayload,
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
