import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  RESPONSE_ACTION_UI_STATUS,
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
  responseStatusCopy,
  severityTone,
  uiStatusFromHistory,
  userSafeExecuteError,
} from './responseConsoleView.js'

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
    const rows = responseActionRows(payContext())
    assert.equal(rows.length, 1)
    assert.equal(rows[0].actionId, 'isolate-node')
    assert.equal(rows[0].targetId, 'pay')
    assert.equal(rows[0].targetName, 'Payment Processing System')
    assert.equal(rows[0].uiStatus, RESPONSE_ACTION_UI_STATUS.AVAILABLE)
  })

  it('surfaces profile label and policy rationale on action rows', () => {
    const rows = responseActionRows(
      payContext({
        availableActions: [
          {
            actionId: 'isolate-node',
            actionType: 'ISOLATE_NODE',
            label: 'Isolate Node',
            description: 'Generic registry description',
            rationale: 'Contain the packet-rate anomaly at the confirmed origin.',
            profileLabel: 'NETWORK TRAFFIC FLOOD',
            responseProfile: 'NETWORK_TRAFFIC_FLOOD',
            requiresNode: true,
            supported: true,
            executionTarget: 'quarantine',
          },
        ],
      })
    )
    assert.equal(rows[0].profileLabel, 'NETWORK TRAFFIC FLOOD')
    assert.match(rows[0].rationale, /packet-rate/)
    assert.match(rows[0].description, /packet-rate/)
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
    assert.equal(isExecuteDisabled(RESPONSE_ACTION_UI_STATUS.EXECUTING), true)
    assert.equal(isExecuteDisabled(RESPONSE_ACTION_UI_STATUS.EXECUTED), true)
    assert.equal(isExecuteDisabled(RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED), true)
    assert.equal(isExecuteDisabled(RESPONSE_ACTION_UI_STATUS.FAILED), false)
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
    const rows = responseActionRows(payContext())
    assert.equal(rows[0].riskScore, undefined)
    assert.equal(rows[0].anomalyScore, undefined)
    assert.equal(rows[0].financialExposure, undefined)
    const pending = responseStatusCopy({ hasActions: true, actionCount: 1 })
    assert.equal(pending.title, 'RESPONSE PENDING')
  })
})
