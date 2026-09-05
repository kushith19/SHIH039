/**
 * Sequential multi-incident orchestration queue — focused tests.
 * Does not change Planner / approval / Response Agent semantics.
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
  PLAN_APPROVAL_STATUS,
} from '../../shared/response/orchestration.js'
import {
  buildStableOrchestrationQueue,
  nextQueuedIncidentId,
  queueProgressView,
} from '../../shared/response/orchestrationQueue.js'

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
    peerExposedNodeIds: extra.peerExposedNodeIds ?? [],
    propagatedNodeIds: extra.propagatedNodeIds ?? [],
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
    relatedIncidents: [],
  }
  return attachAvailableResponseActions(
    attachResponseClassification(base, room.nodes ?? [])
  )
}

function roomWithIncidents(ids) {
  const room = createEmptyRoom('QSEQ')
  room.phase = 'playing'
  room.nodes = ids.map(([, ep]) => node(ep))
  room.edges = []
  room.detection = {
    incidents: ids.map(([id, ep, extra], i) =>
      seedIncident(id, ep, {
        recoveryPriority: 100 - i * 10,
        ...(extra || {}),
      })
    ),
    anomalyNodeIds: ids.map(([, ep]) => ep),
  }
  attachRecoveryImpact(room.detection, {
    nodes: room.nodes,
    edges: room.edges,
    overrides: {},
  })
  room.hackSimulator = {
    active: true,
    nodeOverrides: Object.fromEntries(
      ids.map(([, ep]) => [ep, { packetsPerSecond: 900 }])
    ),
    edgeOverrides: {},
  }
  return room
}

async function approveAndRecover(room, incidentId) {
  const approved = approveOrchestrationPlan(room, {
    resolveContext,
    autoContinue: false,
  })
  assert.equal(approved.ok, true)
  assert.equal(
    room.responseOrchestration.workflowStatus,
    ORCHESTRATION_STATUS.APPROVED
  )
  const executed = executeOrchestrationPlan(room, {
    resolveContext,
    autoContinue: false,
  })
  assert.equal(executed.ok, true)
  const recovered = completeSelectedIncidentDummyRecovery(room, incidentId)
  assert.equal(recovered.ok, true)
  assert.equal(
    room.responseOrchestration.workflowStatus,
    ORCHESTRATION_STATUS.RECOVERED
  )
  return continueOrchestrationQueueAfterRecovery(room, {
    recoveredIncidentId: incidentId,
    resolveContext,
  })
}

describe('orchestrationQueue helpers', () => {
  it('builds a stable queue with focus first', () => {
    const detection = {
      incidents: [
        seedIncident('inc-a', 'a', { recoveryPriority: 90 }),
        seedIncident('inc-b', 'b', { recoveryPriority: 50 }),
        seedIncident('inc-c', 'c', { recoveryPriority: 70 }),
      ],
    }
    assert.deepEqual(buildStableOrchestrationQueue(detection, 'inc-b'), [
      'inc-b',
      'inc-a',
      'inc-c',
    ])
  })

  it('skips completed and missing incidents when picking next', () => {
    const detection = {
      incidents: [
        seedIncident('inc-b', 'b'),
        seedIncident('inc-c', 'c'),
      ],
    }
    assert.equal(
      nextQueuedIncidentId(detection, {
        orchestrationQueue: ['inc-a', 'inc-b', 'inc-c'],
        completedIncidentIds: ['inc-a'],
        currentIncidentId: 'inc-a',
      }),
      'inc-b'
    )
  })

  it('queue progress label shows position', () => {
    const view = queueProgressView({
      orchestrationQueue: ['a', 'b', 'c'],
      currentIncidentId: 'b',
      completedIncidentIds: ['a'],
      orchestrationCycleStatus: ORCHESTRATION_CYCLE_STATUS.AWAITING_APPROVAL,
    })
    assert.equal(view.label, 'Orchestration: 2 / 3')
    assert.equal(view.active, true)
  })
})

describe('sequential multi-incident orchestration', () => {
  const prevFlag = process.env.LLM_RESPONSE_PLAN

  before(() => {
    process.env.LLM_RESPONSE_PLAN = '1'
  })

  after(() => {
    clearLlmCommanderTestCaller()
    if (prevFlag === undefined) delete process.env.LLM_RESPONSE_PLAN
    else process.env.LLM_RESPONSE_PLAN = prevFlag
  })

  it('single incident: analyze → approve → recover → cycle complete', async () => {
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
      const room = roomWithIncidents([['inc-a', 'a']])
      const planned = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-a',
        resolveContext,
      })
      assert.equal(planned.ok, true)
      assert.deepEqual(room.responseOrchestration.orchestrationQueue, ['inc-a'])
      assert.equal(
        room.responseOrchestration.orchestrationCycleStatus,
        ORCHESTRATION_CYCLE_STATUS.AWAITING_APPROVAL
      )
      assert.equal(
        room.responseOrchestration.workflowStatus,
        ORCHESTRATION_STATUS.AWAITING_APPROVAL
      )

      const advanced = await approveAndRecover(room, 'inc-a')
      assert.equal(advanced.completed, true)
      assert.equal(advanced.advanced, false)
      assert.equal(
        room.responseOrchestration.orchestrationCycleStatus,
        ORCHESTRATION_CYCLE_STATUS.COMPLETED
      )
      assert.deepEqual(llmCalls, ['inc-a'])
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('unrelated incidents start in parallel groups (each gets own LLM at analyze)', async () => {
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
      const room = roomWithIncidents([
        ['inc-a', 'a'],
        ['inc-b', 'b'],
        ['inc-c', 'c'],
      ])
      const planned = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-a',
        resolveContext,
      })
      assert.equal(planned.ok, true)
      assert.equal(room.orchestrationGroupsMeta.length, 3)
      assert.equal(planned.parallelGroupsStarted, 3)
      // All three groups planned at analyze time (parallel bootstrap)
      assert.equal(llmCalls.length, 3)
      assert.ok(llmCalls.includes('inc-a'))
      assert.ok(llmCalls.includes('inc-b'))
      assert.ok(llmCalls.includes('inc-c'))
      // Focused group is A's singleton queue
      assert.deepEqual(room.responseOrchestration.orchestrationQueue, ['inc-a'])
      assert.equal(room.responseOrchestration.plan.primaryIncidentId, 'inc-a')
      assert.equal(
        room.responseOrchestration.workflowStatus,
        ORCHESTRATION_STATUS.AWAITING_APPROVAL
      )

      const afterA = await approveAndRecover(room, 'inc-a')
      assert.equal(afterA.completed, true)
      assert.equal(afterA.advanced, false)
      assert.equal(
        room.responseOrchestration.orchestrationCycleStatus,
        ORCHESTRATION_CYCLE_STATUS.COMPLETED
      )
      // Other groups still awaiting independently
      const bRun = room.orchestrationGroupRuns.g2 || room.orchestrationGroupRuns.g3
      assert.ok(bRun)
      const otherAwaiting = Object.values(room.orchestrationGroupRuns).filter(
        (r) =>
          r.groupId !== room.responseOrchestration.groupId &&
          r.workflowStatus === ORCHESTRATION_STATUS.AWAITING_APPROVAL
      )
      assert.equal(otherAwaiting.length, 2)
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('coupled same-asset incidents stay sequential in one group', async () => {
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
      const room = roomWithIncidents([
        ['inc-a', 'a'],
        ['inc-b', 'a'],
      ])
      const planned = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-a',
        resolveContext,
      })
      assert.equal(planned.ok, true)
      assert.equal(room.orchestrationGroupsMeta.length, 1)
      assert.deepEqual(room.responseOrchestration.orchestrationQueue, [
        'inc-a',
        'inc-b',
      ])
      assert.deepEqual(llmCalls, ['inc-a'])

      const afterA = await approveAndRecover(room, 'inc-a')
      assert.equal(afterA.advanced, true)
      assert.equal(afterA.nextIncidentId, 'inc-b')
      assert.deepEqual(llmCalls, ['inc-a', 'inc-b'])

      const afterB = await approveAndRecover(room, 'inc-b')
      assert.equal(afterB.completed, true)
      assert.equal(
        room.responseOrchestration.orchestrationCycleStatus,
        ORCHESTRATION_CYCLE_STATUS.COMPLETED
      )
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('human approval pauses the focused group (no queue advance until recovered)', async () => {
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
      // Same asset → one sequential group so approval pause is meaningful within-group
      const room = roomWithIncidents([
        ['inc-a', 'a'],
        ['inc-b', 'a'],
      ])
      await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-a',
        resolveContext,
      })
      assert.equal(llmCalls.length, 1)
      assert.equal(
        room.responseOrchestration.orchestrationCycleStatus,
        ORCHESTRATION_CYCLE_STATUS.AWAITING_APPROVAL
      )

      const approved = approveOrchestrationPlan(room, {
        resolveContext,
        autoContinue: false,
      })
      assert.equal(approved.ok, true)
      // Approval alone must not advance to B within the group
      assert.equal(llmCalls.length, 1)
      assert.equal(room.responseOrchestration.plan.primaryIncidentId, 'inc-a')
      assert.ok(
        !room.responseOrchestration.completedIncidentIds.includes('inc-a')
      )
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('within a coupled group, skips incidents that disappear before their turn', async () => {
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
      const room = roomWithIncidents([
        ['inc-a', 'shared'],
        ['inc-b', 'shared'],
        ['inc-c', 'shared'],
      ])
      await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-a',
        resolveContext,
      })
      assert.equal(room.orchestrationGroupsMeta.length, 1)
      // Remove B before A recovers
      room.detection.incidents = room.detection.incidents.filter(
        (i) => i.id !== 'inc-b'
      )
      room.detection.anomalyNodeIds = ['shared']

      const afterA = await approveAndRecover(room, 'inc-a')
      assert.equal(afterA.advanced, true)
      assert.equal(afterA.nextIncidentId, 'inc-c')
      assert.equal(room.responseOrchestration.plan.primaryIncidentId, 'inc-c')
      assert.deepEqual(llmCalls, ['inc-a', 'inc-c'])
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('does not rebuild groups when merely selecting focus mid-cycle', () => {
    const room = roomWithIncidents([
      ['inc-a', 'a'],
      ['inc-b', 'b'],
    ])
    beginOrchestrationCycleQueue(room, { focusIncidentId: 'inc-a' })
    const firstMeta = JSON.stringify(room.orchestrationGroupsMeta)
    const firstQueue = [...room.responseOrchestration.orchestrationQueue]
    beginOrchestrationCycleQueue(room, { focusIncidentId: 'inc-b' })
    assert.equal(JSON.stringify(room.orchestrationGroupsMeta), firstMeta)
    assert.deepEqual(room.responseOrchestration.orchestrationQueue, firstQueue)
    assert.equal(room.responseOrchestration.currentIncidentId, 'inc-a')
  })

  it('LLM failure does not mark recovered or advance the queue', async () => {
    setLlmCommanderTestCaller(async () => {
      const err = new Error('ollama unreachable')
      err.code = 'LLM_UNAVAILABLE'
      throw err
    })
    try {
      const room = roomWithIncidents([
        ['inc-a', 'a'],
        ['inc-b', 'a'],
      ])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-a',
        resolveContext,
      })
      assert.equal(result.ok, false)
      assert.notEqual(
        room.responseOrchestration.workflowStatus,
        ORCHESTRATION_STATUS.RECOVERED
      )
      assert.deepEqual(room.responseOrchestration.completedIncidentIds, [])
      assert.equal(room.responseOrchestration.currentIncidentId, 'inc-a')
      assert.ok(
        room.responseOrchestration.orchestrationQueue.includes('inc-b')
      )
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('zero incidents: begin does nothing', () => {
    const room = createEmptyRoom('Q0')
    room.detection = { incidents: [] }
    const started = beginOrchestrationCycleQueue(room, {})
    assert.equal(started.started, false)
    assert.deepEqual(room.responseOrchestration.orchestrationQueue, [])
  })
})

describe('sequential orchestration (deterministic planner)', () => {
  const prevFlag = process.env.LLM_RESPONSE_PLAN

  before(() => {
    process.env.LLM_RESPONSE_PLAN = '0'
  })

  after(() => {
    if (prevFlag === undefined) delete process.env.LLM_RESPONSE_PLAN
    else process.env.LLM_RESPONSE_PLAN = prevFlag
  })

  it('advances A → B only after recovery with deterministic plans (coupled group)', async () => {
    const room = roomWithIncidents([
      ['inc-a', 'shared'],
      ['inc-b', 'shared'],
    ])
    const planned = generateOrchestrationPlan(room, {
      focusIncidentId: 'inc-a',
      resolveContext,
    })
    assert.equal(planned.ok, true)
    assert.equal(room.responseOrchestration.plan.primaryIncidentId, 'inc-a')
    assert.equal(
      room.responseOrchestration.plan.approvalStatus,
      PLAN_APPROVAL_STATUS.PENDING
    )

    const afterA = await approveAndRecover(room, 'inc-a')
    assert.equal(afterA.advanced, true)
    assert.equal(room.responseOrchestration.plan.primaryIncidentId, 'inc-b')
    assert.equal(
      room.responseOrchestration.workflowStatus,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )

    const afterB = await approveAndRecover(room, 'inc-b')
    assert.equal(afterB.completed, true)
    assert.equal(
      room.responseOrchestration.orchestrationCycleStatus,
      ORCHESTRATION_CYCLE_STATUS.COMPLETED
    )
  })
})
