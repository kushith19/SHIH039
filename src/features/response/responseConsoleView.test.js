import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LLM_RESPONSE_UI_STATUS,
  RESPONSE_ACTION_UI_STATUS,
  actionStatusLabel,
  buildExecuteRequestBody,
  executeButtonLabel,
  exposureLabelFromContext,
  formatRiskDisplay,
  formatTrustDisplay,
  incidentIdForExecute,
  isExecuteDisabled,
  postCommanderExecute,
  resolveActionUiStatus,
  responseActionRows,
  responseConsolePresentation,
  responseStatusCopy,
  severityTone,
  uiStatusFromHistory,
  userSafeExecuteError,
} from './responseConsoleView.js'

function llmPlan(recommendedActions, extra = {}) {
  return {
    planSource: 'llm',
    primaryIncidentId: 'pers-pay',
    incidentIds: ['pers-pay'],
    recommendedActions,
    ...extra,
  }
}

function isolatePlanAction(extra = {}) {
  return {
    actionId: 'isolate-node',
    label: 'Isolate Device',
    target: { id: 'pay', name: 'Payment Processing System' },
    reason: 'Contain the affected endpoint based on observed deviation.',
    expectedImpact: 'Quarantine the seed.',
    policyStatus: 'ALLOWED',
    executable: true,
    ...extra,
  }
}

function payContext(overrides = {}) {
  return {
    incidentId: 'pers-pay',
    liveIncidentId: 'inc-pay',
    incidentType: 'behavioural_anomaly',
    severity: 'high',
    status: 'open',
    affectedAsset: { id: 'pay', summary: 'Payment Processing System' },
    riskScore: 0.87,
    trustScore: 42,
    peerExposure: ['gw'],
    propagatedNodeIds: ['gw', 'core'],
    blastRadius: 3,
    financialExposure: {
      simulated: true,
      exposureLabel: '₹2.3 Cr',
    },
    actionsAlreadyTaken: [],
    availableActions: [
      {
        actionId: 'isolate-node',
        actionType: 'ISOLATE_NODE',
        label: 'Isolate Node',
        description: 'Isolate the affected endpoint from active communication.',
        requiresNode: true,
        supported: true,
        executionTarget: 'quarantine',
      },
    ],
    ...overrides,
  }
}

describe('responseConsoleView', () => {
  it('maps severity tones without inventing scores', () => {
    assert.equal(severityTone('critical'), 'crit')
    assert.equal(severityTone('high'), 'crit')
    assert.equal(severityTone('medium'), 'warn')
    assert.equal(severityTone('low'), 'muted')
  })

  it('formats risk and trust from context values only', () => {
    assert.equal(formatRiskDisplay(0.87), 87)
    assert.equal(formatRiskDisplay(87), 87)
    assert.equal(formatRiskDisplay(null), null)
    assert.equal(formatTrustDisplay(42.2), 42)
  })

  it('shows simulated exposure label from context', () => {
    assert.equal(exposureLabelFromContext(payContext()), '₹2.3 Cr')
    assert.equal(
      exposureLabelFromContext(
        payContext({ financialExposure: { simulated: true, exposureLabel: '₹0' } })
      ),
      null
    )
  })

  it('builds execute request with incidentId and actionId only — no target node', () => {
    const body = buildExecuteRequestBody({
      incidentId: 'pers-pay',
      actionId: 'isolate-node',
    })
    assert.deepEqual(body, {
      incidentId: 'pers-pay',
      actionId: 'isolate-node',
    })
    assert.equal('target' in body, false)
    assert.equal('nodeId' in body, false)
    assert.equal('targetNodeId' in body, false)
    assert.equal(incidentIdForExecute(payContext()), 'pers-pay')
  })

  it('renders isolate-node action row with target and AVAILABLE status', () => {
    const rows = responseActionRows(payContext(), {}, llmPlan([isolatePlanAction()]))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].actionId, 'isolate-node')
    assert.equal(rows[0].label, 'Isolate Device')
    assert.match(rows[0].description, /Quarantine a compromised/)
    assert.equal(rows[0].category, 'containment')
    assert.equal(rows[0].targetId, 'pay')
    assert.equal(rows[0].targetName, 'Payment Processing System')
    assert.equal(rows[0].policyStatus, 'ALLOWED')
    assert.equal(rows[0].supported, true)
    assert.equal(rows[0].canExecute, true)
    assert.equal(rows[0].uiStatus, RESPONSE_ACTION_UI_STATUS.AVAILABLE)
  })

  it('uses repository metadata instead of duplicated context presentation', () => {
    const rows = responseActionRows(
      payContext({
        availableActions: [
          {
            actionId: 'isolate-node',
            actionType: 'FAKE_TYPE',
            label: 'Duplicated fake label',
            description: 'Duplicated fake description',
            responseProfile: 'NETWORK_TRAFFIC_FLOOD',
            requiresNode: true,
            supported: true,
            executionTarget: 'quarantine',
          },
        ],
        responseClassification: { responseProfile: 'NETWORK_TRAFFIC_FLOOD' },
      }),
      {},
      llmPlan([isolatePlanAction()])
    )
    assert.equal(rows[0].label, 'Isolate Device')
    assert.equal(rows[0].actionType, 'ISOLATE_NODE')
    assert.doesNotMatch(rows[0].description, /fake/i)
    assert.equal(rows[0].responseProfile, 'NETWORK_TRAFFIC_FLOOD')
  })

  it('maps a validated LLM ResponsePlan through repository metadata and rationale', () => {
    const rows = responseActionRows(
      payContext(),
      {},
      llmPlan([isolatePlanAction()])
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].label, 'Isolate Device')
    assert.equal(rows[0].aiRecommended, true)
    assert.match(rows[0].rationale, /observed deviation/)
    assert.equal(rows[0].expectedImpact, 'Quarantine the seed.')
    assert.equal(rows[0].targetId, 'pay')
    assert.equal(rows[0].canExecute, true)
  })

  it('renders exactly the LLM recommendedActions for data_exfiltration (3)', () => {
    const plan = llmPlan([
      isolatePlanAction(),
      {
        actionId: 'block-external-communication',
        target: { id: 'pay', name: 'PAY' },
        reason: 'Stop outbound exfil.',
        expectedImpact: 'Block untrusted egress.',
        policyStatus: 'ALLOWED',
        executable: true,
      },
      {
        actionId: 'capture-device-state',
        target: { id: 'pay', name: 'PAY' },
        reason: 'Preserve evidence.',
        expectedImpact: 'Snapshot runtime state.',
        policyStatus: 'ALLOWED',
        executable: true,
      },
    ])
    const ctx = payContext({
      availableActions: [
        { actionId: 'isolate-node', supported: true, executionTarget: 'quarantine' },
        { actionId: 'inspect-peer-history', supported: true, executionTarget: 'diagnostic' },
        { actionId: 'collect-telemetry-window', supported: true, executionTarget: 'diagnostic' },
        { actionId: 'capture-device-state', supported: true, executionTarget: 'diagnostic' },
      ],
    })
    const rows = responseActionRows(ctx, {}, plan)
    assert.deepEqual(rows.map((row) => row.actionId), [
      'isolate-node',
      'block-external-communication',
      'capture-device-state',
    ])
    assert.equal(rows.some((row) => row.actionId === 'inspect-peer-history'), false)
    assert.equal(rows.some((row) => row.actionId === 'collect-telemetry-window'), false)
    assert.equal(rows.every((row) => row.canExecute === true), true)
  })

  it('renders exactly one LLM action for credential_spray', () => {
    const rows = responseActionRows(
      payContext({
        availableActions: [
          { actionId: 'isolate-node', supported: true, executionTarget: 'quarantine' },
          { actionId: 'inspect-peer-history', supported: true, executionTarget: 'diagnostic' },
          { actionId: 'collect-telemetry-window', supported: true, executionTarget: 'diagnostic' },
          { actionId: 'capture-device-state', supported: true, executionTarget: 'diagnostic' },
        ],
      }),
      {},
      llmPlan([isolatePlanAction({ reason: 'Stop credential spray.' })])
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].actionId, 'isolate-node')
    assert.match(rows[0].rationale, /credential spray/)
  })

  it('updates displayed actions when the LLM plan changes with the attack', () => {
    const ctx = payContext()
    const exfil = responseActionRows(
      ctx,
      {},
      llmPlan([
        isolatePlanAction(),
        {
          actionId: 'block-external-communication',
          target: { id: 'pay' },
          reason: 'Stop egress',
          policyStatus: 'ALLOWED',
          executable: true,
        },
      ])
    )
    const spray = responseActionRows(ctx, {}, llmPlan([isolatePlanAction()]))
    assert.deepEqual(exfil.map((row) => row.actionId), [
      'isolate-node',
      'block-external-communication',
    ])
    assert.deepEqual(spray.map((row) => row.actionId), ['isolate-node'])
  })

  it('does not render policy playbook actions when there is no LLM plan', () => {
    const rows = responseActionRows(payContext())
    assert.deepEqual(rows, [])
  })

  it('does not auto-execute LLM plan actions', () => {
    const rows = responseActionRows(
      payContext(),
      {},
      llmPlan([isolatePlanAction()])
    )
    assert.equal(rows[0].uiStatus, RESPONSE_ACTION_UI_STATUS.AVAILABLE)
    assert.equal(rows[0].canExecute, true)
    assert.equal(isExecuteDisabled(rows[0].uiStatus), false)
  })

  it('blocks unsupported catalog actions from an LLM plan', () => {
    const plan = llmPlan([
      { actionId: 'disable-camera', target: { id: 'pay' }, reason: 'Unsupported' },
      {
        actionId: 'restore-connectivity',
        target: { id: 'pay' },
        reason: 'Restore after isolation',
        executable: true,
        policyStatus: 'ALLOWED',
      },
      { actionId: 'invented-action', target: { id: 'pay' }, reason: 'Unknown' },
    ])
    const rows = responseActionRows(payContext({ availableActions: [] }), {}, plan)
    assert.deepEqual(rows.map((row) => row.actionId), [
      'disable-camera',
      'restore-connectivity',
    ])
    assert.equal(rows[0].uiStatus, RESPONSE_ACTION_UI_STATUS.BLOCKED)
    assert.equal(rows[0].canExecute, false)
    assert.equal(rows[1].uiStatus, RESPONSE_ACTION_UI_STATUS.AVAILABLE)
    assert.equal(rows[1].canExecute, true)
  })

  it('marks policy-blocked actions as non-executable', () => {
    const rows = responseActionRows(
      payContext(),
      {},
      llmPlan([
        {
          actionId: 'isolate-node',
          target: { id: 'pay' },
          policyStatus: 'POLICY_BLOCKED',
        },
      ])
    )
    assert.equal(rows[0].uiStatus, RESPONSE_ACTION_UI_STATUS.POLICY_BLOCKED)
    assert.equal(rows[0].canExecute, false)
  })

  it('maps button labels and disable rules for execution states', () => {
    assert.equal(executeButtonLabel(RESPONSE_ACTION_UI_STATUS.AVAILABLE), 'Execute')
    assert.equal(executeButtonLabel(RESPONSE_ACTION_UI_STATUS.EXECUTING), 'Executing…')
    assert.equal(executeButtonLabel(RESPONSE_ACTION_UI_STATUS.EXECUTED), '✓ Executed')
    assert.equal(
      executeButtonLabel(RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED),
      '✓ Already executed'
    )
    assert.equal(executeButtonLabel(RESPONSE_ACTION_UI_STATUS.FAILED), 'Retry')
    assert.equal(isExecuteDisabled(RESPONSE_ACTION_UI_STATUS.AVAILABLE), false)
    assert.equal(isExecuteDisabled(RESPONSE_ACTION_UI_STATUS.UNAVAILABLE), true)
    assert.equal(isExecuteDisabled(RESPONSE_ACTION_UI_STATUS.POLICY_BLOCKED), true)
    assert.equal(isExecuteDisabled(RESPONSE_ACTION_UI_STATUS.BLOCKED), true)
    assert.equal(isExecuteDisabled(RESPONSE_ACTION_UI_STATUS.EXECUTING), true)
    assert.equal(isExecuteDisabled(RESPONSE_ACTION_UI_STATUS.EXECUTED), true)
    assert.equal(isExecuteDisabled(RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED), true)
    assert.equal(isExecuteDisabled(RESPONSE_ACTION_UI_STATUS.FAILED), false)
    assert.equal(actionStatusLabel(RESPONSE_ACTION_UI_STATUS.EXECUTED), 'COMPLETED')
    assert.equal(actionStatusLabel(RESPONSE_ACTION_UI_STATUS.FAILED), 'FAILED')
  })

  it('derives EXECUTED from actionsAlreadyTaken history', () => {
    const ctx = payContext({
      actionsAlreadyTaken: [
        {
          actionId: 'isolate-node',
          status: 'EXECUTED',
          targetNodeId: 'pay',
          executedAtMs: 1_700_000_000_000,
        },
      ],
    })
    assert.equal(uiStatusFromHistory(ctx, 'isolate-node'), RESPONSE_ACTION_UI_STATUS.EXECUTED)
    assert.equal(
      resolveActionUiStatus('isolate-node', ctx, {}),
      RESPONSE_ACTION_UI_STATUS.EXECUTED
    )
    const rows = responseActionRows(
      { ...ctx, availableActions: [] },
      {},
      llmPlan([isolatePlanAction()])
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].label, 'Isolate Device')
    assert.equal(rows[0].uiStatus, RESPONSE_ACTION_UI_STATUS.EXECUTED)
    assert.equal(rows[0].canExecute, false)
  })

  it('prefers local EXECUTING over history', () => {
    const ctx = payContext()
    assert.equal(
      resolveActionUiStatus('isolate-node', ctx, {
        'isolate-node': { uiStatus: RESPONSE_ACTION_UI_STATUS.EXECUTING },
      }),
      RESPONSE_ACTION_UI_STATUS.EXECUTING
    )
  })

  it('shows CONTAINMENT EXECUTED without claiming recovery', () => {
    const copy = responseStatusCopy({
      hasActions: true,
      actionCount: 1,
      execution: {
        status: 'EXECUTED',
        actionId: 'isolate-node',
        target: { id: 'pay', name: 'Payment Processing System' },
        executedAtMs: 1_700_000_000_000,
      },
    })
    assert.equal(copy.title, 'CONTAINMENT EXECUTED')
    assert.match(copy.detail, /Containment action succeeded/)
    assert.match(copy.detail, /detection pipeline/)
    assert.doesNotMatch(copy.detail, /RECOVERED|RESOLVED|RISK = 0/i)
  })

  it('shows CONNECTIVITY RESTORED for restore-connectivity', () => {
    const copy = responseStatusCopy({
      hasActions: true,
      actionCount: 2,
      execution: {
        status: 'EXECUTED',
        actionId: 'restore-connectivity',
        target: { id: 'pay', name: 'Payment Processing System' },
      },
    })
    assert.equal(copy.title, 'CONNECTIVITY RESTORED')
    assert.match(copy.detail, /Connectivity restore succeeded/)
    assert.match(copy.detail, /attack override remains cleared/i)
  })

  it('handles ALREADY_EXECUTED and FAILED status copy', () => {
    const already = responseStatusCopy({
      hasActions: true,
      actionCount: 1,
      execution: {
        status: 'ALREADY_EXECUTED',
        actionId: 'isolate-node',
        target: { id: 'pay', name: 'Pay' },
      },
    })
    assert.equal(already.title, 'CONTAINMENT EXECUTED')
    assert.match(already.detail, /already in place/i)

    const failed = responseStatusCopy({
      hasActions: true,
      actionCount: 1,
      execution: { status: 'FAILED', message: 'Unknown action' },
    })
    assert.equal(failed.title, 'EXECUTION FAILED')
    assert.equal(failed.detail, 'Unknown action')
  })

  it('sanitizes unsafe error messages', () => {
    assert.equal(
      userSafeExecuteError('Error: boom\n    at Object.<anonymous> (file.js:1:1)'),
      'Unable to execute this response action for the incident.'
    )
    assert.equal(userSafeExecuteError('Target node not found'), 'Target node not found')
  })

  it('postCommanderExecute sends correct body and maps success', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        json: async () => ({
          ok: true,
          incidentId: 'pers-pay',
          actionId: 'isolate-node',
          actionType: 'ISOLATE_NODE',
          target: { id: 'pay', name: 'Payment Processing System' },
          status: 'EXECUTED',
          executedAtMs: 123,
        }),
      }
    }
    const result = await postCommanderExecute(
      'DEMO',
      { incidentId: 'pers-pay', actionId: 'isolate-node' },
      fetchImpl
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/rooms/DEMO/commander/execute')
    assert.equal(calls[0].init.method, 'POST')
    const sent = JSON.parse(calls[0].init.body)
    assert.deepEqual(sent, { incidentId: 'pers-pay', actionId: 'isolate-node' })
    assert.equal(sent.target, undefined)
    assert.equal(result.ok, true)
    assert.equal(result.status, 'EXECUTED')
    assert.equal(result.target.id, 'pay')
  })

  it('postCommanderExecute maps ALREADY_EXECUTED and errors', async () => {
    const already = await postCommanderExecute(
      'DEMO',
      { incidentId: 'pers-pay', actionId: 'isolate-node' },
      async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          status: 'ALREADY_EXECUTED',
          actionId: 'isolate-node',
          incidentId: 'pers-pay',
          target: { id: 'pay', name: 'Pay' },
          executedAtMs: 1,
        }),
      })
    )
    assert.equal(already.ok, true)
    assert.equal(already.status, 'ALREADY_EXECUTED')

    const failed = await postCommanderExecute(
      'DEMO',
      { incidentId: 'pers-pay', actionId: 'shutdown-grid' },
      async () => ({
        ok: false,
        json: async () => ({ ok: false, message: 'Unknown action' }),
      })
    )
    assert.equal(failed.ok, false)
    assert.equal(failed.message, 'Unknown action')
  })

  it('does not invent risk or recovery values in helpers', () => {
    const rows = responseActionRows(
      payContext(),
      {},
      llmPlan([isolatePlanAction()])
    )
    assert.equal(rows[0].riskScore, undefined)
    assert.equal(rows[0].anomalyScore, undefined)
    assert.equal(rows[0].financialExposure, undefined)
    const pending = responseStatusCopy({ hasActions: true, actionCount: 1 })
    assert.equal(pending.title, 'RESPONSE PENDING')
  })
})

describe('evidence-driven Response LLM UI', () => {
  const playbook = [
    { actionId: 'isolate-node', supported: true, executionTarget: 'quarantine' },
    { actionId: 'inspect-peer-history', supported: true, executionTarget: 'diagnostic' },
    { actionId: 'collect-telemetry-window', supported: true, executionTarget: 'diagnostic' },
    { actionId: 'capture-device-state', supported: true, executionTarget: 'diagnostic' },
  ]

  it('A: initial state has 0 action cards', () => {
    const view = responseConsolePresentation({
      context: payContext({ availableActions: playbook }),
      socketPlan: null,
    })
    assert.deepEqual(view.actions, [])
    assert.equal(view.banner.status, LLM_RESPONSE_UI_STATUS.WAITING)
    assert.match(view.banner.detail, /Press Response/)
  })

  it('B: Analyze started shows WAITING FOR RESPONSE and 0 cards', () => {
    const stale = llmPlan([isolatePlanAction()], { planId: 'plan-a' })
    const view = responseConsolePresentation({
      context: payContext({ availableActions: playbook }),
      socketPlan: stale,
      analyzeUi: {
        generation: 1,
        waiting: true,
        failed: false,
        startedPlanId: 'plan-a',
        resultOk: null,
        resultPlan: null,
      },
    })
    assert.deepEqual(view.actions, [])
    assert.equal(view.banner.status, LLM_RESPONSE_UI_STATUS.WAITING_FOR_RESPONSE)
    assert.match(view.banner.detail, /Qwen/)
  })

  it('C: LLM response not received keeps 0 action cards', () => {
    const view = responseConsolePresentation({
      context: payContext({ availableActions: playbook }),
      socketPlan: llmPlan([isolatePlanAction()], { planId: 'plan-a' }),
      analyzeUi: {
        generation: 1,
        waiting: false,
        failed: false,
        startedPlanId: 'plan-a',
        resultOk: true,
        resultPlan: llmPlan([], { planId: 'plan-b' }),
      },
    })
    assert.deepEqual(view.actions, [])
  })

  it('D: LLM response received renders exactly recommendedActions', () => {
    const plan = llmPlan(
      [
        isolatePlanAction(),
        {
          actionId: 'block-external-communication',
          target: { id: 'pay' },
          reason: 'Stop egress',
          policyStatus: 'ALLOWED',
          executable: true,
        },
        {
          actionId: 'capture-device-state',
          target: { id: 'pay' },
          reason: 'Preserve',
          policyStatus: 'ALLOWED',
          executable: true,
        },
      ],
      { planId: 'plan-b' }
    )
    const view = responseConsolePresentation({
      context: payContext({ availableActions: playbook }),
      socketPlan: plan,
      analyzeUi: {
        generation: 1,
        waiting: false,
        failed: false,
        startedPlanId: 'plan-a',
        resultOk: true,
        resultPlan: plan,
      },
      debugLast: {
        source: 'ollama-direct',
        requestId: 'llm-test',
        durationMs: 1200,
        model: 'qwen2.5:7b-instruct',
        doneReason: 'stop',
        httpStatus: 200,
      },
    })
    assert.deepEqual(view.actions.map((row) => row.actionId), [
      'isolate-node',
      'block-external-communication',
      'capture-device-state',
    ])
    assert.equal(view.banner.status, LLM_RESPONSE_UI_STATUS.RECEIVED)
    assert.equal(
      view.banner.fields.find((field) => field.label === 'Source')?.value,
      'ollama-direct / llm'
    )
    assert.equal(
      view.banner.fields.find((field) => field.label === 'Actions received')?.value,
      '3'
    )
    assert.equal(
      view.banner.fields.find((field) => field.label === 'Model')?.value,
      'qwen2.5:7b-instruct'
    )
  })

  it('E: LLM failure shows FAILED and 0 cards', () => {
    const view = responseConsolePresentation({
      context: payContext({ availableActions: playbook }),
      socketPlan: llmPlan([isolatePlanAction()], { planId: 'plan-a' }),
      analyzeUi: {
        generation: 1,
        waiting: false,
        failed: true,
        error: 'Ollama timeout',
        startedPlanId: 'plan-a',
        resultOk: false,
        resultPlan: null,
      },
    })
    assert.deepEqual(view.actions, [])
    assert.equal(view.banner.status, LLM_RESPONSE_UI_STATUS.FAILED)
    assert.equal(view.banner.detail, 'LLM Response Plan unavailable')
    assert.equal(view.banner.error, 'Ollama timeout')
  })

  it('E2: server planning_failed shows unavailable without policy actions', () => {
    const view = responseConsolePresentation({
      context: payContext({ availableActions: playbook }),
      socketPlan: null,
      continuationReason: 'planning_failed',
      pausedForApprovalReason: 'connection refused',
    })
    assert.deepEqual(view.actions, [])
    assert.equal(view.failed, true)
    assert.equal(view.banner.status, LLM_RESPONSE_UI_STATUS.FAILED)
    assert.equal(view.banner.detail, 'LLM Response Plan unavailable')
    assert.equal(view.banner.error, 'connection refused')
  })

  it('F: non-LLM/deterministic plan renders 0 cards', () => {
    const policyPlan = {
      planSource: 'policy',
      planId: 'plan-policy',
      primaryIncidentId: 'pers-pay',
      incidentIds: ['pers-pay'],
      recommendedActions: [isolatePlanAction()],
    }
    const view = responseConsolePresentation({
      context: payContext({ availableActions: playbook }),
      socketPlan: policyPlan,
      analyzeUi: {
        generation: 1,
        waiting: false,
        failed: false,
        startedPlanId: null,
        resultOk: true,
        resultPlan: policyPlan,
      },
    })
    assert.deepEqual(view.actions, [])
    assert.equal(view.banner.status, LLM_RESPONSE_UI_STATUS.NO_LLM_RESPONSE)
    assert.equal(responseActionRows(payContext(), {}, policyPlan).length, 0)
  })

  it('G: Analyze A then Analyze B drops A immediately and shows only B after B returns', () => {
    const planA = llmPlan(
      [
        isolatePlanAction(),
        {
          actionId: 'block-external-communication',
          target: { id: 'pay' },
          reason: 'A',
          policyStatus: 'ALLOWED',
          executable: true,
        },
      ],
      { planId: 'plan-a' }
    )
    const planB = llmPlan([isolatePlanAction({ reason: 'B only' })], {
      planId: 'plan-b',
    })
    const duringB = responseConsolePresentation({
      context: payContext({ availableActions: playbook }),
      socketPlan: planA,
      analyzeUi: {
        generation: 2,
        waiting: true,
        failed: false,
        startedPlanId: 'plan-a',
        resultOk: null,
        resultPlan: null,
      },
    })
    assert.deepEqual(duringB.actions, [])
    const afterB = responseConsolePresentation({
      context: payContext({ availableActions: playbook }),
      socketPlan: planA,
      analyzeUi: {
        generation: 2,
        waiting: false,
        failed: false,
        startedPlanId: 'plan-a',
        resultOk: true,
        resultPlan: planB,
      },
    })
    assert.deepEqual(afterB.actions.map((row) => row.actionId), ['isolate-node'])
    assert.equal(afterB.actions[0].rationale, 'B only')
  })

  it('H: never renders context.availableActions as response actions', () => {
    const ctx = payContext({
      availableActions: playbook,
    })
    assert.deepEqual(responseActionRows(ctx, {}, null), [])
    const view = responseConsolePresentation({
      context: ctx,
      socketPlan: null,
    })
    assert.equal(
      view.actions.some((row) => row.actionId === 'inspect-peer-history'),
      false
    )
  })

  it('I: never renders the old policy playbook as response actions', () => {
    const rows = responseActionRows(payContext({ availableActions: playbook }))
    assert.deepEqual(rows, [])
    const duringAnalyze = responseConsolePresentation({
      context: payContext({ availableActions: playbook }),
      socketPlan: {
        planSource: 'policy',
        primaryIncidentId: 'pers-pay',
        recommendedActions: playbook,
      },
      workflowStatus: 'ANALYZING',
    })
    assert.deepEqual(duringAnalyze.actions, [])
  })
})
