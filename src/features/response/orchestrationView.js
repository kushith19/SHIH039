/**
 * Pure view helpers for Response Orchestration panel (STEP 1).
 * Reads existing detection / nodes / correlation — does not invent scores or execute.
 */

import {
  ACTION_CAPABILITY_CATEGORIES,
  AGENT_SLOT_STATUS,
  ORCHESTRATION_STATUS,
  agentSlotsForStatus,
  createEmptyOrchestrationState,
  createEmptyResponsePlan,
  listActionCapabilitiesByCategory,
  normalizeOrchestrationStatus,
} from '../../../shared/response/orchestration.js'
import {
  hopDistanceOf,
  primaryAttackPath,
} from '../../../shared/incidentIntel.js'
import { computeFinancialExposure } from '../../../shared/financialExposure.js'
import { selectPrimaryIncident, isNodeQuarantined, nodeLabel } from '../dashboard/overviewView.js'
import { recoveryPriorityValue } from '../dashboard/incidentStreamView.js'

const AGENT_LABELS = Object.freeze({
  commander: 'Commander Agent',
  approval: 'Human Approval',
  response: 'Response Agent',
  recovery: 'Recovery Agent',
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

export function agentLaneView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  const slots = state.agents ?? agentSlotsForStatus(status)
  const ownership = activeAgentOwnershipView(state)
  const order = ['commander', 'approval', 'response', 'recovery']
  const isReplanCycle =
    Number(state.replanCount) > 0 || Boolean(state.plan?.previousPlanId)

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
          slotLabel = isReplanCycle ? 'Re-planning' : 'Analyzing'
          statusKey = isReplanCycle ? 're-planning' : 'analyzing'
        } else if (
          status === ORCHESTRATION_STATUS.PLAN_READY ||
          status === ORCHESTRATION_STATUS.AWAITING_APPROVAL
        ) {
          slotLabel = 'Plan ready'
          statusKey = 'plan-ready'
        } else if (
          status === ORCHESTRATION_STATUS.APPROVED ||
          status === ORCHESTRATION_STATUS.EXECUTING ||
          status === ORCHESTRATION_STATUS.VERIFYING ||
          status === ORCHESTRATION_STATUS.RECOVERED
        ) {
          slotLabel = 'Complete'
          statusKey = 'complete'
        } else if (status === ORCHESTRATION_STATUS.REPLAN_REQUIRED) {
          slotLabel = 'Re-analysis available'
          statusKey = 're-planning'
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
        if (status === ORCHESTRATION_STATUS.VERIFYING) {
          slotLabel = 'Verifying'
          statusKey = 'verifying'
        } else if (status === ORCHESTRATION_STATUS.RECOVERED) {
          slotLabel = 'Recovered'
          statusKey = 'recovered'
        } else if (status === ORCHESTRATION_STATUS.REPLAN_REQUIRED) {
          slotLabel = 'Replan required'
          statusKey = 'replan-required'
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
          id === 'recovery' && status === ORCHESTRATION_STATUS.REPLAN_REQUIRED
            ? 'crit'
            : ownsFocus
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
  const replanCount = Number(state.replanCount) || 0
  const autoIteration = Number(state.autoIteration) || 0
  const continuationReason = state.continuationReason ?? null
  const pausedReason = state.pausedForApprovalReason ?? null

  switch (status) {
    case ORCHESTRATION_STATUS.ANALYZING:
      return {
        focusId: 'commander',
        headline:
          continuationReason === 'remaining_incidents' || autoIteration > 0
            ? 'Commander re-evaluating remaining incidents'
            : replanCount > 0
              ? 'Commander re-planning'
              : 'Commander analyzing',
        detail:
          continuationReason === 'remaining_incidents' || autoIteration > 0
            ? `Automatic continuation (iteration ${autoIteration || 1}) within approved scope.`
            : replanCount > 0
              ? 'Analyzing current graph state after verification failure.'
              : 'Building a policy-approved response plan from live recovery priority.',
        handoffFrom: replanCount > 0 || autoIteration > 0 ? 'recovery' : null,
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
          continuationReason === 'auto_approved_within_scope'
            ? 'Response Agent continuing (within scope)'
            : 'Response Agent ready',
        detail:
          continuationReason === 'auto_approved_within_scope'
            ? 'Plan stays inside approved scope — executing without re-approval.'
            : 'Strategy approved. Agents execute and verify automatically within scope.',
        handoffFrom: 'approval',
      }
    case ORCHESTRATION_STATUS.EXECUTING:
      return {
        focusId: 'response',
        headline: 'Response Agent executing',
        detail: 'Running approved actions via executeResponseAction.',
        handoffFrom: 'approval',
      }
    case ORCHESTRATION_STATUS.VERIFYING:
      return {
        focusId: 'recovery',
        headline:
          continuationReason === 'remaining_incidents'
            ? 'Step verified — more incidents remain'
            : 'Recovery Agent verifying',
        detail:
          continuationReason === 'remaining_incidents'
            ? 'This step passed. Episode is not recovered until no active response work remains.'
            : 'Comparing post-response graph to pre-response baseline.',
        handoffFrom: 'response',
      }
    case ORCHESTRATION_STATUS.RECOVERED:
      return {
        focusId: 'recovery',
        headline: 'Episode recovered',
        detail:
          'No active non-quarantined response incidents remain. Start a new cycle only for a new episode.',
        handoffFrom: null,
      }
    case ORCHESTRATION_STATUS.REPLAN_REQUIRED:
      return {
        focusId: 'commander',
        headline: 'Verification failed — Commander handoff',
        detail:
          state.lastReplanReason ||
          state.verification?.reasons?.[0] ||
          state.staleReason ||
          'Additional response required.',
        handoffFrom: 'recovery',
      }
    case ORCHESTRATION_STATUS.IDLE:
    default:
      return {
        focusId: 'commander',
        headline: 'Awaiting Commander analysis',
        detail: 'Run analysis when open incidents are present.',
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
      summary: 'No active response plan. Run Commander analysis to build one.',
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
    summary: normalized.reasoning || 'Plan present — execution gated on human approval.',
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
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  return status === ORCHESTRATION_STATUS.VERIFYING
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
    }
    entries.push({
      index: entries.length + 1,
      planId: current.planId,
      previousPlanId: current.previousPlanId ?? state.previousPlanId ?? null,
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
      verification.verdict === 'RECOVERED'
        ? 'Response verified'
        : verification.verdict === 'REPLAN_REQUIRED'
          ? 'Verification failed'
          : 'Verification result',
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

export function actionRegistryView() {
  return listActionCapabilitiesByCategory().map((group) => ({
    category: group.category,
    categoryLabel: group.category,
    items: group.items.map((item) => ({
      ...item,
      availabilityLabel:
        item.availability === 'available' ? 'Available' : 'Catalog capability · not implemented',
      tone: item.availability === 'available' ? 'ok' : 'muted',
    })),
  }))
}

/**
 * Split registry into executable vs catalog-only (informational).
 */
export function actionRegistrySplitView() {
  const groups = actionRegistryView()
  const executable = []
  const catalog = []
  for (const group of groups) {
    for (const item of group.items) {
      if (item.availability === 'available' && item.actionId) {
        executable.push(item)
      } else {
        catalog.push(item)
      }
    }
  }
  return { executable, catalog }
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
    const label =
      certainIds[0] ||
      incident?.endpointLabel ||
      incident?.endpointId ||
      'seed endpoint'
    bullets.push({
      key: 'certain',
      mark: '✓',
      text: `Certain recovery: ${label}`,
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
  const isReplan =
    Number(state.replanCount) > 0 || Boolean(plan?.previousPlanId)
  return {
    required: required === true && Boolean(plan?.planId),
    approved:
      status === ORCHESTRATION_STATUS.APPROVED ||
      status === ORCHESTRATION_STATUS.EXECUTING ||
      status === ORCHESTRATION_STATUS.VERIFYING ||
      status === ORCHESTRATION_STATUS.RECOVERED,
    planNumber: planNumberFromState(state),
    isReplan,
    policyStatus: plan?.policyStatus ?? null,
    actionSummaries: actions.map((a) => ({
      actionId: a.actionId,
      label: a.label || a.actionId,
      target: a.target?.name || a.target?.id || null,
    })),
    expectedEffect:
      plan?.expectedImpact?.summaryLines?.[0] ||
      (Number(plan?.expectedImpact?.mayReduceExposureCount) > 0
        ? `May reduce exposure on ${plan.expectedImpact.mayReduceExposureCount} downstream nodes`
        : plan?.expectedImpact?.whyFirst || null),
    buttonLabel: isReplan ? 'Approve New Plan & Continue' : 'Approve Strategy & Continue',
  }
}

/**
 * Re-plan handoff copy from verification + replan context (no causality claims).
 */
export function replanHandoffView(orchestrationState = null) {
  const state = orchestrationState ?? createEmptyOrchestrationState()
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  if (status !== ORCHESTRATION_STATUS.REPLAN_REQUIRED && !(Number(state.replanCount) > 0)) {
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
 * Correlated incident group — non-causal labels only.
 */
export function correlatedGroupView({
  detection = null,
  primaryIncidentId = null,
  nodes = [],
  incidents = null,
} = {}) {
  const list = Array.isArray(incidents)
    ? incidents
    : Array.isArray(detection?.incidents)
      ? detection.incidents
      : []
  const groups = Array.isArray(detection?.liveCorrelation?.groups)
    ? detection.liveCorrelation.groups
    : []
  const focus = primaryIncidentId ? String(primaryIncidentId) : null
  if (!focus || !groups.length) {
    return { empty: true, relatedCount: 0, primary: null, related: [], reasons: [] }
  }

  const group =
    groups.find((g) => {
      const members = Array.isArray(g?.incidentIds) ? g.incidentIds.map(String) : []
      return (
        members.includes(focus) ||
        String(g?.primaryIncidentId ?? '') === focus
      )
    }) ?? null

  if (!group) {
    return { empty: true, relatedCount: 0, primary: null, related: [], reasons: [] }
  }

  const findInc = (id) =>
    list.find(
      (inc) =>
        String(inc?.id) === String(id) ||
        String(inc?.persistentId ?? '') === String(id)
    ) ?? null

  const primaryInc =
    findInc(group.primaryIncidentId) || findInc(focus) || null
  const related = (group.incidentIds || [])
    .map(String)
    .filter((id) => {
      const p = primaryInc?.persistentId || primaryInc?.id
      return String(id) !== String(focus) && String(id) !== String(p)
    })
    .map((id) => {
      const inc = findInc(id)
      return {
        id,
        label:
          inc?.endpointLabel ||
          nodeLabel(nodes, inc?.endpointId) ||
          inc?.endpointId ||
          id,
      }
    })

  const reasons = (group.relationshipReasons || [])
    .map((r) => ({
      type: r?.type ?? null,
      label: r?.label || r?.detail || String(r?.type ?? ''),
      detail: r?.detail ?? null,
    }))
    .filter((r) => r.label)
    // Never surface attack-chain wording
    .filter((r) => !/attack chain|confirmed kill/i.test(r.label))

  return {
    empty: false,
    relatedCount: (group.incidentIds || []).length,
    primary: {
      id: primaryInc?.persistentId || primaryInc?.id || group.primaryIncidentId,
      label:
        primaryInc?.endpointLabel ||
        nodeLabel(nodes, primaryInc?.endpointId) ||
        primaryInc?.endpointId ||
        String(group.primaryIncidentId ?? ''),
    },
    related,
    reasons,
    terminology: 'Related incidents',
  }
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
    planNumber:
      (Number(plan?.replanCount) || 0) + 1,
    previousPlanId: plan?.previousPlanId ?? null,
    actions: planView.actions.map((a) => {
      const result = resultByAction.get(String(a.actionId))
      return {
        actionId: a.actionId,
        label: a.label || a.actionId,
        target: a.target?.name || a.target?.id || null,
        reason: a.reason || null,
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
    liveGroupCount: Array.isArray(detection?.liveCorrelation?.groups)
      ? detection.liveCorrelation.groups.length
      : 0,
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
  const groups = Array.isArray(detection?.liveCorrelation?.groups)
    ? detection.liveCorrelation.groups
    : []
  const relatedIds = new Set()
  if (focus) {
    for (const g of groups) {
      const members = Array.isArray(g?.incidentIds) ? g.incidentIds.map(String) : []
      if (
        members.includes(focus) ||
        String(g?.primaryIncidentId ?? '') === focus
      ) {
        for (const id of members) relatedIds.add(id)
      }
    }
  }
  const affected = focus
    ? list.filter((inc) => {
        const id = String(inc.persistentId || inc.id || '')
        return id === focus || relatedIds.has(id) || relatedIds.has(String(inc.id))
      })
    : list.slice(0, 5)

  const primary =
    (focus &&
      list.find((inc) => String(inc.persistentId || inc.id) === focus)) ||
    selectPrimaryIncident(list, detection?.anomalyNodeIds ?? [])

  return {
    affected,
    primary,
    focusIncidentId: focus,
  }
}

export { ACTION_CAPABILITY_CATEGORIES, ORCHESTRATION_STATUS, createEmptyOrchestrationState }
