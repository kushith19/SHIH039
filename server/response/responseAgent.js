/**
 * Response Agent — deterministic execution worker (STEP 3).
 *
 * Receives ONLY a server-approved ResponsePlan.
 * Executes approved actions sequentially via executeResponseAction().
 * Does not invent actions, modify the plan, or run recovery/verification.
 */

import {
  EXECUTION_STEP_STATUS,
  PLAN_APPROVAL_STATUS,
} from '../../shared/response/orchestration.js'
import {
  getAvailableResponseActions,
  getResponseAction,
  isRegisteredResponseAction,
} from '../../shared/responseActions.js'
import { executeResponseAction, EXECUTION_STATUS } from './executeAction.js'

/**
 * Ordered list of executable steps from the approved server plan.
 * Ignores catalog-only / non-executable entries.
 */
export function orderedExecutableSteps(plan) {
  if (!plan || typeof plan !== 'object') return []
  const byId = new Map()
  for (const action of plan.recommendedActions || []) {
    if (!action || action.executable !== true) continue
    const actionId = String(action.actionId ?? '')
    if (!actionId || !isRegisteredResponseAction(actionId)) continue
    const registered = getResponseAction(actionId)
    if (!registered || registered.supported !== true) continue
    byId.set(actionId, action)
  }

  const order = Array.isArray(plan.executionOrder) ? plan.executionOrder : []
  const steps = []
  const seen = new Set()
  for (const rawId of order) {
    const actionId = String(rawId ?? '')
    if (!actionId || seen.has(actionId)) continue
    const action = byId.get(actionId)
    if (!action) continue
    seen.add(actionId)
    steps.push(action)
  }
  // Fallback: any executable not listed in executionOrder (stable by executionOrder field)
  const rest = [...byId.values()]
    .filter((a) => !seen.has(String(a.actionId)))
    .sort((a, b) => Number(a.executionOrder || 0) - Number(b.executionOrder || 0))
  for (const action of rest) steps.push(action)
  return steps
}

function emptyExecution(totalSteps = 0) {
  return {
    currentStep: 0,
    totalSteps,
    completedSteps: 0,
    activeAction: null,
    results: [],
  }
}

/**
 * Per-action revalidation against live policy.
 * Does not trust earlier approval — rebuilds availability from context.
 */
export function revalidateApprovedAction(action, context, plan) {
  if (!action || typeof action !== 'object') {
    return { ok: false, reason: 'Missing action' }
  }
  const actionId = String(action.actionId ?? '')
  if (!actionId) return { ok: false, reason: 'Missing actionId' }
  if (action.executable !== true) {
    return { ok: false, reason: 'Action is not executable' }
  }
  if (!isRegisteredResponseAction(actionId)) {
    return { ok: false, reason: 'Action is not registered' }
  }
  const registered = getResponseAction(actionId)
  if (!registered || registered.supported !== true) {
    return { ok: false, reason: 'Action is not implemented in the simulator' }
  }

  // Must match an approved plan step (immutability)
  const planStep = (plan?.recommendedActions || []).find(
    (a) => a && String(a.actionId) === actionId && a.executable === true
  )
  if (!planStep) {
    return { ok: false, reason: 'Action is not in the approved plan' }
  }

  if (!context || typeof context !== 'object') {
    return { ok: false, reason: 'Context unavailable for revalidation' }
  }

  const available = getAvailableResponseActions(context)
  const live = available.find((a) => String(a.actionId) === actionId)
  if (!live) {
    return { ok: false, reason: 'Action no longer available under current policy' }
  }

  const plannedTarget = planStep.target?.id != null ? String(planStep.target.id) : null
  const liveTarget =
    context.affectedAsset?.id != null ? String(context.affectedAsset.id) : null
  if (plannedTarget && liveTarget && plannedTarget !== liveTarget) {
    return { ok: false, reason: 'Action target no longer matches the approved plan' }
  }

  return { ok: true, registered, live }
}

function resultEntry(action, patch = {}) {
  return {
    stepId: action.stepId ?? null,
    actionId: action.actionId,
    actionType: action.actionType ?? getResponseAction(action.actionId)?.actionType ?? null,
    label: action.label ?? null,
    target: action.target ?? null,
    executionOrder: action.executionOrder ?? null,
    status: EXECUTION_STEP_STATUS.PENDING,
    startedAtMs: null,
    completedAtMs: null,
    result: null,
    error: null,
    ...patch,
  }
}

/**
 * Run the Response Agent over the server-stored approved plan.
 *
 * @param {{
 *   room: object,
 *   plan: object,
 *   resolveContext: Function,
 *   onProgress?: (execution: object) => void,
 *   nowMs?: number,
 * }} args
 */
export function runResponseAgent({
  room,
  plan,
  resolveContext,
  onProgress,
  nowMs = Date.now(),
} = {}) {
  if (!room || !plan) {
    return {
      ok: false,
      reason: 'Room and approved plan required',
      execution: emptyExecution(0),
    }
  }
  if (plan.approvalStatus !== PLAN_APPROVAL_STATUS.APPROVED) {
    return {
      ok: false,
      reason: 'Plan is not approved',
      execution: emptyExecution(0),
    }
  }

  const steps = orderedExecutableSteps(plan)
  if (!steps.length) {
    return {
      ok: false,
      reason: 'Approved plan has no executable actions',
      execution: emptyExecution(0),
    }
  }

  const incidentId = plan.primaryIncidentId
  if (!incidentId) {
    return {
      ok: false,
      reason: 'Approved plan has no primaryIncidentId',
      execution: emptyExecution(steps.length),
    }
  }

  if (typeof resolveContext !== 'function') {
    return {
      ok: false,
      reason: 'Context resolver unavailable',
      execution: emptyExecution(steps.length),
    }
  }

  const results = steps.map((action) => resultEntry(action))
  const execution = {
    currentStep: 0,
    totalSteps: steps.length,
    completedSteps: 0,
    activeAction: null,
    results,
  }

  const emit = () => {
    if (typeof onProgress === 'function') onProgress({ ...execution, results: [...results] })
  }

  for (let i = 0; i < steps.length; i++) {
    const action = steps[i]
    const stepNumber = i + 1
    execution.currentStep = stepNumber
    execution.activeAction = {
      actionId: action.actionId,
      actionType: action.actionType,
      target: action.target,
      executionOrder: action.executionOrder ?? stepNumber,
    }
    results[i] = resultEntry(action, {
      status: EXECUTION_STEP_STATUS.EXECUTING,
      startedAtMs: nowMs + i,
    })
    emit()

    const context = resolveContext(room, room.id, incidentId)
    const reval = revalidateApprovedAction(action, context, plan)
    if (!reval.ok) {
      results[i] = {
        ...results[i],
        status: EXECUTION_STEP_STATUS.FAILED,
        completedAtMs: Date.now(),
        error: reval.reason,
      }
      for (let j = i + 1; j < results.length; j++) {
        results[j] = {
          ...results[j],
          status: EXECUTION_STEP_STATUS.BLOCKED,
          error: 'Blocked after prior step failure',
        }
      }
      execution.activeAction = null
      emit()
      return {
        ok: false,
        reason: reval.reason,
        execution: { ...execution, results: [...results] },
        failedStep: stepNumber,
      }
    }

    // Authoritative mutation path — never duplicate quarantine/restore logic.
    const execResult = executeResponseAction({
      room,
      roomId: room.id,
      incidentId,
      actionId: action.actionId,
      context,
      // Mid-loop: room nodes already mutated; full telemetry sync after agent finishes.
      onRoomMutated: undefined,
    })

    if (!execResult?.ok) {
      results[i] = {
        ...results[i],
        status: EXECUTION_STEP_STATUS.FAILED,
        completedAtMs: Date.now(),
        error: execResult?.message || 'Execution failed',
        result: execResult ?? null,
      }
      for (let j = i + 1; j < results.length; j++) {
        results[j] = {
          ...results[j],
          status: EXECUTION_STEP_STATUS.BLOCKED,
          error: 'Blocked after prior step failure',
        }
      }
      execution.activeAction = null
      emit()
      return {
        ok: false,
        reason: execResult?.message || 'Execution failed',
        execution: { ...execution, results: [...results] },
        failedStep: stepNumber,
      }
    }

    // EXECUTED and ALREADY_EXECUTED both count as successful step completion.
    results[i] = {
      ...results[i],
      status: EXECUTION_STEP_STATUS.COMPLETED,
      completedAtMs: execResult.executedAtMs ?? Date.now(),
      result: {
        status: execResult.status,
        actionId: execResult.actionId,
        actionType: execResult.actionType,
        target: execResult.target,
        executedAtMs: execResult.executedAtMs,
      },
      target: execResult.target || action.target,
      error: null,
    }
    execution.completedSteps = i + 1
    execution.activeAction = null
    emit()
  }

  return {
    ok: true,
    execution: {
      ...execution,
      currentStep: steps.length,
      completedSteps: steps.length,
      activeAction: null,
      results: [...results],
    },
  }
}

// Re-export for tests
export { EXECUTION_STATUS }
