import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildApprovalScope,
  hasRemainingResponseWork,
  isPlanWithinApprovalScope,
  remainingResponseCandidates,
} from './approvalScope.js'

describe('approvalScope STEP 9', () => {
  it('buildApprovalScope snapshots active incidents and executable actions', () => {
    const scope = buildApprovalScope({
      plan: {
        planId: 'p1',
        affectedNodeIds: ['pay'],
        recommendedActions: [
          { actionId: 'isolate-node', executable: true, target: { id: 'pay' } },
          { actionId: null, executable: false },
        ],
      },
      detection: {
        incidents: [
          { id: 'a', endpointId: 'pay', status: 'open' },
          { id: 'b', endpointId: 'water', status: 'open' },
          { id: 'c', endpointId: 'gw', status: 'resolved' },
        ],
      },
      approvedAtMs: 42,
    })
    assert.deepEqual(scope.incidentIds, ['a', 'b'])
    assert.ok(scope.targetNodeIds.includes('pay'))
    assert.ok(scope.targetNodeIds.includes('water'))
    assert.deepEqual(scope.actionTypes, ['isolate-node'])
    assert.equal(scope.approvedAtMs, 42)
    assert.ok(scope.scopeFingerprint.includes('incidents='))
  })

  it('isPlanWithinApprovalScope rejects new incident / action / target', () => {
    const scope = {
      incidentIds: ['a'],
      targetNodeIds: ['pay'],
      actionTypes: ['isolate-node'],
    }
    assert.equal(
      isPlanWithinApprovalScope(
        {
          primaryIncidentId: 'b',
          incidentIds: ['b'],
          affectedNodeIds: ['water'],
          recommendedActions: [
            { actionId: 'isolate-node', executable: true, target: { id: 'water' } },
          ],
        },
        scope
      ).ok,
      false
    )
    assert.equal(
      isPlanWithinApprovalScope(
        {
          primaryIncidentId: 'a',
          incidentIds: ['a'],
          affectedNodeIds: ['pay'],
          recommendedActions: [
            {
              actionId: 'restore-connectivity',
              executable: true,
              target: { id: 'pay' },
            },
          ],
        },
        scope
      ).ok,
      false
    )
    assert.equal(
      isPlanWithinApprovalScope(
        {
          primaryIncidentId: 'a',
          incidentIds: ['a'],
          affectedNodeIds: ['pay'],
          recommendedActions: [
            { actionId: 'isolate-node', executable: true, target: { id: 'pay' } },
          ],
        },
        scope
      ).ok,
      true
    )
  })

  it('remainingResponseCandidates excludes quarantined endpoints', () => {
    const room = {
      nodes: [
        { id: 'pay', data: { runtimeState: { quarantined: true } } },
        { id: 'water', data: { runtimeState: { quarantined: false } } },
      ],
      detection: {
        incidents: [
          { id: 'a', endpointId: 'pay', status: 'open' },
          { id: 'b', endpointId: 'water', status: 'open' },
        ],
      },
    }
    const rem = remainingResponseCandidates(room)
    assert.equal(rem.length, 1)
    assert.equal(rem[0].id, 'b')
    assert.equal(hasRemainingResponseWork(room), true)
    room.nodes[1].data.runtimeState.quarantined = true
    assert.equal(hasRemainingResponseWork(room), false)
  })
})
