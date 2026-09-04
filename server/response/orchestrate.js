/**
 * Server-side response orchestration (STEP 2 + STEP 3 execute gate).
 * Plan generation + human approval + Response Agent execution entry.
 * Mutations go through executeResponseAction via responseAgent only.
 */

import {
  AGENT_SLOT_STATUS,
  ORCHESTRATION_STATUS,
  PLAN_APPROVAL_STATUS,
  agentSlotsForStatus,
  canTransitionOrchestration,
  createEmptyOrchestrationState,
  normalizeOrchestrationStatus,
} from '../../shared/response/orchestration.js'
import {
  buildResponsePlan,
  fingerprintFromPlanAndContext,
  revalidatePlanAgainstContext,
  selectPrimaryIncidentForPlan,
  selectPrimaryIncidentForReplan,
} from '../../shared/response/responsePlan.js'
import { isActiveResponseIncident } from '../../shared/incidentStatus.js'
import {
  orderedExecutableSteps,
  runResponseAgent,
} from './responseAgent.js'
import {
  captureVerificationBaseline,
  runRecoveryAgent,
  VERIFICATION_VERDICT,
} from './recoveryAgent.js'
import {
  buildApprovalScope,
  hasRemainingResponseWork,
} from '../../shared/response/approvalScope.js'
import { runOrchestrationContinuation } from './orchestrationLoop.js'

/** Prevent concurrent Response Agent runs per room. */
const executionInFlight = new Set()

export function isOrchestrationExecutionInFlight(roomId) {
  return executionInFlight.has(String(roomId ?? '').toUpperCase())
}

export function ensureRoomOrchestration(room) {
  if (!room || typeof room !== 'object') return null
  if (!room.responseOrchestration || typeof room.responseOrchestration !== 'object') {
    room.responseOrchestration = createEmptyOrchestrationState({
      updatedAtMs: Date.now(),
    })
  }
  return room.responseOrchestration
}

export function resetRoomOrchestration(room) {
  if (!room || typeof room !== 'object') return null
  if (room.id) executionInFlight.delete(String(room.id).toUpperCase())
  room.responseOrchestration = createEmptyOrchestrationState({
    updatedAtMs: Date.now(),
  })
  return room.responseOrchestration
}

/** Public sync shape — no internal resolve helpers. */
export function publicOrchestrationState(room) {
  const state = ensureRoomOrchestration(room)
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  return {
    status,
    workflowStatus: status,
    plan: state.plan ?? null,
    agents: state.agents ?? agentSlotsForStatus(status),
    lastUpdatedAt: state.lastUpdatedAt ?? state.updatedAtMs ?? null,
    updatedAtMs: state.updatedAtMs ?? state.lastUpdatedAt ?? null,
    approvedAtMs: state.approvedAtMs ?? null,
    fingerprint: state.fingerprint ?? null,
    stale: state.stale === true,
    staleReason: state.staleReason ?? null,
    execution: state.execution ?? null,
    verification: state.verification ?? null,
    verificationBaseline: state.verificationBaseline ?? null,
    previousPlanId: state.previousPlanId ?? null,
    replanCount: Number.isFinite(Number(state.replanCount))
      ? Math.max(0, Math.floor(Number(state.replanCount)))
      : 0,
    lastReplanReason: state.lastReplanReason ?? null,
    planHistory: Array.isArray(state.planHistory) ? state.planHistory : [],
    approvalScope: state.approvalScope ?? null,
    autoIteration: Number.isFinite(Number(state.autoIteration))
      ? Math.max(0, Math.floor(Number(state.autoIteration)))
      : 0,
    continuationReason: state.continuationReason ?? null,
    pausedForApprovalReason: state.pausedForApprovalReason ?? null,
  }
}

const PLAN_HISTORY_LIMIT = 5

function appendPlanHistory(prevHistory, entry) {
  const list = Array.isArray(prevHistory) ? [...prevHistory] : []
  list.push(entry)
  while (list.length > PLAN_HISTORY_LIMIT) list.shift()
  return list
}

function historyEntryFromPlan(plan, {
  outcome = null,
  verificationVerdict = null,
  atMs = Date.now(),
} = {}) {
  return {
    planId: plan?.planId ?? null,
    previousPlanId: plan?.previousPlanId ?? null,
    replanCount: Number(plan?.replanCount) || 0,
    primaryIncidentId: plan?.primaryIncidentId ?? null,
    executableActionIds: (plan?.recommendedActions ?? [])
      .filter((a) => a?.executable)
      .map((a) => a.actionId),
    targets: Array.isArray(plan?.affectedNodeIds) ? [...plan.affectedNodeIds] : [],
    verificationVerdict: verificationVerdict ?? null,
    outcome,
    createdAt: plan?.createdAt ?? atMs,
    recordedAt: atMs,
  }
}

/**
 * Authoritative write. Rejects illegal status transitions unless forceReplace.
 * Same-status writes are always allowed (progress fields / plan updates).
 */
function writeState(room, patch, { forceReplace = false } = {}) {
  const prev = ensureRoomOrchestration(room)
  const from = normalizeOrchestrationStatus(prev.workflowStatus ?? prev.status)
  const workflowStatus = normalizeOrchestrationStatus(
    patch.workflowStatus ?? patch.status ?? prev.workflowStatus
  )
  if (!forceReplace && workflowStatus !== from) {
    if (!canTransitionOrchestration(from, workflowStatus)) {
      const err = new Error(
        `Invalid orchestration transition ${from} → ${workflowStatus}`
      )
      err.code = 'INVALID_ORCHESTRATION_TRANSITION'
      err.from = from
      err.to = workflowStatus
      throw err
    }
  }
  const now = Number.isFinite(Number(patch.updatedAtMs))
    ? Number(patch.updatedAtMs)
    : Date.now()
  room.responseOrchestration = {
    ...prev,
    ...patch,
    workflowStatus,
    status: workflowStatus,
    agents: patch.agents ?? agentSlotsForStatus(workflowStatus),
    updatedAtMs: now,
    lastUpdatedAt: now,
  }
  return room.responseOrchestration
}

function markReplanRequired(room, reason, execution = undefined) {
  const prev = ensureRoomOrchestration(room)
  const plan = prev.plan
    ? {
        ...prev.plan,
        approvalStatus:
          prev.plan.approvalStatus === PLAN_APPROVAL_STATUS.APPROVED
            ? PLAN_APPROVAL_STATUS.APPROVED
            : PLAN_APPROVAL_STATUS.REJECTED,
      }
    : null
  return writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
    plan,
    stale: true,
    staleReason: reason || 'Plan is stale',
    ...(execution !== undefined ? { execution } : {}),
  })
}

/**
 * Intentional new cycle after RECOVERED.
 * Clears plan, approval, execution, verification, and lineage so unrelated
 * cycles are not connected. Never executes.
 */
export function startNewOrchestrationCycle(room, { nowMs = Date.now() } = {}) {
  ensureRoomOrchestration(room)
  const current = normalizeOrchestrationStatus(
    room.responseOrchestration.workflowStatus
  )
  if (current !== ORCHESTRATION_STATUS.RECOVERED) {
    return {
      ok: false,
      statusCode: 409,
      message: `New cycle requires RECOVERED status (status=${current})`,
      orchestration: publicOrchestrationState(room),
    }
  }
  if (!canTransitionOrchestration(current, ORCHESTRATION_STATUS.IDLE)) {
    return {
      ok: false,
      statusCode: 409,
      message: `Invalid orchestration transition ${current} → IDLE`,
      orchestration: publicOrchestrationState(room),
    }
  }
  if (room.id) executionInFlight.delete(String(room.id).toUpperCase())
  room.responseOrchestration = createEmptyOrchestrationState({
    workflowStatus: ORCHESTRATION_STATUS.IDLE,
    updatedAtMs: nowMs,
  })
  return {
    ok: true,
    orchestration: publicOrchestrationState(room),
    executed: false,
  }
}

/**
 * If a pending plan's fingerprint no longer matches live state, mark REPLAN_REQUIRED.
 * Does not touch APPROVED / EXECUTING / VERIFYING plans.
 */
export function refreshOrchestrationFreshness(room, resolveContext) {
  const state = ensureRoomOrchestration(room)
  const status = normalizeOrchestrationStatus(state.workflowStatus)
  if (
    status !== ORCHESTRATION_STATUS.AWAITING_APPROVAL &&
    status !== ORCHESTRATION_STATUS.PLAN_READY
  ) {
    return state
  }
  const plan = state.plan
  if (!plan?.primaryIncidentId) return state

  const context =
    typeof resolveContext === 'function'
      ? resolveContext(room, room.id, plan.primaryIncidentId)
      : null
  if (!context) {
    return markReplanRequired(room, 'Primary incident context unavailable')
  }

  const liveFp = fingerprintFromPlanAndContext(plan, context, room.detection)
  if (state.fingerprint && liveFp !== state.fingerprint) {
    return markReplanRequired(room, 'Incidents or policy changed since plan was created')
  }

  const reval = revalidatePlanAgainstContext(plan, context, room.detection)
  if (!reval.ok) {
    return markReplanRequired(room, reval.reason || 'Policy revalidation failed')
  }

  return state
}

/**
 * IDLE → ANALYZING → PLAN_READY → AWAITING_APPROVAL (when executable actions exist).
 * Never mutates quarantine / attacks / incidents.
 * REPLAN_REQUIRED must use replanOrchestrationPlan (preserves verification lineage).
 */
export function generateOrchestrationPlan(room, {
  focusIncidentId = null,
  resolveContext,
  nowMs = Date.now(),
} = {}) {
  ensureRoomOrchestration(room)
  const current = normalizeOrchestrationStatus(room.responseOrchestration.workflowStatus)

  if (current === ORCHESTRATION_STATUS.REPLAN_REQUIRED) {
    return {
      ok: false,
      statusCode: 409,
      message:
        'Verification failed — use replan to run Commander re-analysis (preserves prior plan context)',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  if (current === ORCHESTRATION_STATUS.RECOVERED) {
    return {
      ok: false,
      statusCode: 409,
      message:
        'Response cycle recovered — start a new cycle before analyzing again',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  if (current === ORCHESTRATION_STATUS.APPROVED) {
    return {
      ok: false,
      statusCode: 409,
      message: 'An approved plan already exists — execute it or reset the match',
    }
  }
  if (
    current === ORCHESTRATION_STATUS.EXECUTING ||
    current === ORCHESTRATION_STATUS.VERIFYING
  ) {
    return {
      ok: false,
      statusCode: 409,
      message: 'Orchestration is past approval — cannot regenerate now',
    }
  }

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
    plan: null,
    fingerprint: null,
    stale: false,
    staleReason: null,
    approvedAtMs: null,
    execution: null,
    verificationBaseline: null,
    verification: null,
    previousPlanId: null,
    replanCount: 0,
    lastReplanReason: null,
    planHistory: [],
    approvalScope: null,
    autoIteration: 0,
    continuationReason: null,
    pausedForApprovalReason: null,
    updatedAtMs: nowMs,
  })

  const detection = room.detection ?? null
  let contextIncidentId = focusIncidentId ? String(focusIncidentId) : null
  if (!contextIncidentId) {
    const primary = selectPrimaryIncidentForPlan(detection, null)
    contextIncidentId = primary?.persistentId || primary?.id || null
  }

  if (!contextIncidentId) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.IDLE,
      plan: null,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 404,
      message: 'No open incident available for planning',
    }
  }

  if (typeof resolveContext !== 'function') {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.IDLE,
      plan: null,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 500,
      message: 'Context resolver unavailable',
    }
  }

  const context = resolveContext(room, room.id, contextIncidentId)
  if (!context) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.IDLE,
      plan: null,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 404,
      message: 'Incident context not found',
    }
  }

  const built = buildResponsePlan({
    detection,
    context,
    focusIncidentId: contextIncidentId,
    nowMs,
  })

  if (!built.ok || !built.plan) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.IDLE,
      plan: null,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 400,
      message: built.message || 'Failed to build response plan',
    }
  }

  const planReady = {
    ...built.plan,
    commanderStatus: AGENT_SLOT_STATUS.READY,
    approvalStatus:
      built.executableCount > 0
        ? PLAN_APPROVAL_STATUS.PENDING
        : PLAN_APPROVAL_STATUS.NONE,
  }

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.PLAN_READY,
    plan: planReady,
    fingerprint: built.fingerprint,
    stale: false,
    staleReason: null,
    approvedAtMs: null,
    execution: null,
    updatedAtMs: nowMs,
  })

  if (built.executableCount > 0 && planReady.policyStatus === 'ALLOWED') {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
      plan: planReady,
      fingerprint: built.fingerprint,
      stale: false,
      updatedAtMs: nowMs,
    })
  }

  return {
    ok: true,
    orchestration: publicOrchestrationState(room),
    executed: false,
    executedActions: [],
  }
}

/**
 * STEP 5: Commander re-planning after failed verification.
 *
 * REPLAN_REQUIRED → ANALYZING → AWAITING_APPROVAL (or remain REPLAN_REQUIRED)
 *
 * Fresh detection / correlation / recovery / quarantine / Commander context.
 * Previous plan + verification are CONTEXT only — never authoritative.
 * Never executes, quarantines, restores, or auto-approves.
 */
export function replanOrchestrationPlan(room, {
  resolveContext,
  nowMs = Date.now(),
  /** Ignored — client cannot inject plan / actions / targets */
  clientActionIds = null,
  clientTargets = null,
  clientPlan = null,
} = {}) {
  ensureRoomOrchestration(room)

  if (clientActionIds != null || clientTargets != null || clientPlan != null) {
    // Explicit no-op: server state is the only authority
  }

  const prev = room.responseOrchestration
  const current = normalizeOrchestrationStatus(prev.workflowStatus)

  if (current !== ORCHESTRATION_STATUS.REPLAN_REQUIRED) {
    return {
      ok: false,
      statusCode: 409,
      message: `Re-plan requires REPLAN_REQUIRED status (status=${current})`,
      orchestration: publicOrchestrationState(room),
      executed: false,
      mutatedQuarantine: false,
      mutatedOverrides: false,
    }
  }

  const previousPlan = prev.plan
  const previousPlanId = previousPlan?.planId ?? prev.previousPlanId ?? null
  const previousVerification = prev.verification
  const previousExecution = prev.execution
  const nextReplanCount =
    (Number.isFinite(Number(prev.replanCount))
      ? Math.max(0, Math.floor(Number(prev.replanCount)))
      : 0) + 1

  const historySeed = previousPlan
    ? appendPlanHistory(
        prev.planHistory,
        historyEntryFromPlan(previousPlan, {
          outcome: 'verification_failed',
          verificationVerdict: previousVerification?.verdict ?? null,
          atMs: nowMs,
        })
      )
    : Array.isArray(prev.planHistory)
      ? [...prev.planHistory]
      : []

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
    plan: previousPlan,
    fingerprint: null,
    stale: false,
    staleReason: null,
    approvedAtMs: null,
    // Preserve verification + prior execution as evidence; new cycle clears active exec after plan
    execution: previousExecution,
    verification: previousVerification,
    verificationBaseline: prev.verificationBaseline,
    previousPlanId,
    replanCount: nextReplanCount,
    lastReplanReason: null,
    planHistory: historySeed,
    updatedAtMs: nowMs,
  })

  const detection = room.detection ?? null
  const openIncidents = (detection?.incidents ?? []).filter(isActiveResponseIncident)

  if (!openIncidents.length) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      plan: previousPlan,
      execution: previousExecution,
      verification: previousVerification,
      verificationBaseline: prev.verificationBaseline,
      previousPlanId,
      replanCount: nextReplanCount,
      lastReplanReason:
        'Incident state stabilized externally — no open incidents for a new response plan',
      planHistory: historySeed,
      stale: true,
      staleReason:
        'No open incidents available for re-planning; previous verification preserved',
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 409,
      message:
        'No open incidents available for re-planning. Previous verification evidence is preserved.',
      orchestration: publicOrchestrationState(room),
      executed: false,
      mutatedQuarantine: false,
      mutatedOverrides: false,
    }
  }

  if (typeof resolveContext !== 'function') {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      plan: previousPlan,
      previousPlanId,
      replanCount: nextReplanCount,
      lastReplanReason: 'Context resolver unavailable',
      planHistory: historySeed,
      stale: true,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 500,
      message: 'Context resolver unavailable',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const adaptivePrimary = selectPrimaryIncidentForReplan(detection, {
    nodes: room.nodes ?? [],
    previousAffectedNodeIds: previousPlan?.affectedNodeIds ?? [],
    previousPrimaryIncidentId: previousPlan?.primaryIncidentId ?? null,
  })
  const contextIncidentId =
    adaptivePrimary?.persistentId || adaptivePrimary?.id || null

  if (!contextIncidentId) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      plan: previousPlan,
      previousPlanId,
      replanCount: nextReplanCount,
      lastReplanReason: 'No suitable primary incident for re-planning',
      planHistory: historySeed,
      stale: true,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 404,
      message: 'No suitable primary incident for re-planning',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const context = resolveContext(room, room.id, contextIncidentId)
  if (!context) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      plan: previousPlan,
      previousPlanId,
      replanCount: nextReplanCount,
      lastReplanReason: 'Fresh Commander context unavailable',
      planHistory: historySeed,
      stale: true,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 404,
      message: 'Fresh Commander context unavailable',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const built = buildResponsePlan({
    detection,
    context,
    focusIncidentId: contextIncidentId,
    nowMs,
    mode: 'replan',
    nodes: room.nodes ?? [],
    previousPlan,
    verification: previousVerification,
    previousPlanId,
    replanCount: nextReplanCount,
  })

  if (!built.ok || !built.plan) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      plan: previousPlan,
      previousPlanId,
      replanCount: nextReplanCount,
      lastReplanReason: built.message || 'Commander re-analysis failed',
      planHistory: historySeed,
      stale: true,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 400,
      message: built.message || 'Commander re-analysis failed',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  if (built.executableCount <= 0 || built.policyStatus !== 'ALLOWED') {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      plan: previousPlan,
      previousPlanId,
      replanCount: nextReplanCount,
      lastReplanReason:
        'No policy-approved response action is currently available',
      planHistory: historySeed,
      stale: true,
      staleReason: 'No policy-approved response action is currently available',
      verification: previousVerification,
      execution: previousExecution,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 409,
      message: 'No policy-approved response action is currently available',
      orchestration: publicOrchestrationState(room),
      executed: false,
      mutatedQuarantine: false,
      mutatedOverrides: false,
    }
  }

  const planReady = {
    ...built.plan,
    commanderStatus: AGENT_SLOT_STATUS.READY,
    approvalStatus: PLAN_APPROVAL_STATUS.PENDING,
  }

  const historyWithNew = appendPlanHistory(
    historySeed,
    historyEntryFromPlan(planReady, {
      outcome: 'awaiting_approval',
      verificationVerdict: null,
      atMs: nowMs,
    })
  )

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
    plan: planReady,
    fingerprint: built.fingerprint,
    stale: false,
    staleReason: null,
    approvedAtMs: null,
    // New plan cycle — clear active execution; keep verification as last evidence
    execution: null,
    verification: previousVerification,
    verificationBaseline: null,
    previousPlanId,
    replanCount: nextReplanCount,
    lastReplanReason:
      previousVerification?.primaryReason ||
      previousVerification?.failReasons?.[0] ||
      previousVerification?.reasons?.[0] ||
      'Additional response required after verification failure',
    planHistory: historyWithNew,
    updatedAtMs: nowMs,
  })

  return {
    ok: true,
    orchestration: publicOrchestrationState(room),
    executed: false,
    executedActions: [],
    mutatedQuarantine: false,
    mutatedOverrides: false,
    autoApproved: false,
  }
}

/**
 * Approve current plan. Revalidates policy + freshness.
 * Establishes approvalScope and, by default, starts the multi-incident agent loop
 * (execute → verify → continue within scope). Never lets the client inject actions.
 */
export function approveOrchestrationPlan(room, {
  resolveContext,
  nowMs = Date.now(),
  /** Ignored — present only to prove client action injection is rejected */
  clientActionIds = null,
  /** When true (default), start automatic continuation after approval */
  autoContinue = true,
  onProgress = null,
  onCompleteSync = null,
} = {}) {
  ensureRoomOrchestration(room)
  refreshOrchestrationFreshness(room, resolveContext)

  const state = room.responseOrchestration
  const status = normalizeOrchestrationStatus(state.workflowStatus)

  if (state.stale === true || status === ORCHESTRATION_STATUS.REPLAN_REQUIRED) {
    return {
      ok: false,
      statusCode: 409,
      message: state.staleReason || 'Plan is stale — replan required',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  if (
    status !== ORCHESTRATION_STATUS.AWAITING_APPROVAL &&
    status !== ORCHESTRATION_STATUS.PLAN_READY
  ) {
    return {
      ok: false,
      statusCode: 409,
      message: `Plan is not approval-ready (status=${status})`,
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const plan = state.plan
  if (!plan || !plan.planId) {
    return {
      ok: false,
      statusCode: 400,
      message: 'No plan to approve',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  if (clientActionIds != null) {
    // no-op — server plan is authoritative
  }

  if (typeof resolveContext !== 'function') {
    return {
      ok: false,
      statusCode: 500,
      message: 'Context resolver unavailable',
      executed: false,
    }
  }

  const context = resolveContext(room, room.id, plan.primaryIncidentId)
  if (!context) {
    markReplanRequired(room, 'Primary incident context unavailable')
    return {
      ok: false,
      statusCode: 409,
      message: 'Primary incident context unavailable — replan required',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const liveFp = fingerprintFromPlanAndContext(plan, context, room.detection)
  if (state.fingerprint && liveFp !== state.fingerprint) {
    markReplanRequired(room, 'Incidents or policy changed since plan was created')
    return {
      ok: false,
      statusCode: 409,
      message: 'Plan is stale — replan required',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const reval = revalidatePlanAgainstContext(plan, context, room.detection)
  if (!reval.ok) {
    markReplanRequired(room, reval.reason || 'Policy revalidation failed')
    return {
      ok: false,
      statusCode: 409,
      message: reval.reason || 'Policy revalidation failed',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const approvedPlan = {
    ...plan,
    approvalStatus: PLAN_APPROVAL_STATUS.APPROVED,
    commanderStatus: AGENT_SLOT_STATUS.READY,
    policyStatus: reval.policyStatus || plan.policyStatus,
    recommendedActions: (plan.recommendedActions || []).map((a) =>
      a?.executable
        ? { ...a, policyStatus: 'ALLOWED', status: 'approved' }
        : a
    ),
  }

  // Expand scope when re-approving after pause (union with prior scope)
  const freshScope = buildApprovalScope({
    plan: approvedPlan,
    detection: room.detection,
    approvedAtMs: nowMs,
  })
  const prior = state.approvalScope
  const approvalScope = prior
    ? {
        ...freshScope,
        incidentIds: [
          ...new Set([...(prior.incidentIds ?? []), ...(freshScope.incidentIds ?? [])]),
        ].sort(),
        targetNodeIds: [
          ...new Set([...(prior.targetNodeIds ?? []), ...(freshScope.targetNodeIds ?? [])]),
        ].sort(),
        actionTypes: [
          ...new Set([...(prior.actionTypes ?? []), ...(freshScope.actionTypes ?? [])]),
        ].sort(),
        scopeFingerprint: [
          `incidents=${[...new Set([...(prior.incidentIds ?? []), ...(freshScope.incidentIds ?? [])])].sort().join(',')}`,
          `targets=${[...new Set([...(prior.targetNodeIds ?? []), ...(freshScope.targetNodeIds ?? [])])].sort().join(',')}`,
          `actions=${[...new Set([...(prior.actionTypes ?? []), ...(freshScope.actionTypes ?? [])])].sort().join(',')}`,
        ].join('|'),
      }
    : freshScope

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.APPROVED,
    plan: approvedPlan,
    fingerprint: state.fingerprint,
    stale: false,
    staleReason: null,
    approvedAtMs: nowMs,
    execution: null,
    approvalScope,
    autoIteration: 0,
    continuationReason: 'human_approved',
    pausedForApprovalReason: null,
    updatedAtMs: nowMs,
  })

  if (autoContinue === false) {
    return {
      ok: true,
      orchestration: publicOrchestrationState(room),
      executed: false,
      executedActions: [],
      autoContinued: false,
    }
  }

  const continued = runOrchestrationContinuation(room, {
    resolveContext,
    onProgress,
    onCompleteSync,
    nowMs,
    mode: 'from_approved',
    writeState,
    publicOrchestrationState,
    executeOrchestrationPlan,
    verifyOrchestrationPlan,
    markEpisodeRecovered,
  })

  return {
    ok: continued.ok !== false || continued.pausedForApproval === true || continued.episodeComplete === true,
    statusCode: continued.statusCode,
    message: continued.message,
    orchestration: publicOrchestrationState(room),
    executed: true,
    autoContinued: true,
    episodeComplete: continued.episodeComplete === true,
    pausedForApproval: continued.pausedForApproval === true,
    maxIterationsReached: continued.maxIterationsReached === true,
    continuationLog: continued.continuationLog ?? [],
    recovered: continued.recovered === true,
    mutatedQuarantine: false,
    autoRestored: false,
  }
}

function markEpisodeRecovered(room, { nowMs = Date.now(), reason = null } = {}) {
  const prev = ensureRoomOrchestration(room)
  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.RECOVERED,
    plan: prev.plan,
    execution: prev.execution,
    verification: prev.verification,
    verificationBaseline: prev.verificationBaseline,
    approvalScope: prev.approvalScope,
    stale: false,
    staleReason: null,
    continuationReason: reason || 'episode_complete',
    pausedForApprovalReason: null,
    updatedAtMs: nowMs,
  })
}

/**
 * STEP 3: Execute the server-stored APPROVED plan via Response Agent.
 * Client cannot inject/modify plan actions. Never auto-recovers.
 *
 * APPROVED → EXECUTING → VERIFYING | REPLAN_REQUIRED
 */
export function executeOrchestrationPlan(room, {
  resolveContext,
  onProgress = null,
  onCompleteSync = null,
  nowMs = Date.now(),
  /** Ignored — client cannot supply a plan or action list */
  clientPlan = null,
  clientActionIds = null,
} = {}) {
  ensureRoomOrchestration(room)
  const roomKey = String(room.id ?? '').toUpperCase()

  if (clientPlan != null || clientActionIds != null) {
    // Explicit no-op: server plan is the only authority
  }

  if (executionInFlight.has(roomKey)) {
    return {
      ok: false,
      statusCode: 409,
      message: 'Response Agent already executing for this room',
      orchestration: publicOrchestrationState(room),
    }
  }

  const state = room.responseOrchestration
  const status = normalizeOrchestrationStatus(state.workflowStatus)

  if (status !== ORCHESTRATION_STATUS.APPROVED) {
    return {
      ok: false,
      statusCode: 409,
      message: `Execution requires APPROVED status (status=${status})`,
      orchestration: publicOrchestrationState(room),
    }
  }

  const plan = state.plan
  if (!plan?.planId) {
    return {
      ok: false,
      statusCode: 400,
      message: 'No approved plan to execute',
      orchestration: publicOrchestrationState(room),
    }
  }
  if (plan.approvalStatus !== PLAN_APPROVAL_STATUS.APPROVED) {
    return {
      ok: false,
      statusCode: 409,
      message: 'Plan approval metadata is not approved',
      orchestration: publicOrchestrationState(room),
    }
  }

  const steps = orderedExecutableSteps(plan)
  if (!steps.length) {
    return {
      ok: false,
      statusCode: 400,
      message: 'Approved plan has no executable actions',
      orchestration: publicOrchestrationState(room),
    }
  }

  if (typeof resolveContext !== 'function') {
    return {
      ok: false,
      statusCode: 500,
      message: 'Context resolver unavailable',
      orchestration: publicOrchestrationState(room),
    }
  }

  const preContext = resolveContext(room, room.id, plan.primaryIncidentId)
  if (!preContext) {
    markReplanRequired(room, 'Primary incident context unavailable before execution')
    return {
      ok: false,
      statusCode: 409,
      message: 'Primary incident context unavailable — replan required',
      orchestration: publicOrchestrationState(room),
    }
  }

  // Immediate APPROVED → EXECUTING (blocks double execute)
  // Capture baseline BEFORE Response Agent mutates quarantine.
  const verificationBaseline = captureVerificationBaseline(room, plan)
  executionInFlight.add(roomKey)
  const initialExecution = {
    currentStep: 0,
    totalSteps: steps.length,
    completedSteps: 0,
    activeAction: null,
    results: steps.map((action) => ({
      stepId: action.stepId ?? null,
      actionId: action.actionId,
      actionType: action.actionType ?? null,
      label: action.label ?? null,
      target: action.target ?? null,
      executionOrder: action.executionOrder ?? null,
      status: 'pending',
      startedAtMs: null,
      completedAtMs: null,
      result: null,
      error: null,
    })),
  }

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.EXECUTING,
    plan,
    execution: initialExecution,
    verificationBaseline,
    verification: null,
    stale: false,
    updatedAtMs: nowMs,
  })

  if (typeof onProgress === 'function') {
    onProgress(publicOrchestrationState(room))
  }

  try {
    const frozenPlan = {
      ...plan,
      recommendedActions: (plan.recommendedActions || []).map((a) => ({ ...a })),
      executionOrder: Array.isArray(plan.executionOrder) ? [...plan.executionOrder] : [],
      affectedNodeIds: Array.isArray(plan.affectedNodeIds) ? [...plan.affectedNodeIds] : [],
      incidentIds: Array.isArray(plan.incidentIds) ? [...plan.incidentIds] : [],
    }

    const agentResult = runResponseAgent({
      room,
      plan: frozenPlan,
      resolveContext,
      nowMs,
      onProgress: (execution) => {
        writeState(room, {
          workflowStatus: ORCHESTRATION_STATUS.EXECUTING,
          plan,
          execution,
        })
        if (typeof onProgress === 'function') {
          onProgress(publicOrchestrationState(room))
        }
      },
    })

    if (!agentResult.ok) {
      markReplanRequired(
        room,
        agentResult.reason || 'Response Agent execution failed',
        agentResult.execution
      )
      if (typeof onCompleteSync === 'function') onCompleteSync(room)
      return {
        ok: false,
        statusCode: 409,
        message: agentResult.reason || 'Response Agent execution failed',
        orchestration: publicOrchestrationState(room),
        execution: agentResult.execution,
      }
    }

    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.VERIFYING,
      plan,
      execution: agentResult.execution,
      verificationBaseline,
      verification: null,
      stale: false,
      staleReason: null,
      updatedAtMs: Date.now(),
    })

    if (typeof onCompleteSync === 'function') onCompleteSync(room)

    return {
      ok: true,
      orchestration: publicOrchestrationState(room),
      execution: agentResult.execution,
      recovered: false,
      incidentsClosed: false,
      autoRestored: false,
    }
  } finally {
    executionInFlight.delete(roomKey)
  }
}

/**
 * STEP 4 / 9: Recovery Agent verification.
 * VERIFYING → (step verified) → RECOVERED | ANALYZING continuation | REPLAN_REQUIRED
 *
 * RECOVERED means the episode has no remaining active non-quarantined incidents —
 * not that a single step verified successfully.
 *
 * Does NOT mutate quarantine, overrides, or incident status.
 * Does NOT auto-restore. May recommend restore-connectivity only.
 */
export function verifyOrchestrationPlan(room, {
  nowMs = Date.now(),
  resolveContext = null,
  onProgress = null,
  onCompleteSync = null,
  /** When true (default for HTTP), start continuation after step outcome */
  autoContinue = true,
  /** Internal: continuation runner already owns the loop */
  _internalContinuation = false,
} = {}) {
  ensureRoomOrchestration(room)
  const state = room.responseOrchestration
  const status = normalizeOrchestrationStatus(state.workflowStatus)

  if (status !== ORCHESTRATION_STATUS.VERIFYING) {
    return {
      ok: false,
      statusCode: 409,
      message: `Verification requires VERIFYING status (status=${status})`,
      orchestration: publicOrchestrationState(room),
    }
  }

  const plan = state.plan
  const execution = state.execution
  if (!plan?.planId) {
    return {
      ok: false,
      statusCode: 400,
      message: 'No plan available for verification',
      orchestration: publicOrchestrationState(room),
    }
  }

  const result = runRecoveryAgent({
    room,
    plan,
    execution,
    baseline: state.verificationBaseline,
    nowMs,
  })

  const shouldContinue =
    autoContinue === true &&
    _internalContinuation !== true &&
    typeof resolveContext === 'function'

  if (result.verdict === VERIFICATION_VERDICT.RECOVERED) {
    // Step verified — store verification; episode RECOVERED only if no remaining work
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.VERIFYING,
      plan,
      execution,
      verificationBaseline: state.verificationBaseline,
      verification: result.verification,
      continuationReason: 'step_verified',
      stale: false,
      staleReason: null,
      updatedAtMs: nowMs,
    })

    if (!hasRemainingResponseWork(room)) {
      markEpisodeRecovered(room, {
        nowMs,
        reason: 'No active non-quarantined incidents remain',
      })
      return {
        ok: true,
        verdict: result.verdict,
        stepVerified: true,
        episodeComplete: true,
        orchestration: publicOrchestrationState(room),
        verification: result.verification,
        recovered: true,
        incidentsClosed: false,
        autoRestored: false,
        mutatedQuarantine: false,
      }
    }

    // Remaining incidents — do NOT mark episode RECOVERED
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.VERIFYING,
      plan,
      execution,
      verification: result.verification,
      continuationReason: 'remaining_incidents',
      updatedAtMs: nowMs,
    })

    if (shouldContinue) {
      const continued = runOrchestrationContinuation(room, {
        resolveContext,
        onProgress,
        onCompleteSync,
        nowMs: Date.now(),
        mode: 'after_step_verified',
        writeState,
        publicOrchestrationState,
        executeOrchestrationPlan,
        verifyOrchestrationPlan,
        markEpisodeRecovered,
      })
      return {
        ok: true,
        verdict: result.verdict,
        stepVerified: true,
        episodeComplete: continued.episodeComplete === true,
        autoContinued: true,
        pausedForApproval: continued.pausedForApproval === true,
        continuationLog: continued.continuationLog ?? [],
        orchestration: publicOrchestrationState(room),
        verification: result.verification,
        recovered: continued.recovered === true,
        incidentsClosed: false,
        autoRestored: false,
        mutatedQuarantine: false,
      }
    }

    return {
      ok: true,
      verdict: result.verdict,
      stepVerified: true,
      episodeComplete: false,
      orchestration: publicOrchestrationState(room),
      verification: result.verification,
      recovered: false,
      remainingWork: true,
      incidentsClosed: false,
      autoRestored: false,
      mutatedQuarantine: false,
    }
  }

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
    plan,
    execution,
    verificationBaseline: state.verificationBaseline,
    verification: result.verification,
    stale: true,
    staleReason: result.primaryReason || result.failReasons?.[0] || result.reasons?.[0] || 'Recovery verification failed',
    continuationReason: 'verification_failed',
    updatedAtMs: nowMs,
  })

  if (shouldContinue && state.approvalScope) {
    const continued = runOrchestrationContinuation(room, {
      resolveContext,
      onProgress,
      onCompleteSync,
      nowMs: Date.now(),
      mode: 'after_step_failed',
      writeState,
      publicOrchestrationState,
      executeOrchestrationPlan,
      verifyOrchestrationPlan,
      markEpisodeRecovered,
    })
    return {
      ok: continued.ok !== false || continued.pausedForApproval === true,
      statusCode: continued.statusCode,
      verdict: result.verdict,
      stepVerified: false,
      message:
        result.primaryReason ||
        result.failReasons?.[0] ||
        result.reasons?.[0] ||
        'Recovery verification failed — continuing replan',
      autoContinued: true,
      pausedForApproval: continued.pausedForApproval === true,
      continuationLog: continued.continuationLog ?? [],
      orchestration: publicOrchestrationState(room),
      verification: result.verification,
      recovered: continued.recovered === true,
      incidentsClosed: false,
      autoRestored: false,
      mutatedQuarantine: false,
    }
  }

  return {
    ok: false,
    statusCode: 409,
    verdict: result.verdict,
    stepVerified: false,
    message:
      result.primaryReason ||
      result.failReasons?.[0] ||
      result.reasons?.[0] ||
      'Recovery verification failed — replan required',
    orchestration: publicOrchestrationState(room),
    verification: result.verification,
    recovered: false,
    incidentsClosed: false,
    autoRestored: false,
    mutatedQuarantine: false,
  }
}
