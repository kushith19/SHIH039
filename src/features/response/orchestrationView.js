/**
 * Pure view helpers for Response Orchestration panel (STEP 1).
 * Reads existing detection / nodes — does not invent scores or execute.
 */

import {
  ACTION_CAPABILITY_CATEGORIES,
  AGENT_SLOT_STATUS,
  ORCHESTRATION_STATUS,
  agentSlotsForStatus,
  createEmptyOrchestrationState,
  createEmptyResponsePlan,
  normalizeOrchestrationStatus,
} from '../../../shared/response/orchestration.js'
import {
  hopDistanceOf,
  primaryAttackPath,
} from '../../../shared/incidentIntel.js'
import { isActiveResponseIncident } from '../../../shared/incidentStatus.js'
import { computeFinancialExposure } from '../../../shared/financialExposure.js'
import { selectPrimaryIncident, isNodeQuarantined, nodeLabel } from '../dashboard/overviewView.js'
import { recoveryPriorityValue } from '../dashboard/incidentStreamView.js'
import {
  notifyResponseAnalyzeFinished,
  notifyResponseAnalyzeStarted,
} from './responseAnalyzeUi.js'

const AGENT_LABELS = Object.freeze({
  commander: 'Planner',
  approval: 'Human Approval',
  response: 'Response Agent',
  recovery: 'Recovered',
})

const SLOT_COPY = Object.freeze({
  [AGENT_SLOT_STATUS.IDLE]: 'Idle',
  [AGENT_SLOT_STATUS.ANALYZING]: 'Analyzing',
  [AGENT_SLOT_STATUS.READY]: 'Ready',
  [AGENT_SLOT_STATUS.AWAITING]: 'Awaiting approval',
  [AGENT_SLOT_STATUS.APPROVED]: 'Approved',
  [AGENT_SLOT_STATUS.WAITING]: 'Waiting',
  [AGENT_SLOT_STATUS.EXECUTING]: 'Executing',
  [AGENT_SLOT_STATUS.VERIFYING]: 'Verifying',
  [AGENT_SLOT_STATUS.LOCKED]: 'Locked',
  [AGENT_SLOT_STATUS.RECOVERED]: 'Recovered',
  [AGENT_SLOT_STATUS.COMPLETE]: 'Complete',
})

const SLOT_TONE = Object.freeze({
  [AGENT_SLOT_STATUS.IDLE]: 'muted',
  [AGENT_SLOT_STATUS.ANALYZING]: 'warn',
  [AGENT_SLOT_STATUS.READY]: 'ok',
  [AGENT_SLOT_STATUS.AWAITING]: 'warn',
  [AGENT_SLOT_STATUS.APPROVED]: 'ok',
  [AGENT_SLOT_STATUS.WAITING]: 'muted',
  [AGENT_SLOT_STATUS.EXECUTING]: 'warn',
  [AGENT_SLOT_STATUS.VERIFYING]: 'warn',
  [AGENT_SLOT_STATUS.LOCKED]: 'muted',
  [AGENT_SLOT_STATUS.RECOVERED]: 'ok',
  [AGENT_SLOT_STATUS.COMPLETE]: 'ok',
})

const CONTINUATION_REASONS = Object.freeze(
  new Set([
    'remaining_incidents',
    'step_verified',
    'awaiting_step_verification',
    'execution_complete',
    'pacing_commander_continuation',
    'auto_approved_within_scope',
    'pacing_before_execute',
    'pacing_before_verify',
    'pacing_after_approval',
    'pacing_before_recovered',
    'human_approved',
  ])
)

/**
 * Genuine failure / adaptive replan — never infer from previousPlanId alone.
 * previousPlanId is lineage and may appear on successful continuations.
 * Continuation signals (planKind / autoIteration / reason) override a stale replanCount.
 */
export function isGenuineReplanState(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  if (status === ORCHESTRATION_STATUS.REPLAN_REQUIRED) return true
  if (state.continuationReason === 'verification_failed_replan') return true
  if (state.continuationReason === 'verification_failed') return true

  const continuingSignals =
    state.plan?.planKind === 'continuation' ||
    state.plan?.continuationContext != null ||
    Number(state.autoIteration) > 0 ||
    CONTINUATION_REASONS.has(String(state.continuationReason || ''))
  if (continuingSignals) return false

  if (state.plan?.planKind === 'replan') return true
  if (Number(state.replanCount) > 0) return true
  if (state.plan?.replanContext != null) return true
  return false
}

/**
 * Approved-scope multi-incident continuation (not a failure replan).
 * Do not treat previousPlanId as replan.
 */
export function isApprovedScopeContinuation(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  if (status === ORCHESTRATION_STATUS.REPLAN_REQUIRED) return false
  if (state.continuationReason === 'verification_failed_replan') return false
  if (state.continuationReason === 'verification_failed') return false
  if (state.plan?.planKind === 'continuation') return true
  if (state.plan?.continuationContext != null) return true
  if (Number(state.autoIteration) > 0) return true
  if (CONTINUATION_REASONS.has(String(state.continuationReason || ''))) return true
  return false
}

/**
 * Progress within the human-approved incident scope (demo labels only).
 */
export function continuationProgressView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  const scopeIds = Array.isArray(state.approvalScope?.incidentIds)
    ? state.approvalScope.incidentIds
    : []
  const total = scopeIds.length > 0 ? scopeIds.length : null
  const history = Array.isArray(state.planHistory) ? state.planHistory : []
  const verified = history.filter(
    (h) =>
      h?.outcome === 'continued' ||
      h?.outcome === 'step_verified' ||
      h?.verificationVerdict === 'VERIFIED' ||
      h?.verificationVerdict === 'RECOVERED'
  ).length
  const autoIteration = Number(state.autoIteration) || 0
  const active =
    isApprovedScopeContinuation(state) ||
    (total != null && (autoIteration > 0 || verified > 0)) ||
    status === ORCHESTRATION_STATUS.RECOVERED

  if (!active && total == null) {
    return { active: false, current: null, total: null, verified: 0, label: null }
  }

  let current = verified + 1
  if (status === ORCHESTRATION_STATUS.RECOVERED) {
    current = total != null ? total : Math.max(verified, 1)
  } else if (total != null) {
    current = Math.min(Math.max(current, 1), total)
  }

  const label =
    total != null
      ? `Incident ${current} of ${total}`
      : autoIteration > 0
        ? `Continuation ${autoIteration}`
        : verified > 0
          ? `Verified ${verified}`
          : null

  return {
    active: active === true && Boolean(label),
    current,
    total,
    verified,
    autoIteration,
    label,
  }
}

/**
 * Prefer the newer of HTTP localOverride vs socket orchestration by updatedAtMs.
 * Never let a stale HTTP snapshot pin a false REPLAN_REQUIRED over live success.
 */
export function selectAuthoritativeOrchestrationState(
  localOverride = null,
  socketState = null
) {
  if (!localOverride && !socketState) return createEmptyOrchestrationState()
  if (!localOverride) return socketState
  if (!socketState) return localOverride
  const localTs = Number(localOverride.updatedAtMs ?? localOverride.lastUpdatedAt) || 0
  const socketTs = Number(socketState.updatedAtMs ?? socketState.lastUpdatedAt) || 0
  if (socketTs > localTs) return socketState
  if (localTs > socketTs) return localOverride
  // Same timestamp — prefer non-failure socket if local looks like a false fail
  const localStatus = normalizeOrchestrationStatus(
    localOverride.workflowStatus ?? localOverride.status
  )
  const socketStatus = normalizeOrchestrationStatus(
    socketState.workflowStatus ?? socketState.status
  )
  if (
    localStatus === ORCHESTRATION_STATUS.REPLAN_REQUIRED &&
    socketStatus !== ORCHESTRATION_STATUS.REPLAN_REQUIRED
  ) {
    return socketState
  }
  return localOverride
}

export function agentLaneView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  const slots = state.agents ?? agentSlotsForStatus(status)
  const ownership = activeAgentOwnershipView(state)
  const order = ['commander', 'approval', 'response', 'recovery']
  const genuineReplan = isGenuineReplanState(state)
  const continuing = isApprovedScopeContinuation(state)

  return {
    workflowStatus: status,
    focusId: ownership.focusId,
    ownership,
    lanes: order.map((id) => {
      const slot = slots[id] || AGENT_SLOT_STATUS.LOCKED
      let slotLabel = SLOT_COPY[slot] || slot
      let statusKey = slot

      if (id === 'commander') {
        if (status === ORCHESTRATION_STATUS.ANALYZING) {
          if (genuineReplan) {
            slotLabel = 'Re-planning'
            statusKey = 're-planning'
          } else if (continuing) {
            slotLabel = 'Continuing'
            statusKey = 'continuing'
          } else {
            slotLabel = 'Analyzing'
            statusKey = 'analyzing'
          }
        } else if (
          status === ORCHESTRATION_STATUS.PLAN_READY ||
          status === ORCHESTRATION_STATUS.AWAITING_APPROVAL
        ) {
          slotLabel = 'Plan ready'
          statusKey = 'plan-ready'
        } else if (
          status === ORCHESTRATION_STATUS.APPROVED ||
          status === ORCHESTRATION_STATUS.EXECUTING ||
          status === ORCHESTRATION_STATUS.CONTINUING ||
          status === ORCHESTRATION_STATUS.VERIFYING ||
          status === ORCHESTRATION_STATUS.RECOVERED
        ) {
          slotLabel = 'Complete'
          statusKey = 'complete'
        } else if (status === ORCHESTRATION_STATUS.REPLAN_REQUIRED) {
          slotLabel = 'Re-analysis available'
          statusKey = 're-planning'
        } else if (status === ORCHESTRATION_STATUS.LLM_ERROR) {
          slotLabel = 'Planner error'
          statusKey = 'llm-error'
        } else {
          statusKey = 'idle'
        }
      }

      if (id === 'approval') {
        if (status === ORCHESTRATION_STATUS.AWAITING_APPROVAL) {
          slotLabel = 'Approval required'
          statusKey = 'approval-required'
        } else if (status === ORCHESTRATION_STATUS.PLAN_READY) {
          slotLabel = 'Waiting'
          statusKey = 'waiting'
        } else if (
          status === ORCHESTRATION_STATUS.APPROVED ||
          status === ORCHESTRATION_STATUS.EXECUTING ||
          status === ORCHESTRATION_STATUS.CONTINUING ||
          status === ORCHESTRATION_STATUS.VERIFYING ||
          status === ORCHESTRATION_STATUS.RECOVERED
        ) {
          slotLabel = 'Approved'
          statusKey = 'approved'
        } else {
          statusKey = 'waiting'
        }
      }

      if (id === 'response') {
        if (status === ORCHESTRATION_STATUS.APPROVED) {
          slotLabel = 'Ready'
          statusKey = 'ready'
        } else if (status === ORCHESTRATION_STATUS.EXECUTING) {
          slotLabel = 'Executing'
          statusKey = 'executing'
        } else if (
          status === ORCHESTRATION_STATUS.CONTINUING ||
          status === ORCHESTRATION_STATUS.VERIFYING ||
          status === ORCHESTRATION_STATUS.RECOVERED
        ) {
          slotLabel = 'Complete'
          statusKey = 'complete'
        } else if (
          status === ORCHESTRATION_STATUS.REPLAN_REQUIRED &&
          Array.isArray(state.execution?.results) &&
          state.execution.results.some((r) => r?.status === 'failed')
        ) {
          slotLabel = 'Failed'
          statusKey = 'failed'
        } else {
          statusKey = 'waiting'
        }
      }

      if (id === 'recovery') {
        // STEP 16: observational evidence only — not an active workflow lane
        if (state.verification) {
          slotLabel = 'Evidence'
          statusKey = 'complete'
        } else {
          statusKey = 'waiting'
        }
      }

      const ownsFocus = ownership.focusId === id
      return {
        id,
        label: AGENT_LABELS[id],
        slot,
        slotLabel,
        statusKey,
        tone:
          ownsFocus
            ? SLOT_TONE[slot] === 'muted'
              ? 'warn'
              : SLOT_TONE[slot] || 'warn'
            : SLOT_TONE[slot] || 'muted',
        active: slot !== AGENT_SLOT_STATUS.LOCKED && slot !== AGENT_SLOT_STATUS.WAITING,
        ownsFocus,
      }
    }),
  }
}

/**
 * Which agent currently owns the workflow (demo focus) — derived from server status only.
 */
export function activeAgentOwnershipView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  const autoIteration = Number(state.autoIteration) || 0
  const continuationReason = state.continuationReason ?? null
  const pausedReason = state.pausedForApprovalReason ?? null
  const continuing = isApprovedScopeContinuation(state)
  const genuineReplan = isGenuineReplanState(state)
  const progress = continuationProgressView(state)
  const progressSuffix = progress.active && progress.label ? ` ${progress.label}.` : ''

  switch (status) {
    case ORCHESTRATION_STATUS.ANALYZING:
      return {
        focusId: 'commander',
        headline: continuing
          ? 'Planner preparing next response'
          : genuineReplan
            ? 'Planner re-planning'
            : 'Planner is analyzing…',
        detail: continuing
          ? `Remaining approved incidents — automatic continuation (iteration ${autoIteration || 1}).${progressSuffix}`
          : genuineReplan
            ? 'Analyzing current graph state after execution failure.'
            : 'Reviewing selected incident and evidence. Nothing will be executed.',
        handoffFrom: continuing || genuineReplan ? 'response' : null,
      }
    case ORCHESTRATION_STATUS.PLAN_READY:
    case ORCHESTRATION_STATUS.AWAITING_APPROVAL:
      return {
        focusId: 'approval',
        headline: pausedReason
          ? 'Human approval required — scope change'
          : 'Human approval required',
        detail: pausedReason
          ? pausedReason
          : 'Human approval authorizes the response strategy. Agents continue within that approved scope; new authorization requirements pause the workflow.',
        handoffFrom: 'commander',
      }
    case ORCHESTRATION_STATUS.APPROVED:
      return {
        focusId: 'response',
        headline:
          continuationReason === 'pacing_after_approval'
            ? 'Human approval complete'
            : continuationReason === 'pacing_before_execute'
              ? 'Response Agent is executing…'
              : continuationReason === 'auto_approved_within_scope'
                ? 'Response Agent continuing (within scope)'
                : 'Response Agent ready',
        detail:
          continuationReason === 'pacing_after_approval'
            ? 'Strategy approved. Response Agent will start next…'
            : continuationReason === 'pacing_before_execute'
              ? 'Response Agent is executing approved actions…'
              : continuationReason === 'auto_approved_within_scope'
                ? 'Plan stays inside approved scope — executing without re-approval.'
                : 'Strategy approved. Response Agent executes within the approved scope.',
        handoffFrom: 'approval',
      }
    case ORCHESTRATION_STATUS.EXECUTING:
      return {
        focusId: 'response',
        headline: 'Response Agent is executing…',
        detail: 'Executing approved response…',
        handoffFrom: 'approval',
      }
    case ORCHESTRATION_STATUS.CONTINUING:
    case ORCHESTRATION_STATUS.VERIFYING:
      return {
        focusId: 'commander',
        headline: 'Commander — continuing to next incident',
        detail:
          'Response completed. Determining remaining approved-scope work for the next Commander plan.',
        handoffFrom: 'response',
      }
    case ORCHESTRATION_STATUS.RECOVERED:
      return {
        focusId: 'complete',
        headline: 'Episode recovered',
        detail:
          'No active non-quarantined response incidents remain. Start a new cycle only for a new episode.',
        handoffFrom: null,
      }
    case ORCHESTRATION_STATUS.REPLAN_REQUIRED:
      return {
        focusId: 'commander',
        headline: 'Replan required',
        detail:
          state.lastReplanReason ||
          state.staleReason ||
          'Response execution failed or approved scope is no longer valid — human decision required.',
        handoffFrom: 'response',
      }
    case ORCHESTRATION_STATUS.LLM_ERROR:
      return {
        focusId: 'commander',
        headline: 'Planner error',
        detail:
          pausedReason ||
          'A valid response plan could not be produced. Retry Planner. Nothing was executed.',
        handoffFrom: null,
      }
    case ORCHESTRATION_STATUS.IDLE:
    default:
      return {
        focusId: 'commander',
        headline: 'Waiting for Response',
        detail: 'Press Response on an incident to review evidence and propose a response plan.',
        handoffFrom: null,
      }
  }
}

export function responsePlanView(plan = null) {
  if (!plan || typeof plan !== 'object' || !plan.planId) {
    return {
      empty: true,
      plan: createEmptyResponsePlan(),
      actions: [],
      expectedImpact: null,
      summary: 'No active response plan yet. Press Response on an incident to generate one.',
    }
  }
  const normalized = createEmptyResponsePlan(plan)
  const actions = [...(normalized.recommendedActions || [])].sort((a, b) => {
    const ao = Number(a.executionOrder)
    const bo = Number(b.executionOrder)
    if (Number.isFinite(ao) && Number.isFinite(bo)) return ao - bo
    return 0
  })
  return {
    empty: false,
    plan: normalized,
    actions,
    expectedImpact: normalized.expectedImpact,
    summary:
      normalized.llmSummary ||
      normalized.reasoning ||
      'Plan present — execution gated on human approval.',
    attackInterpretation: normalized.attackInterpretation,
    review: normalized.llmReview,
    strategy: normalized.strategy,
    riskAssessment: normalized.riskAssessment,
    uncertainty: normalized.llmUncertainty,
    confidence: normalized.llmConfidence,
  }
}

/**
 * Whether the Approve button should be enabled (client hint only — server is authoritative).
 */
export function canApproveOrchestration(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  if (state.stale === true) return false
  if (status === ORCHESTRATION_STATUS.REPLAN_REQUIRED) return false
  if (
    status !== ORCHESTRATION_STATUS.AWAITING_APPROVAL &&
    status !== ORCHESTRATION_STATUS.PLAN_READY
  ) {
    return false
  }
  const plan = state.plan
  if (!plan?.planId) return false
  if (plan.policyStatus && plan.policyStatus !== 'ALLOWED') return false
  const exec = (plan.recommendedActions || []).filter((a) => a?.executable === true)
  return exec.length > 0
}

export function canAnalyzeOrchestration(orchestrationState = null, hasIncidents = false) {
  if (!hasIncidents) return false
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  if (status === ORCHESTRATION_STATUS.APPROVED) return false
  if (status === ORCHESTRATION_STATUS.EXECUTING) return false
  if (status === ORCHESTRATION_STATUS.VERIFYING) return false
  if (status === ORCHESTRATION_STATUS.RECOVERED) return false
  if (status === ORCHESTRATION_STATUS.REPLAN_REQUIRED) return false
  if (status === ORCHESTRATION_STATUS.ANALYZING) return false
  return true
}

/**
 * Commander re-analysis after verification failure (STEP 5).
 * Client hint only — server requires REPLAN_REQUIRED.
 */
export function canReplanOrchestration(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  return status === ORCHESTRATION_STATUS.REPLAN_REQUIRED
}

/** Intentional new cycle after RECOVERED (client hint). */
export function canStartNewOrchestrationCycle(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  return status === ORCHESTRATION_STATUS.RECOVERED
}

export function canExecuteOrchestration(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  if (status !== ORCHESTRATION_STATUS.APPROVED) return false
  if (state.stale === true) return false
  const plan = state.plan
  if (!plan?.planId) return false
  if (plan.approvalStatus !== 'approved') return false
  const exec = (plan.recommendedActions || []).filter((a) => a?.executable === true)
  return exec.length > 0
}

export function canVerifyOrchestration(orchestrationState = null) {
  // STEP 16: verification is observational only — no Verify CTA / gate
  return false
}

/**
 * Compact plan evolution / response journey (uses planHistory only).
 */
export function planEvolutionView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const history = Array.isArray(state.planHistory) ? state.planHistory : []
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  const current = state.plan

  const entries = history.map((h, i) => ({
    index: i + 1,
    planId: h.planId,
    previousPlanId: h.previousPlanId ?? null,
    planKind: h.planKind ?? null,
    replanCount: Number(h.replanCount) || 0,
    outcome: h.outcome || null,
    verificationVerdict: h.verificationVerdict ?? null,
    targets: Array.isArray(h.targets) ? h.targets : [],
    executableActionIds: Array.isArray(h.executableActionIds)
      ? h.executableActionIds
      : [],
    isCurrent: current?.planId != null && String(h.planId) === String(current.planId),
    steps: journeyStepsForOutcome(h.outcome),
  }))

  if (
    current?.planId &&
    !entries.some((e) => String(e.planId) === String(current.planId))
  ) {
    let outcome = 'active'
    if (status === ORCHESTRATION_STATUS.AWAITING_APPROVAL) outcome = 'awaiting_approval'
    else if (status === ORCHESTRATION_STATUS.APPROVED) outcome = 'approved'
    else if (status === ORCHESTRATION_STATUS.EXECUTING) outcome = 'executing'
    else if (status === ORCHESTRATION_STATUS.VERIFYING) outcome = 'verifying'
    else if (status === ORCHESTRATION_STATUS.RECOVERED) outcome = 'recovered'
    else if (status === ORCHESTRATION_STATUS.REPLAN_REQUIRED) {
      outcome = 'verification_failed'
    } else if (status === ORCHESTRATION_STATUS.PLAN_READY) {
      outcome = 'awaiting_approval'
    } else if (
      status === ORCHESTRATION_STATUS.ANALYZING &&
      isApprovedScopeContinuation(state)
    ) {
      outcome = 'continuing'
    }
    entries.push({
      index: entries.length + 1,
      planId: current.planId,
      previousPlanId: current.previousPlanId ?? state.previousPlanId ?? null,
      planKind: current.planKind ?? null,
      replanCount: Number(current.replanCount ?? state.replanCount) || 0,
      outcome,
      verificationVerdict: state.verification?.verdict ?? null,
      targets: Array.isArray(current.affectedNodeIds) ? current.affectedNodeIds : [],
      executableActionIds: (current.recommendedActions || [])
        .filter((a) => a?.executable)
        .map((a) => a.actionId),
      isCurrent: true,
      steps: journeyStepsForOutcome(outcome),
    })
  }

  return {
    empty: entries.length === 0,
    replanCount: Number(state.replanCount) || 0,
    previousPlanId: state.previousPlanId ?? current?.previousPlanId ?? null,
    lastReplanReason: state.lastReplanReason ?? null,
    planNumber: planNumberFromState(state),
    continuation: continuationProgressView(state),
    entries,
  }
}

function journeyStepsForOutcome(outcome) {
  switch (outcome) {
    case 'verification_failed':
      return [
        { label: 'Commander', done: true },
        { label: 'Human approved', done: true },
        { label: 'Executed', done: true },
        { label: 'Verification failed', done: true, failed: true },
      ]
    case 'continued':
    case 'step_verified':
      return [
        { label: 'Commander', done: true },
        { label: 'Human approved', done: true },
        { label: 'Executed', done: true },
        { label: 'Step verified', done: true },
        { label: 'Continuing approved response', done: true },
      ]
    case 'continuing':
      return [
        { label: 'Step verified', done: true },
        { label: 'Continuing approved response', done: false, current: true },
        { label: 'Commander', done: false },
      ]
    case 'awaiting_approval':
      return [
        { label: 'Commander', done: true },
        { label: 'Awaiting human approval', done: false, current: true },
      ]
    case 'approved':
      return [
        { label: 'Commander', done: true },
        { label: 'Human approved', done: true, current: true },
      ]
    case 'executing':
      return [
        { label: 'Commander', done: true },
        { label: 'Human approved', done: true },
        { label: 'Executing', done: false, current: true },
      ]
    case 'verifying':
      return [
        { label: 'Commander', done: true },
        { label: 'Human approved', done: true },
        { label: 'Executed', done: true },
        { label: 'Verifying', done: false, current: true },
      ]
    case 'recovered':
      return [
        { label: 'Commander', done: true },
        { label: 'Human approved', done: true },
        { label: 'Executed', done: true },
        { label: 'Verified', done: true },
      ]
    default:
      return [{ label: 'Commander', done: false, current: true }]
  }
}

function planNumberFromState(state) {
  const count = Number(state?.replanCount) || 0
  return count + 1
}

const VERIFICATION_CHECK_LABELS = Object.freeze({
  executionComplete: 'Response action applied',
  containmentHeld: 'Target remains contained',
  noNewOutOfScopeAnomalies: 'No new out-of-scope anomalies',
  noNewIndependentOpenOnRelief: 'No new independent open incidents on relief candidates',
  residualNotWorsening: 'Residual not worsening on containment targets',
})

export function verificationView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const verification = state.verification
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  if (!verification || typeof verification !== 'object') {
    return {
      empty: true,
      verdict: null,
      reasons: [],
      checks: null,
      checkRows: [],
      recommendedNextActions: [],
      beforeAfter: [],
      title:
        status === ORCHESTRATION_STATUS.VERIFYING
          ? 'Verifying response against baseline'
          : null,
    }
  }

  const checks = verification.checks && typeof verification.checks === 'object'
    ? verification.checks
    : {}
  const checkRows = Object.keys(VERIFICATION_CHECK_LABELS)
    .filter((key) => Object.prototype.hasOwnProperty.call(checks, key))
    .map((key) => {
      const value = checks[key]
      let stateKey = 'pending'
      if (value === true) stateKey = 'pass'
      else if (value === false) stateKey = 'fail'
      else if (value == null) stateKey = 'unavailable'
      return {
        key,
        label: VERIFICATION_CHECK_LABELS[key],
        value,
        state: stateKey,
        mark:
          stateKey === 'pass' ? '✓' : stateKey === 'fail' ? '✕' : stateKey === 'unavailable' ? '○' : '·',
      }
    })

  return {
    empty: false,
    verdict: verification.verdict ?? null,
    reasons: Array.isArray(verification.reasons) ? verification.reasons : [],
    checks,
    checkRows,
    recommendedNextActions: Array.isArray(verification.recommendedNextActions)
      ? verification.recommendedNextActions
      : [],
    autoRestored: verification.autoRestored === true,
    incidentsClosedByAgent: verification.incidentsClosedByAgent === true,
    beforeAfter: graphImpactFromVerification(verification),
    title:
      status === ORCHESTRATION_STATUS.RECOVERED
        ? 'Episode recovered'
        : verification.verified === true ||
            verification.verdict === 'VERIFIED' ||
            verification.verdict === 'RECOVERED'
          ? status === ORCHESTRATION_STATUS.ANALYZING ||
            state.continuationReason === 'remaining_incidents'
            ? 'Response verified — remaining approved incidents'
            : 'Response verified'
          : verification.verified === false ||
              ((verification.verdict === 'FAILED' ||
                verification.verdict === 'REPLAN_REQUIRED') &&
                status === ORCHESTRATION_STATUS.REPLAN_REQUIRED)
            ? 'Verification failed'
            : 'Verification result',
    stepVerified:
      verification.verified === true ||
      verification.verdict === 'VERIFIED' ||
      verification.verdict === 'RECOVERED',
    stepFailed:
      verification.verified === false ||
      (status === ORCHESTRATION_STATUS.REPLAN_REQUIRED &&
        (verification.verdict === 'FAILED' ||
          verification.verdict === 'REPLAN_REQUIRED')),
    episodeRecovered: status === ORCHESTRATION_STATUS.RECOVERED,
    primaryReason: verification.primaryReason ?? null,
    failReasons: Array.isArray(verification.failReasons)
      ? verification.failReasons
      : [],
    passNotes: Array.isArray(verification.passNotes)
      ? verification.passNotes
      : [],
  }
}

/**
 * Before → after metrics only from verification.baseline / verification.current.
 * Never invents missing values.
 */
export function graphImpactFromVerification(verification = null) {
  if (!verification || typeof verification !== 'object') return []
  const before = verification.baseline
  const after = verification.current
  if (!before || !after) return []

  const metrics = []
  if (Array.isArray(before.openIncidentIds) && Array.isArray(after.openIncidentIds)) {
    metrics.push({
      key: 'openIncidents',
      label: 'Open incidents',
      before: before.openIncidentIds.length,
      after: after.openIncidentIds.length,
    })
  }
  if (Array.isArray(before.anomalyNodeIds) && Array.isArray(after.anomalyNodeIds)) {
    metrics.push({
      key: 'anomalies',
      label: 'Anomaly seeds',
      before: before.anomalyNodeIds.length,
      after: after.anomalyNodeIds.length,
    })
  }
  if (
    Array.isArray(before.peerExposedNodeIds) &&
    Array.isArray(after.peerExposedNodeIds)
  ) {
    metrics.push({
      key: 'exposed',
      label: 'Exposed nodes',
      before: before.peerExposedNodeIds.length,
      after: after.peerExposedNodeIds.length,
    })
  } else if (
    Array.isArray(before.peerExposedNodeIds) &&
    !Array.isArray(after.peerExposedNodeIds)
  ) {
    // Baseline-only exposure — do not invent after
  }
  if (
    before.quarantineByTarget &&
    typeof before.quarantineByTarget === 'object' &&
    after.quarantineByTarget &&
    typeof after.quarantineByTarget === 'object'
  ) {
    const countQ = (map) =>
      Object.values(map).filter((v) => v === true).length
    metrics.push({
      key: 'quarantined',
      label: 'Quarantined targets',
      before: countQ(before.quarantineByTarget),
      after: countQ(after.quarantineByTarget),
      note: 'Quarantined ≠ recovered',
    })
  }
  return metrics
}

export function executionProgressView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const execution = state.execution
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  if (!execution || typeof execution !== 'object') {
    return {
      empty: true,
      currentStep: 0,
      totalSteps: 0,
      completedSteps: 0,
      failedSteps: 0,
      results: [],
      activeAction: null,
      title: null,
      complete: false,
    }
  }
  const results = Array.isArray(execution.results) ? execution.results : []
  const completedSteps = results.filter((r) => r?.status === 'completed').length
  const failedSteps = results.filter((r) => r?.status === 'failed').length
  const complete =
    status === ORCHESTRATION_STATUS.VERIFYING ||
    status === ORCHESTRATION_STATUS.RECOVERED ||
    (Number(execution.totalSteps) > 0 &&
      completedSteps + failedSteps >= Number(execution.totalSteps))

  return {
    empty: false,
    currentStep: Number(execution.currentStep) || 0,
    totalSteps: Number(execution.totalSteps) || 0,
    completedSteps:
      Number(execution.completedSteps) || completedSteps,
    failedSteps,
    results: results.map((r) => ({
      ...r,
      mark:
        r?.status === 'completed'
          ? '✓'
          : r?.status === 'failed'
            ? '✕'
            : r?.status === 'executing'
              ? '●'
              : '○',
    })),
    activeAction: execution.activeAction ?? null,
    title: complete
      ? failedSteps > 0
        ? 'Response complete with failures'
        : 'Response complete'
      : status === ORCHESTRATION_STATUS.EXECUTING
        ? 'Executing'
        : 'Execution',
    complete,
  }
}

export async function postOrchestrationAnalyze(roomId, { incidentId = null } = {}) {
  if (!roomId) {
    return { ok: false, message: 'Room required' }
  }
  const res = await fetch(
    `/rooms/${encodeURIComponent(String(roomId))}/orchestration/analyze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(incidentId ? { incidentId } : {}),
    }
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    return {
      ok: false,
      message: json.message ?? `HTTP ${res.status}`,
      orchestration: json.orchestration ?? null,
    }
  }
  return { ok: true, orchestration: json.orchestration, executed: json.executed === true }
}

/**
 * Incident Response button: generate an LLM Response Plan. Does not execute.
 */
export async function requestIncidentResponsePlan(roomId, incidentId, previousPlan = null) {
  notifyResponseAnalyzeStarted(previousPlan)
  const result = await postOrchestrationAnalyze(roomId, { incidentId })
  notifyResponseAnalyzeFinished({
    ok: result.ok,
    message: result.message,
    orchestration: result.orchestration,
  })
  return result
}

export async function postOrchestrationApprove(roomId) {
  if (!roomId) {
    return { ok: false, message: 'Room required' }
  }
  const res = await fetch(
    `/rooms/${encodeURIComponent(String(roomId))}/orchestration/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    return {
      ok: false,
      message: json.message ?? `HTTP ${res.status}`,
      orchestration: json.orchestration ?? null,
    }
  }
  return { ok: true, orchestration: json.orchestration, executed: json.executed === true }
}

export async function postOrchestrationExecute(roomId) {
  if (!roomId) {
    return { ok: false, message: 'Room required' }
  }
  const res = await fetch(
    `/rooms/${encodeURIComponent(String(roomId))}/orchestration/execute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    return {
      ok: false,
      message: json.message ?? `HTTP ${res.status}`,
      orchestration: json.orchestration ?? null,
      execution: json.execution ?? null,
    }
  }
  return {
    ok: true,
    orchestration: json.orchestration,
    execution: json.execution,
    recovered: json.recovered === true,
    incidentsClosed: json.incidentsClosed === true,
    autoRestored: json.autoRestored === true,
  }
}

/** UI-only dummy Response Agent pacing (ms per approved plan action). */
export const DEMO_RESPONSE_AGENT_STEP_MS = 1000

export function recommendedPlanActions(plan = null) {
  if (!Array.isArray(plan?.recommendedActions)) return []
  return plan.recommendedActions.filter((action) => action && action.actionId)
}

/**
 * Sequential dummy execution snapshot for Orchestrate UI.
 * completedCount actions are done; the next (if any) is executing.
 */
export function buildDemoResponseAgentExecution(plan = null, completedCount = 0) {
  const actions = recommendedPlanActions(plan)
  const total = actions.length
  const completed = Math.max(0, Math.min(Number(completedCount) || 0, total))
  const executingIndex = completed < total ? completed : -1
  return {
    currentStep: executingIndex >= 0 ? executingIndex + 1 : total,
    totalSteps: total,
    completedSteps: completed,
    activeAction:
      executingIndex >= 0
        ? {
            actionId: actions[executingIndex].actionId,
            label: actions[executingIndex].label || actions[executingIndex].actionId,
          }
        : null,
    results: actions.map((action, index) => ({
      stepId: action.stepId ?? action.actionId,
      actionId: action.actionId,
      actionType: action.actionType ?? null,
      label: action.label || action.actionId,
      target: action.target ?? null,
      executionOrder: action.executionOrder ?? index + 1,
      status:
        index < completed
          ? 'completed'
          : index === executingIndex
            ? 'executing'
            : 'pending',
      startedAtMs: null,
      completedAtMs: null,
      result: null,
      error: null,
    })),
  }
}

export async function postOrchestrationVerify(roomId) {
  if (!roomId) {
    return { ok: false, message: 'Room required' }
  }
  const res = await fetch(
    `/rooms/${encodeURIComponent(String(roomId))}/orchestration/verify`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    return {
      ok: false,
      message: json.message ?? `HTTP ${res.status}`,
      verdict: json.verdict ?? null,
      orchestration: json.orchestration ?? null,
      verification: json.verification ?? null,
    }
  }
  return {
    ok: true,
    verdict: json.verdict,
    orchestration: json.orchestration,
    verification: json.verification,
    recovered: json.recovered === true,
    incidentsClosed: json.incidentsClosed === true,
    autoRestored: json.autoRestored === true,
  }
}

export async function postOrchestrationReplan(roomId) {
  if (!roomId) {
    return { ok: false, message: 'Room required' }
  }
  const res = await fetch(
    `/rooms/${encodeURIComponent(String(roomId))}/orchestration/replan`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    return {
      ok: false,
      message: json.message ?? `HTTP ${res.status}`,
      orchestration: json.orchestration ?? null,
      executed: json.executed === true,
    }
  }
  return {
    ok: true,
    orchestration: json.orchestration,
    executed: false,
    autoApproved: json.autoApproved === true,
  }
}

export async function postOrchestrationNewCycle(roomId) {
  if (!roomId) {
    return { ok: false, message: 'Room required' }
  }
  const res = await fetch(
    `/rooms/${encodeURIComponent(String(roomId))}/orchestration/new-cycle`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    return {
      ok: false,
      message: json.message ?? `HTTP ${res.status}`,
      orchestration: json.orchestration ?? null,
    }
  }
  return { ok: true, orchestration: json.orchestration, executed: false }
}

/**
 * STEP 17 — Commander "why this response" from plan + policy snapshot.
 */
export function commanderReasoningView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const plan = state.plan
  if (!plan?.planId) {
    return { empty: true }
  }
  const actions = (plan.recommendedActions || []).filter((a) => a?.executable)
  const policy = plan.reasoning || null
  return {
    empty: false,
    primaryIncidentId: plan.primaryIncidentId,
    planKind: plan.planKind || 'fresh',
    playbookHint: null,
    selectedActions: actions.map((a) => ({
      actionId: a.actionId,
      label: a.label || a.actionId,
      target: a.target?.name || a.target?.id || null,
      peer: a.target?.peerId || null,
      reason: a.reason || null,
    })),
    reasoningText: typeof policy === 'string' ? policy : null,
    signals: Array.isArray(plan.replanContext?.verificationReasons)
      ? plan.replanContext.verificationReasons
      : [],
  }
}

/**
 * Deterministic "why resolve first" from recoveryImpact — MAY language preserved.
 */
export function whyResolveFirstView(incident = null, plan = null) {
  const impact = incident?.recoveryImpact ?? null
  const explanation = impact?.explanation ?? null
  const expected = plan?.expectedImpact ?? null
  if (!impact && !expected && !explanation) {
    return {
      empty: true,
      headline: null,
      bullets: [],
      prioritization: null,
    }
  }

  const bullets = []
  const certainIds = Array.isArray(impact?.certainNodeIds) ? impact.certainNodeIds : []
  const certainCount =
    certainIds.length ||
    Number(explanation?.certain?.count) ||
    Number(expected?.certainRecoveryCount) ||
    0
  if (certainCount > 0) {
    const rawLabel = String(incident?.endpointLabel || '').trim()
    const rawId = String(certainIds[0] || incident?.endpointId || '').trim()
    const looksInternal =
      !rawLabel ||
      rawLabel === rawId ||
      /^(ep-|inc-|node-)/i.test(rawLabel) ||
      /[_:]/.test(rawLabel)
    bullets.push({
      key: 'certain',
      mark: '✓',
      text: looksInternal
        ? 'Certain recovery: seed endpoint'
        : `Certain recovery: ${rawLabel}`,
      tone: 'ok',
    })
  }

  const reliefCount =
    (Array.isArray(impact?.reliefCandidateIds) ? impact.reliefCandidateIds.length : 0) ||
    Number(explanation?.exposureRelief?.count) ||
    Number(expected?.mayReduceExposureCount) ||
    0
  if (reliefCount > 0) {
    bullets.push({
      key: 'may',
      mark: '✓',
      text: `May reduce exposure on ${reliefCount} downstream node${reliefCount === 1 ? '' : 's'}`,
      tone: 'ok',
    })
  }

  const independentCount =
    (Array.isArray(impact?.excludedIndependentIds)
      ? impact.excludedIndependentIds.length
      : 0) ||
    Number(explanation?.excludedIndependent?.count) ||
    Number(expected?.independentlyCompromisedCount) ||
    0
  if (independentCount > 0) {
    bullets.push({
      key: 'independent',
      mark: '✓',
      text: `${independentCount} related incident${independentCount === 1 ? '' : 's'} remain independently compromised (not claimed recovered)`,
      tone: 'warn',
    })
  }

  const quarantinedCount =
    (Array.isArray(impact?.excludedQuarantinedIds)
      ? impact.excludedQuarantinedIds.length
      : 0) ||
    Number(explanation?.excludedQuarantined?.count) ||
    Number(expected?.quarantinedCount) ||
    0
  if (quarantinedCount > 0) {
    bullets.push({
      key: 'quarantined',
      mark: '✓',
      text: `${quarantinedCount} already quarantined downstream (quarantined ≠ recovered)`,
      tone: 'muted',
    })
  }

  const criticality = String(incident?.criticality ?? '').toLowerCase()
  if (criticality === 'critical' || criticality === 'high') {
    bullets.push({
      key: 'criticality',
      mark: '✓',
      text: `Criticality-weighted recovery impact: ${criticality.toUpperCase()}`,
      tone: 'ok',
    })
  }

  const priority = recoveryPriorityValue(incident)
  return {
    empty: bullets.length === 0 && !explanation?.headline,
    headline: explanation?.headline || expected?.whyFirst || 'Why resolve this first?',
    bullets,
    prioritization:
      Number.isFinite(priority) && priority > 0
        ? `Recovery priority ${priority}`
        : null,
    usesMayLanguage: bullets.some((b) => /may /i.test(b.text)),
    claimsIndependentRecovered: false,
    claimsQuarantinedRecovered: false,
  }
}

/**
 * Human approval spotlight — strongest CTA when awaiting approval.
 */
export function approvalSpotlightView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  const required =
    status === ORCHESTRATION_STATUS.AWAITING_APPROVAL ||
    (status === ORCHESTRATION_STATUS.PLAN_READY && canApproveOrchestration(state))
  const plan = state.plan
  const actions = (plan?.recommendedActions || []).filter((a) => a?.executable)
  const isReplan = isGenuineReplanState(state)
  const pausedReason = state.pausedForApprovalReason ?? null
  const scopeExpansion =
    Boolean(pausedReason) ||
    state.continuationReason === 'scope_expansion'
  return {
    required: required === true && Boolean(plan?.planId),
    approved:
      status === ORCHESTRATION_STATUS.APPROVED ||
      status === ORCHESTRATION_STATUS.EXECUTING ||
      status === ORCHESTRATION_STATUS.CONTINUING ||
      status === ORCHESTRATION_STATUS.VERIFYING ||
      status === ORCHESTRATION_STATUS.RECOVERED,
    planNumber: planNumberFromState(state),
    isReplan,
    isContinuation: isApprovedScopeContinuation(state),
    policyStatus: plan?.policyStatus ?? null,
    actionSummaries: actions.map((a) => ({
      actionId: a.actionId,
      label: a.label || a.actionId,
      target: a.target?.name || a.target?.id || null,
      rationale: a.reason || a.rationale || null,
      expectedImpact: a.expectedImpact || null,
    })),
    expectedEffect:
      plan?.expectedImpact?.summaryLines?.[0] ||
      (Number(plan?.expectedImpact?.mayReduceExposureCount) > 0
        ? `May reduce exposure on ${plan.expectedImpact.mayReduceExposureCount} downstream nodes`
        : plan?.expectedImpact?.whyFirst || null),
    buttonLabel: isReplan
      ? 'Approve Expanded Response'
      : scopeExpansion
        ? 'Approve Expanded Response'
        : 'Approve Response',
    missionTitle: 'Response Mission',
    autoContinue: state.approvalScope?.autoContinue !== false,
    capabilities: Array.isArray(state.approvalScope?.missionCapabilities)
      ? state.approvalScope.missionCapabilities
      : Array.isArray(state.approvalScope?.actionTypes)
        ? state.approvalScope.actionTypes
        : actions.map((a) => a.actionId),
  }
}

/**
 * Re-plan handoff copy from verification + replan context (no causality claims).
 */
export function replanHandoffView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  // previousPlanId alone is not a replan signal
  if (status !== ORCHESTRATION_STATUS.REPLAN_REQUIRED && !isGenuineReplanState(state)) {
    return { active: false }
  }
  const verify = verificationView(state)
  const ctx = state.plan?.replanContext
  return {
    active: status === ORCHESTRATION_STATUS.REPLAN_REQUIRED,
    failureReason:
      state.lastReplanReason ||
      state.verification?.primaryReason ||
      state.verification?.failReasons?.[0] ||
      verify.reasons?.[0] ||
      state.staleReason ||
      'Exposure remains elevated after containment.',
    previousPlanId: state.previousPlanId || ctx?.previousPlanId || null,
    previousTargets: ctx?.previousTargets || [],
    previousActions: ctx?.previousExecutableActionIds || [],
    verificationReasons:
      ctx?.verificationReasons ||
      state.verification?.failReasons ||
      verify.reasons ||
      [],
    planNumber: planNumberFromState(state),
    commanderMessage:
      status === ORCHESTRATION_STATUS.REPLAN_REQUIRED
        ? 'Plan was insufficient. Run Commander re-analysis on the current graph state.'
        : 'Commander created a new plan from fresh state.',
  }
}

/**
 * Correlated incident group — live correlation removed; always empty.
 */
export function correlatedGroupView() {
  return { empty: true, relatedCount: 0, primary: null, related: [], reasons: [] }
}

/**
 * Compact plan action rows for demo UI.
 */
export function planActionDetailsView(plan = null, execution = null) {
  const planView = responsePlanView(plan)
  if (planView.empty) return { empty: true, actions: [], planNumber: 1 }
  const resultByAction = new Map()
  for (const r of execution?.results || []) {
    if (r?.actionId) resultByAction.set(String(r.actionId), r)
  }
  return {
    empty: false,
    planNumber: (Number(plan?.replanCount) || 0) + 1,
    previousPlanId: plan?.previousPlanId ?? null,
    planKind: plan?.planKind ?? 'fresh',
    isContinuation: plan?.planKind === 'continuation' || plan?.continuationContext != null,
    isReplan: plan?.planKind === 'replan' || (plan?.replanContext != null && plan?.planKind !== 'continuation'),
    lineageLabel:
      plan?.planKind === 'continuation'
        ? 'Prior plan (continuation lineage)'
        : plan?.previousPlanId
          ? 'Previous plan'
          : null,
    actions: planView.actions.map((a) => {
      const result = resultByAction.get(String(a.actionId))
      return {
        actionId: a.actionId,
        label: a.label || a.actionId,
        target: a.target?.name || a.target?.id || null,
        targetPeer: a.target?.peerId || a.target?.peerName || null,
        reason: a.reason || null,
        expectedImpact: a.expectedImpact || null,
        confidence: a.confidence,
        dependencies: Array.isArray(a.dependencies) ? [...a.dependencies] : [],
        risk: a.risk || null,
        reversible: a.reversibility === true,
        reversibleLabel:
          a.reversibility === true ? 'Yes' : a.reversibility === false ? 'No' : '—',
        policyStatus: a.policyStatus || null,
        executable: a.executable === true,
        status: result?.status || a.status || 'ready',
        error: result?.error || null,
      }
    }),
  }
}

/**
 * Graph impact section: prefer verification before/after; else live snapshot only (no fake delta).
 */
export function graphImpactView(orchestrationState = null, { detection = null } = {}) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const verify = verificationView(state)
  if (verify.beforeAfter.length > 0) {
    return {
      empty: false,
      mode: 'before_after',
      title: 'Graph impact',
      metrics: verify.beforeAfter,
      disclaimer: 'Before → after from Recovery Agent baseline vs current verification snapshot.',
    }
  }
  // Live-only — no fabricated before values
  const anomalies = Array.isArray(detection?.anomalyNodeIds)
    ? detection.anomalyNodeIds.length
    : null
  const exposed = Array.isArray(detection?.peerExposedNodeIds)
    ? detection.peerExposedNodeIds.length
    : null
  const open = Array.isArray(detection?.incidents)
    ? detection.incidents.filter((inc) => {
        const s = String(inc?.status ?? 'open').toLowerCase()
        return s !== 'cleared' && s !== 'closed' && s !== 'resolved'
      }).length
    : null
  const metrics = []
  if (open != null) metrics.push({ key: 'open', label: 'Open incidents', value: open })
  if (anomalies != null) metrics.push({ key: 'anomalies', label: 'Anomaly seeds', value: anomalies })
  if (exposed != null) metrics.push({ key: 'exposed', label: 'Exposed nodes', value: exposed })
  return {
    empty: metrics.length === 0,
    mode: 'live',
    title: 'Graph status',
    metrics,
    disclaimer: 'Live detection snapshot — no before/after until verification completes.',
  }
}

/**
 * Graph health snapshot from existing room/detection props — display only.
 */
export function graphHealthView({
  detection = null,
  nodes = [],
  edges = [],
  incidents = null,
} = {}) {
  const list = Array.isArray(incidents)
    ? incidents
    : Array.isArray(detection?.incidents)
      ? detection.incidents
      : []
  const primary = selectPrimaryIncident(list, detection?.anomalyNodeIds ?? [])
  const finance = computeFinancialExposure({ detection, nodes, edges })
  const propCount = Array.isArray(detection?.propagatedNodeIds)
    ? detection.propagatedNodeIds.length
    : 0
  const atRisk = Array.isArray(detection?.atRiskNodeIds) ? detection.atRiskNodeIds.length : 0
  const hop = hopDistanceOf(primaryAttackPath(primary))
  const anomalyScore = Number(primary?.anomalyScore)
  const riskLabel = Number.isFinite(anomalyScore)
    ? `${Math.round(anomalyScore * 100)} / 100 residual`
    : '—'
  const exposureLabel =
    finance?.simulated === true && finance.exposureLabel && finance.exposureLabel !== '₹0'
      ? finance.exposureLabel
      : '₹0 (simulated)'

  const criticalNodes = list
    .filter((inc) => {
      const sev = String(inc?.severity ?? '').toLowerCase()
      return sev === 'critical' || sev === 'high'
    })
    .slice(0, 5)
    .map((inc) => ({
      id: inc.endpointId ?? inc.id,
      label: inc.endpointLabel || nodeLabel(nodes, inc.endpointId) || String(inc.endpointId ?? ''),
      quarantined: isNodeQuarantined(
        (nodes ?? []).find((n) => String(n.id) === String(inc.endpointId))
      ),
      priority: recoveryPriorityValue(inc),
    }))

  return {
    risk: riskLabel,
    riskTone: Number.isFinite(anomalyScore) && anomalyScore >= 0.7 ? 'crit' : 'muted',
    propagation:
      propCount > 0 || hop > 0
        ? `${propCount} propagated · hop ${Number.isFinite(hop) ? hop : 0}`
        : 'None observed',
    propagationTone: propCount > 0 || hop > 0 ? 'warn' : 'muted',
    exposure: exposureLabel,
    exposureTone:
      finance?.simulated === true && finance.exposureLabel && finance.exposureLabel !== '₹0'
        ? 'crit'
        : 'muted',
    atRiskCount: atRisk,
    criticalNodes,
    primaryIncidentId: primary?.persistentId || primary?.id || null,
    liveGroupCount: 0,
  }
}

/** Persistent flowchart step ids (UI only — not a server FSM). */
export const ORCHESTRATION_FLOW_STEP_IDS = Object.freeze([
  'commander',
  'approval',
  'response',
  'complete',
])

const FLOW_STEP_LABELS = Object.freeze({
  commander: 'Planner',
  approval: 'Human Approval',
  response: 'Response Agent',
  complete: 'Recovered',
})

/**
 * Default detail-panel selection from live orchestration state.
 */
export function defaultOrchestrationSelectedStep(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)

  if (status === ORCHESTRATION_STATUS.REPLAN_REQUIRED) return 'commander'
  if (status === ORCHESTRATION_STATUS.CONTINUING || status === ORCHESTRATION_STATUS.VERIFYING) {
    return 'commander'
  }
  if (status === ORCHESTRATION_STATUS.ANALYZING && isApprovedScopeContinuation(state)) {
    return 'commander'
  }
  if (status === ORCHESTRATION_STATUS.RECOVERED) return 'complete'

  const focus = activeAgentOwnershipView(state).focusId
  if (ORCHESTRATION_FLOW_STEP_IDS.includes(focus)) return focus
  return 'commander'
}

/**
 * Four-step workflow rail: Commander → Approval → Response → Recovered.
 * Verification is evidence-only (not a rail lane).
 */
export function orchestrationFlowRailView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  const ownership = activeAgentOwnershipView(state)
  const lanes = agentLaneView(state)
  const laneById = Object.fromEntries(lanes.lanes.map((l) => [l.id, l]))
  const genuineReplan = isGenuineReplanState(state)
  const continuing = isApprovedScopeContinuation(state)
  const suggestedStepId = defaultOrchestrationSelectedStep(state)

  const steps = ORCHESTRATION_FLOW_STEP_IDS.map((id) => {
    const base = { id, label: FLOW_STEP_LABELS[id] }
    let phase = 'locked'
    let statusLabel = 'Locked'
    let tone = 'muted'

    if (id === 'commander') {
      const lane = laneById.commander
      if (status === ORCHESTRATION_STATUS.IDLE) {
        phase = 'active'
        statusLabel = 'Awaiting analysis'
        tone = 'warn'
      } else if (
        status === ORCHESTRATION_STATUS.ANALYZING ||
        status === ORCHESTRATION_STATUS.CONTINUING ||
        status === ORCHESTRATION_STATUS.VERIFYING
      ) {
        phase = 'active'
        if (genuineReplan) {
          statusLabel = 'Re-planning'
        } else if (continuing || status === ORCHESTRATION_STATUS.CONTINUING) {
          statusLabel = 'Continuing'
        } else {
          statusLabel = 'Analyzing'
        }
        tone = 'warn'
      } else if (status === ORCHESTRATION_STATUS.REPLAN_REQUIRED) {
        phase = 'active'
        statusLabel = 'Re-analysis available'
        tone = 'warn'
      } else if (
        status === ORCHESTRATION_STATUS.PLAN_READY ||
        status === ORCHESTRATION_STATUS.AWAITING_APPROVAL ||
        status === ORCHESTRATION_STATUS.APPROVED ||
        status === ORCHESTRATION_STATUS.EXECUTING ||
        status === ORCHESTRATION_STATUS.RECOVERED
      ) {
        phase = 'completed'
        statusLabel = 'Complete'
        tone = 'ok'
      } else if (status === ORCHESTRATION_STATUS.LLM_ERROR) {
        phase = 'failed'
        statusLabel = 'Planner error'
        tone = 'crit'
      } else {
        phase = 'idle'
        statusLabel = lane?.slotLabel || 'Idle'
        tone = 'muted'
      }
    } else if (id === 'approval') {
      if (
        status === ORCHESTRATION_STATUS.IDLE ||
        status === ORCHESTRATION_STATUS.ANALYZING ||
        status === ORCHESTRATION_STATUS.REPLAN_REQUIRED ||
        status === ORCHESTRATION_STATUS.LLM_ERROR
      ) {
        phase = 'locked'
        statusLabel = 'Locked'
        tone = 'muted'
      } else if (
        status === ORCHESTRATION_STATUS.AWAITING_APPROVAL ||
        status === ORCHESTRATION_STATUS.PLAN_READY
      ) {
        phase = 'active'
        statusLabel =
          status === ORCHESTRATION_STATUS.AWAITING_APPROVAL
            ? 'Approval required'
            : 'Waiting'
        tone = 'warn'
      } else if (
        status === ORCHESTRATION_STATUS.APPROVED ||
        status === ORCHESTRATION_STATUS.EXECUTING ||
        status === ORCHESTRATION_STATUS.CONTINUING ||
        status === ORCHESTRATION_STATUS.VERIFYING ||
        status === ORCHESTRATION_STATUS.RECOVERED
      ) {
        phase = 'completed'
        statusLabel = 'Approved'
        tone = 'ok'
      }
    } else if (id === 'response') {
      if (
        status === ORCHESTRATION_STATUS.APPROVED ||
        status === ORCHESTRATION_STATUS.EXECUTING
      ) {
        phase = 'active'
        statusLabel =
          status === ORCHESTRATION_STATUS.EXECUTING ? 'Executing' : 'Ready'
        tone = 'warn'
      } else if (
        status === ORCHESTRATION_STATUS.CONTINUING ||
        status === ORCHESTRATION_STATUS.VERIFYING ||
        status === ORCHESTRATION_STATUS.RECOVERED
      ) {
        phase = 'completed'
        statusLabel = 'Complete'
        tone = 'ok'
      } else if (
        status === ORCHESTRATION_STATUS.REPLAN_REQUIRED &&
        Array.isArray(state.execution?.results) &&
        state.execution.results.some((r) => r?.status === 'failed')
      ) {
        phase = 'failed'
        statusLabel = 'Failed'
        tone = 'crit'
      } else if (
        status === ORCHESTRATION_STATUS.IDLE ||
        status === ORCHESTRATION_STATUS.ANALYZING ||
        status === ORCHESTRATION_STATUS.PLAN_READY ||
        status === ORCHESTRATION_STATUS.AWAITING_APPROVAL ||
        status === ORCHESTRATION_STATUS.REPLAN_REQUIRED
      ) {
        phase = continuing && status === ORCHESTRATION_STATUS.ANALYZING
          ? 'completed'
          : 'waiting'
        statusLabel =
          continuing && status === ORCHESTRATION_STATUS.ANALYZING
            ? 'Complete'
            : 'Waiting'
        tone = 'muted'
      }
    } else if (id === 'complete') {
      if (status === ORCHESTRATION_STATUS.RECOVERED) {
        phase = 'completed'
        statusLabel = 'Recovered'
        tone = 'ok'
      } else {
        phase = 'locked'
        statusLabel = 'Locked'
        tone = 'muted'
      }
    }

    const ownsFocus = suggestedStepId === id || ownership.focusId === id
    return {
      ...base,
      index: ORCHESTRATION_FLOW_STEP_IDS.indexOf(id) + 1,
      phase,
      statusLabel,
      tone,
      ownsFocus: ownsFocus && phase === 'active',
    }
  })

  return {
    steps,
    suggestedStepId,
    ownership,
    continuing,
    genuineReplan,
  }
}

/**
 * Context-aware primary CTA for the detail panel (maps to existing handlers only).
 * During post-approval auto-continuation, prefers live progress over Execute/Verify clicks.
 */
export function primaryOrchestrationActionView(
  orchestrationState = null,
  { hasIncidents = false } = {}
) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)

  if (canReplanOrchestration(state)) {
    return {
      actionId: 'replan',
      label: 'Run Planner Re-analysis',
      enabled: true,
      liveProgress: false,
    }
  }
  if (canStartNewOrchestrationCycle(state)) {
    return {
      actionId: 'new-cycle',
      label: 'Start New Response Cycle',
      enabled: true,
      liveProgress: false,
    }
  }
  if (canApproveOrchestration(state)) {
    return {
      actionId: 'approve',
      label: 'Approve Response Plan',
      enabled: true,
      liveProgress: false,
    }
  }
  if (canAnalyzeOrchestration(state, hasIncidents)) {
    return {
      actionId: 'analyze',
      label: 'Run Planner',
      enabled: true,
      liveProgress: false,
    }
  }
  if (
    status === ORCHESTRATION_STATUS.APPROVED ||
    status === ORCHESTRATION_STATUS.EXECUTING ||
    status === ORCHESTRATION_STATUS.CONTINUING ||
    status === ORCHESTRATION_STATUS.VERIFYING ||
    (status === ORCHESTRATION_STATUS.ANALYZING && Number(state.autoIteration) > 0)
  ) {
    const exec = state.execution
    const stepLabel =
      exec?.activeAction?.label ||
      exec?.activeAction?.actionId ||
      null
    const progress =
      exec && Number(exec.totalSteps) > 0
        ? `Step ${Number(exec.completedSteps) || 0} of ${exec.totalSteps}`
        : null
    return {
      actionId: null,
      label: null,
      enabled: false,
      liveProgress: true,
      liveMessage:
        status === ORCHESTRATION_STATUS.EXECUTING
          ? [
              'RESPONSE AGENT',
              progress,
              'Executing approved response…',
            ]
              .filter(Boolean)
              .join(' · ')
          : status === ORCHESTRATION_STATUS.CONTINUING ||
              status === ORCHESTRATION_STATUS.VERIFYING
            ? 'AUTONOMOUS RESPONSE · Commander continuing within approved scope…'
            : status === ORCHESTRATION_STATUS.ANALYZING
              ? 'AUTONOMOUS RESPONSE · Commander reassessment…'
              : 'AUTONOMOUS RESPONSE ACTIVE',
    }
  }
  return {
    actionId: null,
    label: null,
    enabled: false,
    liveProgress: false,
  }
}

/**
 * Live Response Agent checklist from real execution / plan statuses only.
 */
export function responseTodoChecklistView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  const progress = executionProgressView(state)
  const actionDetails = planActionDetailsView(state.plan, state.execution)
  const items = []

  if (!progress.empty && progress.results.length > 0) {
    for (const step of progress.results) {
      const st = String(step.status || 'pending').toLowerCase()
      items.push({
        key: step.stepId || step.actionId || `exec-${items.length}`,
        label: step.label || step.actionId || 'Action',
        target: step.target?.name || step.target?.id || null,
        status: st,
        mark:
          st === 'completed'
            ? '✓'
            : st === 'failed'
              ? '✕'
              : st === 'executing'
                ? '●'
                : st === 'blocked'
                  ? 'blocked'
                  : '○',
        error: step.error || null,
        kind: 'action',
      })
    }
  } else if (
    !actionDetails.empty &&
    (status === ORCHESTRATION_STATUS.APPROVED ||
      status === ORCHESTRATION_STATUS.AWAITING_APPROVAL ||
      status === ORCHESTRATION_STATUS.PLAN_READY)
  ) {
    for (const action of actionDetails.actions.filter((a) => a.executable)) {
      items.push({
        key: action.actionId,
        label: action.label || action.actionId,
        target: action.target,
        status: 'pending',
        mark: '○',
        error: null,
        kind: 'action',
      })
    }
  }

  // Observational evidence marker — not a workflow gate
  if (
    state.verification &&
    (status === ORCHESTRATION_STATUS.CONTINUING ||
      status === ORCHESTRATION_STATUS.VERIFYING ||
      status === ORCHESTRATION_STATUS.RECOVERED ||
      status === ORCHESTRATION_STATUS.REPLAN_REQUIRED)
  ) {
    const verify = verificationView(state)
    items.push({
      key: 'evidence-verification',
      label: 'Evidence / Verification (observational)',
      target: null,
      status: verify.stepFailed ? 'failed' : 'completed',
      mark: verify.stepFailed ? '✕' : '✓',
      error: null,
      kind: 'evidence',
    })
  }

  if (
    (status === ORCHESTRATION_STATUS.CONTINUING ||
      status === ORCHESTRATION_STATUS.ANALYZING) &&
    Number(state.autoIteration) > 0
  ) {
    items.push({
      key: 'continue-next',
      label: 'Commander — continuing to next incident',
      target: null,
      status: 'executing',
      mark: '●',
      error: null,
      kind: 'continue',
    })
  } else if (
    status === ORCHESTRATION_STATUS.VERIFYING &&
    state.continuationReason === 'remaining_incidents'
  ) {
    items.push({
      key: 'continue-next',
      label: 'Commander — continuing to next incident',
      target: null,
      status: 'pending',
      mark: '○',
      error: null,
      kind: 'continue',
    })
  }

  return {
    empty: items.length === 0,
    currentStep: progress.currentStep,
    totalSteps: progress.totalSteps,
    completedSteps: progress.completedSteps,
    failedSteps: progress.failedSteps,
    activeAction: progress.activeAction,
    title: progress.title,
    complete: progress.complete,
    items,
  }
}

export function focusedIncidentsView({
  detection = null,
  incidents = null,
  focusIncidentId = null,
} = {}) {
  const list = Array.isArray(incidents)
    ? incidents
    : Array.isArray(detection?.incidents)
      ? detection.incidents
      : []
  const focus = focusIncidentId ? String(focusIncidentId) : null
  const affected = focus
    ? list.filter((inc) => {
        const id = String(inc.persistentId || inc.id || '')
        return id === focus || String(inc.id) === focus
      })
    : list.slice(0, 5)

  const primary =
    (focus &&
      list.find(
        (inc) =>
          isActiveResponseIncident(inc) &&
          String(inc.persistentId || inc.id) === focus
      )) ||
    selectPrimaryIncident(list, detection?.anomalyNodeIds ?? [])

  return {
    affected,
    primary,
    focusIncidentId: focus,
  }
}

export { ACTION_CAPABILITY_CATEGORIES, ORCHESTRATION_STATUS, createEmptyOrchestrationState }
export { queueProgressView } from '../../../shared/response/orchestrationQueue.js'
