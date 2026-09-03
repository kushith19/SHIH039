/**
 * Pure helpers for Response Console display and execute wiring.
 * Does not recalculate risk, TGNN, propagation, or financial exposure.
 */

export const RESPONSE_ACTION_UI_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
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

/**
 * Map registry availableActions to display rows.
 * uiStatus comes from local execute state or actionsAlreadyTaken — not invented recovery.
 */
export function responseActionRows(context, localByAction = {}) {
  const actions = Array.isArray(context?.availableActions) ? context.availableActions : []
  const targetId = context?.affectedAsset?.id ?? null
  const targetName =
    context?.affectedAsset?.summary ||
    context?.affectedAsset?.id ||
    null
  return actions.map((action) => ({
    actionId: action.actionId,
    actionType: action.actionType,
    label: action.label || action.actionId,
    description: action.rationale || action.description || '',
    rationale: action.rationale || action.description || '',
    responseProfile: action.responseProfile || context?.responseClassification?.responseProfile || null,
    profileLabel:
      action.profileLabel ||
      context?.responsePolicy?.recommendedActions?.[0]?.profileLabel ||
      null,
    executionTarget: action.executionTarget ?? null,
    requiresNode: action.requiresNode === true,
    targetId,
    targetName,
    uiStatus: resolveActionUiStatus(action.actionId, context, localByAction),
  }))
}

/** Empty-state copy when policy forbids executable containment. */
export function noExecutableActionsCopy(context) {
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

export function isExecuteDisabled(uiStatus) {
  return (
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
