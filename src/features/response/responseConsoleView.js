/**
 * Pure helpers for Response Console display and execute wiring.
 * Does not recalculate risk, TGNN, propagation, or financial exposure.
 */

import { getRepositoryAction } from '../../../shared/response/responseActionRepository.js'

export const RESPONSE_ACTION_UI_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
  POLICY_BLOCKED: 'POLICY_BLOCKED',
  BLOCKED: 'BLOCKED',
  EXECUTING: 'EXECUTING',
  EXECUTED: 'EXECUTED',
  ALREADY_EXECUTED: 'ALREADY_EXECUTED',
  FAILED: 'FAILED',
})

export function severityTone(severity) {
  const s = String(severity ?? '').toLowerCase()
  if (s === 'critical' || s === 'high') return 'crit'
  if (s === 'medium') return 'warn'
  return 'muted'
}

export function formatRiskDisplay(riskScore) {
  if (riskScore == null || !Number.isFinite(Number(riskScore))) return null
  const n = Number(riskScore)
  if (n <= 1) return Math.round(n * 100)
  return Math.round(n)
}

export function formatTrustDisplay(trustScore) {
  if (trustScore == null || !Number.isFinite(Number(trustScore))) return null
  return Math.round(Number(trustScore))
}

/** Simulated exposure label from context only — never invent amounts. */
export function exposureLabelFromContext(context) {
  const fin = context?.financialExposure
  if (!fin || fin.simulated !== true) return null
  const label = fin.exposureLabel
  if (!label || label === '₹0') return null
  return String(label)
}

/** Backend request body — incident is source of truth; no client target node. */
export function buildExecuteRequestBody({ incidentId, actionId }) {
  return {
    incidentId: String(incidentId ?? '').trim(),
    actionId: String(actionId ?? '').trim(),
  }
}

export function incidentIdForExecute(context) {
  if (!context || typeof context !== 'object') return ''
  return String(context.incidentId || context.liveIncidentId || '').trim()
}

/** Prefer authoritative history from commander context when present. */
export function uiStatusFromHistory(context, actionId) {
  const id = String(actionId ?? '')
  const taken = Array.isArray(context?.actionsAlreadyTaken)
    ? context.actionsAlreadyTaken
    : []
  for (let i = taken.length - 1; i >= 0; i--) {
    const entry = taken[i]
    if (!entry || typeof entry !== 'object') continue
    if (String(entry.actionId) !== id) continue
    const status = String(entry.status ?? '')
    if (status === RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED) {
      return RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED
    }
    if (status === RESPONSE_ACTION_UI_STATUS.EXECUTED) {
      return RESPONSE_ACTION_UI_STATUS.EXECUTED
    }
  }
  return RESPONSE_ACTION_UI_STATUS.AVAILABLE
}

export function resolveActionUiStatus(actionId, context, localByAction = {}) {
  const local = localByAction?.[actionId]
  if (local?.uiStatus) return local.uiStatus
  return uiStatusFromHistory(context, actionId)
}

export function responsePlanMatchesContext(responsePlan, context) {
  if (!responsePlan || !context) return false
  return [
    responsePlan.primaryIncidentId,
    ...(Array.isArray(responsePlan.incidentIds) ? responsePlan.incidentIds : []),
  ]
    .filter(Boolean)
    .map(String)
    .some(
      (id) =>
        id === String(context?.incidentId ?? '') ||
        id === String(context?.liveIncidentId ?? '')
    )
}

/**
 * True only for a backend LLM ResponsePlan that belongs to the focused incident.
 * Never treats context.availableActions or policy playbooks as a plan.
 */
export function isAuthoritativeLlmResponsePlan(responsePlan, context) {
  if (!responsePlan || typeof responsePlan !== 'object') return false
  if (String(responsePlan.planSource ?? '') !== 'llm') return false
  if (!responsePlanMatchesContext(responsePlan, context)) return false
  const actions = Array.isArray(responsePlan.recommendedActions)
    ? responsePlan.recommendedActions.filter((action) => action?.actionId)
    : []
  return actions.length > 0
}

/**
 * Plan the Response Console may render. Stale socket plans are suppressed while
 * Analyze is in flight or after a failed / non-LLM Analyze.
 */
export function visibleResponsePlan({
  socketPlan = null,
  context = null,
  analyzeUi = null,
  workflowStatus = null,
} = {}) {
  const waiting =
    analyzeUi?.waiting === true ||
    String(workflowStatus ?? '').toUpperCase() === 'ANALYZING'
  if (waiting) return null
  if (analyzeUi?.failed === true) return null

  const candidate =
    analyzeUi?.resultOk === true && analyzeUi.resultPlan
      ? analyzeUi.resultPlan
      : socketPlan

  if (!isAuthoritativeLlmResponsePlan(candidate, context)) return null

  if (
    analyzeUi?.generation > 0 &&
    analyzeUi.resultOk !== true &&
    analyzeUi.startedPlanId &&
    candidate.planId &&
    String(candidate.planId) === String(analyzeUi.startedPlanId)
  ) {
    return null
  }

  return candidate
}

export const LLM_RESPONSE_UI_STATUS = Object.freeze({
  WAITING: 'WAITING',
  WAITING_FOR_RESPONSE: 'WAITING FOR RESPONSE',
  RECEIVED: 'RECEIVED',
  FAILED: 'FAILED',
  NO_LLM_RESPONSE: 'NO LLM RESPONSE',
})

function presentDebugField(value) {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

/** Safe debug fields only — never copies raw model text. */
export function safeLlmDebugFields(debugLast = null) {
  if (!debugLast || typeof debugLast !== 'object') return {}
  const fields = {}
  const requestId = presentDebugField(debugLast.requestId)
  if (requestId) fields.requestId = requestId
  if (Number.isFinite(Number(debugLast.durationMs))) {
    fields.durationMs = Number(debugLast.durationMs)
  }
  const model = presentDebugField(debugLast.model)
  if (model) fields.model = model
  const doneReason = presentDebugField(
    debugLast.doneReason ?? debugLast.done_reason
  )
  if (doneReason) fields.doneReason = doneReason
  if (debugLast.httpStatus != null && Number.isFinite(Number(debugLast.httpStatus))) {
    fields.httpStatus = Number(debugLast.httpStatus)
  }
  const source = presentDebugField(debugLast.source)
  if (source) fields.source = source
  return fields
}

export function llmResponseBannerView({
  waiting = false,
  failed = false,
  error = null,
  visiblePlan = null,
  socketPlan = null,
  analyzeAttempted = false,
  debugLast = null,
} = {}) {
  if (waiting) {
    return {
      status: LLM_RESPONSE_UI_STATUS.WAITING_FOR_RESPONSE,
      detail: 'Generating response plan with Qwen…',
      error: null,
      fields: [],
    }
  }
  if (failed) {
    return {
      status: LLM_RESPONSE_UI_STATUS.FAILED,
      detail: 'LLM Response Plan unavailable',
      error: String(error || 'LLM Response Plan unavailable'),
      fields: [],
    }
  }
  if (visiblePlan) {
    const debug = safeLlmDebugFields(debugLast)
    const sourceParts = []
    if (debug.source) sourceParts.push(debug.source)
    sourceParts.push('llm')
    const fields = [
      { label: 'Source', value: sourceParts.join(' / ') },
      {
        label: 'Actions received',
        value: String(
          visiblePlan.recommendedActions.filter((action) => action?.actionId)
            .length
        ),
      },
    ]
    if (debug.requestId) {
      fields.push({ label: 'Request ID', value: debug.requestId })
    }
    if (debug.durationMs != null) {
      fields.push({ label: 'Response time', value: `${debug.durationMs} ms` })
    }
    if (debug.model) {
      fields.push({ label: 'Model', value: debug.model })
    }
    if (debug.doneReason) {
      fields.push({ label: 'Done reason', value: debug.doneReason })
    }
    if (debug.httpStatus != null) {
      fields.push({ label: 'HTTP status', value: String(debug.httpStatus) })
    }
    return {
      status: LLM_RESPONSE_UI_STATUS.RECEIVED,
      detail: null,
      error: null,
      fields,
    }
  }
  if (
    analyzeAttempted &&
    socketPlan &&
    String(socketPlan.planSource ?? '') &&
    String(socketPlan.planSource) !== 'llm'
  ) {
    return {
      status: LLM_RESPONSE_UI_STATUS.NO_LLM_RESPONSE,
      detail: 'NO LLM RESPONSE',
      error: null,
      fields: [
        { label: 'Source', value: String(socketPlan.planSource) },
      ],
    }
  }
  if (analyzeAttempted) {
    return {
      status: LLM_RESPONSE_UI_STATUS.NO_LLM_RESPONSE,
      detail: 'No LLM response was received.',
      error: null,
      fields: [],
    }
  }
  return {
    status: LLM_RESPONSE_UI_STATUS.WAITING,
    detail: 'Press Response on an incident to generate a plan with Qwen.',
    error: null,
    fields: [],
  }
}

export function logResponseUiTransition(kind, extras = {}) {
  const prefix = '[RESPONSE UI]'
  if (kind === 'ANALYZE_STARTED') {
    console.info(`${prefix} ANALYZE_STARTED`)
    console.info(`${prefix} WAITING_FOR_LLM`)
    return
  }
  if (kind === 'WAITING_FOR_LLM') {
    console.info(`${prefix} WAITING_FOR_LLM`)
    return
  }
  if (kind === 'LLM_RESPONSE_RECEIVED') {
    console.info(`${prefix} LLM_RESPONSE_RECEIVED`)
    console.info(`${prefix} PLAN_SOURCE=${extras.planSource ?? ''}`)
    console.info(`${prefix} ACTION_COUNT=${extras.actionCount ?? 0}`)
    console.info(`${prefix} RENDERING_LLM_ACTIONS`)
    return
  }
  if (kind === 'NO_LLM_RESPONSE') {
    console.info(`${prefix} NO_LLM_RESPONSE`)
    if (extras.planSource != null && extras.planSource !== '') {
      console.info(`${prefix} PLAN_SOURCE=${extras.planSource}`)
    }
    console.info(`${prefix} ACTION_COUNT=0`)
  }
}

/**
 * Display rows for the Response Console.
 * Only an authoritative LLM ResponsePlan may produce cards.
 * Never unioned with context.availableActions or the policy playbook.
 */
export function responseActionRows(context, localByAction = {}, responsePlan = null) {
  if (!isAuthoritativeLlmResponsePlan(responsePlan, context)) {
    return []
  }
  const planActions = responsePlan.recommendedActions.filter(
    (action) => action?.actionId
  )
  const llmPlan = true

  const seen = new Set()
  const contextTargetId = context?.affectedAsset?.id ?? null
  const targetName =
    context?.affectedAsset?.summary ||
    context?.affectedAsset?.id ||
    null

  return planActions.flatMap((planAction) => {
    const actionId = String(planAction.actionId)
    if (seen.has(actionId)) return []
    seen.add(actionId)
    const repositoryAction = getRepositoryAction(actionId)
    if (!repositoryAction) return []

    const supported =
      repositoryAction.supported === true &&
      Boolean(repositoryAction.executionTarget)
    const policyBlocked =
      planAction?.policyStatus === 'BLOCKED' ||
      planAction?.policyStatus === 'POLICY_BLOCKED'
    const planExecutable = planAction?.executable !== false
    const executionStatus = resolveActionUiStatus(
      actionId,
      context,
      localByAction
    )
    const hasExecutionState =
      executionStatus !== RESPONSE_ACTION_UI_STATUS.AVAILABLE
    const canExecute =
      supported && planExecutable && !policyBlocked && !hasExecutionState
    const uiStatus = hasExecutionState
      ? executionStatus
      : !supported
        ? RESPONSE_ACTION_UI_STATUS.BLOCKED
        : policyBlocked
          ? RESPONSE_ACTION_UI_STATUS.POLICY_BLOCKED
          : RESPONSE_ACTION_UI_STATUS.AVAILABLE
    const authoritativeTarget = planAction?.target?.id ?? contextTargetId

    return [{
      actionId: repositoryAction.actionId,
      actionType: repositoryAction.actionType,
      label: planAction.label || repositoryAction.label,
      description: repositoryAction.description,
      category: repositoryAction.category ?? null,
      riskLevel: repositoryAction.riskLevel ?? null,
      responseProfile:
        context?.responseClassification?.responseProfile || null,
      executionTarget: repositoryAction.executionTarget ?? null,
      requiresNode: repositoryAction.requiresNode === true,
      requiresPeer: repositoryAction.requiresPeer === true,
      supported,
      executable: canExecute,
      policyStatus:
        planAction?.policyStatus ??
        (policyBlocked ? 'POLICY_BLOCKED' : canExecute ? 'ALLOWED' : 'UNAVAILABLE'),
      availability: canExecute ? 'available' : 'unavailable',
      targetId: authoritativeTarget,
      targetName:
        planAction?.target?.name ||
        (String(authoritativeTarget ?? '') === String(contextTargetId ?? '')
          ? targetName
          : authoritativeTarget),
      aiRecommended: llmPlan || Boolean(planAction),
      rationale: planAction?.reason ?? planAction?.rationale ?? null,
      expectedImpact: planAction?.expectedImpact ?? null,
      uiStatus,
      canExecute,
    }]
  })
}

export function responseConsolePresentation({
  context = null,
  socketPlan = null,
  analyzeUi = null,
  workflowStatus = null,
  localByAction = {},
  debugLast = null,
  continuationReason = null,
  pausedForApprovalReason = null,
} = {}) {
  const waiting =
    analyzeUi?.waiting === true ||
    String(workflowStatus ?? '').toUpperCase() === 'ANALYZING'
  const failed =
    analyzeUi?.failed === true ||
    (!waiting && String(continuationReason ?? '') === 'planning_failed')
  const visiblePlan = visibleResponsePlan({
    socketPlan,
    context,
    analyzeUi,
    workflowStatus,
  })
  const analyzeAttempted =
    Number(analyzeUi?.generation ?? 0) > 0 ||
    String(continuationReason ?? '') === 'planning_failed' ||
    Boolean(visiblePlan)
  const banner = llmResponseBannerView({
    waiting,
    failed,
    error: analyzeUi?.error || pausedForApprovalReason,
    visiblePlan,
    socketPlan,
    analyzeAttempted,
    debugLast,
  })
  const actions =
    waiting || failed
      ? []
      : responseActionRows(context, localByAction, visiblePlan)
  return { waiting, failed, visiblePlan, banner, actions }
}

/** Empty-state copy when there is no Commander plan to execute. */
export function noExecutableActionsCopy(context, responsePlan = null) {
  if (responsePlan?.planSource === 'llm') {
    return {
      title: null,
      detail:
        'No executable actions in the Commander plan for this incident.',
    }
  }
  if (!responsePlan?.recommendedActions?.length) {
    return {
      title: null,
      detail: 'Press Response on an incident to generate a plan with Qwen.',
    }
  }
  const profile =
    context?.responseClassification?.responseProfile ||
    context?.responsePolicy?.responseProfile ||
    null
  if (
    profile === 'PROPAGATED_EXPOSURE' ||
    context?.responsePolicy?.executionConstraints?.exposureOnly === true ||
    context?.isExposureIncident === true
  ) {
    return {
      title: 'PROPAGATED EXPOSURE',
      detail:
        'No executable response. No independent anomaly is confirmed on this node — monitor only until it becomes a confirmed seed.',
    }
  }
  return {
    title: null,
    detail: 'No registered executable actions for this incident.',
  }
}

export function executeButtonLabel(uiStatus) {
  switch (uiStatus) {
    case RESPONSE_ACTION_UI_STATUS.EXECUTING:
      return 'Executing…'
    case RESPONSE_ACTION_UI_STATUS.EXECUTED:
      return '✓ Executed'
    case RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED:
      return '✓ Already executed'
    case RESPONSE_ACTION_UI_STATUS.FAILED:
      return 'Retry'
    default:
      return 'Execute'
  }
}

export function actionStatusLabel(uiStatus) {
  if (
    uiStatus === RESPONSE_ACTION_UI_STATUS.EXECUTED ||
    uiStatus === RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED
  ) {
    return 'COMPLETED'
  }
  return uiStatus || RESPONSE_ACTION_UI_STATUS.UNAVAILABLE
}

export function isExecuteDisabled(uiStatus) {
  return (
    uiStatus === RESPONSE_ACTION_UI_STATUS.UNAVAILABLE ||
    uiStatus === RESPONSE_ACTION_UI_STATUS.POLICY_BLOCKED ||
    uiStatus === RESPONSE_ACTION_UI_STATUS.BLOCKED ||
    uiStatus === RESPONSE_ACTION_UI_STATUS.EXECUTING ||
    uiStatus === RESPONSE_ACTION_UI_STATUS.EXECUTED ||
    uiStatus === RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED
  )
}

export function userSafeExecuteError(message) {
  const raw = String(message ?? '').trim()
  if (!raw) return 'Unable to execute this response action for the incident.'
  if (/stack|exception|at\s+\S+\s+\(/i.test(raw)) {
    return 'Unable to execute this response action for the incident.'
  }
  return raw
}

export function formatExecutedAt(executedAtMs) {
  if (executedAtMs == null || !Number.isFinite(Number(executedAtMs))) return null
  try {
    return new Date(Number(executedAtMs)).toLocaleString()
  } catch {
    return null
  }
}

/**
 * @param {{ hasActions: boolean, actionCount: number, execution?: { status?: string, message?: string, target?: { id?: string, name?: string }, executedAtMs?: number, actionId?: string } | null }} args
 */
export function responseStatusCopy({ hasActions, actionCount, execution = null }) {
  const status = execution?.status
  const actionId = String(execution?.actionId ?? '')
  const isRestore = actionId === 'restore-connectivity'
  if (
    status === RESPONSE_ACTION_UI_STATUS.EXECUTED ||
    status === RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED
  ) {
    const targetLabel = execution?.target?.name || execution?.target?.id || null
    const when = formatExecutedAt(execution?.executedAtMs)
    if (isRestore) {
      const parts = [
        status === RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED
          ? 'Connectivity was already restored for this target.'
          : 'Connectivity restore succeeded.',
        'The attack override remains cleared; a new attack would require a new attacker action.',
      ]
      if (targetLabel) parts.push(`Target: ${targetLabel}.`)
      if (when) parts.push(`Executed at ${when}.`)
      return {
        title: 'CONNECTIVITY RESTORED',
        detail: parts.join(' '),
      }
    }
    const parts = [
      status === RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED
        ? 'Containment was already in place for this target.'
        : 'Containment action succeeded.',
      'Recovery is determined by the live detection pipeline — not claimed here.',
    ]
    if (targetLabel) parts.push(`Target: ${targetLabel}.`)
    if (when) parts.push(`Executed at ${when}.`)
    return {
      title: 'CONTAINMENT EXECUTED',
      detail: parts.join(' '),
    }
  }
  if (status === RESPONSE_ACTION_UI_STATUS.FAILED) {
    return {
      title: 'EXECUTION FAILED',
      detail: userSafeExecuteError(execution?.message),
    }
  }
  if (status === RESPONSE_ACTION_UI_STATUS.EXECUTING) {
    return {
      title: 'EXECUTING',
      detail: 'Sending registered response action to the simulator…',
    }
  }
  if (!hasActions) {
    return {
      title: 'RESPONSE PENDING',
      detail: 'No registered response actions are available for this incident.',
    }
  }
  return {
    title: 'RESPONSE PENDING',
    detail:
      actionCount === 1
        ? 'No response action has been executed.'
        : 'No response actions have been executed.',
  }
}

/**
 * POST /rooms/:roomId/commander/execute — reuses existing backend contract.
 * @returns {Promise<{ ok: true, status: string, incidentId: string, actionId: string, target?: object, executedAtMs?: number } | { ok: false, message: string }>}
 */
export async function postCommanderExecute(
  roomId,
  { incidentId, actionId },
  fetchImpl = globalThis.fetch
) {
  const body = buildExecuteRequestBody({ incidentId, actionId })
  if (!body.incidentId) return { ok: false, message: 'incidentId required' }
  if (!body.actionId) return { ok: false, message: 'actionId required' }
  if (!roomId) return { ok: false, message: 'Room not found' }

  const res = await fetchImpl(
    `/rooms/${encodeURIComponent(String(roomId))}/commander/execute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  let json = null
  try {
    json = await res.json()
  } catch {
    return { ok: false, message: 'Unable to execute this response action for the incident.' }
  }
  if (!res.ok || json?.ok === false) {
    return {
      ok: false,
      message: userSafeExecuteError(json?.message),
    }
  }
  return {
    ok: true,
    incidentId: json.incidentId,
    actionId: json.actionId,
    actionType: json.actionType,
    target: json.target ?? null,
    status: json.status,
    executedAtMs: json.executedAtMs,
  }
}
