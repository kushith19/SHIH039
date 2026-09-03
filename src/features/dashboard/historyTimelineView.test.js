import assert from 'node:assert/strict'
import test from 'node:test'
import {
  annotateHistoryEventsWithCampaigns,
  historyEventsFromIncidents,
  liveIncidentMatchesTimelineEvent,
  timelineSelectionKey,
} from './historyTimelineView.js'

const T0 = 1_700_000_000_000

function persisted(id, node, extra = {}) {
  return {
    incidentId: id,
    liveIncidentId: `inc-${node}`,
    affectedNodeId: node,
    affectedNodeLabel: extra.label ?? node,
    incidentType: extra.incidentType ?? 'behavioural_anomaly',
    severity: extra.severity ?? 'high',
    status: extra.status ?? 'open',
    detectedAtMs: extra.detectedAtMs ?? T0,
    summary: extra.summary ?? `${node}: behavioural`,
    campaignId: extra.campaignId ?? null,
    financialContext: extra.financialContext ?? null,
  }
}

test('timeline events appear chronologically from persisted incidents', () => {
  const newest = historyEventsFromIncidents(
    [
      persisted('a', 'pay', { detectedAtMs: T0 }),
      persisted('b', 'gw', { detectedAtMs: T0 + 2000 }),
      persisted('c', 'core', { detectedAtMs: T0 + 1000 }),
    ],
    { order: 'newest-first' }
  )
  assert.deepEqual(
    newest.map((e) => e.incidentId),
    ['b', 'c', 'a']
  )

  const oldest = historyEventsFromIncidents(
    [
      persisted('a', 'pay', { detectedAtMs: T0 }),
      persisted('b', 'gw', { detectedAtMs: T0 + 2000 }),
    ],
    { order: 'oldest-first' }
  )
  assert.deepEqual(
    oldest.map((e) => e.incidentId),
    ['a', 'b']
  )
})

test('timeline uses only persisted incidents — no fake events', () => {
  const events = historyEventsFromIncidents([
    persisted('only', 'pay', {
      financialContext: { simulated: true, exposureLabel: '₹2.4 Cr' },
    }),
    null,
    { incidentId: '', affectedNodeId: '' },
  ])
  assert.equal(events.length, 1)
  assert.equal(events[0].incidentId, 'only')
  assert.equal(events[0].exposureLabel, '₹2.4 Cr simulated exposure')
  assert.equal(events[0].severity, 'high')
  assert.equal(events[0].status, 'open')
  assert.ok(events[0].timeLabel)
})

test('campaign annotation stays backend-driven', () => {
  const events = historyEventsFromIncidents([
    persisted('a', 'pay', { campaignId: 'camp-h-1', detectedAtMs: T0 }),
    persisted('b', 'gw', { campaignId: 'camp-h-1', detectedAtMs: T0 + 1 }),
    persisted('c', 'water', { detectedAtMs: T0 + 2 }),
  ])
  const annotated = annotateHistoryEventsWithCampaigns(events, [
    {
      campaignId: 'camp-h-1',
      status: 'suspected',
      incidentCount: 2,
      sequence: [{ incidentId: 'a' }, { incidentId: 'b' }],
    },
  ])
  assert.equal(annotated.find((e) => e.incidentId === 'a').campaignStatus, 'suspected')
  assert.equal(annotated.find((e) => e.incidentId === 'a').campaignIncidentCount, 2)
  assert.equal(annotated.find((e) => e.incidentId === 'c').campaignStatus, null)
  // Empty campaigns payload must not invent correlation
  const bare = annotateHistoryEventsWithCampaigns(events, [])
  assert.equal(bare.find((e) => e.incidentId === 'a').campaignStatus, null)
  assert.equal(bare.find((e) => e.incidentId === 'a').campaignId, 'camp-h-1')
})

test('timeline selection connects to live Incident Card keys', () => {
  const event = historyEventsFromIncidents([persisted('pay:1', 'pay')])[0]
  assert.equal(timelineSelectionKey(event), 'pay')
  assert.equal(
    liveIncidentMatchesTimelineEvent(
      { id: 'inc-pay', endpointId: 'pay', persistentId: 'pay:1' },
      event
    ),
    true
  )
  assert.equal(
    liveIncidentMatchesTimelineEvent({ id: 'inc-gw', endpointId: 'gw' }, event),
    false
  )
})
