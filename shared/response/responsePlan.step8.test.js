import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  selectPrimaryIncidentForPlan,
  selectPrimaryIncidentForPlanWithReason,
  selectPrimaryIncidentForReplan,
} from './responsePlan.js'
import { attachRecoveryImpact } from '../recovery/recoveryImpact.js'
import { attachLiveCorrelation } from '../correlation/liveCorrelation.js'
import { isActiveResponseIncident } from '../incidentStatus.js'

function node(id, criticality = 'high') {
  return {
    id,
    data: {
      label: id.toUpperCase(),
      criticality,
      runtimeState: { quarantined: false },
    },
  }
}

function seed(id, endpointId, extra = {}) {
  return {
    id,
    endpointId,
    endpointLabel: endpointId.toUpperCase(),
    status: 'open',
    severity: 'high',
    anomalyScore: 0.9,
    criticality: 'high',
    detectionType: 'behavioral_anomaly',
    evidence: [
      {
        code: 'metric_deviation',
        metric: 'packetsPerSecond',
        observed: 800,
        expected: 80,
        deviationPct: 900,
      },
    ],
    peerExposedNodeIds: [],
    propagatedNodeIds: [],
    ...extra,
  }
}

describe('STEP 8 primary selection + status alignment', () => {
  it('global #1 wins even when outside groups[0]', () => {
    const nodes = [
      node('a', 'medium'),
      node('b', 'medium'),
      node('c', 'critical'),
      node('d', 'high'),
    ]
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'c', target: 'd' },
    ]
    // Two separate correlation pairs; stamp priorities so C is global #1
    const incidents = [
      seed('inc-a', 'a', { recoveryPriority: 5 }),
      seed('inc-b', 'b', { recoveryPriority: 4 }),
      seed('inc-c', 'c', { recoveryPriority: 99 }),
      seed('inc-d', 'd', { recoveryPriority: 10 }),
    ]
    const detection = {
      incidents,
      anomalyNodeIds: ['a', 'c'],
      liveCorrelation: {
        groups: [
          {
            groupId: 'g-low',
            primaryIncidentId: 'inc-a',
            incidentIds: ['inc-a', 'inc-b'],
          },
          {
            groupId: 'g-high',
            primaryIncidentId: 'inc-c',
            incidentIds: ['inc-c', 'inc-d'],
          },
        ],
      },
    }
    attachRecoveryImpact(detection, { nodes, edges, overrides: {} })
    // Force priorities after attach (attach recomputes)
    detection.incidents.find((i) => i.id === 'inc-a').recoveryPriority = 5
    detection.incidents.find((i) => i.id === 'inc-b').recoveryPriority = 4
    detection.incidents.find((i) => i.id === 'inc-c').recoveryPriority = 99
    detection.incidents.find((i) => i.id === 'inc-d').recoveryPriority = 10
    detection.liveCorrelation.groups[0].primaryIncidentId = 'inc-a'
    detection.liveCorrelation.groups[1].primaryIncidentId = 'inc-c'

    const primary = selectPrimaryIncidentForPlan(detection, null)
    assert.equal(primary.id, 'inc-c')
    const withReason = selectPrimaryIncidentForPlanWithReason(detection, null)
    assert.equal(withReason.reason, 'global_recovery_priority')
    assert.equal(withReason.focusOverride, false)
    // groups[0] primary is NOT chosen merely for being first
    assert.notEqual(primary.id, detection.liveCorrelation.groups[0].primaryIncidentId)
  })

  it('explicit focus override is documented when valid', () => {
    const detection = {
      incidents: [
        seed('inc-a', 'a', { recoveryPriority: 99 }),
        seed('inc-b', 'b', { recoveryPriority: 1 }),
      ],
      liveCorrelation: { groups: [] },
    }
    const withReason = selectPrimaryIncidentForPlanWithReason(detection, 'inc-b')
    assert.equal(withReason.incident.id, 'inc-b')
    assert.equal(withReason.reason, 'explicit_focus_override')
    assert.equal(withReason.focusOverride, true)
  })

  it('focus on cleared incident falls back to global rank', () => {
    const detection = {
      incidents: [
        seed('inc-a', 'a', { recoveryPriority: 50 }),
        seed('inc-b', 'b', { recoveryPriority: 10, status: 'cleared' }),
      ],
      liveCorrelation: { groups: [] },
    }
    const withReason = selectPrimaryIncidentForPlanWithReason(detection, 'inc-b')
    assert.equal(withReason.incident.id, 'inc-a')
    assert.equal(withReason.reason, 'global_recovery_priority')
  })

  it('replan ranks eligible candidates by recovery priority after quarantine filter', () => {
    const nodes = [
      {
        id: 'a',
        data: { label: 'A', criticality: 'high', runtimeState: { quarantined: true } },
      },
      {
        id: 'b',
        data: { label: 'B', criticality: 'high', runtimeState: { quarantined: false } },
      },
      {
        id: 'c',
        data: { label: 'C', criticality: 'high', runtimeState: { quarantined: false } },
      },
    ]
    const detection = {
      incidents: [
        seed('inc-a', 'a', { recoveryPriority: 100 }),
        seed('inc-b', 'b', { recoveryPriority: 20 }),
        seed('inc-c', 'c', { recoveryPriority: 80 }),
      ],
    }
    const primary = selectPrimaryIncidentForReplan(detection, {
      nodes,
      previousAffectedNodeIds: ['a'],
      previousPrimaryIncidentId: 'inc-a',
    })
    assert.equal(primary.id, 'inc-c')
  })

  it('acknowledged/investigating/contained are active; cleared is not', () => {
    assert.equal(isActiveResponseIncident({ status: 'acknowledged' }), true)
    assert.equal(isActiveResponseIncident({ status: 'investigating' }), true)
    assert.equal(isActiveResponseIncident({ status: 'contained' }), true)
    assert.equal(isActiveResponseIncident({ status: 'cleared' }), false)

    const detection = {
      incidents: [
        seed('inc-ack', 'a', { status: 'acknowledged', recoveryPriority: 40 }),
        seed('inc-clear', 'b', { status: 'cleared', recoveryPriority: 99 }),
      ],
      liveCorrelation: { groups: [] },
    }
    const primary = selectPrimaryIncidentForPlan(detection, null)
    assert.equal(primary.id, 'inc-ack')
  })

  it('recovery attach and planning share active population', () => {
    const nodes = [node('a'), node('b')]
    const edges = [{ id: 'e1', source: 'a', target: 'b' }]
    const detection = {
      incidents: [
        seed('inc-a', 'a', { status: 'investigating' }),
        seed('inc-b', 'b', { status: 'cleared' }),
      ],
      anomalyNodeIds: ['a'],
      peerExposedNodeIds: [],
      propagatedNodeIds: [],
    }
    attachLiveCorrelation(detection, { nodes, edges })
    attachRecoveryImpact(detection, { nodes, edges, overrides: {} })
    const active = detection.incidents.filter(isActiveResponseIncident)
    assert.equal(active.length, 1)
    assert.ok(Number.isFinite(Number(active[0].recoveryPriority)))
    assert.equal(detection.incidents.find((i) => i.id === 'inc-b').recoveryPriority, undefined)
    const primary = selectPrimaryIncidentForPlan(detection, null)
    assert.equal(primary.id, 'inc-a')
  })
})
