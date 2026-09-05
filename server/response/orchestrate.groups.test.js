/**
 * Parallel orchestration groups — integration tests.
 */

import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  approveOrchestrationPlan,
  beginOrchestrationCycleQueue,
  completeSelectedIncidentDummyRecovery,
  continueOrchestrationQueueAfterRecovery,
  executeOrchestrationPlan,
  focusOrchestrationGroup,
  generateOrchestrationPlan,
  generateOrchestrationPlanMaybeLlm,
} from './orchestrate.js'
import {
  clearLlmCommanderTestCaller,
  setLlmCommanderTestCaller,
} from './llmCommanderClient.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import {
  ORCHESTRATION_CYCLE_STATUS,
  ORCHESTRATION_STATUS,
} from '../../shared/response/orchestration.js'

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
    endpointId,
    endpointLabel: endpointId.toUpperCase(),
    status: 'open',
    severity: extra.severity ?? 'high',
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
    peerExposedNodeIds: extra.peerExposedNodeIds ?? [],
    propagatedNodeIds: extra.propagatedNodeIds ?? [],
    relatedIncidents: extra.relatedIncidents ?? [],
    campaignId: extra.campaignId ?? null,
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
    peerExposure: live.peerExposedNodeIds ?? [],
    propagatedNodeIds: live.propagatedNodeIds ?? [],
    actionsAlreadyTaken: live.actionsTaken ?? [],
    isExposureIncident: live.isExposureIncident === true,
    relatedIncidents: live.relatedIncidents ?? [],
  }
  return attachAvailableResponseActions(
    attachResponseClassification(base, room.nodes ?? [])
  )
}

function roomWith(ids, { edges = [] } = {}) {
  const room = createEmptyRoom('PGROUP')
  room.phase = 'playing'
  const eps = [...new Set(ids.map(([, ep]) => ep))]
  room.nodes = eps.map((ep) => node(ep))
  room.edges = edges
  room.detection = {
    incidents: ids.map(([id, ep, extra], i) =>
      seedIncident(id, ep, {
        recoveryPriority: 100 - i * 10,
        ...(extra || {}),
      })
    ),
    anomalyNodeIds: eps,
  }
  attachRecoveryImpact(room.detection, {
    nodes: room.nodes,
    edges: room.edges,
    overrides: {},
  })
  room.hackSimulator = {
    active: true,
    nodeOverrides: Object.fromEntries(
      eps.map((ep) => [ep, { packetsPerSecond: 900 }])
    ),
    edgeOverrides: {},
  }
  return room
}

async function approveRecoverGroup(room, incidentId, groupId) {
  focusOrchestrationGroup(room, groupId)
  const approved = approveOrchestrationPlan(room, {
    resolveContext,
    autoContinue: false,
    groupId,
  })
  assert.equal(approved.ok, true)
  const executed = executeOrchestrationPlan(room, {
    resolveContext,
    autoContinue: false,
    groupId,
  })
  assert.equal(executed.ok, true)
  completeSelectedIncidentDummyRecovery(room, incidentId)
  return continueOrchestrationQueueAfterRecovery(room, {
    recoveredIncidentId: incidentId,
    resolveContext,
  })
}

describe('parallel orchestration groups', () => {
  const prevFlag = process.env.LLM_RESPONSE_PLAN
  const prevMode = process.env.ORCHESTRATION_GROUP_MODE

  before(() => {
    process.env.LLM_RESPONSE_PLAN = '0'
    process.env.ORCHESTRATION_GROUP_MODE = 'sector'
  })

  after(() => {
    clearLlmCommanderTestCaller()
    if (prevFlag === undefined) delete process.env.LLM_RESPONSE_PLAN
    else process.env.LLM_RESPONSE_PLAN = prevFlag
    if (prevMode === undefined) delete process.env.ORCHESTRATION_GROUP_MODE
    else process.env.ORCHESTRATION_GROUP_MODE = prevMode
  })

  it('1. one incident → one group → works as before', () => {
    const room = roomWith([['inc-a', 'power', { sector: 'Energy' }]])
    const planned = generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    assert.equal(planned.ok, true)
    assert.equal(room.orchestrationGroupsMeta.length, 1)
    assert.deepEqual(room.responseOrchestration.orchestrationQueue, ['inc-a'])
    assert.equal(
      room.responseOrchestration.workflowStatus,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
  })

  it('2. Energy + Water sectors → two parallel groups both planned', () => {
    const room = roomWith([
      ['inc-a', 'power', { severity: 'critical', recoveryPriority: 99, sector: 'Energy' }],
      ['inc-b', 'water', { severity: 'low', recoveryPriority: 1, sector: 'Water' }],
    ])
    const planned = generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    assert.equal(planned.ok, true)
    assert.equal(planned.parallelGroupsStarted, 2)
    assert.equal(room.orchestrationGroupsMeta.length, 2)
    const statuses = Object.values(room.orchestrationGroupRuns).map(
      (r) => r.workflowStatus
    )
    assert.equal(statuses.length, 2)
    assert.ok(
      statuses.every((s) => s === ORCHESTRATION_STATUS.AWAITING_APPROVAL)
    )
  })

  it('3. same city sector → one sequential group', () => {
    const room = roomWith([
      ['inc-a', 'power', { severity: 'critical', sector: 'Energy' }],
      ['inc-b', 'sub', { severity: 'high', sector: 'Energy' }],
    ])
    const planned = generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    assert.equal(planned.ok, true)
    assert.equal(room.orchestrationGroupsMeta.length, 1)
    assert.equal(room.responseOrchestration.orchestrationQueue.length, 2)
  })

  it('4. Energy cluster + Water → parallel sector groups', async () => {
    process.env.LLM_RESPONSE_PLAN = '1'
    const llmCalls = []
    setLlmCommanderTestCaller(async (payload) => {
      llmCalls.push(payload.incident.incidentId)
      return {
        actions: [
          {
            actionId: 'isolate-node',
            target: payload.serverAuthoritativeTarget,
            rationale: 'contain',
          },
        ],
      }
    })
    try {
      const room = roomWith([
        [
          'inc-a',
          'power',
          { severity: 'critical', recoveryPriority: 99, sector: 'Energy' },
        ],
        ['inc-b', 'idam', { severity: 'high', recoveryPriority: 80, sector: 'Energy' }],
        ['inc-c', 'water', { severity: 'low', recoveryPriority: 1, sector: 'Water' }],
      ])
      const planned = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-a',
        resolveContext,
      })
      assert.equal(planned.ok, true)
      assert.equal(room.orchestrationGroupsMeta.length, 2)
      assert.equal(llmCalls.length, 2)
      assert.ok(llmCalls.includes('inc-a'))
      assert.ok(llmCalls.includes('inc-c'))
    } finally {
      clearLlmCommanderTestCaller()
      process.env.LLM_RESPONSE_PLAN = '0'
    }
  })

  it('5. same asset must not execute independently', () => {
    const room = roomWith([
      ['inc-a', 'power', { sector: 'Energy' }],
      ['inc-b', 'power', { sector: 'Energy' }],
    ])
    beginOrchestrationCycleQueue(room, { focusIncidentId: 'inc-a' })
    assert.equal(room.orchestrationGroupsMeta.length, 1)
    assert.deepEqual(
      [...room.orchestrationGroupsMeta[0].incidentIds].sort(),
      ['inc-a', 'inc-b'].sort()
    )
  })

  it('6. human approval remains per focused group plan', () => {
    const room = roomWith([
      ['inc-a', 'power', { sector: 'Energy' }],
      ['inc-b', 'water', { sector: 'Water' }],
    ])
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    const gA = room.focusedGroupId
    const approved = approveOrchestrationPlan(room, {
      resolveContext,
      autoContinue: false,
      groupId: gA,
    })
    assert.equal(approved.ok, true)
    assert.equal(
      room.responseOrchestration.workflowStatus,
      ORCHESTRATION_STATUS.APPROVED
    )
    // Other group still awaiting its own approval
    const other = Object.values(room.orchestrationGroupRuns).find(
      (r) => r.groupId !== gA
    )
    assert.equal(other.workflowStatus, ORCHESTRATION_STATUS.AWAITING_APPROVAL)
  })

  it('7. group completion waits for its own recovery before reporting done', async () => {
    const room = roomWith([['inc-a', 'power']])
    generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    const gid = room.focusedGroupId
    const done = await approveRecoverGroup(room, 'inc-a', gid)
    assert.equal(done.completed, true)
    assert.equal(
      room.responseOrchestration.orchestrationCycleStatus,
      ORCHESTRATION_CYCLE_STATUS.COMPLETED
    )
  })

  it('8. single-incident demo path indistinguishable (queue length 1)', () => {
    const room = roomWith([['inc-only', 'gateway']])
    const planned = generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-only',
      resolveContext,
    })
    assert.equal(planned.ok, true)
    assert.equal(planned.parallelGroupsStarted, undefined)
    assert.deepEqual(room.responseOrchestration.orchestrationQueue, ['inc-only'])
    assert.equal(room.responseOrchestration.groupId, 'g1')
  })
})
