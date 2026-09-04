import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  completeSelectedIncidentDummyRecovery,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
  publicOrchestrationState,
} from './orchestrate.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import { ORCHESTRATION_STATUS } from '../../shared/response/orchestration.js'
import { mergeMonitorTimelineEvents } from '../../src/features/dashboard/orchestrationTimelineView.js'

function node(id, criticality = 'high') {
  return {
    id,
    data: {
      label: id.toUpperCase(),
      criticality,
      runtimeState: { quarantined: false, provenance: 'catalog' },
    },
  }
}

function seedIncident(id, endpointId, extra = {}) {
  return {
    id,
    persistentId: extra.persistentId ?? id,
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
    actionsTaken: [],
    ...extra,
  }
}

function resolveContext(room, _roomId, incidentId) {
  const live = (room.detection?.incidents ?? []).find(
    (inc) => inc.id === incidentId || inc.persistentId === incidentId
  )
  if (!live) return null
  const base = {
    incidentId: live.persistentId || live.id,
    liveIncidentId: live.id,
    incidentType: live.detectionType,
    severity: live.severity,
    status: live.status,
    affectedAsset: {
      id: live.endpointId,
      summary: live.endpointLabel,
      quarantined: false,
    },
    riskScore: live.anomalyScore,
    trustScore: 35,
    anomalyEvidence: live.evidence ?? [],
    peerExposure: [],
    propagatedNodeIds: [],
    actionsAlreadyTaken: [],
  }
  return attachAvailableResponseActions(
    attachResponseClassification(base, room.nodes)
  )
}

function roomWithIncident() {
  const room = createEmptyRoom('TL-LIFE')
  room.nodes = [node('pay', 'critical'), node('gw', 'medium')]
  room.edges = [{ id: 'e1', source: 'pay', target: 'gw' }]
  room.detection = {
    incidents: [
      seedIncident('inc-pay', 'pay', { persistentId: 'pay:1' }),
    ],
    anomalyNodeIds: ['pay'],
  }
  attachRecoveryImpact(room.detection, {
    nodes: room.nodes,
    edges: room.edges,
    overrides: {},
  })
  room.hackSimulator = {
    active: true,
    nodeOverrides: { pay: { packetsPerSecond: 900 } },
    edgeOverrides: {},
  }
  return room
}

describe('Monitor timeline orchestration lifecycle', () => {
  it('records real transitions Detection → Planner → Approval → Response → Recovery', () => {
    const room = roomWithIncident()
    const t0 = 1_700_000_100_000

    const planned = generateOrchestrationPlan(room, {
      focusIncidentId: 'pay:1',
      resolveContext,
      nowMs: t0 + 8000,
    })
    assert.equal(planned.ok, true)
    assert.equal(
      room.responseOrchestration.workflowStatus,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )

    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      nowMs: t0 + 62000,
    })
    assert.equal(approved.ok, true)

    const executed = executeOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      nowMs: t0 + 63000,
    })
    assert.equal(executed.ok, true)

    const recovered = completeSelectedIncidentDummyRecovery(room, 'pay:1', {
      nowMs: t0 + 64000,
    })
    assert.equal(recovered.ok, true)
    assert.equal(
      room.responseOrchestration.workflowStatus,
      ORCHESTRATION_STATUS.RECOVERED
    )

    const pub = publicOrchestrationState(room)
    const phases = (pub.workflowTrace ?? [])
      .filter((t) => t.kind === 'agent_loop')
      .map((t) => t.phase)

    assert.ok(phases.includes('PLANNER_STARTED'))
    assert.ok(phases.includes('COMMANDER_PLAN'))
    assert.ok(phases.includes('HUMAN_APPROVED'))
    assert.ok(phases.includes('RESPONSE_COMPLETED') || phases.includes('ACTION_EXECUTED'))
    assert.ok(phases.includes('VERIFICATION_EVIDENCE'))
    assert.ok(phases.includes('EPISODE_RECOVERED'))

    const commanderPlan = (pub.workflowTrace ?? []).find(
      (t) => t.kind === 'agent_loop' && t.phase === 'COMMANDER_PLAN'
    )
    assert.equal(commanderPlan.planSource, 'policy')
    assert.equal(commanderPlan.primaryIncidentId, 'pay:1')

    const timeline = mergeMonitorTimelineEvents({
      incidents: [
        {
          incidentId: 'pay:1',
          liveIncidentId: 'inc-pay',
          affectedNodeId: 'pay',
          affectedNodeLabel: 'PAY',
          incidentType: 'behavioural_anomaly',
          severity: 'high',
          status: 'open',
          detectedAtMs: t0,
          evidence: [{ code: 'metric_deviation' }],
        },
      ],
      orchestration: pub,
      order: 'oldest-first',
    })

    const labels = timeline
      .filter((e) => e.incidentId === 'pay:1')
      .map((e) =>
        e.eventKind === 'detection'
          ? 'Incident detected'
          : e.label
      )

    assert.ok(labels.includes('Incident detected'))
    assert.ok(labels.includes('Evidence collected'))
    assert.ok(labels.includes('Planner started'))
    assert.ok(!labels.includes('AI plan generated'), 'policy plan must not fake LLM event')
    assert.ok(labels.includes('Awaiting approval'))
    assert.ok(labels.includes('Plan approved'))
    assert.ok(labels.includes('Response executed') || labels.includes('Response Agent started'))
    assert.ok(labels.includes('Recovery verification'))
    assert.ok(labels.includes('Incident recovered'))

    // Chronological: detection before planner before recovery
    const idx = (label) => labels.indexOf(label)
    assert.ok(idx('Incident detected') < idx('Planner started'))
    assert.ok(idx('Planner started') < idx('Plan approved'))
    assert.ok(idx('Plan approved') < idx('Incident recovered'))
  })
})
