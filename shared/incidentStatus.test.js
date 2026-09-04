import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isActiveResponseIncident,
  isClosedOrHistoricalIncident,
  filterActiveResponseIncidents,
} from './incidentStatus.js'

describe('incidentStatus shared semantics', () => {
  it('treats open and operator workflow aliases as active', () => {
    for (const status of ['open', 'acknowledged', 'investigating', 'contained', '']) {
      assert.equal(isActiveResponseIncident({ status }), true, status)
    }
    assert.equal(isActiveResponseIncident({}), true)
  })

  it('treats cleared/closed/resolved as historical', () => {
    for (const status of ['cleared', 'closed', 'resolved']) {
      assert.equal(isActiveResponseIncident({ status }), false, status)
      assert.equal(isClosedOrHistoricalIncident({ status }), true, status)
    }
  })

  it('filters mixed populations consistently', () => {
    const list = [
      { id: '1', status: 'open' },
      { id: '2', status: 'acknowledged' },
      { id: '3', status: 'cleared' },
      { id: '4', status: 'investigating' },
      { id: '5', status: 'contained' },
      { id: '6', status: 'resolved' },
    ]
    const active = filterActiveResponseIncidents(list)
    assert.deepEqual(
      active.map((i) => i.id),
      ['1', '2', '4', '5']
    )
  })
})
