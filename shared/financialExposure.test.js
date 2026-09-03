import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RESIDUAL_BAND,
  computeFinancialExposure,
  currentExposureForIncident,
  economicServiceKey,
  financeServiceKey,
  flaggedNodeIds,
  formatInrLakhs,
  residualBand,
  serviceDisplayLabel,
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
  assert.equal(economicServiceKey({ type: 'power_grid' }), 'distribution-management-system')
  assert.equal(economicServiceKey({ type: 'telecom_gateway' }), 'telecom-network-gateway')
  assert.equal(economicServiceKey({ type: 'emergency_services' }), 'emergency-dispatch-system')
})

test('retail / supply-chain catalog types are not treated as economic services via sector alone', () => {
  assert.equal(financeServiceKey({ type: 'retail_infrastructure', cityEndpointId: 'payment-processing-system' }), null)
  assert.equal(financeServiceKey({ type: 'supply_chain', sector: 'Finance' }), null)
})

test('A: payment + core banking → ₹2 Cr', () => {
  const view = computeFinancialExposure({
    detection: {
      riskMomentum: { score: 80, available: true },
      anomalyNodeIds: ['pay'],
      peerExposedNodeIds: ['core'],
      propagatedNodeIds: ['core'],
    },
    nodes: [
      { id: 'pay', data: { type: 'payment_processing_system' } },
      { id: 'core', data: { type: 'banking_financial' } },
    ],
    edges: [{ source: 'pay', target: 'core' }],
  })
  assert.equal(view.lakhs, 80 + 120)
  assert.equal(view.exposureLabel, '₹2 Cr')
  assert.equal(view.affectedServices, 2)
  assert.ok(view.breakdown.some((b) => b.id === 'payment-processing-system' && b.lakhs === 80))
  assert.ok(view.breakdown.some((b) => b.id === 'core-banking-system' && b.lakhs === 120))
})

test('B: multiple sectors sum distinct mappings', () => {
  const view = computeFinancialExposure({
    detection: {
      anomalyNodeIds: ['pay', 'tel', 'em'],
    },
    nodes: [
      { id: 'pay', data: { type: 'payment_processing_system' } },
      { id: 'tel', data: { type: 'telecom_gateway' } },
      { id: 'em', data: { type: 'emergency_services' } },
    ],
    edges: [],
  })
  assert.equal(view.lakhs, 80 + 50 + 70)
  assert.equal(view.exposureLabel, '₹2 Cr')
  assert.equal(view.affectedServices, 3)
  assert.equal(view.breakdown.length, 3)
})

test('C/D: same service via type and yaml on two nodes does not double-count', () => {
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

test('E: unmapped asset contributes ₹0', () => {
  const view = computeFinancialExposure({
    detection: {
      riskMomentum: { score: 90, available: true },
      anomalyNodeIds: ['ep-unknown'],
      incidents: [],
    },
    nodes: [{ id: 'ep-unknown', data: { type: 'street_lighting', criticality: 'low' } }],
    edges: [],
  })
  assert.equal(view.lakhs, 0)
  assert.equal(view.affectedServices, 0)
  assert.match(view.explanation, /no mapped economically consequential/i)
})

test('power and hospital contribute economic exposure', () => {
  const view = computeFinancialExposure({
    detection: {
      anomalyNodeIds: ['ep-power_grid', 'ep-hospital_gateway'],
    },
    nodes: [
      { id: 'ep-power_grid', data: { type: 'power_grid', criticality: 'critical' } },
      { id: 'ep-hospital_gateway', data: { type: 'hospital_gateway', criticality: 'critical' } },
    ],
    edges: [],
  })
  assert.equal(view.lakhs, 150 + 120)
  assert.equal(view.exposureLabel, '₹2.7 Cr')
  assert.equal(serviceDisplayLabel('distribution-management-system'), 'Power Grid')
})

test('F: propagation adds distinct economic services', () => {
  const seedOnly = computeFinancialExposure({
    detection: { anomalyNodeIds: ['pay'] },
    nodes: [
      { id: 'pay', data: { type: 'payment_processing_system' } },
      { id: 'core', data: { type: 'banking_financial' } },
    ],
    edges: [{ source: 'pay', target: 'core' }],
  })
  const withProp = computeFinancialExposure({
    detection: {
      anomalyNodeIds: ['pay'],
      peerExposedNodeIds: ['core'],
      propagatedNodeIds: ['core'],
    },
    nodes: [
      { id: 'pay', data: { type: 'payment_processing_system' } },
      { id: 'core', data: { type: 'banking_financial' } },
    ],
    edges: [{ source: 'pay', target: 'core' }],
  })
  assert.equal(seedOnly.lakhs, 80)
  assert.ok(withProp.lakhs > seedOnly.lakhs)
  assert.equal(withProp.lakhs, 200)
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

test('H: idle / empty flagged set yields zero exposure', () => {
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
  assert.deepEqual(view.breakdown, [])
})

test('I: cleared incident current exposure is ₹0 while historical preserved', () => {
  const view = currentExposureForIncident(
    {
      status: 'cleared',
      affectedNodeId: 'pay',
      financialContext: {
        simulated: true,
        lakhs: 200,
        exposureLabel: '₹2 Cr',
        affectedServiceIds: ['payment-processing-system', 'core-banking-system'],
        breakdown: [
          { id: 'core-banking-system', label: 'Core Banking', lakhs: 120, exposureLabel: '₹1.2 Cr' },
        ],
      },
    },
    { detection: { anomalyNodeIds: [], incidents: [] }, nodes: [], edges: [] }
  )
  assert.equal(view.lakhs, 0)
  assert.equal(view.exposureLabel, '₹0')
  assert.equal(view.historicalExposure.lakhs, 200)
  assert.equal(view.peakLakhs, 200)
})

test('G: current exposure drops when live incident leaves the detection set', () => {
  const roomAttack = {
    nodes: [
      { id: 'pay', data: { type: 'payment_processing_system' } },
      { id: 'core', data: { type: 'banking_financial' } },
    ],
    edges: [{ source: 'pay', target: 'core' }],
    detection: {
      anomalyNodeIds: ['pay'],
      incidents: [
        {
          id: 'inc-pay',
          endpointId: 'pay',
          peerExposedNodeIds: ['core'],
          propagatedNodeIds: ['core'],
        },
      ],
    },
  }
  const incident = {
    status: 'open',
    incidentId: 'inc-pay:1',
    liveIncidentId: 'inc-pay',
    affectedNodeId: 'pay',
    financialContext: { simulated: true, lakhs: 200, exposureLabel: '₹2 Cr' },
  }
  const during = currentExposureForIncident(incident, roomAttack)
  assert.equal(during.lakhs, 200)

  const roomClear = {
    ...roomAttack,
    detection: { anomalyNodeIds: [], incidents: [], peerExposedNodeIds: [], propagatedNodeIds: [] },
  }
  const after = currentExposureForIncident(incident, roomClear)
  assert.equal(after.lakhs, 0)
  assert.equal(after.exposureLabel, '₹0')
})
