/**
 * Explicit multi-incident orchestration continuation runner (STEP 9 / 16).
 *
 * STEP 16 control flow (Verification is NOT a gate):
 *   Human approval → Response execute → (remaining?) → Commander continue → execute → …
 * until no remaining approved-scope work, scope expansion, or max iterations.
 *
 * REPLAN_REQUIRED only on genuine Response execution failure.
 * Scope expansion → AWAITING_APPROVAL (human), not replan.
 */

import {
  AGENT_SLOT_STATUS,
  ORCHESTRATION_STATUS,
  PLAN_APPROVAL_STATUS,
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
import { verifyResponseStep } from './recoveryAgent.js'
import { pushWorkflowTrace } from './workflowTrace.js'

export const DEFAULT_MAX_AUTO_ITERATIONS = 8

/** Demo/readability pause between automatic agent stages (ms). */
export const ORCHESTRATION_STEP_DELAY_MS = 3500

export function getMaxAutoIterations() {
  const n = Number(process.env.ORCHESTRATION_MAX_AUTO_ITERATIONS)
  if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), 20)
  return DEFAULT_MAX_AUTO_ITERATIONS
}

export function getOrchestrationStepDelayMs() {
  if (
    process.env.ORCHESTRATION_STEP_DELAY_MS != null &&
    process.env.ORCHESTRATION_STEP_DELAY_MS !== ''
  ) {
    const n = Number(process.env.ORCHESTRATION_STEP_DELAY_MS)
    if (Number.isFinite(n) && n >= 0) return Math.min(Math.floor(n), 15000)
  }
  return ORCHESTRATION_STEP_DELAY_MS
}

export function sleepMs(ms) {
  const n = Math.floor(Number(ms) || 0)
  if (n <= 0) return
  const sab = new SharedArrayBuffer(4)
  const ia = new Int32Array(sab)
  Atomics.wait(ia, 0, 0, n)
}

const loopInFlight = new Set()

export function isOrchestrationLoopInFlight(roomIdOrKey) {
  return loopInFlight.has(String(roomIdOrKey ?? '').toUpperCase())
}

export function clearOrchestrationLoopInFlight(roomIdOrKey) {
  if (roomIdOrKey) loopInFlight.delete(String(roomIdOrKey).toUpperCase())
}

function loopLockKey(room) {
  const roomId = String(room?.id ?? '').toUpperCase()
  if (!roomId) return ''
  const gid = room?.responseOrchestration?.groupId
  return gid ? `${roomId}::${String(gid)}` : `${roomId}::default`
}

function groupAllowlistFromRoom(room) {
  const queue = room?.responseOrchestration?.orchestrationQueue
  if (Array.isArray(queue) && queue.length > 0) return queue.map(String)
  return null
}

function detectionForGroup(detection, allowlist) {
  if (!allowlist) return detection
  const allowed = new Set(allowlist.map(String))
  const incidents = (detection?.incidents ?? []).filter((inc) => {
    const a = inc?.persistentId != null ? String(inc.persistentId) : null
    const b = inc?.id != null ? String(inc.id) : null
    return (a && allowed.has(a)) || (b && allowed.has(b))
  })
  return { ...(detection || {}), incidents }
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
    previousPlanId: null,
    planKind: plan?.planKind ?? null,
    replanCount: 0,
    continuationCount: Number(plan?.continuationContext?.continuationCount) || 0,
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

function paceStage(room, {
  delayMs,
  reason,
  writeState,
  publicOrchestrationState,
  onProgress,
  log,
} = {}) {
  const ms = Math.floor(Number(delayMs) || 0)
  if (ms <= 0) return
  writeState(room, {
    continuationReason: reason,
    updatedAtMs: Date.now(),
  })
  if (typeof onProgress === 'function') {
    onProgress(publicOrchestrationState(room))
  }
  if (Array.isArray(log)) {
    log.push({ event: 'paced', reason, delayMs: ms, atMs: Date.now() })
  }
  sleepMs(ms)
}

/**
 * Observational evidence only — never gates continuation or writes REPLAN.
 */
export function recordObservationalVerification(room) {
  const state = room?.responseOrchestration
  if (!state?.plan || !state?.execution) return null
  const step = verifyResponseStep({
    room,
    plan: state.plan,
    execution: state.execution,
    baseline: state.verificationBaseline,
    approvalScope: state.approvalScope ?? null,
    detectionSnapshot: state.postExecutionDetection ?? null,
    nowMs: Date.now(),
  })
  state.verification = step.verification
  pushWorkflowTrace(room, {
    kind: 'observational_verification',
    verified: step.verified === true,
    failReasons: step.failReasons ?? [],
    planId: state.plan?.planId ?? null,
    primaryIncidentId: state.plan?.primaryIncidentId ?? null,
    // Explicit: does not change workflow status
    controlFlow: 'ignored',
  })
  return step
}

export function buildContinuationPlan(room, {
  resolveContext,
  nowMs = Date.now(),
  previousPlan = null,
  verification = null,
  replanCount = 0,
  continuationCount = 0,
  planMode = 'continue',
} = {}) {
  if (typeof resolveContext !== 'function') {
    return { ok: false, message: 'Context resolver unavailable' }
  }
  if (!hasRemainingResponseWork(room, { incidentIdAllowlist: groupAllowlistFromRoom(room) })) {
    return { ok: false, message: 'No remaining response candidates', noWork: true }
  }

  const allowlist = groupAllowlistFromRoom(room)
  const detection = detectionForGroup(room.detection ?? null, allowlist)
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

  const mode = planMode === 'replan' ? 'replan' : 'continue'
  const built = buildResponsePlan({
    detection,
    context,
    focusIncidentId: contextIncidentId,
    nowMs,
    mode,
    nodes: room.nodes ?? [],
    previousPlan,
    verification,
    previousPlanId: mode === 'replan' ? previousPlan?.planId ?? null : null,
    replanCount: mode === 'replan' ? replanCount : 0,
    continuationCount,
  })

  if (!built.ok || !built.plan) {
    return { ok: false, message: built.message || 'Failed to build continuation plan' }
  }
  if (built.executableCount <= 0 || built.policyStatus !== 'ALLOWED') {
    return {
      ok: false,
      message: 'No policy-approved response action is currently available',
      noExecutable: true,
    }
  }
  return {
    ok: true,
    plan: built.plan,
    fingerprint: built.fingerprint,
    primaryIncidentId: built.plan.primaryIncidentId,
  }
}

export function runOrchestrationContinuation(room, {
  resolveContext,
  onProgress = null,
  onCompleteSync = null,
  nowMs = Date.now(),
  maxIterations = null,
  stepDelayMs = null,
  /** 'from_approved' | 'after_execution' */
  mode = 'after_execution',
  writeState,
  publicOrchestrationState,
  executeOrchestrationPlan,
  verifyOrchestrationPlan: _unusedVerify,
  markEpisodeRecovered,
} = {}) {
  const roomKey = loopLockKey(room)
  if (roomKey && loopInFlight.has(roomKey)) {
    return {
      ok: false,
      statusCode: 409,
      message: 'Orchestration continuation already in progress for this room',
      orchestration:
        typeof publicOrchestrationState === 'function'
          ? publicOrchestrationState(room)
          : null,
    }
  }
  if (roomKey) loopInFlight.add(roomKey)

  try {
    return runOrchestrationContinuationBody(room, {
      resolveContext,
      onProgress,
      onCompleteSync,
      nowMs,
      maxIterations,
      stepDelayMs,
      mode,
      writeState,
      publicOrchestrationState,
      executeOrchestrationPlan,
      markEpisodeRecovered,
    })
  } finally {
    if (roomKey) loopInFlight.delete(roomKey)
  }
}

function runOrchestrationContinuationBody(room, {
  resolveContext,
  onProgress = null,
  onCompleteSync = null,
  nowMs = Date.now(),
  maxIterations = null,
  stepDelayMs = null,
  mode = 'after_execution',
  writeState,
  publicOrchestrationState,
  executeOrchestrationPlan,
  markEpisodeRecovered,
} = {}) {
  const max = maxIterations ?? getMaxAutoIterations()
  const delayMs =
    stepDelayMs != null && Number.isFinite(Number(stepDelayMs))
      ? Math.max(0, Math.floor(Number(stepDelayMs)))
      : getOrchestrationStepDelayMs()
  let autoIteration = Number(room.responseOrchestration?.autoIteration) || 0
  const scope = room.responseOrchestration?.approvalScope ?? null
  const log = []
  let pendingTerminalSync = false
  const requestTerminalSync = () => {
    pendingTerminalSync = true
  }
  const flushTerminalSync = () => {
    if (pendingTerminalSync && typeof onCompleteSync === 'function') {
      onCompleteSync(room)
      pendingTerminalSync = false
    }
  }

  const emit = () => {
    if (typeof onProgress === 'function') {
      onProgress(publicOrchestrationState(room))
    }
  }

  const pace = (reason) =>
    paceStage(room, {
      delayMs,
      reason,
      writeState,
      publicOrchestrationState,
      onProgress,
      log,
    })

  const afterSuccessfulExecute = (planId) => {
    // executeOrchestrationPlan already recorded observational evidence + RESPONSE_COMPLETED
    log.push({ event: 'execute_ok', planId })
    requestTerminalSync()
  }

  // from_approved: hold APPROVED visibility, then execute the human-approved plan
  if (mode === 'from_approved') {
    const status = normalizeOrchestrationStatus(
      room.responseOrchestration.workflowStatus
    )
    if (status !== ORCHESTRATION_STATUS.APPROVED) {
      return {
        ok: false,
        statusCode: 409,
        message: `Continuation from_approved requires APPROVED (status=${status})`,
        orchestration: publicOrchestrationState(room),
      }
    }
    emit()
    pace('pacing_after_approval')

    pushWorkflowTrace(room, {
      kind: 'agent_loop',
      phase: 'RESPONSE_EXECUTING',
      planId: room.responseOrchestration?.plan?.planId,
      primaryIncidentId: room.responseOrchestration?.plan?.primaryIncidentId,
      atMs: Date.now(),
    })

    const exec = executeOrchestrationPlan(room, {
      resolveContext,
      onProgress,
      onCompleteSync: null,
      nowMs,
      _internalContinuation: true,
    })
    if (!exec.ok) {
      log.push({ event: 'execute_failed', message: exec.message })
      if (typeof onCompleteSync === 'function') onCompleteSync(room)
      return { ...exec, continuationLog: log, stepVerified: false }
    }
    emit()
    afterSuccessfulExecute(room.responseOrchestration?.plan?.planId)
    mode = 'after_execution'
  }

  while (autoIteration < max) {
    if (!hasRemainingResponseWork(room, { incidentIdAllowlist: groupAllowlistFromRoom(room) })) {
      pace('pacing_before_recovered')
      markEpisodeRecovered(room, {
        nowMs: Date.now(),
        reason: 'No active non-quarantined incidents remain',
      })
      emit()
      if (typeof onCompleteSync === 'function') onCompleteSync(room)
      else flushTerminalSync()
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
      if (typeof onCompleteSync === 'function') onCompleteSync(room)
      else flushTerminalSync()
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
    const prevReplanCount = Number.isFinite(Number(prev.replanCount))
      ? Math.max(0, Math.floor(Number(prev.replanCount)))
      : 0

    const historySeed = previousPlan
      ? appendPlanHistory(
          prev.planHistory,
          historyEntryFromPlan(previousPlan, {
            outcome: 'continued',
            verificationVerdict: previousVerification?.verdict ?? null,
            atMs: Date.now(),
          })
        )
      : Array.isArray(prev.planHistory)
        ? [...prev.planHistory]
        : []

    const fromStatus = normalizeOrchestrationStatus(prev.workflowStatus)
    if (
      fromStatus !== ORCHESTRATION_STATUS.CONTINUING &&
      canTransitionOrchestration(fromStatus, ORCHESTRATION_STATUS.CONTINUING)
    ) {
      writeState(room, {
        workflowStatus: ORCHESTRATION_STATUS.CONTINUING,
        autoIteration,
        continuationReason: 'remaining_incidents',
        pausedForApprovalReason: null,
        stale: false,
        staleReason: null,
        planHistory: historySeed,
        previousPlanId: null,
        replanCount: prevReplanCount,
        lastReplanReason: null,
        updatedAtMs: Date.now(),
      })
      emit()
    } else {
      writeState(room, {
        autoIteration,
        continuationReason: 'remaining_incidents',
        planHistory: historySeed,
        previousPlanId: null,
        replanCount: prevReplanCount,
        lastReplanReason: null,
        updatedAtMs: Date.now(),
      })
    }

    pushWorkflowTrace(room, {
      kind: 'agent_loop',
      phase: 'COMMANDER_CONTINUATION',
      autoIteration,
      remaining: remainingResponseCandidates(room).map((i) => i.id),
      atMs: Date.now(),
    })

    pace('pacing_commander_continuation')

    const built = buildContinuationPlan(room, {
      resolveContext,
      nowMs: Date.now(),
      previousPlan,
      verification: previousVerification,
      replanCount: 0,
      continuationCount: autoIteration,
      planMode: 'continue',
    })

    if (!built.ok) {
      if (built.noWork || !hasRemainingResponseWork(room, { incidentIdAllowlist: groupAllowlistFromRoom(room) })) {
        pace('pacing_before_recovered')
        markEpisodeRecovered(room, {
          nowMs: Date.now(),
          reason: built.message || 'No remaining response work',
        })
        emit()
        if (typeof onCompleteSync === 'function') onCompleteSync(room)
        else flushTerminalSync()
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
        stale: false,
        updatedAtMs: Date.now(),
      })
      emit()
      if (typeof onCompleteSync === 'function') onCompleteSync(room)
      else flushTerminalSync()
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
        previousPlanId: null,
        updatedAtMs: Date.now(),
      })
      emit()
      log.push({ event: 'paused_scope', reason: scopeCheck.reason })
      if (typeof onCompleteSync === 'function') onCompleteSync(room)
      else flushTerminalSync()
      return {
        ok: true,
        pausedForApproval: true,
        reason: scopeCheck.reason,
        orchestration: publicOrchestrationState(room),
        continuationLog: log,
        autoIteration,
      }
    }

    const approvedPlan = {
      ...built.plan,
      approvalStatus: PLAN_APPROVAL_STATUS.APPROVED,
      commanderStatus: AGENT_SLOT_STATUS.READY,
      previousPlanId: null,
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
      postExecutionDetection: null,
      previousPlanId: null,
      replanCount: prevReplanCount,
      updatedAtMs: Date.now(),
    })
    emit()
    log.push({
      event: 'auto_approved',
      planId: approvedPlan.planId,
      primary: approvedPlan.primaryIncidentId,
      candidates: remainingResponseCandidates(room).map((i) => i.id),
    })

    pushWorkflowTrace(room, {
      kind: 'agent_loop',
      phase: 'AUTO_APPROVED_WITHIN_SCOPE',
      planId: approvedPlan.planId,
      primaryIncidentId: approvedPlan.primaryIncidentId,
      atMs: Date.now(),
    })

    pace('pacing_before_execute')

    pushWorkflowTrace(room, {
      kind: 'agent_loop',
      phase: 'RESPONSE_EXECUTING',
      planId: approvedPlan.planId,
      primaryIncidentId: approvedPlan.primaryIncidentId,
      atMs: Date.now(),
    })

    const exec = executeOrchestrationPlan(room, {
      resolveContext,
      onProgress,
      onCompleteSync: null,
      nowMs: Date.now(),
      _internalContinuation: true,
    })
    if (!exec.ok) {
      log.push({ event: 'execute_failed', message: exec.message })
      if (typeof onCompleteSync === 'function') onCompleteSync(room)
      return { ...exec, continuationLog: log, autoIteration, stepVerified: false }
    }

    emit()
    afterSuccessfulExecute(approvedPlan.planId)
    mode = 'after_execution'
  }

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
    pausedForApprovalReason: `Automatic iteration limit reached (${max}) — human review required`,
    continuationReason: 'max_iterations',
    stale: false,
    staleReason: null,
    updatedAtMs: Date.now(),
  })
  emit()
  if (typeof onCompleteSync === 'function') onCompleteSync(room)
  else flushTerminalSync()
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
