import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeMonitorTimelineEvents,
  orchestrationLifecycleEventsFromState,
} from './orchestrationTimelineView.js'

const T0 = 1_700_000_000_000

function historyRow(id, node, extra = {}) {
  return {
    incidentId: id,
    liveIncidentId: `live-${node}`,
    affectedNodeId: node,
    affectedNodeLabel: extra.label ?? node,
    incidentType: 'behavioural_anomaly',
    severity: 'high',
    status: 'open',
    detectedAtMs: extra.detectedAtMs ?? T0,
    evidence: extra.evidence ?? [{ code: 'metric_deviation', detail: 'pps +80%' }],
    campaignId: null,
  }
}

test('detection rows remain without orchestration when idle', () => {
  const events = mergeMonitorTimelineEvents({
    incidents: [historyRow('pay:1', 'pay')],
    orchestration: { workflowStatus: 'IDLE', workflowTrace: [] },
    order: 'oldest-first',
  })
  assert.equal(events.filter((e) => e.eventKind === 'detection').length, 1)
  assert.equal(events.filter((e) => e.eventKind === 'orchestration').length, 0)
  assert.equal(events.find((e) => e.eventKind === 'evidence')?.label, 'Evidence collected')
})

test('does not invent AI plan generated for policy plans', () => {
  const events = orchestrationLifecycleEventsFromState(
    {
      workflowTrace: [
        {
          kind: 'agent_loop',
          phase: 'PLANNER_STARTED',
          primaryIncidentId: 'pay:1',
          atMs: T0 + 5000,
        },
        {
          kind: 'agent_loop',
          phase: 'COMMANDER_PLAN',
          primaryIncidentId: 'pay:1',
          planId: 'plan-1',
          planSource: 'policy',
          atMs: T0 + 6000,
        },
      ],
    },
    {
      historyEvents: [
        {
          incidentId: 'pay:1',
          liveIncidentId: 'live-pay',
          affectedNodeId: 'pay',
          affectedNodeLabel: 'Pay',
        },
      ],
    }
  )
  assert.ok(events.some((e) => e.lifecycleKey === 'planner_started'))
  assert.ok(!events.some((e) => e.lifecycleKey === 'ai_plan_generated'))
})

test('full lifecycle maps real timestamps and labels per incident', () => {
  const events = mergeMonitorTimelineEvents({
    incidents: [
      historyRow('pay:1', 'pay', { detectedAtMs: T0 }),
      historyRow('gw:1', 'gw', { detectedAtMs: T0 + 1000, evidence: [] }),
    ],
    orchestration: {
      workflowTrace: [
        {
          kind: 'agent_loop',
          phase: 'PLANNER_STARTED',
          primaryIncidentId: 'pay:1',
          atMs: T0 + 8000,
        },
        {
          kind: 'agent_loop',
          phase: 'COMMANDER_PLAN',
          primaryIncidentId: 'pay:1',
          planId: 'plan-pay',
          planSource: 'llm',
          atMs: T0 + 18000,
        },
        {
          kind: 'status_transition',
          previousStatus: 'PLAN_READY',
          newStatus: 'AWAITING_APPROVAL',
          primaryIncidentId: 'pay:1',
          planId: 'plan-pay',
          atMs: T0 + 18000,
        },
        {
          kind: 'agent_loop',
          phase: 'HUMAN_APPROVED',
          primaryIncidentId: 'pay:1',
          planId: 'plan-pay',
          atMs: T0 + 62000,
        },
        {
          kind: 'agent_loop',
          phase: 'RESPONSE_EXECUTING',
          primaryIncidentId: 'pay:1',
          planId: 'plan-pay',
          atMs: T0 + 62000,
        },
        {
          kind: 'agent_loop',
          phase: 'RESPONSE_COMPLETED',
          primaryIncidentId: 'pay:1',
          planId: 'plan-pay',
          atMs: T0 + 63000,
        },
        {
          kind: 'agent_loop',
          phase: 'VERIFICATION_EVIDENCE',
          primaryIncidentId: 'pay:1',
          planId: 'plan-pay',
          atMs: T0 + 64000,
        },
        {
          kind: 'agent_loop',
          phase: 'EPISODE_RECOVERED',
          primaryIncidentId: 'pay:1',
          planId: 'plan-pay',
          atMs: T0 + 64000,
        },
      ],
    },
    order: 'oldest-first',
  })

  const payOrch = events.filter(
    (e) => e.eventKind === 'orchestration' && e.incidentId === 'pay:1'
  )
  assert.deepEqual(
    payOrch.map((e) => e.label),
    [
      'Planner started',
      'AI plan generated',
      'Awaiting approval',
      'Plan approved',
      'Response Agent started',
      'Response executed',
      'Recovery verification',
      'Incident recovered',
    ]
  )

  // gw never entered orchestration — no response lifecycle rows
  assert.equal(
    events.filter((e) => e.eventKind === 'orchestration' && e.incidentId === 'gw:1')
      .length,
    0
  )

  // Detection rows preserved
  assert.ok(events.some((e) => e.eventKind === 'detection' && e.incidentId === 'pay:1'))
  assert.ok(events.some((e) => e.eventKind === 'detection' && e.incidentId === 'gw:1'))
})

test('liveIncidentId on trace resolves to history incidentId', () => {
  const events = orchestrationLifecycleEventsFromState(
    {
      workflowTrace: [
        {
          kind: 'agent_loop',
          phase: 'PLANNER_STARTED',
          primaryIncidentId: 'live-pay',
          atMs: T0 + 10,
        },
      ],
    },
    {
      historyEvents: [
        {
          incidentId: 'pay:1',
          liveIncidentId: 'live-pay',
          affectedNodeId: 'pay',
          affectedNodeLabel: 'Pay',
        },
      ],
    }
  )
  assert.equal(events[0].incidentId, 'pay:1')
  assert.equal(events[0].label, 'Planner started')
})
