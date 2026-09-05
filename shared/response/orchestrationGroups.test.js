import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import {
  buildOrchestrationGroups,
  cityModelSectorOf,
  couplingReasonBetween,
  resolveOrchestrationGroupMode,
} from './orchestrationGroups.js'

function inc(id, endpointId, extra = {}) {
  return {
    id,
    endpointId,
    endpointLabel: endpointId.toUpperCase(),
    status: 'open',
    severity: extra.severity ?? 'medium',
    recoveryPriority: extra.recoveryPriority ?? 10,
    sector: extra.sector,
    peerExposedNodeIds: extra.peerExposedNodeIds ?? [],
    propagatedNodeIds: extra.propagatedNodeIds ?? [],
    relatedIncidents: extra.relatedIncidents ?? [],
    campaignId: extra.campaignId ?? null,
    ...extra,
  }
}

describe('orchestrationGroups — city sector + modes', () => {
  const prevMode = process.env.ORCHESTRATION_GROUP_MODE
  const prevCouple = process.env.ORCHESTRATION_GROUP_COUPLING

  after(() => {
    if (prevMode === undefined) delete process.env.ORCHESTRATION_GROUP_MODE
    else process.env.ORCHESTRATION_GROUP_MODE = prevMode
    if (prevCouple === undefined) delete process.env.ORCHESTRATION_GROUP_COUPLING
    else process.env.ORCHESTRATION_GROUP_COUPLING = prevCouple
  })

  before(() => {
    delete process.env.ORCHESTRATION_GROUP_COUPLING
    process.env.ORCHESTRATION_GROUP_MODE = 'sector'
  })

  it('default mode is sector', () => {
    assert.equal(resolveOrchestrationGroupMode(null), 'sector')
  })

  it('Energy + Water → two parallel sector groups', () => {
    const { groups, groupMode } = buildOrchestrationGroups({
      detection: {
        incidents: [
          inc('a', 'power', { sector: 'Energy', recoveryPriority: 99 }),
          inc('b', 'pump', { sector: 'Water', recoveryPriority: 10 }),
        ],
      },
      groupMode: 'sector',
    })
    assert.equal(groupMode, 'sector')
    assert.equal(groups.length, 2)
    assert.ok(groups.some((g) => /Energy/i.test(g.label)))
    assert.ok(groups.some((g) => /Water/i.test(g.label)))
  })

  it('two Energy incidents → one sector group (sequential inside)', () => {
    const { groups } = buildOrchestrationGroups({
      detection: {
        incidents: [
          inc('a', 'power', { sector: 'Energy', recoveryPriority: 90 }),
          inc('b', 'sub', { sector: 'Energy', recoveryPriority: 40 }),
        ],
      },
      groupMode: 'sector',
    })
    assert.equal(groups.length, 1)
    assert.deepEqual(groups[0].incidentIds, ['a', 'b'])
    assert.match(groups[0].reason, /sector/i)
  })

  it('mode=none → every incident parallel', () => {
    const { groups } = buildOrchestrationGroups({
      detection: {
        incidents: [
          inc('a', 'power', { sector: 'Energy' }),
          inc('b', 'sub', { sector: 'Energy' }),
        ],
      },
      groupMode: 'none',
    })
    assert.equal(groups.length, 2)
  })

  it('mode=link couples by campaign / peer', () => {
    const { groups } = buildOrchestrationGroups({
      detection: {
        incidents: [
          inc('a', 'power', { sector: 'Energy', campaignId: 'c1' }),
          inc('b', 'pump', { sector: 'Water', campaignId: 'c1' }),
        ],
      },
      groupMode: 'link',
    })
    assert.equal(groups.length, 1)
  })

  it('resolves sector from node.data.domain when incident.sector missing', () => {
    const nodes = [
      { id: 'power', data: { domain: 'Energy', type: 'power_grid' } },
      { id: 'pump', data: { domain: 'Water', type: 'water_pump' } },
    ]
    assert.equal(cityModelSectorOf(inc('a', 'power'), nodes), 'energy')
    assert.equal(cityModelSectorOf(inc('b', 'pump'), nodes), 'water')
    const { groups } = buildOrchestrationGroups({
      detection: { incidents: [inc('a', 'power'), inc('b', 'pump')] },
      nodes,
      groupMode: 'sector',
    })
    assert.equal(groups.length, 2)
  })

  it('unknown sector stays per-asset (not one giant unknown bag)', () => {
    const { groups } = buildOrchestrationGroups({
      detection: {
        incidents: [inc('a', 'x1'), inc('b', 'x2')],
      },
      nodes: [],
      groupMode: 'sector',
    })
    assert.equal(groups.length, 2)
  })

  it('couplingReasonBetween still works for link mode', () => {
    assert.equal(
      couplingReasonBetween(inc('a', 'power'), inc('b', 'water'), {
        adjacency: new Map(),
      }),
      null
    )
    assert.equal(
      couplingReasonBetween(inc('a', 'power'), inc('b', 'power')),
      'same affected node'
    )
  })
})
