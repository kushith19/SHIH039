import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { createEmptyRoom } from '../roomStore.js'
import {
  applyDummySelectedIncidentRecovery,
  approveOrchestrationPlan,
  generateOrchestrationPlan,
  generateOrchestrationPlanMaybeLlm,
  publicOrchestrationState,
} from './orchestrate.js'
import {
  clearLlmCommanderTestCaller,
  getLastLlmResponse,
  setLlmCommanderTestCaller,
  ollamaRunnerIsRequestedModel,
  OLLAMA_MODEL,
  OLLAMA_NUM_CTX,
  OLLAMA_NUM_PREDICT,
} from './llmCommanderClient.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { attachRecoveryImpact } from '../../shared/recovery/recoveryImpact.js'
import { ORCHESTRATION_STATUS, PLAN_APPROVAL_STATUS } from '../../shared/response/orchestration.js'

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
    relatedIncidents: (room.detection?.incidents ?? [])
      .filter((i) => i.id !== live.id)
      .map((i) => ({ id: i.id, severity: i.severity, endpointId: i.endpointId })),
  }
  return attachAvailableResponseActions(
    attachResponseClassification(base, room.nodes ?? [])
  )
}

function roomFixture(incidents) {
  const room = createEmptyRoom('LLM1')
  room.phase = 'playing'
  room.nodes = [node('pay'), node('gw')]
  room.edges = [{ id: 'e1', source: 'pay', target: 'gw' }]
  room.detection = {
    incidents,
    anomalyNodeIds: incidents.map((i) => i.endpointId),
  }
  attachRecoveryImpact(room.detection, {
    nodes: room.nodes,
    edges: room.edges,
    overrides: {},
  })
  return room
}

describe('LLM Commander orchestration STEP 2', () => {
  const prevFlag = process.env.LLM_RESPONSE_PLAN
  const prevMode = process.env.RESPONSE_PLAN_MODE

  before(() => {
    process.env.LLM_RESPONSE_PLAN = '1'
    delete process.env.RESPONSE_PLAN_MODE
  })

  after(() => {
    clearLlmCommanderTestCaller()
    if (prevFlag === undefined) delete process.env.LLM_RESPONSE_PLAN
    else process.env.LLM_RESPONSE_PLAN = prevFlag
    if (prevMode === undefined) delete process.env.RESPONSE_PLAN_MODE
    else process.env.RESPONSE_PLAN_MODE = prevMode
  })

  it('valid JSON actions → ResponsePlan at AWAITING_APPROVAL (no auto-exec)', async () => {
    const logs = []
    const orig = console.log
    let invoked = 0
    console.log = (...args) => logs.push(args.map(String).join(' '))
    setLlmCommanderTestCaller(async () => {
      invoked += 1
      return {
        summary: 'Contain the affected endpoint',
        actions: [
          {
            actionId: 'isolate-node',
            target: 'pay',
            rationale: 'Contain the affected endpoint',
          },
        ],
        confidence: 0.9,
        uncertainty: 'Operator must confirm service impact',
      }
    })
    try {
      const room = roomFixture([seedIncident('inc-pay', 'pay')])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(result.ok, true)
      assert.equal(invoked, 1)
      assert.equal(result.executed, false)
      const orch = publicOrchestrationState(room)
      assert.equal(orch.workflowStatus, ORCHESTRATION_STATUS.AWAITING_APPROVAL)
      assert.equal(orch.plan.approvalStatus, PLAN_APPROVAL_STATUS.PENDING)
      assert.deepEqual(
        orch.plan.recommendedActions.map((a) => a.actionId),
        ['isolate-node']
      )
      assert.equal(
        orch.plan.recommendedActions[0].reason,
        'Contain the affected endpoint'
      )
      assert.ok(logs.some((l) => l.startsWith('[LLM ANALYZE]')))
      assert.ok(logs.some((l) => l.startsWith('[LLM REQUEST START]')))
      assert.ok(logs.some((l) => l.startsWith('[LLM REQUEST SENT]')))
      assert.ok(logs.some((l) => l.startsWith('[LLM RESPONSE RECEIVED]')))
      assert.ok(logs.some((l) => l.startsWith('[LLM RAW]')))
      assert.ok(logs.some((l) => l.startsWith('[LLM PARSED]')))
      assert.ok(logs.some((l) => l.startsWith('[LLM VALIDATED]')))
      assert.ok(logs.some((l) => l.startsWith('[LLM FINAL PLAN]')))
      assert.ok(logs.some((l) => /isolate-node/.test(l)))

      // LLM output must not reach executeResponseAction directly
      const beforeQ =
        room.nodes.find((n) => n.id === 'pay')?.data?.runtimeState?.quarantined
      assert.equal(beforeQ, false)
    } finally {
      console.log = orig
      clearLlmCommanderTestCaller()
    }
  })

  it('acknowledged incidents remain eligible for LLM planning', async () => {
    let invoked = 0
    setLlmCommanderTestCaller(async (payload) => {
      invoked += 1
      return {
        actions: [
          {
            actionId: 'isolate-node',
            target: payload.serverAuthoritativeTarget,
            rationale: 'Contain the acknowledged incident endpoint',
          },
        ],
      }
    })
    try {
      const room = roomFixture([
        seedIncident('inc-pay', 'pay', { status: 'acknowledged' }),
      ])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        resolveContext,
      })
      assert.equal(result.ok, true)
      assert.equal(invoked, 1)
      assert.equal(
        room.responseOrchestration.workflowStatus,
        ORCHESTRATION_STATUS.AWAITING_APPROVAL
      )
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('selects one global primary from multiple active incidents', async () => {
    let selectedIncidentId = null
    setLlmCommanderTestCaller(async (payload) => {
      selectedIncidentId = payload.incident.incidentId
      return {
        actions: [
          {
            actionId: 'isolate-node',
            target: payload.serverAuthoritativeTarget,
            rationale: 'Contain the highest recovery-priority endpoint',
          },
        ],
      }
    })
    try {
      const room = roomFixture([
        seedIncident('inc-pay', 'pay', { recoveryPriority: 20 }),
        seedIncident('inc-gw', 'gw', { recoveryPriority: 90 }),
      ])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        resolveContext,
      })
      assert.equal(result.ok, true)
      assert.equal(selectedIncidentId, 'inc-gw')
      assert.equal(room.responseOrchestration.plan.primaryIncidentId, 'inc-gw')
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('skips without invoking the LLM when no active incident exists', async () => {
    let invoked = 0
    setLlmCommanderTestCaller(async () => {
      invoked += 1
      return { actions: ['isolate-node'] }
    })
    try {
      const room = roomFixture([
        seedIncident('inc-pay', 'pay', { status: 'cleared' }),
      ])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(result.ok, false)
      assert.equal(result.statusCode, 404)
      assert.equal(invoked, 0)
      assert.equal(
        room.responseOrchestration.workflowStatus,
        ORCHESTRATION_STATUS.IDLE
      )
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('rejects a hallucinated target without creating a plan', async () => {
    setLlmCommanderTestCaller(async () => ({
      actions: [
        {
          actionId: 'isolate-node',
          target: 'invented-node',
          rationale: 'Contain',
        },
      ],
    }))
    try {
      const room = roomFixture([seedIncident('inc-pay', 'pay')])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(result.ok, false)
      assert.equal(result.code, 'INVALID_TARGET')
      assert.equal(room.responseOrchestration.plan, null)
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('reports an LLM timeout without deterministic fallback', async () => {
    setLlmCommanderTestCaller(async () => {
      const error = new Error('request timed out')
      error.name = 'AbortError'
      throw error
    })
    try {
      const room = roomFixture([seedIncident('inc-pay', 'pay')])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(result.ok, false)
      assert.equal(result.code, 'LLM_TIMEOUT')
      assert.equal(room.responseOrchestration.plan, null)
      assert.equal(
        room.responseOrchestration.workflowStatus,
        ORCHESTRATION_STATUS.LLM_ERROR
      )
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('malformed JSON fails safely without inventing actions', async () => {
    setLlmCommanderTestCaller(async () => 'TOTALLY NOT JSON')
    try {
      const room = roomFixture([seedIncident('inc-pay', 'pay')])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(result.ok, false)
      assert.equal(result.executed, false)
      assert.match(result.message, /LLM Commander planning failed/)
      assert.equal(
        publicOrchestrationState(room).workflowStatus,
        ORCHESTRATION_STATUS.LLM_ERROR
      )
      assert.equal(room.responseOrchestration.plan, null)
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('empty actions fails safely', async () => {
    setLlmCommanderTestCaller(async () => ({ actions: [] }))
    try {
      const room = roomFixture([seedIncident('inc-pay', 'pay')])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(result.ok, false)
      assert.match(result.message, /empty|EMPTY/i)
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('hallucinated action ID fails safely', async () => {
    setLlmCommanderTestCaller(async () => ({ actions: ['disable-nuclear-reactor'] }))
    try {
      const room = roomFixture([seedIncident('inc-pay', 'pay')])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(result.ok, false)
      assert.match(result.message, /Unknown|hallucinated|failed/i)
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('catalog-only action fails safely', async () => {
    setLlmCommanderTestCaller(async () => ({ actions: ['disable-camera'] }))
    try {
      const room = roomFixture([seedIncident('inc-pay', 'pay')])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(result.ok, false)
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('LLM may select repository actions that policy would not offer', async () => {
    setLlmCommanderTestCaller(async () => ({ actions: ['restore-connectivity'] }))
    try {
      const room = roomFixture([seedIncident('inc-pay', 'pay')])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(result.ok, true)
      assert.deepEqual(
        room.responseOrchestration.plan.executionOrder,
        ['restore-connectivity']
      )
      assert.equal(
        room.responseOrchestration.workflowStatus,
        ORCHESTRATION_STATUS.AWAITING_APPROVAL
      )
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('multiple actions preserve LLM order and still require human approval', async () => {
    setLlmCommanderTestCaller(async (payload) => {
      const target = payload.serverAuthoritativeTarget
      return {
        actions: [
          {
            actionId: 'capture-device-state',
            target,
            rationale: 'Preserve endpoint state first',
            expectedImpact: 'Evidence available for later containment',
          },
          {
            actionId: 'isolate-node',
            target,
            rationale: 'Contain after evidence capture',
            expectedImpact: 'Reduce further communication from the endpoint',
          },
        ],
      }
    })
    try {
      const room = roomFixture([seedIncident('inc-pay', 'pay')])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(result.ok, true)
      const plan = room.responseOrchestration.plan
      assert.ok(plan.recommendedActions.length >= 1)
      assert.equal(plan.approvalStatus, PLAN_APPROVAL_STATUS.PENDING)
      assert.equal(
        room.responseOrchestration.workflowStatus,
        ORCHESTRATION_STATUS.AWAITING_APPROVAL
      )

      // Approve still required before execute
      const approved = approveOrchestrationPlan(room, {
        resolveContext,
        autoContinue: false,
      })
      assert.equal(approved.ok, true)
      assert.equal(
        room.responseOrchestration.workflowStatus,
        ORCHESTRATION_STATUS.APPROVED
      )
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('multiple incidents: LLM plans for focused primary only', async () => {
    setLlmCommanderTestCaller(async () => ({ actions: ['isolate-node'] }))
    try {
      const room = roomFixture([
        seedIncident('inc-pay', 'pay'),
        seedIncident('inc-gw', 'gw', { severity: 'medium', anomalyScore: 0.5 }),
      ])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-gw',
        resolveContext,
      })
      assert.equal(result.ok, true)
      assert.equal(room.responseOrchestration.plan.primaryIncidentId, 'inc-gw')
      assert.deepEqual(room.responseOrchestration.plan.affectedNodeIds, ['gw'])
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('preserves three distinct attack-aware strategies without appending playbook actions', async () => {
    const cases = [
      {
        presetId: 'api_abuse',
        incident: seedIncident('inc-api', 'pay', {
          peerExposedNodeIds: ['gw'],
          evidence: [{
            code: 'metric_deviation',
            metric: 'httpRequestsPerMin',
            observed: 9000,
            expected: 100,
            deviationPct: 8900,
          }],
        }),
        actionId: 'enforce-policy',
        summary: 'API request volume is materially above baseline.',
        interpretation: 'Assessment: API abuse with peer exposure.',
        strategy: 'Enforce the expected communication policy.',
      },
      {
        presetId: 'credential_spray',
        incident: seedIncident('inc-cred', 'gw', {
          evidence: [{
            code: 'metric_deviation',
            metric: 'failedLoginsPerMin',
            observed: 350,
            expected: 2,
            deviationPct: 17400,
          }],
        }),
        actionId: 'capture-device-state',
        summary: 'Failed logins show a credential-focused anomaly.',
        interpretation: 'Assessment: credential spray against the gateway.',
        strategy: 'Preserve identity endpoint state before containment.',
      },
      {
        presetId: 'data_exfiltration',
        incident: seedIncident('inc-exfil', 'pay', {
          evidence: [{
            code: 'metric_deviation',
            metric: 'filesDownloaded',
            observed: 700,
            expected: 5,
            deviationPct: 13900,
          }],
        }),
        actionId: 'block-external-communication',
        summary: 'File-transfer volume is materially above baseline.',
        interpretation: 'Assessment: possible data exfiltration.',
        strategy: 'Restrict external communication while preserving evidence.',
      },
    ]

    assert.equal(OLLAMA_MODEL, process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct')
    assert.equal(OLLAMA_NUM_CTX, 8192)
    assert.equal(OLLAMA_NUM_PREDICT, 1024)
    setLlmCommanderTestCaller(async (payload) => {
      assert.equal(payload.policy, undefined)
      assert.equal(payload.instruction, undefined)
      assert.ok((payload.availableActions ?? []).length >= 8)
      const current = cases.find(
        (item) => item.presetId === payload.attackContext?.presetId
      )
      assert.ok(current)
      return {
        summary: current.summary,
        attackInterpretation: current.interpretation,
        strategy: current.strategy,
        actions: [{
          actionId: current.actionId,
          target: payload.serverAuthoritativeTarget,
          rationale: `Use ${current.actionId} for this evidence.`,
          expectedImpact: 'Reduce the observed risk while preserving monitoring.',
          confidence: 0.84,
          dependencies: [],
        }],
        riskAssessment: 'Operator must consider service continuity.',
        uncertainty: 'Attribution remains unconfirmed.',
      }
    })

    try {
      for (const current of cases) {
        const room = roomFixture([current.incident])
        room.hackSimulator.nodeAttackStates[current.incident.endpointId] = true
        room.hackSimulator.nodePresetIds = {
          ...(room.hackSimulator.nodePresetIds ?? {}),
          [current.incident.endpointId]: current.presetId,
        }
        room.hackSimulator.nodeOverrides[current.incident.endpointId] = {
          [current.incident.evidence[0].metric]: current.incident.evidence[0].observed,
        }
        room.activeAttackSequences = {
          seq: {
            status: 'active',
            nodePath: [current.incident.endpointId],
            events: [{ kind: 'seed', presetId: current.presetId }],
          },
        }
        const result = await generateOrchestrationPlanMaybeLlm(room, {
          focusIncidentId: current.incident.id,
          resolveContext,
        })
        assert.equal(result.ok, true)
        const plan = room.responseOrchestration.plan
        assert.deepEqual(plan.executionOrder, [current.actionId])
        assert.equal(plan.recommendedActions.length, 1)
        assert.equal(plan.llmSummary, current.summary)
        assert.equal(plan.attackInterpretation, current.interpretation)
        assert.equal(plan.strategy, current.strategy)
        assert.match(plan.recommendedActions[0].reason, new RegExp(current.actionId))
        assert.equal(plan.recommendedActions[0].confidence, 0.84)
        assert.equal(plan.approvalStatus, PLAN_APPROVAL_STATUS.PENDING)
        assert.equal(plan.planSource, 'llm')
        assert.equal(
          room.responseOrchestration.workflowStatus,
          ORCHESTRATION_STATUS.AWAITING_APPROVAL
        )
        console.log('PRESET', current.presetId)
        console.log('ATTACK TYPE', current.incident.evidence[0].metric)
        console.log(
          'KEY TELEMETRY CHANGES',
          JSON.stringify(current.incident.evidence[0])
        )
        console.log('COMMANDER ACTIONS', JSON.stringify(plan.executionOrder))
        console.log('COMMANDER SUMMARY', plan.llmSummary)
        console.log('COMMANDER STRATEGY', plan.strategy)
      }
      const debug = getLastLlmResponse()
      assert.equal(debug.isTest, true)
      assert.equal(debug.inputContext.policy, undefined)
      assert.ok((debug.inputContext.availableActions ?? []).length >= 8)
      assert.equal(debug.inputContext.attackContext.presetId, 'data_exfiltration')
      assert.match(debug.parsedResponse.strategy, /external communication/)
      assert.equal(debug.validatedResponse.actions[0].actionId, 'block-external-communication')
      assert.equal(debug.finalPlan.strategy, cases[2].strategy)
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('does not treat qwen2.5:7b as the instruct planner runner', () => {
    assert.equal(
      ollamaRunnerIsRequestedModel({ name: 'qwen2.5:7b' }, 'qwen2.5:7b-instruct'),
      false
    )
    assert.equal(
      ollamaRunnerIsRequestedModel({ name: 'qwen2.5:7b-instruct' }, 'qwen2.5:7b-instruct'),
      true
    )
    assert.equal(
      ollamaRunnerIsRequestedModel(
        { name: 'qwen2.5:7b-instruct:latest' },
        'qwen2.5:7b-instruct'
      ),
      true
    )
  })

  it('deterministic generate remains available when flag off', async () => {
    process.env.LLM_RESPONSE_PLAN = '0'
    clearLlmCommanderTestCaller()
    const room = roomFixture([seedIncident('inc-pay', 'pay')])
    const result = await generateOrchestrationPlanMaybeLlm(room, {
      focusIncidentId: 'inc-pay',
      resolveContext,
    })
    assert.equal(result.ok, true)
    assert.equal(
      room.responseOrchestration.workflowStatus,
      ORCHESTRATION_STATUS.AWAITING_APPROVAL
    )
    assert.equal(room.responseOrchestration.plan?.planSource, 'policy')
    process.env.LLM_RESPONSE_PLAN = '1'
  })

  it('LLM mode does not silently use the deterministic planner on failure', async () => {
    setLlmCommanderTestCaller(async () => {
      throw new Error('ECONNREFUSED')
    })
    try {
      const room = roomFixture([seedIncident('inc-pay', 'pay')])
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(result.ok, false)
      assert.equal(room.responseOrchestration.plan, null)
      assert.notEqual(result.code, undefined)
      assert.equal(
        room.responseOrchestration.workflowStatus,
        ORCHESTRATION_STATUS.LLM_ERROR
      )
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('LLM planning never enters executeResponseAction boundary', async () => {
    setLlmCommanderTestCaller(async () => ({ actions: ['isolate-node'] }))
    try {
      const room = roomFixture([seedIncident('inc-pay', 'pay')])
      await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      const q = room.nodes.find((n) => n.id === 'pay')?.data?.runtimeState?.quarantined
      assert.equal(q, false)
      assert.equal(room.responseOrchestration.execution, null)
      assert.deepEqual(room.detection.incidents[0].actionsTaken, [])
      assert.equal(
        room.responseOrchestration.workflowStatus,
        ORCHESTRATION_STATUS.AWAITING_APPROVAL
      )
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('a second Analyze after a plan is ready issues a fresh LLM request and does not execute', async () => {
    let invoked = 0
    setLlmCommanderTestCaller(async () => {
      invoked += 1
      return {
        actions: [
          {
            actionId: invoked === 1 ? 'isolate-node' : 'block-external-communication',
            target: 'pay',
            rationale: invoked === 1 ? 'first' : 'second',
          },
        ],
      }
    })
    try {
      const room = roomFixture([seedIncident('inc-pay', 'pay')])
      const first = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(first.ok, true)
      assert.equal(invoked, 1)
      assert.deepEqual(
        room.responseOrchestration.plan.recommendedActions.map((a) => a.actionId),
        ['isolate-node']
      )
      const second = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-pay',
        resolveContext,
      })
      assert.equal(second.ok, true)
      assert.equal(invoked, 2)
      assert.deepEqual(
        room.responseOrchestration.plan.recommendedActions.map((a) => a.actionId),
        ['block-external-communication']
      )
      assert.equal(room.responseOrchestration.execution, null)
      assert.equal(
        room.nodes.find((n) => n.id === 'pay')?.data?.runtimeState?.quarantined,
        false
      )
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('plans only the explicitly selected incident among three active incidents', async () => {
    let selectedIncidentId = null
    setLlmCommanderTestCaller(async (payload) => {
      selectedIncidentId = payload.incident.incidentId
      return {
        actions: [
          {
            actionId: 'isolate-node',
            target: payload.serverAuthoritativeTarget,
            rationale: 'Contain the selected incident only',
          },
        ],
      }
    })
    try {
      const room = createEmptyRoom('SEL1')
      room.phase = 'playing'
      room.nodes = [node('n1'), node('n2'), node('n3')]
      room.edges = []
      room.detection = {
        incidents: [
          seedIncident('inc-1', 'n1', { recoveryPriority: 90 }),
          seedIncident('inc-2', 'n2', { recoveryPriority: 10 }),
          seedIncident('inc-3', 'n3', { recoveryPriority: 50 }),
        ],
        anomalyNodeIds: ['n1', 'n2', 'n3'],
      }
      attachRecoveryImpact(room.detection, {
        nodes: room.nodes,
        edges: room.edges,
        overrides: {},
      })
      const result = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-2',
        resolveContext,
      })
      assert.equal(result.ok, true)
      assert.equal(selectedIncidentId, 'inc-2')
      assert.equal(room.responseOrchestration.plan.primaryIncidentId, 'inc-2')
      assert.equal(room.responseOrchestration.plan.affectedNodeIds?.[0], 'n2')
    } finally {
      clearLlmCommanderTestCaller()
    }
  })

  it('dummy recovery clears only the selected incident', () => {
    const room = createEmptyRoom('SEL2')
    room.phase = 'playing'
    room.nodes = [node('n1'), node('n2'), node('n3')]
    room.detection = {
      incidents: [
        seedIncident('inc-1', 'n1'),
        seedIncident('inc-2', 'n2'),
        seedIncident('inc-3', 'n3'),
      ],
      anomalyNodeIds: ['n1', 'n2', 'n3'],
    }
    const recovered = applyDummySelectedIncidentRecovery(room, 'inc-2')
    assert.equal(recovered.ok, true)
    const ids = (room.detection.incidents ?? []).map((i) => i.id)
    assert.deepEqual(ids, ['inc-1', 'inc-3'])
    assert.deepEqual(room.detection.anomalyNodeIds, ['n1', 'n3'])
    assert.equal(
      room.nodes.find((n) => n.id === 'n2')?.data?.runtimeState?.quarantined,
      true
    )
    assert.equal(
      room.nodes.find((n) => n.id === 'n1')?.data?.runtimeState?.quarantined,
      false
    )
    assert.equal(
      room.nodes.find((n) => n.id === 'n3')?.data?.runtimeState?.quarantined,
      false
    )
  })

  it('a later Response on a different incident issues a new Planner call', async () => {
    let selected = []
    setLlmCommanderTestCaller(async (payload) => {
      selected.push(payload.incident.incidentId)
      return {
        actions: [
          {
            actionId: 'isolate-node',
            target: payload.serverAuthoritativeTarget,
            rationale: 'Contain selected',
          },
        ],
      }
    })
    try {
      const room = createEmptyRoom('SEL3')
      room.phase = 'playing'
      room.nodes = [node('n1'), node('n2'), node('n3')]
      room.detection = {
        incidents: [
          seedIncident('inc-1', 'n1'),
          seedIncident('inc-2', 'n2'),
          seedIncident('inc-3', 'n3'),
        ],
        anomalyNodeIds: ['n1', 'n2', 'n3'],
      }
      attachRecoveryImpact(room.detection, {
        nodes: room.nodes,
        edges: room.edges,
        overrides: {},
      })
      const first = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-2',
        resolveContext,
      })
      assert.equal(first.ok, true)
      applyDummySelectedIncidentRecovery(room, 'inc-2')
      room.responseOrchestration.workflowStatus = ORCHESTRATION_STATUS.RECOVERED
      room.responseOrchestration.status = ORCHESTRATION_STATUS.RECOVERED
      const second = await generateOrchestrationPlanMaybeLlm(room, {
        focusIncidentId: 'inc-3',
        resolveContext,
      })
      assert.equal(second.ok, true)
      assert.deepEqual(selected, ['inc-2', 'inc-3'])
      assert.equal(room.responseOrchestration.plan.primaryIncidentId, 'inc-3')
    } finally {
      clearLlmCommanderTestCaller()
    }
  })
})
