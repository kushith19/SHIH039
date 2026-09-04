import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  actionRegistrySplitView,
  actionRegistryView,
  activeAgentOwnershipView,
  agentLaneView,
  approvalSpotlightView,
  canAnalyzeOrchestration,
  canApproveOrchestration,
  canExecuteOrchestration,
  canReplanOrchestration,
  canStartNewOrchestrationCycle,
  correlatedGroupView,
  createEmptyOrchestrationState,
  executionProgressView,
  focusedIncidentsView,
  graphHealthView,
  graphImpactFromVerification,
  graphImpactView,
  planActionDetailsView,
  planEvolutionView,
  replanHandoffView,
  responsePlanView,
  verificationView,
  whyResolveFirstView,
} from './orchestrationView.js'
import {
  ORCHESTRATION_STATUS,
  PLAN_APPROVAL_STATUS,
} from '../../../shared/response/orchestration.js'

describe('orchestrationView', () => {
  it('1: IDLE state ownership and lanes', () => {
    const state = createEmptyOrchestrationState()
    const view = agentLaneView(state)
    const ownership = activeAgentOwnershipView(state)
    assert.equal(view.workflowStatus, ORCHESTRATION_STATUS.IDLE)
    assert.equal(view.lanes.length, 4)
    assert.equal(view.lanes[0].label, 'Commander Agent')
    assert.equal(view.lanes[1].slotLabel, 'Locked')
    assert.equal(view.lanes[2].slotLabel, 'Waiting')
    assert.equal(view.lanes[3].slotLabel, 'Locked')
    assert.equal(ownership.focusId, 'commander')
  })

  it('2: ANALYZING focuses Commander', () => {
    const ownership = activeAgentOwnershipView({
      workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
    })
    assert.equal(ownership.focusId, 'commander')
    const lanes = agentLaneView({
      workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
      replanCount: 0,
    })
    assert.equal(lanes.lanes[0].slotLabel, 'Analyzing')
    assert.equal(lanes.lanes[0].ownsFocus, true)
  })

  it('3: AWAITING_APPROVAL displays approval spotlight', () => {
    const state = {
      workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
      stale: false,
      replanCount: 0,
      plan: {
        planId: 'p1',
        policyStatus: 'ALLOWED',
        approvalStatus: PLAN_APPROVAL_STATUS.PENDING,
        recommendedActions: [
          {
            actionId: 'isolate-node',
            label: 'Isolate Node',
            executable: true,
            target: { id: 'pay', name: 'PAY' },
          },
        ],
        expectedImpact: {
          mayReduceExposureCount: 3,
          summaryLines: ['May reduce exposure across 3 downstream nodes.'],
        },
      },
    }
    const spotlight = approvalSpotlightView(state)
    assert.equal(spotlight.required, true)
    assert.equal(spotlight.buttonLabel, 'Approve Strategy & Continue')
    assert.ok(spotlight.expectedEffect.includes('May reduce'))
    assert.equal(canApproveOrchestration(state), true)
    assert.equal(activeAgentOwnershipView(state).focusId, 'approval')
  })

  it('4: APPROVED transitions visual focus to Response Agent', () => {
    const state = {
      workflowStatus: ORCHESTRATION_STATUS.APPROVED,
      plan: {
        planId: 'p1',
        approvalStatus: PLAN_APPROVAL_STATUS.APPROVED,
        recommendedActions: [{ actionId: 'isolate-node', executable: true }],
      },
    }
    assert.equal(activeAgentOwnershipView(state).focusId, 'response')
    const response = agentLaneView(state).lanes.find((l) => l.id === 'response')
    assert.equal(response.slotLabel, 'Ready')
    assert.equal(response.ownsFocus, true)
    assert.equal(canExecuteOrchestration(state), true)
  })

  it('5: EXECUTING displays real execution progress', () => {
    const view = executionProgressView({
      workflowStatus: ORCHESTRATION_STATUS.EXECUTING,
      execution: {
        currentStep: 1,
        totalSteps: 2,
        completedSteps: 0,
        results: [
          {
            actionId: 'isolate-node',
            label: 'Isolate Node',
            status: 'executing',
            target: { id: 'pay' },
          },
          { actionId: 'restore-connectivity', status: 'pending' },
        ],
      },
    })
    assert.equal(view.empty, false)
    assert.equal(view.currentStep, 1)
    assert.equal(view.totalSteps, 2)
    assert.equal(view.results[0].mark, '●')
    assert.equal(view.results[1].mark, '○')
    assert.equal(view.title, 'Executing')
  })

  it('6: VERIFYING displays real verification checks', () => {
    const view = verificationView({
      workflowStatus: ORCHESTRATION_STATUS.VERIFYING,
      verification: {
        verdict: null,
        reasons: [],
        checks: {
          executionComplete: true,
          containmentHeld: true,
          noNewOutOfScopeAnomalies: false,
          noNewIndependentOpenOnRelief: true,
          residualNotWorsening: null,
        },
      },
    })
    assert.equal(view.empty, false)
    assert.ok(view.checkRows.some((r) => r.key === 'executionComplete' && r.state === 'pass'))
    assert.ok(
      view.checkRows.some((r) => r.key === 'noNewOutOfScopeAnomalies' && r.state === 'fail')
    )
    assert.ok(
      view.checkRows.some((r) => r.key === 'residualNotWorsening' && r.state === 'unavailable')
    )
  })

  it('7: RECOVERED displays before/after from verification only', () => {
    const verification = {
      verdict: 'RECOVERED',
      reasons: ['Containment verified'],
      checks: { executionComplete: true, containmentHeld: true },
      baseline: {
        openIncidentIds: ['a', 'b', 'c'],
        anomalyNodeIds: ['n1', 'n2'],
        quarantineByTarget: { pay: false },
      },
      current: {
        openIncidentIds: ['a'],
        anomalyNodeIds: ['n1'],
        quarantineByTarget: { pay: true },
      },
    }
    const view = verificationView({
      workflowStatus: ORCHESTRATION_STATUS.RECOVERED,
      verification,
    })
    assert.equal(view.title, 'Response verified')
    const impact = graphImpactFromVerification(verification)
    assert.ok(impact.some((m) => m.key === 'openIncidents' && m.before === 3 && m.after === 1))
    assert.ok(impact.some((m) => m.key === 'quarantined' && m.before === 0 && m.after === 1))
    assert.ok(impact.find((m) => m.key === 'quarantined')?.note?.includes('≠ recovered'))
  })

  it('8/9: REPLAN_REQUIRED shows failure reason and Commander handoff', () => {
    const state = {
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      lastReplanReason: 'Exposure remains elevated after containment.',
      verification: {
        verdict: 'REPLAN_REQUIRED',
        reasons: ['Exposure remains elevated after containment.'],
        checks: { containmentHeld: true },
      },
      plan: { planId: 'p1' },
    }
    const handoff = replanHandoffView(state)
    assert.equal(handoff.active, true)
    assert.ok(handoff.failureReason.includes('Exposure remains'))
    assert.ok(handoff.commanderMessage.includes('re-analysis'))
    const ownership = activeAgentOwnershipView(state)
    assert.equal(ownership.focusId, 'commander')
    assert.equal(ownership.handoffFrom, 'recovery')
    const recovery = agentLaneView(state).lanes.find((l) => l.id === 'recovery')
    assert.equal(recovery.slotLabel, 'Replan required')
    assert.equal(recovery.tone, 'crit')
  })

  it('10: new plan displays previousPlanId / plan number', () => {
    const details = planActionDetailsView({
      planId: 'p2',
      previousPlanId: 'p1',
      replanCount: 1,
      recommendedActions: [
        { actionId: 'isolate-node', label: 'Isolate', executable: true, target: { id: 'gw' } },
      ],
    })
    assert.equal(details.planNumber, 2)
    assert.equal(details.previousPlanId, 'p1')
    const spotlight = approvalSpotlightView({
      workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
      stale: false,
      replanCount: 1,
      plan: {
        planId: 'p2',
        previousPlanId: 'p1',
        policyStatus: 'ALLOWED',
        recommendedActions: [{ actionId: 'isolate-node', executable: true }],
      },
    })
    assert.equal(spotlight.isReplan, true)
    assert.equal(spotlight.buttonLabel, 'Approve New Plan & Continue')
    assert.equal(spotlight.planNumber, 2)
  })

  it('11: plan history / journey renders correctly', () => {
    const view = planEvolutionView({
      workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
      replanCount: 1,
      previousPlanId: 'old-plan',
      planHistory: [
        {
          planId: 'old-plan',
          outcome: 'verification_failed',
          executableActionIds: ['isolate-node'],
          targets: ['pay'],
        },
      ],
      plan: {
        planId: 'new-plan',
        previousPlanId: 'old-plan',
        replanCount: 1,
        affectedNodeIds: ['gw'],
        recommendedActions: [{ actionId: 'isolate-node', executable: true }],
      },
    })
    assert.equal(view.empty, false)
    const failed = view.entries.find((e) => e.planId === 'old-plan')
    assert.ok(failed.steps.some((s) => s.failed === true))
    const current = view.entries.find((e) => e.planId === 'new-plan')
    assert.ok(current.steps.some((s) => /Awaiting human approval/i.test(s.label)))
  })

  it('12: recovery explanation uses MAY language', () => {
    const why = whyResolveFirstView(
      {
        endpointId: 'pay',
        endpointLabel: 'PAY',
        criticality: 'critical',
        recoveryPriority: 12,
        recoveryImpact: {
          certainNodeIds: ['pay'],
          reliefCandidateIds: ['a', 'b', 'c'],
          excludedIndependentIds: ['x', 'y'],
          excludedQuarantinedIds: ['z'],
          explanation: {
            headline: 'Resolve PAY first',
            certain: { count: 1 },
            exposureRelief: { count: 3 },
            excludedIndependent: { count: 2 },
            excludedQuarantined: { count: 1 },
          },
        },
      },
      null
    )
    assert.equal(why.empty, false)
    assert.equal(why.usesMayLanguage, true)
    assert.ok(why.bullets.some((b) => /May reduce exposure/i.test(b.text)))
  })

  it('13/14: independent and quarantined are not claimed recovered', () => {
    const why = whyResolveFirstView({
      recoveryImpact: {
        certainNodeIds: ['pay'],
        reliefCandidateIds: [],
        excludedIndependentIds: ['gw'],
        excludedQuarantinedIds: ['core'],
        explanation: { headline: 'test' },
      },
    })
    assert.equal(why.claimsIndependentRecovered, false)
    assert.equal(why.claimsQuarantinedRecovered, false)
    assert.ok(why.bullets.some((b) => /independently compromised/i.test(b.text)))
    assert.ok(why.bullets.some((b) => /quarantined ≠ recovered/i.test(b.text)))
  })

  it('15: correlation labels remain non-causal', () => {
    const view = correlatedGroupView({
      detection: {
        liveCorrelation: {
          groups: [
            {
              groupId: 'g1',
              primaryIncidentId: 'inc-1',
              incidentIds: ['inc-1', 'inc-2'],
              relationshipReasons: [
                { type: 'direct_dependency', label: 'Direct dependency' },
                { type: 'exposure_overlap', label: 'Shared exposure context' },
              ],
            },
          ],
        },
        incidents: [
          { id: 'inc-1', endpointId: 'pay', endpointLabel: 'PAY' },
          { id: 'inc-2', endpointId: 'gw', endpointLabel: 'GW' },
        ],
      },
      primaryIncidentId: 'inc-1',
      nodes: [],
    })
    assert.equal(view.empty, false)
    assert.equal(view.terminology, 'Related incidents')
    assert.ok(view.reasons.every((r) => !/attack chain/i.test(r.label)))
    assert.ok(view.reasons.some((r) => /Direct dependency/i.test(r.label)))
  })

  it('16: missing metrics do not render fabricated values', () => {
    assert.deepEqual(graphImpactFromVerification(null), [])
    assert.deepEqual(
      graphImpactFromVerification({ verdict: 'RECOVERED', baseline: null, current: null }),
      []
    )
    // baseline exposure without current exposure → do not invent after
    const partial = graphImpactFromVerification({
      baseline: {
        openIncidentIds: ['a'],
        anomalyNodeIds: ['n1'],
        peerExposedNodeIds: ['e1', 'e2'],
      },
      current: {
        openIncidentIds: ['a'],
        anomalyNodeIds: ['n1'],
      },
    })
    assert.ok(!partial.some((m) => m.key === 'exposed'))
    assert.ok(partial.some((m) => m.key === 'openIncidents'))

    const live = graphImpactView(createEmptyOrchestrationState(), { detection: null })
    assert.equal(live.mode, 'live')
  })

  it('17: catalog-only actions are not shown as executable', () => {
    const split = actionRegistrySplitView()
    assert.ok(split.executable.every((i) => i.availability === 'available' && i.actionId))
    assert.ok(split.executable.some((i) => i.actionId === 'isolate-node'))
    assert.ok(
      split.catalog.some((i) => String(i.capabilityId || '').includes('rate-limit'))
    )
    assert.ok(!split.executable.some((i) => String(i.capabilityId || '').includes('rate-limit')))
    const groups = actionRegistryView()
    const contain = groups.find((g) => g.category === 'CONTAIN')
    const rate = contain.items.find((i) => i.capabilityId === 'contain.rate-limit-endpoint')
    assert.ok(rate.availabilityLabel.includes('not implemented'))
  })

  it('legacy helpers remain stable', () => {
    assert.equal(responsePlanView(null).empty, true)
    assert.equal(graphHealthView({}).risk, '—')
    assert.ok(
      focusedIncidentsView({
        incidents: [{ id: 'inc-1', endpointId: 'pay', severity: 'high' }],
      }).primary
    )
    assert.equal(canAnalyzeOrchestration({ workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED }, true), false)
    assert.equal(canReplanOrchestration({ workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED }), true)
  })

  it('canStartNewOrchestrationCycle only when RECOVERED', () => {
    assert.equal(
      canStartNewOrchestrationCycle({
        workflowStatus: ORCHESTRATION_STATUS.RECOVERED,
      }),
      true
    )
    assert.equal(
      canStartNewOrchestrationCycle({
        workflowStatus: ORCHESTRATION_STATUS.IDLE,
      }),
      false
    )
    assert.equal(
      canAnalyzeOrchestration(
        { workflowStatus: ORCHESTRATION_STATUS.RECOVERED },
        true
      ),
      false
    )
  })
})
