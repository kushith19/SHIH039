import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  RESPONSE_ACTION_TYPES,
  RESPONSE_ACTIONS,
  listRegisteredResponseActions,
  getResponseAction,
  isRegisteredResponseAction,
  getAvailableResponseActions,
  attachAvailableResponseActions,
  affectedNodeIdFromContext,
  isExposureIncidentContext,
} from './responseActions.js'
import { RESPONSE_PROFILES, buildResponsePolicy } from './responsePolicy.js'

function metricEv(metric, deviationPct) {
  return {
    code: 'metric_deviation',
    metric,
    observed: 1000,
    expected: 100,
    deviationPct,
  }
}

function seedContext(overrides = {}) {
  const { affectedAsset: assetOver, ...rest } = overrides
  return {
    affectedAsset: {
      id: 'ep-pay',
      summary: 'Payment Processing',
      ...(assetOver ?? {}),
    },
    anomalyEvidence: [metricEv('packetsPerSecond', 400)],
    isExposureIncident: false,
    financialExposure: null,
    ...rest,
    affectedAsset: {
      id: assetOver?.id ?? rest.affectedAsset?.id ?? 'ep-pay',
      summary: assetOver?.summary ?? 'Payment Processing',
      ...(assetOver ?? {}),
    },
  }
}

describe('responseActions registry', () => {
  it('registers isolate-node and restore-connectivity', () => {
    const listed = listRegisteredResponseActions()
    assert.ok(listed.some((action) => action.actionId === 'isolate-node'))
    assert.ok(listed.some((action) => action.actionId === 'restore-connectivity'))
    assert.equal(getResponseAction('isolate-node').actionType, RESPONSE_ACTION_TYPES.ISOLATE_NODE)
    assert.equal(
      getResponseAction('restore-connectivity').actionType,
      RESPONSE_ACTION_TYPES.RESTORE_CONNECTIVITY
    )
    assert.equal(getResponseAction('isolate-node').executionTarget, 'quarantine')
    assert.equal(getResponseAction('restore-connectivity').executionTarget, 'unquarantine')
    assert.equal(getResponseAction('restore-connectivity').supported, true)
    assert.equal(RESPONSE_ACTIONS['isolate-node'].actionId, 'isolate-node')
    assert.equal(RESPONSE_ACTIONS['restore-connectivity'].actionId, 'restore-connectivity')
    assert.equal(RESPONSE_ACTIONS['disable-camera'], undefined)
    assert.equal(getResponseAction('disable-camera').supported, false)
  })

  it('exposes ISOLATE_NODE when incident has an affected node', () => {
    const available = getAvailableResponseActions({
      affectedAsset: { id: 'pay', summary: 'Payment Processing System' },
    })
    assert.equal(available.length, 1)
    assert.equal(available[0].actionId, 'isolate-node')
    assert.equal(available[0].actionType, 'ISOLATE_NODE')
    assert.ok(available[0].rationale)
    assert.ok(available[0].profileLabel)
  })

  it('hides ISOLATE_NODE for exposure / propagated-risk incidents', () => {
    assert.deepEqual(
      getAvailableResponseActions({
        affectedAsset: { id: 'gw', summary: 'Bank Gateway' },
        isExposureIncident: true,
      }),
      []
    )
    assert.deepEqual(
      getAvailableResponseActions({
        affectedAsset: { id: 'core', summary: 'Core Banking' },
        anomalyEvidence: [{ code: 'peer_exposure', kind: 'dependency_anomaly' }],
      }),
      []
    )
    assert.equal(
      isExposureIncidentContext({
        evidence: [{ code: 'graph_propagation' }],
      }),
      true
    )
    assert.equal(
      isExposureIncidentContext({
        affectedAsset: { id: 'pay' },
        anomalyEvidence: [{ code: 'tgnn_embed' }],
      }),
      false
    )
  })

  it('hides ISOLATE_NODE when incident has no affected node', () => {
    assert.deepEqual(getAvailableResponseActions({}), [])
    assert.deepEqual(
      getAvailableResponseActions({ affectedAsset: { id: '', summary: 'x' } }),
      []
    )
    assert.deepEqual(
      getAvailableResponseActions({ affectedAsset: { id: '   ', summary: 'x' } }),
      []
    )
    assert.deepEqual(getAvailableResponseActions(null), [])
    assert.equal(affectedNodeIdFromContext({ endpointId: 'gw' }), 'gw')
    assert.equal(affectedNodeIdFromContext({ affectedNodeId: 'core' }), 'core')
  })

  it('rejects unknown action ids', () => {
    assert.equal(getResponseAction('shutdown-grid'), null)
    assert.equal(getResponseAction(''), null)
    assert.equal(getResponseAction(null), null)
    assert.equal(isRegisteredResponseAction('shutdown-grid'), false)
    assert.equal(isRegisteredResponseAction('isolate-node'), true)
  })

  it('does not depend on attacker panel preset names', () => {
    const base = {
      affectedAsset: { id: 'pay', summary: 'Payment Processing System' },
    }
    const withPreset = {
      ...base,
      attackPreset: 'traffic_flood',
      presetId: 'data_exfiltration',
      campaignId: 'cmp-fake',
    }
    const a = getAvailableResponseActions(base)
    const b = getAvailableResponseActions(withPreset)
    assert.equal(a.length, b.length)
    assert.equal(a[0]?.actionId, b[0]?.actionId)
    assert.deepEqual(
      getAvailableResponseActions({
        attackPreset: 'credential_spray',
        presetId: 'api_abuse',
      }),
      []
    )
  })

  it('attachAvailableResponseActions adds availableActions and responsePolicy', () => {
    const attached = attachAvailableResponseActions({
      incidentId: 'pers-pay',
      affectedAsset: { id: 'pay', summary: 'Pay' },
    })
    assert.equal(attached.incidentId, 'pers-pay')
    assert.equal(attached.availableActions[0].actionId, 'isolate-node')
    assert.ok(attached.responsePolicy)
    assert.equal(attached.responsePolicy.executionConstraints.seedOnly, true)
    assert.equal(attachAvailableResponseActions(null), null)
  })
})

describe('Stage 3 policy-driven availability', () => {
  it('includes isolate-node for each confirmed seed profile', () => {
    const cases = [
      {
        name: 'flood',
        ctx: seedContext({ anomalyEvidence: [metricEv('packetsPerSecond', 400)] }),
        profile: RESPONSE_PROFILES.NETWORK_TRAFFIC_FLOOD,
        rationale: /packet-rate|flood/i,
      },
      {
        name: 'credential',
        ctx: seedContext({
          affectedAsset: { id: 'id', summary: 'Identity', type: 'identity_access' },
          anomalyEvidence: [metricEv('failedLoginsPerMin', 300)],
        }),
        profile: RESPONSE_PROFILES.IDENTITY_CREDENTIAL_ATTACK,
        rationale: /failed-login|authentication/i,
      },
      {
        name: 'exfil',
        ctx: seedContext({ anomalyEvidence: [metricEv('filesDownloaded', 250)] }),
        profile: RESPONSE_PROFILES.DATA_EXFILTRATION,
        rationale: /file-transfer|bulk file/i,
      },
      {
        name: 'api',
        ctx: seedContext({ anomalyEvidence: [metricEv('httpRequestsPerMin', 400)] }),
        profile: RESPONSE_PROFILES.SERVICE_API_ABUSE,
        rationale: /HTTP\/API|request volume/i,
      },
      {
        name: 'finance',
        ctx: seedContext({
          affectedAsset: {
            id: 'pay',
            type: 'payment_processing_system',
            summary: 'Payment',
          },
          anomalyEvidence: [{ code: 'tgnn_embed' }],
          financialExposure: { simulated: true, exposureLabel: '₹2 Cr' },
        }),
        profile: RESPONSE_PROFILES.FINANCIAL_SERVICE_COMPROMISE,
        rationale: /finance|simulated/i,
      },
      {
        name: 'ot',
        ctx: seedContext({
          affectedAsset: { id: 'pwr', type: 'power_grid', summary: 'Power Grid' },
          anomalyEvidence: [{ code: 'tgnn_embed' }],
        }),
        profile: RESPONSE_PROFILES.OT_INFRASTRUCTURE_ANOMALY,
        rationale: /Cyber\/network|OT|plant/i,
      },
      {
        name: 'general',
        ctx: seedContext({
          affectedAsset: { id: 'road', type: 'road_infrastructure', summary: 'Road' },
          anomalyEvidence: [{ code: 'tgnn_embed' }],
        }),
        profile: RESPONSE_PROFILES.GENERAL_RESIDUAL_ANOMALY,
        rationale: /residual|evidence/i,
      },
    ]

    const flood = getAvailableResponseActions(cases[0].ctx)
    const credential = getAvailableResponseActions(cases[1].ctx)
    const floodIsolate = flood.find((action) => action.actionId === 'isolate-node')
    const credentialIsolate = credential.find((action) => action.actionId === 'isolate-node')
    assert.ok(floodIsolate)
    assert.ok(credentialIsolate)
    assert.ok(floodIsolate.rationale)
    assert.ok(credentialIsolate.rationale)

    for (const c of cases) {
      const actions = getAvailableResponseActions(c.ctx)
      const isolate = actions.find((action) => action.actionId === 'isolate-node')
      assert.ok(isolate, c.name)
      assert.equal(isolate.responseProfile, c.profile, c.name)
      assert.ok(isolate.rationale, c.name)
      const policy = buildResponsePolicy(c.ctx)
      assert.equal(policy.responseProfile, c.profile, c.name)
      assert.equal(policy.executionConstraints.exposureOnly, false, c.name)
      assert.equal(
        actions.some((a) => a.actionId === 'restore-connectivity'),
        false,
        `${c.name}: restore before isolate`
      )
    }
  })

  it('offers restore-connectivity only after prior isolate while quarantined', () => {
    const base = seedContext({ anomalyEvidence: [metricEv('packetsPerSecond', 400)] })
    assert.equal(
      getAvailableResponseActions(base).some((a) => a.actionId === 'restore-connectivity'),
      false
    )
    const afterIsolate = {
      ...base,
      affectedAsset: { ...base.affectedAsset, quarantined: true },
      actionsAlreadyTaken: [
        {
          actionId: 'isolate-node',
          status: 'EXECUTED',
          targetNodeId: 'ep-pay',
          executedAtMs: Date.now(),
        },
      ],
    }
    const available = getAvailableResponseActions(afterIsolate)
    const restore = available.find((a) => a.actionId === 'restore-connectivity')
    assert.ok(restore)
    assert.match(restore.rationale, /Restore connectivity after containment/i)

    assert.equal(
      getAvailableResponseActions({
        ...afterIsolate,
        affectedAsset: { ...afterIsolate.affectedAsset, quarantined: false },
      }).some((a) => a.actionId === 'restore-connectivity'),
      false
    )
    assert.equal(
      getAvailableResponseActions({
        ...base,
        affectedAsset: { ...base.affectedAsset, quarantined: true },
      }).some((a) => a.actionId === 'restore-connectivity'),
      false
    )
  })

  it('returns zero executable actions for propagated/exposure-only nodes', () => {
    assert.deepEqual(
      getAvailableResponseActions(
        seedContext({
          isExposureIncident: true,
          anomalyEvidence: [{ code: 'graph_propagation' }],
          affectedAsset: { id: 'core', type: 'banking_financial', summary: 'Core' },
          financialExposure: { simulated: true, exposureLabel: '₹2 Cr' },
        })
      ),
      []
    )
    const policy = buildResponsePolicy({
      affectedAsset: { id: 'gw', summary: 'Gateway' },
      isExposureIncident: true,
      anomalyEvidence: [{ code: 'peer_exposure' }],
      financialExposure: { simulated: true, exposureLabel: '₹5 Cr' },
    })
    assert.equal(policy.responseProfile, RESPONSE_PROFILES.PROPAGATED_EXPOSURE)
    assert.equal(policy.executionConstraints.exposureOnly, true)
    assert.equal(policy.recommendedActions.length, 0)
  })

  it('does not invent unregistered actionIds from policy or client-shaped fields', () => {
    const available = getAvailableResponseActions(
      seedContext({
        availableActions: [{ actionId: 'shutdown-grid' }],
        recommendedActions: [{ actionId: 'fake-waf' }],
      })
    )
    assert.ok(available.some((action) => action.actionId === 'isolate-node'))
    assert.ok(available.every((action) => isRegisteredResponseAction(action.actionId)))
    assert.equal(available.some((action) => action.actionId === 'shutdown-grid'), false)
    assert.equal(available.some((action) => action.actionId === 'fake-waf'), false)
    assert.equal(getResponseAction('fake-waf'), null)
  })

  it('never offers restore for exposure-only even if quarantined with isolate history', () => {
    const available = getAvailableResponseActions({
      affectedAsset: { id: 'gw', summary: 'Gateway', quarantined: true },
      isExposureIncident: true,
      anomalyEvidence: [{ code: 'peer_exposure' }],
      actionsAlreadyTaken: [
        {
          actionId: 'isolate-node',
          status: 'EXECUTED',
          targetNodeId: 'gw',
          executedAtMs: 1,
        },
      ],
    })
    assert.deepEqual(available, [])
  })
})
