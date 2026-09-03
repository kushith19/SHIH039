import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CLASSIFICATION_CONFIDENCE,
  RESPONSE_PROFILES,
  attachResponseClassification,
  classifyResponseProfile,
  inferDominantMetric,
} from './responsePolicy.js'

function baseContext(overrides = {}) {
  const { affectedAsset: assetOver, ...rest } = overrides
  return {
    incidentId: 'pers-1',
    severity: 'high',
    anomalyEvidence: [],
    financialExposure: null,
    isExposureIncident: false,
    ...rest,
    affectedAsset: {
      id: 'ep-pay',
      summary: 'Payment Processing',
      ...(assetOver ?? {}),
    },
  }
}

function metricEv(metric, deviationPct) {
  return {
    code: 'metric_deviation',
    metric,
    observed: 1000,
    expected: 100,
    deviationPct,
  }
}

describe('classifyResponseProfile', () => {
  it('classifies strong PPS as NETWORK_TRAFFIC_FLOOD', () => {
    const r = classifyResponseProfile(
      baseContext({
        anomalyEvidence: [metricEv('packetsPerSecond', 400)],
      })
    )
    assert.equal(r.responseProfile, RESPONSE_PROFILES.NETWORK_TRAFFIC_FLOOD)
    assert.equal(r.dominantMetric, 'packetsPerSecond')
    assert.equal(r.classificationConfidence, CLASSIFICATION_CONFIDENCE.HIGH)
    assert.equal(r.isSeed, true)
    assert.equal(r.isExposureOnly, false)
    assert.ok(r.reasons.some((x) => /packetsPerSecond/i.test(x)))
    assert.equal('actionId' in r, false)
  })

  it('classifies strong failed logins as IDENTITY_CREDENTIAL_ATTACK', () => {
    const r = classifyResponseProfile(
      baseContext({
        affectedAsset: { type: 'identity_access' },
        anomalyEvidence: [metricEv('failedLoginsPerMin', 250)],
      })
    )
    assert.equal(r.responseProfile, RESPONSE_PROFILES.IDENTITY_CREDENTIAL_ATTACK)
    assert.equal(r.dominantMetric, 'failedLoginsPerMin')
    assert.equal(r.classificationConfidence, CLASSIFICATION_CONFIDENCE.HIGH)
    assert.ok(r.reasons.some((x) => /failedLoginsPerMin/i.test(x)))
  })

  it('classifies strong filesDownloaded as DATA_EXFILTRATION', () => {
    const r = classifyResponseProfile(
      baseContext({
        anomalyEvidence: [metricEv('filesDownloaded', 300)],
      })
    )
    assert.equal(r.responseProfile, RESPONSE_PROFILES.DATA_EXFILTRATION)
    assert.equal(r.dominantMetric, 'filesDownloaded')
    assert.equal(r.classificationConfidence, CLASSIFICATION_CONFIDENCE.HIGH)
  })

  it('classifies strong HTTP as SERVICE_API_ABUSE', () => {
    const r = classifyResponseProfile(
      baseContext({
        anomalyEvidence: [metricEv('httpRequestsPerMin', 500)],
      })
    )
    assert.equal(r.responseProfile, RESPONSE_PROFILES.SERVICE_API_ABUSE)
    assert.equal(r.dominantMetric, 'httpRequestsPerMin')
  })

  it('classifies OT power/plc nodes as OT_INFRASTRUCTURE_ANOMALY', () => {
    for (const type of ['power_grid', 'plc_controller', 'water_supply', 'smart_actuator']) {
      const r = classifyResponseProfile(
        baseContext({
          affectedAsset: { id: `ep-${type}`, type },
          anomalyEvidence: [{ code: 'tgnn_embed', detail: 'tgnn_embed' }],
        })
      )
      assert.equal(r.responseProfile, RESPONSE_PROFILES.OT_INFRASTRUCTURE_ANOMALY, type)
      assert.equal(r.otSafety, true)
      assert.equal(r.classificationConfidence, CLASSIFICATION_CONFIDENCE.HIGH)
      assert.ok(r.reasons.some((x) => /OT\/cyber-physical/i.test(x)))
    }
  })

  it('classifies finance node without strong signature as FINANCIAL_SERVICE_COMPROMISE', () => {
    const r = classifyResponseProfile(
      baseContext({
        affectedAsset: {
          id: 'ep-payment_processing_system',
          type: 'payment_processing_system',
          sector: 'Finance',
        },
        anomalyEvidence: [{ code: 'tgnn_embed', detail: 'tgnn_embed' }],
        financialExposure: {
          simulated: true,
          exposureLabel: '₹2 Cr',
          available: true,
        },
      })
    )
    assert.equal(r.responseProfile, RESPONSE_PROFILES.FINANCIAL_SERVICE_COMPROMISE)
    assert.equal(r.classificationConfidence, CLASSIFICATION_CONFIDENCE.MEDIUM)
    assert.ok(r.reasons.length >= 1)
  })

  it('falls back to GENERAL_RESIDUAL_ANOMALY for generic TGNN residual', () => {
    const r = classifyResponseProfile(
      baseContext({
        affectedAsset: { id: 'ep-road_infrastructure', type: 'road_infrastructure' },
        anomalyEvidence: [{ code: 'tgnn_embed', detail: 'tgnn_embed' }],
      })
    )
    assert.equal(r.responseProfile, RESPONSE_PROFILES.GENERAL_RESIDUAL_ANOMALY)
    assert.equal(r.classificationConfidence, CLASSIFICATION_CONFIDENCE.LOW)
    assert.equal(r.isSeed, true)
  })

  it('classifies exposure-only as PROPAGATED_EXPOSURE', () => {
    const r = classifyResponseProfile(
      baseContext({
        isExposureIncident: true,
        affectedAsset: { id: 'ep-bank_gateway', type: 'bank_gateway' },
        anomalyEvidence: [{ code: 'peer_exposure' }],
      })
    )
    assert.equal(r.responseProfile, RESPONSE_PROFILES.PROPAGATED_EXPOSURE)
    assert.equal(r.isExposureOnly, true)
    assert.equal(r.isSeed, false)
    assert.equal(r.classificationConfidence, CLASSIFICATION_CONFIDENCE.HIGH)
  })

  it('does not let finance override a strong PPS signature', () => {
    const r = classifyResponseProfile(
      baseContext({
        affectedAsset: {
          id: 'ep-payment_processing_system',
          type: 'payment_processing_system',
          sector: 'Finance',
        },
        anomalyEvidence: [metricEv('packetsPerSecond', 350)],
        financialExposure: {
          simulated: true,
          exposureLabel: '₹2 Cr',
        },
      })
    )
    assert.equal(r.responseProfile, RESPONSE_PROFILES.NETWORK_TRAFFIC_FLOOD)
    assert.ok(r.reasons.includes('financial_service_context'))
  })

  it('includes confidence and reasons and never emits actionId', () => {
    const r = classifyResponseProfile(
      baseContext({ anomalyEvidence: [metricEv('httpRequestsPerMin', 200)] })
    )
    assert.ok(['high', 'medium', 'low'].includes(r.classificationConfidence))
    assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0)
    assert.equal(r.actionId, undefined)
    assert.deepEqual(Object.keys(r).sort(), [
      'classificationConfidence',
      'dominantMetric',
      'isExposureOnly',
      'isSeed',
      'otSafety',
      'reasons',
      'responseProfile',
    ])
  })

  it('is pure and deterministic for the same input', () => {
    const ctx = baseContext({
      anomalyEvidence: [metricEv('filesDownloaded', 180), metricEv('packetsPerSecond', 90)],
    })
    const a = classifyResponseProfile(ctx)
    const b = classifyResponseProfile(ctx)
    assert.deepEqual(a, b)
    assert.equal(a.responseProfile, RESPONSE_PROFILES.DATA_EXFILTRATION)
  })

  it('resolves dominant metric ties toward higher-precedence attack metrics', () => {
    // Equal abs deviation — failedLogins wins tie-break over PPS
    const ctx = baseContext({
      anomalyEvidence: [
        metricEv('packetsPerSecond', 100),
        metricEv('failedLoginsPerMin', 100),
      ],
    })
    assert.equal(inferDominantMetric(ctx), 'failedLoginsPerMin')
    assert.equal(
      classifyResponseProfile(ctx).responseProfile,
      RESPONSE_PROFILES.IDENTITY_CREDENTIAL_ATTACK
    )
  })
})

describe('attachResponseClassification', () => {
  it('enriches affectedAsset from room nodes and attaches responseClassification', () => {
    const context = {
      affectedAsset: { id: 'ep-power_grid', summary: 'Power Grid' },
      anomalyEvidence: [{ code: 'tgnn_embed' }],
    }
    const nodes = [
      {
        id: 'ep-power_grid',
        data: {
          type: 'power_grid',
          sector: 'Energy',
          criticality: 'critical',
          label: 'Power Grid',
        },
      },
    ]
    const out = attachResponseClassification(context, nodes)
    assert.equal(out.affectedAsset.type, 'power_grid')
    assert.equal(out.affectedAsset.sector, 'Energy')
    assert.equal(out.affectedAsset.criticality, 'critical')
    assert.equal(
      out.responseClassification.responseProfile,
      RESPONSE_PROFILES.OT_INFRASTRUCTURE_ANOMALY
    )
    assert.equal(out.availableActions, undefined)
  })
})
