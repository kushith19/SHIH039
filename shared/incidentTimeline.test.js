import assert from 'node:assert/strict'
import test from 'node:test'
import {
  currentTimelineKind,
  DEMO_INCIDENT_TIMELINE,
  TIMELINE_CAPTION,
  timelineEventsFromIncident,
} from './incidentTimeline.js'

test('empty or incomplete incident yields no events', () => {
  assert.deepEqual(timelineEventsFromIncident(null), [])
  assert.deepEqual(timelineEventsFromIncident({}), [])
  assert.deepEqual(timelineEventsFromIncident({ severity: 'high' }), [])
})

test('metric-only incident omits trust', () => {
  const events = timelineEventsFromIncident({
    id: 'inc-a',
    endpointId: 'a',
    timestamp: '2026-09-03T12:31:06.000Z',
    severity: 'medium',
    confidence: 0.5,
    anomalyScore: 0.61,
    evidence: [
      {
        code: 'metric_deviation',
        metric: 'packetsPerSecond',
        deviationPct: 40,
        detail: 'metric_deviation:packetsPerSecond',
      },
    ],
  })
  const kinds = events.map((e) => e.kind)
  assert.deepEqual(kinds, ['telemetry', 'detection', 'escalation'])
  assert.equal(currentTimelineKind(events), 'escalation')
  assert.ok(events[0].detail.includes('packetsPerSecond'))
  assert.ok(events[1].title.includes('Graph residual'))
  assert.ok(!events.some((e) => e.title.includes('TGNN')))
})

test('peer trust is included without a propagation stage', () => {
  const events = timelineEventsFromIncident({
    id: 'inc-b',
    endpointId: 'b',
    timestamp: '2026-09-03T12:31:06.000Z',
    severity: 'high',
    confidence: 0.74,
    anomalyScore: 0.82,
    evidence: [
      {
        code: 'metric_deviation',
        metric: 'failedLoginsPerMin',
        deviationPct: 90,
      },
      {
        code: 'peer_trust_decrease',
        previous: 72,
        current: 41,
        detail: 'peer_trust_decrease:72->41',
      },
      { code: 'graph_propagation', kind: 'graph_propagation', detail: 'origin_spread' },
    ],
    affectedDependencies: [{ id: 'e1', source: 'b', target: 'c' }],
  })
  assert.deepEqual(
    events.map((e) => e.kind),
    ['telemetry', 'detection', 'trust', 'escalation']
  )
  assert.ok(events.find((e) => e.kind === 'trust').detail.includes('72'))
  assert.ok(!events.some((e) => e.kind === 'propagation'))
})

test('display clocks offset 1s around promotion timestamp', () => {
  const events = timelineEventsFromIncident({
    id: 'inc-c',
    endpointId: 'c',
    timestamp: '2026-09-03T12:31:06.000Z',
    evidence: [{ code: 'metric_deviation', metric: 'httpRequestsPerMin', deviationPct: 12 }],
  })
  const promo = events.find((e) => e.kind === 'escalation')
  assert.equal(promo.at, '2026-09-03T12:31:06.000Z')
  assert.equal(promo.timeLabel, '12:31:06')
  const tel = events.find((e) => e.kind === 'telemetry')
  assert.equal(tel.timeLabel, '12:31:04')
  const det = events.find((e) => e.kind === 'detection')
  assert.equal(det.timeLabel, '12:31:05')
})

test('pending commander highlights AI; ready explanation adds recommendation', () => {
  const pending = timelineEventsFromIncident({
    id: 'inc-d',
    endpointId: 'd',
    timestamp: '2026-09-03T12:31:06.000Z',
    explanationStatus: 'pending',
    explanation: '',
  })
  assert.equal(currentTimelineKind(pending), 'ai')
  assert.ok(!pending.some((e) => e.kind === 'recommendation'))

  const ready = timelineEventsFromIncident({
    id: 'inc-d',
    endpointId: 'd',
    timestamp: '2026-09-03T12:31:06.000Z',
    explanationStatus: 'ready',
    explanationSource: 'llm-explain',
    explanation: 'Observed residual and metric deviation at the flagged endpoint.',
  })
  assert.equal(currentTimelineKind(ready), 'recommendation')
  const rec = ready.find((e) => e.kind === 'recommendation')
  assert.ok(rec.detail.includes('Advisory'))
  assert.ok(!/shut down|power off/i.test(rec.detail))
})

test('demo fixture matches the pipeline order and clocks', () => {
  const { events, caption } = DEMO_INCIDENT_TIMELINE
  assert.equal(caption, TIMELINE_CAPTION)
  assert.equal(events.length, 6)
  assert.deepEqual(
    events.map((e) => e.kind),
    ['telemetry', 'detection', 'trust', 'escalation', 'ai', 'recommendation']
  )
  assert.deepEqual(
    events.map((e) => e.timeLabel),
    ['12:31:02', '12:31:03', '12:31:04', '12:31:05', '12:31:06', '12:31:07']
  )
  assert.equal(events[1].title, 'Graph residual anomaly detected')
  assert.equal(currentTimelineKind(events), 'recommendation')
})
