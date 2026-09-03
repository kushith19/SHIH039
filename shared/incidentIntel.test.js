import assert from 'node:assert/strict'
import test from 'node:test'
import { keySignals, primaryAttackPath, riskPercent, whyItMatters } from './incidentIntel.js'

test('primaryAttackPath uses longest seed-rooted path and does not invent hops', () => {
  const path = primaryAttackPath({
    endpointId: 'pay',
    propagationPaths: {
      gw: ['pay', 'gw'],
      core: ['pay', 'gw', 'core'],
      other: ['x', 'y'],
    },
  })
  assert.deepEqual(path, ['pay', 'gw', 'core'])
  assert.deepEqual(primaryAttackPath({ endpointId: 'solo' }), ['solo'])
})

test('key signals stay compact and user-facing', () => {
  const signals = keySignals({
    endpointId: 'pay',
    trustScore: 42,
    evidence: [
      { code: 'tgnn_embed', detail: 'tgnn_embed' },
      { code: 'peer_trust_decrease', previous: 70, current: 42 },
    ],
    propagationPaths: { core: ['pay', 'gw', 'core'] },
  })
  assert.equal(signals.length <= 3, true)
  assert.ok(signals.includes('Graph residual anomaly detected'))
  assert.ok(signals.includes('Trust degradation'))
  assert.ok(signals.includes('2-hop propagation'))
})

test('whyItMatters mentions simulated finance when present', () => {
  const text = whyItMatters({
    endpointLabel: 'Payment Processing System',
    detectionType: 'behavioural_anomaly',
    financialContext: { simulated: true, exposureLabel: '₹2.3 Cr' },
    propagationPaths: { core: ['pay', 'gw', 'core'] },
    endpointId: 'pay',
  })
  assert.match(text, /Payment Processing System/)
  assert.match(text, /₹2\.3 Cr/)
  assert.match(text, /not a loss forecast/)
})

test('riskPercent maps residual 0-1 to display points', () => {
  assert.equal(riskPercent(0.87), 87)
  assert.equal(riskPercent(null), null)
})
