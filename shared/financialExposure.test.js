import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RESIDUAL_BAND,
  computeFinancialExposure,
  financeServiceKey,
  flaggedNodeIds,
  formatInrLakhs,
  residualBand,
} from './financialExposure.js'

test('formatter uses Cr and L without fake precision', () => {
  assert.equal(formatInrLakhs(0), '₹0')
  assert.equal(formatInrLakhs(80), '₹80 L')
  assert.equal(formatInrLakhs(120), '₹1.2 Cr')
  assert.equal(formatInrLakhs(100), '₹1 Cr')
})

test('residual band follows the displayed cyber score', () => {
  assert.equal(residualBand(null), RESIDUAL_BAND.NOMINAL)
  assert.equal(residualBand(44), RESIDUAL_BAND.NOMINAL)
  assert.equal(residualBand(45), RESIDUAL_BAND.ELEVATED)
  assert.equal(residualBand(70), RESIDUAL_BAND.HIGH)
})

test('type and yaml id of the same service share one key', () => {
  assert.equal(
    financeServiceKey({ type: 'banking_financial' }),
    financeServiceKey({ cityEndpointId: 'core-banking-system' })
  )
  assert.equal(financeServiceKey({ id: 'ep-payment_processing_system' }), 'payment-processing-system')
})

test('retail / supply-chain catalog types are not treated as finance services', () => {
  assert.equal(financeServiceKey({ type: 'retail_infrastructure', cityEndpointId: 'payment-processing-system' }), null)
  assert.equal(financeServiceKey({ type: 'supply_chain', sector: 'Finance' }), null)
})

test('same service via type and yaml on two nodes does not double-count', () => {
  const view = computeFinancialExposure({
    detection: {
      riskMomentum: { score: 87, available: true },
      anomalyNodeIds: ['ep-banking_financial', 'alias-core'],
      incidents: [],
    },
    nodes: [
      { id: 'ep-banking_financial', data: { type: 'banking_financial', criticality: 'critical' } },
      { id: 'alias-core', data: { cityEndpointId: 'core-banking-system', criticality: 'critical' } },
    ],
    edges: [],
  })
  assert.equal(view.lakhs, 120)
  assert.equal(view.affectedServices, 1)
  assert.equal(view.exposureLabel, '₹1.2 Cr')
  assert.equal(view.blastRadius, 2)
})

test('non-finance flagged nodes add zero rupees', () => {
  const view = computeFinancialExposure({
    detection: {
      riskMomentum: { score: 90, available: true },
      anomalyNodeIds: ['ep-power_grid'],
      compromisedNodeIds: [],
      atRiskNodeIds: [],
      incidents: [{ endpointId: 'ep-healthcare' }],
    },
    nodes: [
      { id: 'ep-power_grid', data: { type: 'power_grid', criticality: 'critical' } },
      { id: 'ep-healthcare', data: { type: 'healthcare', criticality: 'critical' } },
    ],
    edges: [],
  })
  assert.equal(view.lakhs, 0)
  assert.equal(view.affectedServices, 0)
  assert.equal(view.blastRadius, 2)
  assert.match(view.explanation, /no mapped financial services/i)
})

test('blast radius is the unique flagged union including incidents', () => {
  const ids = flaggedNodeIds({
    anomalyNodeIds: ['a'],
    compromisedNodeIds: ['a', 'b'],
    atRiskNodeIds: ['c'],
    incidents: [{ endpointId: 'd' }, { endpointId: 'b' }],
  })
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c', 'd'])
})

test('critical dependencies count unique high/critical neighbors on existing edges', () => {
  const view = computeFinancialExposure({
    detection: {
      riskMomentum: { score: 80, available: true },
      anomalyNodeIds: ['ep-payment_processing_system'],
    },
    nodes: [
      {
        id: 'ep-payment_processing_system',
        data: { type: 'payment_processing_system', criticality: 'critical' },
      },
      { id: 'ep-banking_financial', data: { type: 'banking_financial', criticality: 'critical' } },
      { id: 'ep-public_wifi', data: { type: 'public_wifi', criticality: 'low' } },
      { id: 'two-hops-away', data: { type: 'bank_gateway', criticality: 'critical' } },
    ],
    edges: [
      { source: 'ep-payment_processing_system', target: 'ep-banking_financial' },
      { source: 'ep-payment_processing_system', target: 'ep-public_wifi' },
      { source: 'ep-banking_financial', target: 'two-hops-away' },
    ],
  })
  assert.equal(view.lakhs, 80)
  assert.equal(view.affectedServices, 1)
  assert.equal(view.criticalDependencies, 1)
  assert.equal(view.blastRadius, 1)
})

test('idle detection yields zero exposure', () => {
  const view = computeFinancialExposure({
    detection: {
      riskMomentum: { score: null, available: false },
      anomalyNodeIds: [],
      incidents: [],
    },
    nodes: [],
    edges: [],
  })
  assert.equal(view.lakhs, 0)
  assert.equal(view.blastRadius, 0)
  assert.equal(view.cyberScoreAvailable, false)
  assert.equal(view.residualBand, RESIDUAL_BAND.NOMINAL)
})
