/**
 * Explicit multi-incident orchestration continuation runner (STEP 9).
 *
 * After human approval establishes an approvalScope, this runner drives:
 *   execute → verify → (more work?) → plan → scope check → auto-approve → …
 * until no remaining active (non-quarantined) incidents, scope expansion, or max iterations.
 *
 * Not a recursive HTTP chain — a single server-side loop with explicit transitions.
 */

import {
  AGENT_SLOT_STATUS,
  ORCHESTRATION_STATUS,
  PLAN_APPROVAL_STATUS,
  agentSlotsForStatus,
  canTransitionOrchestration,
  normalizeOrchestrationStatus,
} from '../../shared/response/orchestration.js'
import {
  buildResponsePlan,
  selectPrimaryIncidentForReplan,
} from '../../shared/response/responsePlan.js'
import {
  buildApprovalScope,
  hasRemainingResponseWork,
  isPlanWithinApprovalScope,
  remainingResponseCandidates,
} from '../../shared/response/approvalScope.js'

export const DEFAULT_MAX_AUTO_ITERATIONS = 8

export function getMaxAutoIterations() {
  const n = Number(process.env.ORCHESTRATION_MAX_AUTO_ITERATIONS)
  if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), 20)
  return DEFAULT_MAX_AUTO_ITERATIONS
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
 * Build the next Commander plan for continuation (fresh state; prior plan = context).
 * Does not execute. Caller owns status transitions.
 */
export function buildContinuationPlan(room, {
  resolveContext,
  nowMs = Date.now(),
  previousPlan = null,
  verification = null,
  replanCount = 0,
} = {}) {
  if (typeof resolveContext !== 'function') {
    return { ok: false, message: 'Context resolver unavailable' }
  }
  if (!hasRemainingResponseWork(room)) {
    return { ok: false, message: 'No remaining response candidates', noWork: true }
  }

  const detection = room.detection ?? null
  const adaptive = selectPrimaryIncidentForReplan(detection, {
    nodes: room.nodes ?? [],
    previousAffectedNodeIds: previousPlan?.affectedNodeIds ?? [],
    previousPrimaryIncidentId: previousPlan?.primaryIncidentId ?? null,
  })
  const contextIncidentId = adaptive?.persistentId || adaptive?.id || null
  if (!contextIncidentId) {
    return { ok: false, message: 'No suitable primary for continuation', noWork: true }
  }

  const context = resolveContext(room, room.id, contextIncidentId)
  if (!context) {
    return { ok: false, message: 'Fresh Commander context unavailable' }
  }

  const built = buildResponsePlan({
    detection,
    context,
    focusIncidentId: contextIncidentId,
    nowMs,
    mode: 'replan',
    nodes: room.nodes ?? [],
    previousPlan,
    verification,
    previousPlanId: previousPlan?.planId ?? null,
    replanCount,
  })

  if (!built.ok || !built.plan) {
    return { ok: false, message: built.message || 'Failed to build continuation plan' }
  }
  if (built.executableCount <= 0 || built.policyStatus !== 'ALLOWED') {
    return {
      ok: false,
      message: 'No policy-approved response action is currently available',
      noExecutable: true,
      plan: built.plan,
      fingerprint: built.fingerprint,
    }
  }

  return {
    ok: true,
    plan: {
      ...built.plan,
      commanderStatus: AGENT_SLOT_STATUS.READY,
      approvalStatus: PLAN_APPROVAL_STATUS.PENDING,
    },
    fingerprint: built.fingerprint,
    primaryIncident: built.primaryIncident,
  }
}

/**
 * Run automatic continuation after a verification outcome or from APPROVED.
 *
 * @param {object} deps - injected orchestrate primitives to avoid circular imports
 */
export function runOrchestrationContinuation(room, {
  resolveContext,
  onProgress = null,
  onCompleteSync = null,
  nowMs = Date.now(),
  maxIterations = null,
  /** 'from_approved' | 'after_step_verified' | 'after_step_failed' */
  mode = 'after_step_verified',
  writeState,
  publicOrchestrationState,
  executeOrchestrationPlan,
  verifyOrchestrationPlan,
  markEpisodeRecovered,
} = {}) {
  const max = maxIterations ?? getMaxAutoIterations()
  let autoIteration = Number(room.responseOrchestration?.autoIteration) || 0
  const scope = room.responseOrchestration?.approvalScope ?? null
  const log = []

  const emit = () => {
    if (typeof onProgress === 'function') {
      onProgress(publicOrchestrationState(room))
    }
  }

  // from_approved: execute the human-approved plan first
  if (mode === 'from_approved') {
    const status = normalizeOrchestrationStatus(room.responseOrchestration.workflowStatus)
    if (status !== ORCHESTRATION_STATUS.APPROVED) {
      return {
        ok: false,
        statusCode: 409,
        message: `Continuation from_approved requires APPROVED (status=${status})`,
        orchestration: publicOrchestrationState(room),
      }
    }
    const exec = executeOrchestrationPlan(room, {
      resolveContext,
      onProgress,
      onCompleteSync,
      nowMs,
      _internalContinuation: true,
    })
    if (!exec.ok) {
      // Execution failed → may be REPLAN_REQUIRED; try to continue planning
      if (
        normalizeOrchestrationStatus(room.responseOrchestration.workflowStatus) ===
        ORCHESTRATION_STATUS.REPLAN_REQUIRED
      ) {
        mode = 'after_step_failed'
        log.push({ event: 'execute_failed', message: exec.message })
      } else {
        return { ...exec, continuationLog: log }
      }
    } else {
      const verify = verifyOrchestrationPlan(room, {
        nowMs: Date.now(),
        _internalContinuation: true,
        autoContinue: false,
      })
      emit()
      if (verify.verdict === 'RECOVERED' || verify.stepVerified === true) {
        mode = 'after_step_verified'
        log.push({ event: 'step_verified', planId: room.responseOrchestration.plan?.planId })
      } else {
        mode = 'after_step_failed'
        log.push({ event: 'step_verify_failed', message: verify.message })
      }
    }
  }

  while (autoIteration < max) {
    // Episode complete?
    if (!hasRemainingResponseWork(room)) {
      markEpisodeRecovered(room, {
        nowMs: Date.now(),
        reason: 'No active non-quarantined incidents remain',
      })
      emit()
      if (typeof onCompleteSync === 'function') onCompleteSync(room)
      return {
        ok: true,
        episodeComplete: true,
        recovered: true,
        orchestration: publicOrchestrationState(room),
        continuationLog: log,
        autoIteration,
        mutatedQuarantine: false,
        autoRestored: false,
      }
    }

    if (!scope) {
      writeState(room, {
        workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
        pausedForApprovalReason: 'No approval scope — human approval required',
        continuationReason: 'scope_missing',
        updatedAtMs: Date.now(),
      })
      emit()
      return {
        ok: true,
        pausedForApproval: true,
        reason: 'No approval scope — human approval required',
        orchestration: publicOrchestrationState(room),
        continuationLog: log,
      }
    }

    autoIteration += 1
    const prev = room.responseOrchestration
    const previousPlan = prev.plan
    const previousVerification = prev.verification
    const nextReplanCount =
      (Number.isFinite(Number(prev.replanCount))
        ? Math.max(0, Math.floor(Number(prev.replanCount)))
        : 0) + (mode === 'after_step_failed' || previousPlan ? 1 : 0)

    const historySeed = previousPlan
      ? appendPlanHistory(
          prev.planHistory,
          historyEntryFromPlan(previousPlan, {
            outcome:
              mode === 'after_step_failed' ? 'verification_failed' : 'step_verified',
            verificationVerdict: previousVerification?.verdict ?? null,
            atMs: Date.now(),
          })
        )
      : Array.isArray(prev.planHistory)
        ? [...prev.planHistory]
        : []

    // Transition into ANALYZING for Commander re-evaluation
    const fromStatus = normalizeOrchestrationStatus(prev.workflowStatus)
    if (
      fromStatus !== ORCHESTRATION_STATUS.ANALYZING &&
      canTransitionOrchestration(fromStatus, ORCHESTRATION_STATUS.ANALYZING)
    ) {
      writeState(room, {
        workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
        autoIteration,
        continuationReason:
          mode === 'after_step_failed'
            ? 'verification_failed_replan'
            : 'remaining_incidents',
        pausedForApprovalReason: null,
        stale: false,
        planHistory: historySeed,
        previousPlanId: previousPlan?.planId ?? prev.previousPlanId,
        replanCount: nextReplanCount,
        updatedAtMs: Date.now(),
      })
      emit()
    } else {
      writeState(room, {
        autoIteration,
        continuationReason:
          mode === 'after_step_failed'
            ? 'verification_failed_replan'
            : 'remaining_incidents',
        planHistory: historySeed,
        previousPlanId: previousPlan?.planId ?? prev.previousPlanId,
        replanCount: nextReplanCount,
        updatedAtMs: Date.now(),
      })
    }

    const built = buildContinuationPlan(room, {
      resolveContext,
      nowMs: Date.now(),
      previousPlan,
      verification: previousVerification,
      replanCount: nextReplanCount,
    })

    if (!built.ok) {
      if (built.noWork || !hasRemainingResponseWork(room)) {
        markEpisodeRecovered(room, {
          nowMs: Date.now(),
          reason: built.message || 'No remaining response work',
        })
        emit()
        if (typeof onCompleteSync === 'function') onCompleteSync(room)
        return {
          ok: true,
          episodeComplete: true,
          recovered: true,
          orchestration: publicOrchestrationState(room),
          continuationLog: log,
          autoIteration,
        }
      }
      writeState(room, {
        workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
        pausedForApprovalReason: built.message || 'Continuation planning failed',
        continuationReason: 'planning_failed',
        updatedAtMs: Date.now(),
      })
      emit()
      return {
        ok: true,
        pausedForApproval: true,
        reason: built.message,
        orchestration: publicOrchestrationState(room),
        continuationLog: log,
        autoIteration,
      }
    }

    const scopeCheck = isPlanWithinApprovalScope(built.plan, scope)
    if (!scopeCheck.ok) {
      const planReady = {
        ...built.plan,
        approvalStatus: PLAN_APPROVAL_STATUS.PENDING,
      }
      writeState(room, {
        workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
        plan: planReady,
        fingerprint: built.fingerprint,
        stale: false,
        pausedForApprovalReason: scopeCheck.reason,
        continuationReason: 'scope_expansion',
        approvalScope: scope,
        autoIteration,
        updatedAtMs: Date.now(),
      })
      emit()
      log.push({ event: 'paused_scope', reason: scopeCheck.reason })
      return {
        ok: true,
        pausedForApproval: true,
        reason: scopeCheck.reason,
        orchestration: publicOrchestrationState(room),
        continuationLog: log,
        autoIteration,
      }
    }

    // Within scope — auto-approve
    const approvedPlan = {
      ...built.plan,
      approvalStatus: PLAN_APPROVAL_STATUS.APPROVED,
      commanderStatus: AGENT_SLOT_STATUS.READY,
      recommendedActions: (built.plan.recommendedActions || []).map((a) =>
        a?.executable
          ? { ...a, policyStatus: 'ALLOWED', status: 'approved' }
          : a
      ),
    }
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.APPROVED,
      plan: approvedPlan,
      fingerprint: built.fingerprint,
      stale: false,
      staleReason: null,
      pausedForApprovalReason: null,
      continuationReason: 'auto_approved_within_scope',
      approvalScope: scope,
      autoIteration,
      execution: null,
      verificationBaseline: null,
      updatedAtMs: Date.now(),
    })
    emit()
    log.push({
      event: 'auto_approved',
      planId: approvedPlan.planId,
      primary: approvedPlan.primaryIncidentId,
      candidates: remainingResponseCandidates(room).map((i) => i.id),
    })

    const exec = executeOrchestrationPlan(room, {
      resolveContext,
      onProgress,
      onCompleteSync,
      nowMs: Date.now(),
      _internalContinuation: true,
    })
    if (!exec.ok) {
      log.push({ event: 'execute_failed', message: exec.message })
      mode = 'after_step_failed'
      if (
        normalizeOrchestrationStatus(room.responseOrchestration.workflowStatus) !==
        ORCHESTRATION_STATUS.REPLAN_REQUIRED
      ) {
        return { ...exec, continuationLog: log, autoIteration }
      }
      continue
    }

    const verify = verifyOrchestrationPlan(room, {
      nowMs: Date.now(),
      _internalContinuation: true,
      autoContinue: false,
    })
    emit()
    if (verify.stepVerified === true || verify.verdict === 'RECOVERED') {
      log.push({ event: 'step_verified', planId: approvedPlan.planId })
      mode = 'after_step_verified'
      continue
    }
    log.push({ event: 'step_verify_failed', message: verify.message })
    mode = 'after_step_failed'
  }

  // Max iterations — pause safely (not stale: human may re-approve to continue)
  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
    pausedForApprovalReason: `Automatic iteration limit reached (${max}) — human review required`,
    continuationReason: 'max_iterations',
    stale: false,
    staleReason: null,
    updatedAtMs: Date.now(),
  })
  emit()
  return {
    ok: true,
    statusCode: 409,
    maxIterationsReached: true,
    pausedForApproval: true,
    message: `Automatic iteration limit reached (${max}) — human review required`,
    orchestration: publicOrchestrationState(room),
    continuationLog: log,
    autoIteration,
  }
}

export { buildApprovalScope, hasRemainingResponseWork, isPlanWithinApprovalScope }
