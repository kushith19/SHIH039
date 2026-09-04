import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  activeAgentOwnershipView,
  agentLaneView,
  approvalSpotlightView,
  buildDemoResponseAgentExecution,
  canAnalyzeOrchestration,
  canApproveOrchestration,
  canExecuteOrchestration,
  canReplanOrchestration,
  canStartNewOrchestrationCycle,
  correlatedGroupView,
  createEmptyOrchestrationState,
  defaultOrchestrationSelectedStep,
  DEMO_RESPONSE_AGENT_STEP_MS,
  executionProgressView,
  focusedIncidentsView,
  graphHealthView,
  graphImpactFromVerification,
  graphImpactView,
  isApprovedScopeContinuation,
  isGenuineReplanState,
  orchestrationFlowRailView,
  planActionDetailsView,
  planEvolutionView,
  primaryOrchestrationActionView,
  recommendedPlanActions,
  replanHandoffView,
  responsePlanView,
  responseTodoChecklistView,
  verificationView,
  whyResolveFirstView,
} from './orchestrationView.js'
import {
  ORCHESTRATION_STATUS,
  PLAN_APPROVAL_STATUS,
} from '../../../shared/response/orchestration.js'

describe('orchestrationView', () => {
  it('preserves rich LLM strategy and action reasoning for Commander display', () => {
    const plan = {
      planId: 'llm-rich',
      llmSummary: 'Distinct evidence-grounded summary.',
      attackInterpretation: 'Assessment: possible credential abuse.',
      strategy: 'Capture identity state before containment.',
      riskAssessment: 'Containment may affect authentication availability.',
      llmUncertainty: 'Credential ownership remains unverified.',
      recommendedActions: [{
        actionId: 'capture-device-state',
        target: { id: 'auth', name: 'Identity Gateway' },
        reason: 'Preserve runtime evidence.',
        expectedImpact: 'Retain evidence for operator investigation.',
        confidence: 0.82,
        dependencies: [],
        executable: true,
        executionOrder: 1,
      }],
    }
    const view = responsePlanView(plan)
    const details = planActionDetailsView(plan)
    assert.equal(view.summary, 'Distinct evidence-grounded summary.')
    assert.match(view.attackInterpretation, /credential abuse/)
    assert.match(view.strategy, /identity state/)
    assert.match(view.riskAssessment, /authentication availability/)
    assert.match(view.uncertainty, /ownership/)
    assert.equal(details.actions[0].expectedImpact, 'Retain evidence for operator investigation.')
    assert.equal(details.actions[0].confidence, 0.82)
    assert.deepEqual(details.actions[0].dependencies, [])
  })

  it('1: IDLE state ownership and lanes', () => {
    const state = createEmptyOrchestrationState()
    const view = agentLaneView(state)
    const ownership = activeAgentOwnershipView(state)
    assert.equal(view.workflowStatus, ORCHESTRATION_STATUS.IDLE)
    assert.equal(view.lanes.length, 4)
    assert.equal(view.lanes[0].label, 'Planner')
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
    assert.equal(spotlight.buttonLabel, 'Approve Response')
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
    assert.equal(view.title, 'Episode recovered')
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
    assert.equal(ownership.handoffFrom, 'response')
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
    assert.equal(spotlight.buttonLabel, 'Approve Expanded Response')
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

  it('15: correlatedGroupView is empty without live correlation', () => {
    const view = correlatedGroupView({
      detection: {
        incidents: [
          { id: 'inc-1', endpointId: 'pay', endpointLabel: 'PAY' },
          { id: 'inc-2', endpointId: 'gw', endpointLabel: 'GW' },
        ],
      },
      primaryIncidentId: 'inc-1',
      nodes: [],
    })
    assert.equal(view.empty, true)
    assert.equal(view.relatedCount, 0)
    assert.deepEqual(view.reasons, [])
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

  it('STEP 13: flow rail derives four persistent steps', () => {
    const idle = orchestrationFlowRailView(createEmptyOrchestrationState())
    assert.equal(idle.steps.length, 4)
    assert.deepEqual(
      idle.steps.map((s) => s.id),
      ['commander', 'approval', 'response', 'complete']
    )
    assert.equal(idle.steps[0].phase, 'active')
    assert.equal(idle.steps[3].phase, 'locked')
    assert.equal(idle.suggestedStepId, 'commander')

    const awaiting = orchestrationFlowRailView({
      workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
      plan: {
        planId: 'p1',
        policyStatus: 'ALLOWED',
        approvalStatus: PLAN_APPROVAL_STATUS.PENDING,
        recommendedActions: [{ actionId: 'isolate-node', executable: true }],
      },
    })
    assert.equal(awaiting.steps[0].phase, 'completed')
    assert.equal(awaiting.steps[1].phase, 'active')
    assert.equal(awaiting.steps[1].statusLabel, 'Approval required')
    assert.equal(awaiting.suggestedStepId, 'approval')

    const executing = orchestrationFlowRailView({
      workflowStatus: ORCHESTRATION_STATUS.EXECUTING,
      execution: { currentStep: 1, totalSteps: 1, results: [] },
    })
    assert.equal(executing.steps[2].phase, 'active')
    assert.equal(executing.steps[2].statusLabel, 'Executing')
    assert.equal(executing.suggestedStepId, 'response')
  })

  it('STEP 13: REPLAN_REQUIRED selects Commander on same rail', () => {
    const state = {
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      lastReplanReason: 'Containment lost',
      verification: { verdict: 'FAILED', reasons: ['Containment lost'] },
    }
    assert.equal(defaultOrchestrationSelectedStep(state), 'commander')
    const rail = orchestrationFlowRailView(state)
    assert.equal(rail.suggestedStepId, 'commander')
    assert.equal(rail.steps[0].phase, 'active')
    assert.equal(rail.steps[2].phase, 'waiting')
    assert.equal(rail.steps[3].phase, 'locked')
    assert.equal(rail.steps.length, 4)
  })

  it('STEP 13: continuation ANALYZING selects Commander', () => {
    assert.equal(
      defaultOrchestrationSelectedStep({
        workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
        autoIteration: 2,
        continuationReason: 'remaining_incidents',
      }),
      'commander'
    )
  })

  it('STEP 13: RECOVERED selects Complete and new-cycle CTA', () => {
    const state = { workflowStatus: ORCHESTRATION_STATUS.RECOVERED }
    assert.equal(defaultOrchestrationSelectedStep(state), 'complete')
    const rail = orchestrationFlowRailView(state)
    assert.equal(rail.steps[3].phase, 'completed')
    assert.equal(rail.steps[3].statusLabel, 'Recovered')
    const cta = primaryOrchestrationActionView(state)
    assert.equal(cta.actionId, 'new-cycle')
    assert.equal(cta.enabled, true)
  })

  it('STEP 13: approval CTA maps to approve handler gate', () => {
    const state = {
      workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
      stale: false,
      plan: {
        planId: 'p1',
        policyStatus: 'ALLOWED',
        recommendedActions: [{ actionId: 'isolate-node', executable: true }],
      },
    }
    const cta = primaryOrchestrationActionView(state, { hasIncidents: true })
    assert.equal(cta.actionId, 'approve')
    assert.equal(cta.label, 'Approve Response Plan')
    assert.equal(canApproveOrchestration(state), true)
  })

  it('STEP 13: live execution checklist uses real statuses only', () => {
    const view = responseTodoChecklistView({
      workflowStatus: ORCHESTRATION_STATUS.EXECUTING,
      execution: {
        currentStep: 2,
        totalSteps: 3,
        completedSteps: 1,
        results: [
          {
            actionId: 'isolate-node',
            label: 'Isolate Node',
            status: 'completed',
            target: { id: 'a', name: 'NODE-A' },
          },
          {
            actionId: 'isolate-node-2',
            label: 'Isolate Node',
            status: 'executing',
            target: { id: 'b', name: 'NODE-B' },
          },
          {
            actionId: 'isolate-node-3',
            label: 'Isolate Node',
            status: 'pending',
            target: { id: 'c', name: 'NODE-C' },
          },
        ],
      },
    })
    assert.equal(view.empty, false)
    assert.equal(view.items[0].mark, '✓')
    assert.equal(view.items[0].status, 'completed')
    assert.equal(view.items[1].mark, '●')
    assert.equal(view.items[2].mark, '○')
    assert.equal(view.items.every((i) => i.kind === 'action'), true)
  })

  it('STEP 13: failed and blocked execution states', () => {
    const view = responseTodoChecklistView({
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      execution: {
        currentStep: 1,
        totalSteps: 2,
        results: [
          { actionId: 'isolate-node', label: 'Isolate', status: 'failed', error: 'policy' },
          { actionId: 'restore-connectivity', label: 'Restore', status: 'blocked' },
        ],
      },
      verification: {
        verdict: 'FAILED',
        reasons: ['Not all approved actions completed'],
        checks: { executionComplete: false },
      },
    })
    assert.equal(view.items[0].mark, '✕')
    assert.equal(view.items[1].mark, 'blocked')
    assert.equal(view.items[1].status, 'blocked')
    assert.equal(view.items.some((i) => i.kind === 'verify'), false)
  })

  it('STEP 13: verification display distinguishes step vs episode', () => {
    const step = verificationView({
      workflowStatus: ORCHESTRATION_STATUS.CONTINUING,
      verification: {
        verdict: 'VERIFIED',
        reasons: ['ok'],
        checks: { executionComplete: true, containmentHeld: true },
      },
    })
    assert.equal(step.stepVerified, true)
    assert.equal(step.episodeRecovered, false)
    assert.equal(step.title, 'Response verified')

    const episode = verificationView({
      workflowStatus: ORCHESTRATION_STATUS.RECOVERED,
      verification: {
        verdict: 'VERIFIED',
        reasons: ['ok'],
        checks: { executionComplete: true },
      },
    })
    assert.equal(episode.episodeRecovered, true)
    assert.equal(episode.title, 'Episode recovered')
  })

  it('STEP 13: post-approval live progress CTA (no execute/verify click loop)', () => {
    const cta = primaryOrchestrationActionView({
      workflowStatus: ORCHESTRATION_STATUS.EXECUTING,
    })
    assert.equal(cta.actionId, null)
    assert.equal(cta.liveProgress, true)
    assert.ok(/executing/i.test(cta.liveMessage))
  })

  it('STEP 12: previousPlanId alone is not a replan; continuation UI is distinct', () => {
    const cont = {
      workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
      autoIteration: 1,
      replanCount: 0,
      continuationReason: 'remaining_incidents',
      previousPlanId: null,
      approvalScope: { incidentIds: ['a', 'b', 'c'] },
      plan: {
        planId: 'p2',
        previousPlanId: null,
        planKind: 'continuation',
        continuationContext: { previousPlanId: null, continuationCount: 1 },
        replanCount: 0,
      },
      verification: { verdict: 'VERIFIED', failReasons: [], reasons: [] },
    }
    assert.equal(isGenuineReplanState(cont), false)
    assert.equal(isApprovedScopeContinuation(cont), true)
    const ownership = activeAgentOwnershipView(cont)
    assert.match(ownership.headline, /Planner preparing next response/i)
    assert.doesNotMatch(ownership.headline, /replan|Verification failed/i)
    const rail = orchestrationFlowRailView(cont)
    assert.equal(rail.suggestedStepId, 'commander')
    assert.equal(rail.steps[0].statusLabel, 'Continuing')
    assert.equal(rail.steps[3].statusLabel, 'Locked')
    assert.notEqual(rail.steps[2].phase, 'failed')
    const spotlight = approvalSpotlightView({
      ...cont,
      workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
      plan: {
        ...cont.plan,
        policyStatus: 'ALLOWED',
        recommendedActions: [{ actionId: 'isolate-node', executable: true }],
      },
    })
    assert.equal(spotlight.isReplan, false)

    const fail = {
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      replanCount: 0,
      lastReplanReason: 'Containment lost',
      verification: { verdict: 'FAILED', failReasons: ['Containment lost'] },
    }
    assert.equal(isGenuineReplanState(fail), true)
    assert.equal(defaultOrchestrationSelectedStep(fail), 'commander')
    assert.equal(orchestrationFlowRailView(fail).steps[2].phase, 'waiting')
  })

  it('demo Response Agent pacing follows recommendedActions length', () => {
    assert.equal(DEMO_RESPONSE_AGENT_STEP_MS, 1000)
    const plan = {
      recommendedActions: [
        { actionId: 'isolate-node', label: 'Isolate', target: { id: 'n2' } },
        { actionId: 'capture-device-state', label: 'Capture', target: { id: 'n2' } },
      ],
    }
    assert.equal(recommendedPlanActions(plan).length, 2)
    const start = buildDemoResponseAgentExecution(plan, 0)
    assert.equal(start.totalSteps, 2)
    assert.equal(start.results[0].status, 'executing')
    assert.equal(start.results[1].status, 'pending')
    const mid = buildDemoResponseAgentExecution(plan, 1)
    assert.equal(mid.results[0].status, 'completed')
    assert.equal(mid.results[1].status, 'executing')
    const done = buildDemoResponseAgentExecution(plan, 2)
    assert.equal(done.results.every((r) => r.status === 'completed'), true)
    const checklist = responseTodoChecklistView({
      workflowStatus: ORCHESTRATION_STATUS.EXECUTING,
      execution: mid,
    })
    assert.equal(checklist.items[0].mark, '✓')
    assert.equal(checklist.items[1].mark, '●')
  })
})
