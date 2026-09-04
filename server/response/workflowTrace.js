/**
 * STEP 14 — structured orchestration / Recovery forensic trace.
 * Server-internal; attachable to room.responseOrchestration.workflowTrace.
 * Does not mutate quarantine, detection, or execution authority.
 */

import { runtimeStateOf } from '../infrastructureNode.js'
import {
  remainingResponseCandidates,
  hasRemainingResponseWork,
} from '../../shared/response/approvalScope.js'
import { isRegisteredResponseAction } from '../../shared/responseActions.js'

const TRACE_LIMIT = 80

function nowIso(ms = Date.now()) {
  return new Date(ms).toISOString()
}

function quarantineOf(room, nodeId) {
  const n = (room?.nodes ?? []).find((x) => String(x.id) === String(nodeId))
  if (!n) return null
  return runtimeStateOf(n.data).quarantined === true
}

function incidentStatusSummary(detection) {
  return (detection?.incidents ?? []).map((inc) => ({
    id: inc.persistentId || inc.id,
    endpointId: inc.endpointId ?? null,
    status: inc.status ?? null,
  }))
}

export function ensureWorkflowTrace(room) {
  const state = room?.responseOrchestration
  if (!state) return null
  if (!Array.isArray(state.workflowTrace)) state.workflowTrace = []
  return state.workflowTrace
}

export function pushWorkflowTrace(room, entry) {
  const list = ensureWorkflowTrace(room)
  if (!list) return entry
  const row = {
    timestamp: nowIso(),
    atMs: Date.now(),
    ...entry,
  }
  list.push(row)
  while (list.length > TRACE_LIMIT) list.shift()
  return row
}

export function logStatusTransition(room, {
  previousStatus,
  newStatus,
  reason = null,
  planId = null,
  iteration = null,
  source = null,
} = {}) {
  return pushWorkflowTrace(room, {
    kind: 'status_transition',
    previousStatus,
    newStatus,
    reason,
    planId,
    iteration: iteration ?? room?.responseOrchestration?.autoIteration ?? 0,
    source,
  })
}

/**
 * Structured Recovery check diagnostics (STEP 14).
 * Attached to verification.checkDetails — never replaces hard-fail logic.
 */
export function buildRecoveryCheckDetails({
  checks,
  results = [],
  isolateTargets = [],
  missingQuarantine = [],
  baselineAnomalies = [],
  currentAnomalies = [],
  knownScope = [],
  newOutOfScope = [],
  baselineOpenEnds = [],
  currentOpenEnds = [],
  newIndependentOpen = [],
  residualRows = [],
  catalogActionIds = [],
  executableActionIds = [],
  quarantineLifecycle = [],
  detectionSource = 'live',
  detectionIdentity = null,
} = {}) {
  return {
    detectionSource,
    detectionIdentity,
    catalogActionIds,
    executableActionIds,
    catalogActionsDoNotAffectVerdict: true,
    quarantineLifecycle,
    executionComplete: {
      name: 'executionComplete',
      expected: true,
      actual: checks.executionComplete === true,
      passed: checks.executionComplete === true,
      resultCount: results.length,
      resultStatuses: results.map((r) => ({
        actionId: r.actionId,
        status: r.status,
        target: r.target?.id ?? null,
        error: r.error ?? null,
      })),
      reason: checks.executionComplete
        ? 'All executed steps completed successfully'
        : 'One or more execution steps missing, failed, or blocked',
    },
    containmentHeld: {
      name: 'containmentHeld',
      expected: true,
      actual: checks.containmentHeld === true,
      passed: checks.containmentHeld === true,
      targets: [...isolateTargets],
      missingQuarantine: [...missingQuarantine],
      reason:
        isolateTargets.length === 0
          ? 'No isolate-node targets found to verify containment'
          : missingQuarantine.length
            ? `Target(s) not quarantined: ${missingQuarantine.join(', ')}`
            : 'All isolate targets remain quarantined',
    },
    noNewOutOfScopeAnomalies: {
      name: 'noNewOutOfScopeAnomalies',
      expected: true,
      actual: checks.noNewOutOfScopeAnomalies === true,
      passed: checks.noNewOutOfScopeAnomalies === true,
      baseline: [...baselineAnomalies].sort(),
      current: [...currentAnomalies].sort(),
      knownScope: [...knownScope].sort(),
      newAnomalies: [...currentAnomalies]
        .filter((id) => !baselineAnomalies.includes(id))
        .sort(),
      outsideScope: [...newOutOfScope].sort(),
      reason: newOutOfScope.length
        ? `New out-of-scope anomaly seeds: ${newOutOfScope.join(', ')}`
        : 'No new anomaly seeds outside known episode/approval scope',
    },
    noNewIndependentOpenOnRelief: {
      name: 'noNewIndependentOpenOnRelief',
      expected: true,
      actual: checks.noNewIndependentOpenOnRelief === true,
      passed: checks.noNewIndependentOpenOnRelief === true,
      baselineOpenEnds: [...baselineOpenEnds].sort(),
      currentOpenEnds: [...currentOpenEnds].sort(),
      knownScope: [...knownScope].sort(),
      outsideScope: [...newIndependentOpen].sort(),
      reason: newIndependentOpen.length
        ? `New independent opens outside scope: ${newIndependentOpen.join(', ')}`
        : 'No new independent open endpoints outside approval scope',
    },
    residualNotWorsening: {
      name: 'residualNotWorsening',
      expected: true,
      actual: checks.residualNotWorsening !== false,
      passed: checks.residualNotWorsening !== false,
      rows: residualRows,
      reason:
        checks.residualNotWorsening === false
          ? 'Residual worsened beyond threshold on one or more isolate targets'
          : 'Residual not worsening on isolate targets (or unavailable)',
    },
  }
}

export function classifyPlanActions(plan) {
  const recommended = Array.isArray(plan?.recommendedActions)
    ? plan.recommendedActions
    : []
  const executable = []
  const catalog = []
  for (const a of recommended) {
    const actionId = a?.actionId != null ? String(a.actionId) : null
    const row = {
      actionId,
      actionType: a?.actionType ?? null,
      executable: a?.executable === true,
      target: a?.target?.id ?? null,
      registered: actionId ? isRegisteredResponseAction(actionId) : false,
    }
    if (a?.executable === true && actionId && isRegisteredResponseAction(actionId)) {
      executable.push(row)
    } else {
      catalog.push(row)
    }
  }
  return { executable, catalog, recommended }
}

export function buildIterationTraceSkeleton(room, {
  iteration = 0,
  plan = null,
  phase = null,
} = {}) {
  const state = room?.responseOrchestration ?? {}
  const classified = classifyPlanActions(plan || state.plan)
  const remaining = remainingResponseCandidates(room)
  return {
    timestamp: nowIso(),
    iteration,
    planId: (plan || state.plan)?.planId ?? null,
    incidentIds: Array.isArray((plan || state.plan)?.incidentIds)
      ? [...(plan || state.plan).incidentIds]
      : [],
    primaryIncidentId: (plan || state.plan)?.primaryIncidentId ?? null,
    phase,
    commander: {
      status: state.workflowStatus ?? state.status ?? null,
      selectedPrimary: (plan || state.plan)?.primaryIncidentId ?? null,
      primarySelectionReason: (plan || state.plan)?.primarySelectionReason ?? null,
      recommendedActions: classified.recommended,
      executableActions: classified.executable,
      catalogOnlyActions: classified.catalog,
    },
    approval: {
      approved: (plan || state.plan)?.approvalStatus === 'approved',
      approvalScope: state.approvalScope ?? null,
      scopeFingerprint: state.approvalScope?.scopeFingerprint ?? null,
    },
    response: null,
    verification: null,
    continuation: {
      decision: null,
      continuationReason: state.continuationReason ?? null,
      remainingResponseWork: hasRemainingResponseWork(room),
      remainingIncidentIds: remaining.map((i) => i.persistentId || i.id),
      withinApprovalScope: null,
    },
    incidentSnapshot: incidentStatusSummary(room?.detection),
    finalState: state.workflowStatus ?? state.status ?? null,
  }
}

export function quarantineLifecycleForTargets(room, targets = [], {
  before = null,
  executeResult = null,
  after = null,
  verification = null,
} = {}) {
  return (targets ?? []).map((id) => ({
    targetNodeId: id,
    beforeQuarantined: before?.[id] ?? quarantineOf(room, id),
    executeResult: executeResult ?? null,
    afterQuarantined: after?.[id] ?? quarantineOf(room, id),
    verificationQuarantined: verification?.[id] ?? quarantineOf(room, id),
  }))
}

export function publicWorkflowTrace(room) {
  const list = room?.responseOrchestration?.workflowTrace
  return Array.isArray(list) ? list.slice(-TRACE_LIMIT) : []
}

export function latestIterationTrace(room) {
  const list = publicWorkflowTrace(room)
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.kind === 'iteration' || list[i]?.verification) return list[i]
  }
  return list[list.length - 1] ?? null
}
