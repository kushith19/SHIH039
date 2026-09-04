import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACTION_CAPABILITY_CATALOG,
  CAPABILITY_AVAILABILITY,
  ORCHESTRATION_STATUS,
  PLAN_APPROVAL_STATUS,
  agentSlotsForStatus,
  canTransitionOrchestration,
  createEmptyOrchestrationState,
  createEmptyResponsePlan,
  isPlanApprovedForExecution,
  listActionCapabilitiesByCategory,
  listExecutableSimulatorActions,
  normalizePlanAction,
} from './orchestration.js'
import { RESPONSE_ACTIONS } from '../responseActions.js'
import { listRepositoryActions } from './responseActionRepository.js'

describe('response orchestration contract', () => {
  it('starts IDLE with locked approval and recovery', () => {
    const state = createEmptyOrchestrationState()
    assert.equal(state.workflowStatus, ORCHESTRATION_STATUS.IDLE)
    assert.equal(state.plan, null)
    assert.equal(state.agents.commander, 'idle')
    assert.equal(state.agents.approval, 'locked')
    assert.equal(state.agents.response, 'waiting')
    assert.equal(state.agents.recovery, 'locked')
  })

  it('maps AWAITING_APPROVAL to human-first agent slots', () => {
    const slots = agentSlotsForStatus(ORCHESTRATION_STATUS.AWAITING_APPROVAL)
    assert.equal(slots.commander, 'ready')
    assert.equal(slots.approval, 'awaiting')
    assert.equal(slots.response, 'waiting')
    assert.equal(slots.recovery, 'locked')
  })

  it('allows EXECUTING → REPLAN_REQUIRED and EXECUTING → CONTINUING', () => {
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.EXECUTING,
        ORCHESTRATION_STATUS.REPLAN_REQUIRED
      ),
      true
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.EXECUTING,
        ORCHESTRATION_STATUS.CONTINUING
      ),
      true
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.VERIFYING,
        ORCHESTRATION_STATUS.REPLAN_REQUIRED
      ),
      false
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.ANALYZING,
        ORCHESTRATION_STATUS.LLM_ERROR
      ),
      true
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.LLM_ERROR,
        ORCHESTRATION_STATUS.ANALYZING
      ),
      true
    )
  })

  it('models replan and new-cycle paths; rejects recovered→execute', () => {
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.REPLAN_REQUIRED,
        ORCHESTRATION_STATUS.ANALYZING
      ),
      true
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.ANALYZING,
        ORCHESTRATION_STATUS.AWAITING_APPROVAL
      ),
      true
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.AWAITING_APPROVAL,
        ORCHESTRATION_STATUS.ANALYZING
      ),
      true
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.RECOVERED,
        ORCHESTRATION_STATUS.IDLE
      ),
      true
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.RECOVERED,
        ORCHESTRATION_STATUS.EXECUTING
      ),
      false
    )
    assert.equal(
      canTransitionOrchestration(
        ORCHESTRATION_STATUS.RECOVERED,
        ORCHESTRATION_STATUS.ANALYZING
      ),
      false
    )
  })

  it('creates empty ResponsePlan with approval none', () => {
    const plan = createEmptyResponsePlan()
    assert.equal(plan.planId, null)
    assert.equal(plan.approvalStatus, PLAN_APPROVAL_STATUS.NONE)
    assert.deepEqual(plan.recommendedActions, [])
    assert.equal(isPlanApprovedForExecution(plan), false)
  })

  it('marks registry actions executable and catalog actions not', () => {
    const isolate = normalizePlanAction({ actionId: 'isolate-node', executionOrder: 1 })
    assert.equal(isolate.executable, true)
    assert.equal(isolate.availability, CAPABILITY_AVAILABILITY.AVAILABLE)
    assert.equal(isolate.actionType, 'ISOLATE_NODE')

    const rateLimit = normalizePlanAction({
      actionId: null,
      label: 'Rate Limit Endpoint',
    })
    assert.equal(rateLimit.executable, false)
    assert.equal(rateLimit.availability, CAPABILITY_AVAILABILITY.CATALOG)
  })

  it('requires approval before execution handoff', () => {
    const pending = createEmptyResponsePlan({
      approvalStatus: PLAN_APPROVAL_STATUS.PENDING,
      recommendedActions: [{ actionId: 'isolate-node' }],
    })
    assert.equal(isPlanApprovedForExecution(pending), false)

    const approved = createEmptyResponsePlan({
      approvalStatus: PLAN_APPROVAL_STATUS.APPROVED,
    })
    assert.equal(isPlanApprovedForExecution(approved), true)
  })

  it('catalog lists available isolate/restore and catalog-only peers', () => {
    const groups = listActionCapabilitiesByCategory()
    assert.ok(groups.some((g) => g.category === 'CONTAIN'))
    const available = ACTION_CAPABILITY_CATALOG.filter(
      (c) => c.availability === CAPABILITY_AVAILABILITY.AVAILABLE
    )
    assert.deepEqual(
      available.map((c) => c.actionId).sort(),
      ['isolate-node', 'restore-connectivity']
    )
    for (const cap of available) {
      assert.ok(RESPONSE_ACTIONS[cap.actionId])
    }
    const catalogOnly = ACTION_CAPABILITY_CATALOG.filter(
      (c) => c.availability === CAPABILITY_AVAILABILITY.CATALOG
    )
    assert.ok(catalogOnly.length >= 5)
    for (const cap of catalogOnly) {
      assert.equal(cap.actionId, null)
    }
  })

  it('executable simulator list matches registry only', () => {
    const exec = listExecutableSimulatorActions()
    assert.deepEqual(
      exec.map((a) => a.actionId).sort(),
      listRepositoryActions({ supportedOnly: true })
        .map((a) => a.actionId)
        .sort()
    )
    assert.ok(exec.every((a) => a.supported === true))
  })
})
