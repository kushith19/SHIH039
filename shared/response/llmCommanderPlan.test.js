import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildLlmCommanderPromptPayload,
  llmResponsePlanEnabled,
  logLlmCommanderPlan,
  parseAndValidateLlmCommanderPlan,
  parseLlmCommanderActionsJson,
  validateLlmCommanderActions,
} from './llmCommanderPlan.js'
import { buildResponsePlan } from './responsePlan.js'
import { attachAvailableResponseActions } from '../responseActions.js'
import { attachResponseClassification } from '../responsePolicy.js'

function node(id) {
  return {
    id,
    data: {
      label: id.toUpperCase(),
      criticality: 'high',
      runtimeState: { quarantined: false },
    },
  }
}

function seedContext(endpointId = 'pay', extra = {}) {
  const nodes = [node(endpointId), node('peer')]
  const base = {
    incidentId: 'inc-pay',
    liveIncidentId: 'inc-pay',
    incidentType: 'behavioral_anomaly',
    severity: 'high',
    status: 'open',
    affectedAsset: {
      id: endpointId,
      summary: 'PAY',
      type: 'payment_processing_system',
      sector: 'Finance',
      criticality: 'critical',
      quarantined: false,
    },
    riskScore: 0.9,
    trustScore: 30,
    anomalyEvidence: [
      {
        code: 'metric_deviation',
        metric: 'packetsPerSecond',
        observed: 900,
        expected: 100,
        deviationPct: 800,
      },
    ],
    peerExposure: ['peer'],
    propagatedNodeIds: ['peer'],
    actionsAlreadyTaken: [],
    isExposureIncident: false,
    relatedIncidents: [{ id: 'inc-peer', severity: 'medium', endpointId: 'peer' }],
    ...extra,
  }
  return attachAvailableResponseActions(attachResponseClassification(base, nodes))
}

describe('LLM Commander plan parse/validate', () => {
  it('parses valid JSON action array', () => {
    const ctx = seedContext()
    const available = (ctx.availableActions ?? []).map((a) => a.actionId)
    assert.ok(available.includes('isolate-node'))

    const raw = JSON.stringify({
      summary: 'PPS spike on pay',
      actions: ['isolate-node'],
    })
    const result = parseAndValidateLlmCommanderPlan(raw, ctx)
    assert.equal(result.ok, true)
    assert.deepEqual(result.actionIds, ['isolate-node'])
    assert.deepEqual(result.actions[0], {
      actionId: 'isolate-node',
      target: 'pay',
      rationale: null,
      expectedImpact: null,
      confidence: null,
      dependencies: [],
    })
    assert.equal(result.summary, 'PPS spike on pay')
  })

  it('normalizes legacy string actions without inventing rationale', () => {
    const ctx = seedContext()
    const raw = {
      summary: 'Evidence-backed residual rise',
      actions: ['isolate-node'],
      uncertainty: 'operator verification required',
    }
    const result = parseAndValidateLlmCommanderPlan(raw, ctx)
    assert.equal(result.ok, true)
    assert.deepEqual(result.actionIds, ['isolate-node'])
    assert.equal(result.actions[0].rationale, null)
    assert.equal(result.uncertainty, 'operator verification required')
  })

  it('accepts canonical actions and preserves rationale', () => {
    const ctx = seedContext()
    const result = parseAndValidateLlmCommanderPlan(
      {
        summary: 'Contain the affected endpoint',
        actions: [
          {
            actionId: 'isolate-node',
            target: 'pay',
            rationale: 'Contain the affected endpoint',
          },
        ],
        confidence: 0.8,
        uncertainty: 'Operator must confirm service impact',
      },
      ctx,
      { room: { nodes: [node('pay'), node('peer')] } }
    )
    assert.equal(result.ok, true)
    assert.equal(result.actions[0].target, 'pay')
    assert.equal(result.actions[0].rationale, 'Contain the affected endpoint')
    assert.equal(result.confidence, 0.8)
  })

  it('preserves rich attack strategy and ordered action reasoning', () => {
    const ctx = seedContext()
    const result = parseAndValidateLlmCommanderPlan(
      {
        summary: 'Observed packet volume is materially above baseline.',
        attackInterpretation: 'Assessment: volumetric service pressure at the seed.',
        strategy: 'Capture evidence, then contain the affected endpoint.',
        actions: [
          {
            actionId: 'inspect-peer-history',
            target: 'pay',
            rationale: 'Check whether the observed exposure has peer activity.',
            expectedImpact: 'Preserves peer evidence before containment.',
            confidence: 0.72,
            dependencies: [],
          },
          {
            actionId: 'isolate-node',
            target: 'pay',
            rationale: 'Contain the confirmed high-risk seed.',
            expectedImpact: 'Stops active communication from the seed.',
            confidence: 0.91,
            dependencies: ['inspect-peer-history'],
          },
        ],
        riskAssessment: 'Isolation may disrupt payment availability.',
        uncertainty: 'Operator must validate service continuity impact.',
      },
      ctx,
      {
        source: 'ollama-direct',
        room: { nodes: [node('pay'), node('peer')] },
      }
    )
    assert.equal(result.ok, true)
    assert.match(result.attackInterpretation, /volumetric/)
    assert.match(result.strategy, /Capture evidence/)
    assert.match(result.riskAssessment, /payment availability/)
    assert.equal(result.actions[1].expectedImpact, 'Stops active communication from the seed.')
    assert.equal(result.actions[1].confidence, 0.91)
    assert.deepEqual(result.actions[1].dependencies, ['inspect-peer-history'])
  })

  it('rejects incomplete rich output from a live provider', () => {
    const result = parseAndValidateLlmCommanderPlan(
      {
        summary: 'Only a summary and action were returned.',
        actions: ['isolate-node'],
      },
      seedContext(),
      { source: 'ollama-direct' }
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, 'INVALID_RICH_PLAN')
  })

  it('rejects forward or unknown action dependencies', () => {
    const result = parseAndValidateLlmCommanderPlan(
      {
        actions: [
          {
            actionId: 'isolate-node',
            target: 'pay',
            rationale: 'Contain',
            dependencies: ['inspect-peer-history'],
          },
        ],
      },
      seedContext(),
      { room: { nodes: [node('pay'), node('peer')] } }
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, 'INVALID_DEPENDENCY')
  })

  it('rejects a hallucinated canonical target', () => {
    const ctx = seedContext()
    const result = parseAndValidateLlmCommanderPlan(
      {
        actions: [
          {
            actionId: 'isolate-node',
            target: 'invented-node',
            rationale: 'Contain',
          },
        ],
      },
      ctx,
      { room: { nodes: [node('pay'), node('peer')] } }
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, 'INVALID_TARGET')
  })

  it('rejects malformed JSON', () => {
    const ctx = seedContext()
    const result = parseAndValidateLlmCommanderPlan('not-json', ctx)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'MALFORMED_JSON')
  })

  it('rejects truncated JSON without silent playbook fallback', () => {
    const ctx = seedContext()
    const result = parseAndValidateLlmCommanderPlan(
      '{"summary":"partial","actions":[{"actionId":"isolate-node"',
      ctx
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, 'TRUNCATED_JSON')
  })

  it('rejects empty Ollama content', () => {
    const ctx = seedContext()
    const result = parseAndValidateLlmCommanderPlan('   ', ctx)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'EMPTY_RESPONSE')
  })

  it('rejects empty actions array', () => {
    const ctx = seedContext()
    const result = parseAndValidateLlmCommanderPlan('{"actions":[]}', ctx)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'EMPTY_ACTIONS')
  })

  it('rejects hallucinated action ID', () => {
    const ctx = seedContext()
    const result = parseAndValidateLlmCommanderPlan(
      '{"actions":["launch-missiles"]}',
      ctx
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, 'UNKNOWN_ACTION')
  })

  it('rejects catalog-only / unsupported action', () => {
    const ctx = seedContext()
    const result = parseAndValidateLlmCommanderPlan(
      '{"actions":["disable-camera"]}',
      ctx
    )
    assert.equal(result.ok, false)
    assert.ok(
      result.code === 'CATALOG_ONLY' || result.code === 'UNKNOWN_ACTION',
      result.code
    )
  })

  it('accepts repository actions that policy would not offer', () => {
    const ctx = seedContext()
    const ids = (ctx.availableActions ?? []).map((a) => a.actionId)
    assert.ok(!ids.includes('restore-connectivity'))
    const result = validateLlmCommanderActions(['restore-connectivity'], ctx)
    assert.equal(result.ok, true)
    assert.deepEqual(result.actionIds, ['restore-connectivity'])
  })

  it('does not use policy to reject isolate on exposure incidents', () => {
    const ctx = seedContext('peer', { isExposureIncident: true })
    ctx.responseClassification = {
      ...(ctx.responseClassification ?? {}),
      isExposureOnly: true,
      responseProfile: 'PROPAGATED_EXPOSURE',
    }
    ctx.responsePolicy = {
      ...(ctx.responsePolicy ?? {}),
      responseProfile: 'PROPAGATED_EXPOSURE',
      recommendedActions: [],
      executionConstraints: {
        ...(ctx.responsePolicy?.executionConstraints ?? {}),
        exposureOnly: true,
      },
    }
    ctx.availableActions = []
    const result = validateLlmCommanderActions(['isolate-node'], ctx)
    assert.equal(result.ok, true)
    assert.deepEqual(result.actionIds, ['isolate-node'])
  })

  it('accepts multiple actions and preserves order', () => {
    const ctx = seedContext()
    const pick = ['capture-device-state', 'isolate-node']
    const result = parseAndValidateLlmCommanderPlan(
      JSON.stringify({ actions: pick }),
      ctx
    )
    assert.equal(result.ok, true)
    assert.deepEqual(result.actionIds, pick)
  })

  it('builds ResponsePlan from selected LLM action IDs and keeps approval pending', () => {
    const ctx = seedContext()
    const built = buildResponsePlan({
      detection: {
        incidents: [
          {
            id: 'inc-pay',
            endpointId: 'pay',
            status: 'open',
            severity: 'high',
            recoveryPriority: 10,
          },
        ],
      },
      context: ctx,
      selectedActionIds: ['isolate-node'],
    })
    assert.equal(built.ok, true)
    assert.equal(built.executableCount, 1)
    assert.deepEqual(
      built.plan.recommendedActions.map((a) => a.actionId),
      ['isolate-node']
    )
    assert.equal(built.plan.recommendedActions[0].target.id, 'pay')
    assert.equal(built.plan.approvalStatus, 'none') // generate() sets pending
    assert.match(built.plan.reasoning || '', /LLM Commander/)
  })

  it('prompt payload includes the full executable repository, not a policy playbook', () => {
    const ctx = seedContext()
    const payload = buildLlmCommanderPromptPayload(ctx, { room: null })
    assert.equal(payload.policy, undefined)
    assert.equal(payload.instruction, undefined)
    assert.equal(payload.evidence, undefined)
    assert.equal(payload.executableActions, undefined)
    assert.ok(Array.isArray(payload.availableActions))
    const ids = payload.availableActions.map((a) => a.actionId)
    assert.equal(payload.allowedActionIds, undefined)
    assert.equal(payload.actionRepository, undefined)
    assert.equal(payload.attack, undefined)
    assert.equal(payload.affectedNode, undefined)
    assert.equal(payload.telemetry, undefined)
    assert.ok(ids.includes('isolate-node'))
    assert.ok(ids.includes('restore-connectivity'))
    assert.ok(ids.includes('inspect-peer-history') || ids.includes('collect-telemetry-window') || ids.includes('capture-device-state'))
    assert.ok(payload.availableActions.length > (ctx.availableActions?.length ?? 0))
    const isolate = payload.availableActions.find((a) => a.actionId === 'isolate-node')
    assert.equal(isolate.capability, 'containment')
    assert.ok(isolate.name)
    assert.equal(isolate.targetType, 'node')
    assert.equal(payload.incident.incidentId, 'inc-pay')
    assert.ok(payload.relatedIncidents.length >= 1)
    assert.ok(payload.telemetryEvidence.length >= 1)
    assert.ok(payload.responseGoal)
  })

  it('resolves authoritative attack preset, stage, graph, city, and previous plan context', () => {
    const ctx = seedContext('pay', {
      cityContext: 'festival_peak',
      primaryPath: ['pay', 'peer'],
      propagationPaths: { peer: ['pay', 'peer'] },
      hopDistance: 1,
    })
    const payload = buildLlmCommanderPromptPayload(ctx, {
      room: {
        nodes: [node('pay'), node('peer')],
        edges: [{ id: 'e1', source: 'pay', target: 'peer' }],
        detection: { cityContext: 'festival_peak', incidents: [] },
        hackSimulator: {
          nodeAttackStates: { pay: true },
          nodeOverrides: { pay: { httpRequestsPerMin: 9000 } },
        },
        activeAttackSequences: {
          seq: {
            status: 'active',
            nodePath: ['pay'],
            events: [{ kind: 'seed', presetId: 'api_abuse' }],
          },
        },
      },
      previousPlan: {
        planId: 'prev-1',
        primaryIncidentId: 'inc-pay',
        strategy: 'Previous strategy',
        recommendedActions: [{ actionId: 'inspect-peer-history', status: 'completed' }],
      },
      verification: { verdict: 'FAILED', reasons: ['Residual remains elevated'] },
    })
    assert.equal(payload.attackContext.presetId, 'api_abuse')
    assert.equal(payload.attackContext.attackType, 'api_abuse')
    assert.equal(payload.attackContext.stage.id, 'hammer')
    assert.equal(payload.cityModelContext.cityContext, 'festival_peak')
    assert.deepEqual(payload.graphContext.primaryPath, ['pay', 'peer'])
    assert.equal(payload.previousResponseContext.planId, 'prev-1')
    assert.equal(payload.availableActions.some((action) => 'rationale' in action), false)
    assert.equal(payload.policy, undefined)
  })

  it('changing attack presets changes Commander attack context', () => {
    const ctx = seedContext()
    const ids = ['api_abuse', 'credential_spray', 'data_exfiltration']
    const seen = new Set()
    for (const presetId of ids) {
      const payload = buildLlmCommanderPromptPayload(ctx, {
        room: {
          nodes: [node('pay'), node('peer')],
          edges: [{ id: 'e1', source: 'pay', target: 'peer' }],
          hackSimulator: {
            nodeAttackStates: { pay: true },
            nodeOverrides: { pay: { packetsPerSecond: 900 } },
            nodePresetIds: { pay: presetId },
          },
        },
      })
      seen.add(payload.attackContext.presetId)
      assert.equal(payload.attackContext.presetId, presetId)
      assert.ok(payload.attackContext.title)
      assert.ok(payload.availableActions.length >= 8)
    }
    assert.equal(seen.size, 3)
  })

  it('parse strips markdown fences', () => {
    const parsed = parseLlmCommanderActionsJson(
      '```json\n{"actions":["isolate-node"]}\n```'
    )
    assert.equal(parsed.ok, true)
    assert.deepEqual(parsed.value.actions, ['isolate-node'])
  })

  it('feature flag defaults off', () => {
    const prev = process.env.LLM_RESPONSE_PLAN
    const prevMode = process.env.RESPONSE_PLAN_MODE
    delete process.env.LLM_RESPONSE_PLAN
    delete process.env.RESPONSE_PLAN_MODE
    assert.equal(llmResponsePlanEnabled(), false)
    process.env.LLM_RESPONSE_PLAN = '1'
    assert.equal(llmResponsePlanEnabled(), true)
    process.env.RESPONSE_PLAN_MODE = 'deterministic'
    assert.equal(llmResponsePlanEnabled(), false)
    if (prev === undefined) delete process.env.LLM_RESPONSE_PLAN
    else process.env.LLM_RESPONSE_PLAN = prev
    if (prevMode === undefined) delete process.env.RESPONSE_PLAN_MODE
    else process.env.RESPONSE_PLAN_MODE = prevMode
  })

  it('accepts complete JSON even when done_reason is length', () => {
    const ctx = seedContext()
    const raw = JSON.stringify({
      summary: 'Contain the endpoint',
      attackInterpretation: 'Assessment: volumetric pressure.',
      strategy: 'Isolate the seed.',
      actions: [
        {
          actionId: 'isolate-node',
          target: 'pay',
          rationale: 'Stop further communication.',
          expectedImpact: 'Quarantine the seed.',
        },
      ],
    })
    const result = parseAndValidateLlmCommanderPlan(raw, ctx, {
      source: 'ollama-direct',
      doneReason: 'length',
      room: { nodes: [node('pay'), node('peer')] },
    })
    assert.equal(result.ok, true)
    assert.equal(result.actionIds[0], 'isolate-node')
  })

  it('logLlmCommanderPlan prints the required banner', () => {
    const lines = []
    const orig = console.log
    console.log = (...args) => lines.push(args.map(String).join(' '))
    try {
      logLlmCommanderPlan({ actions: ['isolate-node', 'capture-device-state'] })
    } finally {
      console.log = orig
    }
    assert.match(lines[0], /^\[LLM COMMANDER\] PARSED:/)
    assert.match(lines[0], /"isolate-node"/)
  })
})
