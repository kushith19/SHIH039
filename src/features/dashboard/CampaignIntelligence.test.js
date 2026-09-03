import assert from 'node:assert/strict'
import test from 'node:test'
import { visibleHistoryCampaigns } from './campaignIntelligenceView.js'

test('campaign intelligence hides a single incident or empty payload', () => {
  assert.deepEqual(visibleHistoryCampaigns([]), [])
  assert.deepEqual(visibleHistoryCampaigns(null), [])
  assert.equal(
    visibleHistoryCampaigns([
      { campaignId: 'camp-h-x', incidentCount: 1, sequence: [{ incidentId: 'a' }] },
    ]).length,
    0
  )
})

test('campaign intelligence keeps backend multi-incident campaigns', () => {
  const rows = visibleHistoryCampaigns([
    {
      campaignId: 'camp-h-1',
      incidentCount: 2,
      sequence: [{ incidentId: 'a' }, { incidentId: 'b' }],
      correlationReasons: ['Detected within the configured time window'],
    },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].campaignId, 'camp-h-1')
  assert.equal(rows[0].correlationReasons.length, 1)
})
