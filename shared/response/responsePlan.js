/**
 * Response plan builder — STEP 2.
 *
 * Builds a ResponsePlan from existing detection / recovery / Commander context.
 * Does NOT execute actions, mutate quarantine, or invent actionIds.
 * Executable steps come only from getAvailableResponseActions / registry.
 */

import { rankIncidentsByRecoveryPriority } from '../recovery/priorityRank.js'
import { emptyRecoveryImpact } from '../recovery/recoveryImpact.js'
import { isActiveResponseIncident } from '../incidentStatus.js'
import {
  affectedNodeIdFromContext,
  getAvailableResponseActions,
  getResponseAction,
  isExposureIncidentContext,
  isRegisteredResponseAction,
} from '../responseActions.js'
import { buildResponsePolicy } from '../responsePolicy.js'
import {
  AGENT_SLOT_STATUS,
  CAPABILITY_AVAILABILITY,
  PLAN_ACTION_STATUS,
  PLAN_APPROVAL_STATUS,
  createEmptyResponsePlan,
  normalizePlanAction,
} from './orchestration.js'

function liveId(inc) {
  if (!inc || typeof inc !== 'object') return null
  const id = inc.id ?? inc.liveIncidentId
  return id != null && String(id) ? String(id) : null
}

function persistentOrLiveId(inc) {
  if (!inc || typeof inc !== 'object') return null
  const id = inc.persistentId || inc.id || inc.liveIncidentId
  return id != null && String(id) ? String(id) : null
}

function findIncident(incidents, incidentId) {
  if (incidentId == null || incidentId === '') return null
  const key = String(incidentId)
  return (
    (incidents ?? []).find(
      (inc) =>
        String(inc?.id) === key ||
        String(inc?.persistentId ?? '') === key ||
        String(inc?.liveIncidentId ?? '') === key
    ) ?? null
  )
}

/**
 * Select primary incident for orchestration.
 *
 * Ranking (aligned with Incident Stream):
 * 1. Explicit focus override when the focused incident is an active response incident
 * 2. Otherwise highest recoveryPriority among all active response incidents (global)
 *
 * Correlation groups never force groups[0] to win. Group primaryIncidentId may match
 * the orchestration primary when that incident is also the global #1 (or focus).
 *
 * Returns { incident, reason } where reason documents why this primary was chosen.
 */
export function selectPrimaryIncidentForPlan(detection = null, focusIncidentId = null) {
  const incidents = Array.isArray(detection?.incidents) ? detection.incidents : []
  const active = incidents.filter(isActiveResponseIncident)
  if (!active.length) return null

  if (focusIncidentId) {
    const focused = findIncident(active, focusIncidentId)
    if (focused) {
      return focused
    }
  }

  const ranked = rankIncidentsByRecoveryPriority(active)
  return ranked[0] ?? null
}

/**
 * Same as selectPrimaryIncidentForPlan but with an explicit selection reason
 * for orchestration / demo transparency.
 */
export function selectPrimaryIncidentForPlanWithReason(
  detection = null,
  focusIncidentId = null
) {
  const incidents = Array.isArray(detection?.incidents) ? detection.incidents : []
  const active = incidents.filter(isActiveResponseIncident)
  if (!active.length) {
    return { incident: null, reason: 'no_active_incidents', focusOverride: false }
  }

  if (focusIncidentId) {
    const focused = findIncident(active, focusIncidentId)
    if (focused) {
      return {
        incident: focused,
        reason: 'explicit_focus_override',
        focusOverride: true,
      }
    }
  }

  const ranked = rankIncidentsByRecoveryPriority(active)
  const incident = ranked[0] ?? null
  return {
    incident,
    reason: incident ? 'global_recovery_priority' : 'no_active_incidents',
    focusOverride: false,
  }
}

/**
 * Adaptive primary selection for re-planning (STEP 5 / STEP 8).
 * Prefer open, non-quarantined seeds; avoid previous isolate targets when alternatives exist.
 * Eligible candidates are ranked with the same recovery-priority comparator as the stream.
 */
export function selectPrimaryIncidentForReplan(
  detection = null,
  {
    nodes = [],
    previousAffectedNodeIds = [],
    previousPrimaryIncidentId = null,
  } = {}
) {
  const incidents = Array.isArray(detection?.incidents) ? detection.incidents : []
  // Exposure-only / peer-propagated records are not executable Response targets (STEP 14)
  const open = incidents
    .filter(isActiveResponseIncident)
    .filter((inc) => !isExposureIncidentContext(inc))
  if (!open.length) return null

  const quarantined = new Set()
  for (const n of nodes ?? []) {
    const q =
      n?.data?.runtimeState?.quarantined === true || n?.data?.quarantined === true
    if (q) quarantined.add(String(n.id))
  }
  const prevTargets = new Set((previousAffectedNodeIds ?? []).map(String))

  const notQuarantined = open.filter(
    (inc) => !quarantined.has(String(inc.endpointId ?? ''))
  )
  const pool = notQuarantined.length ? notQuarantined : open

  const avoidPrev = pool.filter(
    (inc) => !prevTargets.has(String(inc.endpointId ?? ''))
  )
  const rankedPool = avoidPrev.length ? avoidPrev : pool
  const ranked = rankIncidentsByRecoveryPriority(rankedPool)

  if (
    ranked[0] &&
    previousPrimaryIncidentId &&
    String(ranked[0].id) === String(previousPrimaryIncidentId)
  ) {
    return ranked[0]
  }
  return ranked[0] ?? selectPrimaryIncidentForPlan(detection, null)
}

/**
 * Compact re-plan reasoning from previous plan + verification (context only).
 * Uses non-causal language.
 */
export function buildReplanReasoning({
  previousPlan = null,
  verification = null,
  primary = null,
  adapted = false,
} = {}) {
  const parts = []
  const prevActions = (previousPlan?.recommendedActions ?? [])
    .filter((a) => a?.executable)
    .map((a) => {
      const t = a.target?.name || a.target?.id || ''
      return t ? `${a.label || a.actionId} · ${t}` : a.label || a.actionId
    })
  if (prevActions.length) {
    parts.push(`Previous response: ${prevActions.join('; ')}`)
  }
  if (verification?.verdict) {
    parts.push(`Verification: ${verification.verdict}`)
  }
  const failed = []
  const checks = verification?.checks
  if (checks) {
    if (checks.containmentHeld === false) failed.push('containment not held')
    if (checks.noNewOutOfScopeAnomalies === false) {
      failed.push('new out-of-scope anomalies observed')
    }
    if (checks.noNewIndependentOpenOnRelief === false) {
      failed.push('new independent open incidents on relief candidates')
    }
    if (checks.executionComplete === false) failed.push('execution incomplete')
  }
  if (failed.length) {
    parts.push(`Previous response did not sufficiently reduce risk (${failed.join('; ')})`)
  } else if (verification?.reasons?.length) {
    parts.push(
      `Previous response did not sufficiently reduce exposure: ${verification.reasons[0]}`
    )
  }
  if (primary) {
    const label = primary.endpointLabel || primary.endpointId || primary.id
    parts.push(
      adapted
        ? `Additional response required — focusing ${label} under current recovery priority`
        : `Re-analysis focuses ${label} under current recovery priority`
    )
  }
  return parts.join(' · ') || 'Commander re-analysis after verification failure'
}

/** Incident ids in the same live correlation group as the primary (or just primary). */
export function correlatedIncidentIds(detection, primaryIncident) {
  const primaryLive = liveId(primaryIncident)
  const primaryAny = persistentOrLiveId(primaryIncident)
  const ids = new Set()
  if (primaryAny) ids.add(primaryAny)
  if (primaryLive) ids.add(primaryLive)

  const groups = Array.isArray(detection?.liveCorrelation?.groups)
    ? detection.liveCorrelation.groups
    : []
  for (const group of groups) {
    const members = Array.isArray(group?.incidentIds)
      ? group.incidentIds.map(String)
      : []
    const hit =
      (primaryLive && members.includes(primaryLive)) ||
      (primaryAny && members.includes(primaryAny)) ||
      String(group?.primaryIncidentId ?? '') === primaryLive ||
      String(group?.primaryIncidentId ?? '') === primaryAny
    if (!hit) continue
    for (const id of members) ids.add(id)
    if (group.primaryIncidentId) ids.add(String(group.primaryIncidentId))
  }
  return [...ids]
}

/**
 * Expected impact from existing recoveryImpact — preserves MAY language.
 */
export function buildExpectedImpactFromIncident(incident) {
  const impact = incident?.recoveryImpact ?? emptyRecoveryImpact()
  const explanation = impact.explanation ?? emptyRecoveryImpact().explanation
  const certainCount = Array.isArray(impact.certainNodeIds)
    ? impact.certainNodeIds.length
    : Number(explanation?.certain?.count) || 0
  const reliefCount = Array.isArray(impact.reliefCandidateIds)
    ? impact.reliefCandidateIds.length
    : Number(explanation?.exposureRelief?.count) || 0
  const criticalRelief =
    Number(explanation?.exposureRelief?.criticalCount) || 0
  const independentCount = Array.isArray(impact.excludedIndependentIds)
    ? impact.excludedIndependentIds.length
    : Number(explanation?.excludedIndependent?.count) || 0
  const quarantinedCount = Array.isArray(impact.excludedQuarantinedIds)
    ? impact.excludedQuarantinedIds.length
    : Number(explanation?.excludedQuarantined?.count) || 0

  const lines = []
  if (certainCount > 0) {
    lines.push(
      `Certain recovery on seed endpoint (${certainCount} node${certainCount === 1 ? '' : 's'}).`
    )
  }
  if (reliefCount > 0) {
    lines.push(
      `May reduce exposure across ${reliefCount} downstream node${reliefCount === 1 ? '' : 's'}.`
    )
  }
  if (criticalRelief > 0) {
    lines.push(
      `Critical exposure relief candidates: ${criticalRelief}.`
    )
  }
  if (independentCount > 0) {
    lines.push(
      `Independently compromised related nodes: ${independentCount} (not claimed as recovered).`
    )
  }
  if (quarantinedCount > 0) {
    lines.push(
      `Already quarantined downstream: ${quarantinedCount} (not counted as newly recovered).`
    )
  }

  return {
    recoveryPriority:
      Number.isFinite(Number(incident?.recoveryPriority ?? impact.score))
        ? Number(incident?.recoveryPriority ?? impact.score)
        : null,
    certainRecoveryCount: certainCount,
    mayReduceExposureCount: reliefCount,
    criticalExposureReliefCount: criticalRelief,
    independentlyCompromisedCount: independentCount,
    quarantinedCount,
    whyFirst: explanation?.headline || null,
    reasons: Array.isArray(explanation?.reasons) ? [...explanation.reasons] : [],
    summaryLines: lines,
    /** Raw pointers — UI may display; not cascade restoration claims */
    certainNodeIds: Array.isArray(impact.certainNodeIds)
      ? [...impact.certainNodeIds]
      : [],
    reliefCandidateIds: Array.isArray(impact.reliefCandidateIds)
      ? [...impact.reliefCandidateIds]
      : [],
  }
}

function actionRiskLabel(actionId, context) {
  const severity = String(context?.severity ?? '').toLowerCase()
  if (actionId === 'isolate-node') {
    if (severity === 'critical' || severity === 'high') {
      return 'Containment risk — isolates a high-severity seed endpoint'
    }
    return 'Containment risk — isolates the confirmed seed endpoint'
  }
  if (actionId === 'restore-connectivity') {
    return 'Recovery risk — restores connectivity after prior containment'
  }
  if (actionId === 'block-peer' || actionId === 'revoke-peer-access') {
    return 'Containment risk — blocks or revokes a peer communication path'
  }
  if (actionId === 'block-external-communication') {
    return 'Containment risk — blocks external communication'
  }
  if (actionId === 'segment-device') {
    return 'Containment risk — moves device into a restricted segment'
  }
  if (
    actionId === 'capture-device-state' ||
    actionId === 'snapshot-network-state' ||
    actionId === 'collect-telemetry-window' ||
    actionId === 'inspect-peer-history'
  ) {
    return 'Diagnostic — read-only evidence collection'
  }
  return 'Policy-assessed response action'
}

/**
 * Map server-authoritative availableActions → plan steps.
 * Ignores any client-supplied actionIds. Catalog capabilities never appear as executable.
 *
 * When selectedActionIds is provided (LLM Commander), only those IDs are included,
 * resolved against the executable repository (not the policy playbook).
 */
export function buildRecommendedActionsFromContext(context, { selectedActionIds = null } = {}) {
  const nodeId = affectedNodeIdFromContext(context)
  const nodeName =
    context?.affectedAsset?.summary ||
    context?.affectedAsset?.id ||
    nodeId
  const available = getAvailableResponseActions(context)

  /** @type {object[]} */
  let sourceActions
  if (selectedActionIds != null) {
    if (!Array.isArray(selectedActionIds)) return []
    sourceActions = []
    const seen = new Set()
    for (const selected of selectedActionIds) {
      const actionId = String(
        selected && typeof selected === 'object'
          ? selected.actionId
          : selected ?? ''
      ).trim()
      if (!actionId || seen.has(actionId)) continue
      const registered = getResponseAction(actionId)
      if (!registered || registered.supported !== true || !registered.executionTarget) {
        continue
      }
      seen.add(actionId)
      const llmTarget =
        selected && typeof selected === 'object'
          ? String(selected.target ?? '').trim() || null
          : null
      sourceActions.push({
        ...registered,
        rationale:
          selected &&
          typeof selected === 'object' &&
          typeof selected.rationale === 'string' &&
          selected.rationale.trim()
            ? selected.rationale.trim()
            : null,
        expectedImpact:
          selected && typeof selected === 'object'
            ? selected.expectedImpact ?? null
            : null,
        confidence:
          selected && typeof selected === 'object'
            ? selected.confidence ?? null
            : null,
        dependencies:
          selected &&
          typeof selected === 'object' &&
          Array.isArray(selected.dependencies)
            ? [...selected.dependencies]
            : [],
        peerTargetId: registered.requiresPeer ? llmTarget : null,
      })
    }
  } else {
    sourceActions = available
  }

  const steps = []
  let order = 1
  for (const action of sourceActions) {
    const actionId = String(action.actionId ?? '')
    if (!isRegisteredResponseAction(actionId)) continue
    const registered = getResponseAction(actionId)
    if (!registered || registered.supported !== true) continue
    const peerId = action.peerTargetId ? String(action.peerTargetId) : null
    steps.push(
      normalizePlanAction({
        stepId: `step-${order}-${actionId}`,
        actionId,
        actionType: registered.actionType,
        label: registered.label,
        target: nodeId
          ? {
              id: nodeId,
              name: nodeName || nodeId,
              ...(peerId ? { peerId, peerName: peerId } : {}),
            }
          : null,
        reason:
          selectedActionIds != null
            ? action.rationale ?? null
            : action.rationale || registered.description,
        expectedImpact: action.expectedImpact ?? null,
        confidence: action.confidence ?? null,
        dependencies: Array.isArray(action.dependencies)
          ? [...action.dependencies]
          : [],
        executionOrder: order,
        risk: actionRiskLabel(actionId, context),
        reversibility:
          typeof registered.reversible === 'boolean'
            ? registered.reversible
            : actionId !== 'restore-connectivity',
        policyStatus: 'ALLOWED',
        status: PLAN_ACTION_STATUS.READY,
        executable: true,
        availability: CAPABILITY_AVAILABILITY.AVAILABLE,
      })
    )
    order += 1
  }
  return steps
}

/**
 * Deterministic fingerprint for stale-plan detection.
 */
export function buildPlanFingerprint({
  primaryIncidentId = null,
  incidentIds = [],
  incidentStatuses = {},
  targetNodeIds = [],
  recoveryPriority = null,
  availableActionIds = [],
  policyProfile = null,
  policyExposureOnly = false,
} = {}) {
  const statuses = Object.keys(incidentStatuses || {})
    .sort()
    .map((id) => `${id}:${incidentStatuses[id]}`)
  return [
    `primary=${primaryIncidentId ?? ''}`,
    `incidents=${[...(incidentIds || [])].map(String).sort().join(',')}`,
    `statuses=${statuses.join(',')}`,
    `targets=${[...(targetNodeIds || [])].map(String).sort().join(',')}`,
    `priority=${
      Number.isFinite(Number(recoveryPriority)) ? Number(recoveryPriority) : ''
    }`,
    `actions=${[...(availableActionIds || [])].map(String).sort().join(',')}`,
    `profile=${policyProfile ?? ''}`,
    `exposureOnly=${policyExposureOnly === true ? '1' : '0'}`,
  ].join('|')
}

export function fingerprintFromPlanAndContext(plan, context, detection) {
  const primary = findIncident(
    detection?.incidents ?? [],
    plan?.primaryIncidentId
  )
  const incidentIds = Array.isArray(plan?.incidentIds) ? plan.incidentIds : []
  const statuses = {}
  for (const id of incidentIds) {
    const inc = findIncident(detection?.incidents ?? [], id)
    statuses[String(id)] = String(inc?.status ?? 'missing')
  }
  const llmPlan = plan?.planSource === 'llm'
  const available = llmPlan
    ? (plan?.recommendedActions ?? [])
        .filter((a) => a?.executable === true)
        .map((a) => a.actionId)
    : getAvailableResponseActions(context).map((a) => a.actionId)
  const policy = context?.responsePolicy || buildResponsePolicy(context)
  return buildPlanFingerprint({
    primaryIncidentId: plan?.primaryIncidentId ?? null,
    incidentIds,
    incidentStatuses: statuses,
    targetNodeIds: Array.isArray(plan?.affectedNodeIds) ? plan.affectedNodeIds : [],
    recoveryPriority: primary?.recoveryPriority ?? plan?.expectedImpact?.recoveryPriority,
    availableActionIds: available,
    policyProfile: llmPlan ? 'llm' : policy?.responseProfile ?? null,
    policyExposureOnly: llmPlan
      ? false
      : policy?.executionConstraints?.exposureOnly === true,
  })
}

let planIdSeq = 0

function makePlanId(primaryIncidentId) {
  const base = primaryIncidentId ? String(primaryIncidentId).replace(/[^\w.-]+/g, '_') : 'none'
  planIdSeq += 1
  return `rplan-${base}-${Date.now()}-${planIdSeq}`
}

/**
 * Build a full ResponsePlan from room detection + Commander context.
 *
 * @param {{
 *   detection?: object|null,
 *   context: object,
 *   focusIncidentId?: string|null,
 *   nowMs?: number,
 *   mode?: 'plan'|'replan'|'continue',
 *   nodes?: object[],
 *   previousPlan?: object|null,
 *   verification?: object|null,
 *   previousPlanId?: string|null,
 *   replanCount?: number,
 *   continuationCount?: number,
 *   selectedActionIds?: string[]|null,
 * }} args
 */
export function buildResponsePlan({
  detection = null,
  context,
  focusIncidentId = null,
  nowMs = Date.now(),
  mode = 'plan',
  nodes = [],
  previousPlan = null,
  verification = null,
  previousPlanId = null,
  replanCount = 0,
  continuationCount = 0,
  selectedActionIds = null,
} = {}) {
  if (!context || typeof context !== 'object') {
    return {
      ok: false,
      message: 'Commander context required',
      plan: null,
      fingerprint: null,
    }
  }

  const isReplan = mode === 'replan'
  const isContinue = mode === 'continue'
  const usesAdaptivePrimary = isReplan || isContinue
  let primarySelectionReason = isContinue
    ? 'continuation_adaptive_recovery_priority'
    : isReplan
      ? 'replan_adaptive_recovery_priority'
      : 'global_recovery_priority'
  let focusOverride = false

  let primary
  if (usesAdaptivePrimary) {
    primary =
      selectPrimaryIncidentForReplan(detection, {
        nodes,
        previousAffectedNodeIds: previousPlan?.affectedNodeIds ?? [],
        previousPrimaryIncidentId: previousPlan?.primaryIncidentId ?? null,
      }) ||
      findIncident(detection?.incidents ?? [], context.incidentId || context.liveIncidentId)
  } else {
    const selected = selectPrimaryIncidentForPlanWithReason(detection, focusIncidentId)
    primary =
      selected.incident ||
      findIncident(detection?.incidents ?? [], context.incidentId || context.liveIncidentId)
    primarySelectionReason = selected.reason
    focusOverride = selected.focusOverride === true
  }

  const primaryId =
    persistentOrLiveId(primary) ||
    context.incidentId ||
    context.liveIncidentId ||
    null

  const incidentIds = primary
    ? correlatedIncidentIds(detection, primary)
    : [primaryId].filter(Boolean)

  const nodeId = affectedNodeIdFromContext(context)
  const affectedNodeIds = nodeId ? [nodeId] : []

  const llmSelected =
    Array.isArray(selectedActionIds) && selectedActionIds.length > 0
  const policy = context.responsePolicy || buildResponsePolicy(context)
  const recommendedActions = buildRecommendedActionsFromContext(context, {
    selectedActionIds,
  })
  const executableActions = recommendedActions.filter((a) => a.executable === true)

  if (
    llmSelected &&
    executableActions.length === 0
  ) {
    return {
      ok: false,
      message: 'Selected action IDs are not executable repository actions',
      plan: null,
      fingerprint: null,
    }
  }

  const policyStatus = llmSelected
    ? executableActions.length > 0
      ? 'ALLOWED'
      : 'NO_EXECUTABLE_ACTIONS'
    : policy?.executionConstraints?.exposureOnly === true
      ? 'BLOCKED_EXPOSURE'
      : executableActions.length > 0
        ? 'ALLOWED'
        : 'NO_EXECUTABLE_ACTIONS'

  const expectedImpact = buildExpectedImpactFromIncident(primary || {
    recoveryImpact: null,
    recoveryPriority: null,
  })

  const adapted =
    usesAdaptivePrimary &&
    previousPlan?.primaryIncidentId &&
    primaryId &&
    String(previousPlan.primaryIncidentId) !== String(primaryId)

  const reasoningParts = []
  if (isContinue) {
    reasoningParts.push(
      'Continuing approved response within human approval scope after a verified iteration.'
    )
    if (adapted) {
      reasoningParts.push('Next primary selected by live recovery priority among remaining candidates.')
    }
  } else if (isReplan) {
    reasoningParts.push(
      buildReplanReasoning({
        previousPlan,
        verification,
        primary,
        adapted,
      })
    )
  }
  if (expectedImpact.whyFirst) reasoningParts.push(expectedImpact.whyFirst)
  if (expectedImpact.reasons.length) {
    reasoningParts.push(...expectedImpact.reasons.slice(0, 4))
  }
  if (policy?.reasons?.length && !llmSelected) {
    reasoningParts.push(`Policy profile: ${policy.responseProfile}`)
  }
  if (llmSelected) {
    reasoningParts.push(
      `LLM Commander selected ${executableActions.length} repository-validated action(s)`
    )
  }

  const count = Number.isFinite(Number(replanCount))
    ? Math.max(0, Math.floor(Number(replanCount)))
    : 0
  const contCount = Number.isFinite(Number(continuationCount))
    ? Math.max(0, Math.floor(Number(continuationCount)))
    : 0

  const lineagePreviousId = isReplan
    ? previousPlanId || previousPlan?.planId || null
    : null

  const plan = createEmptyResponsePlan({
    planId: makePlanId(primaryId),
    createdAt: nowMs,
    commanderStatus: AGENT_SLOT_STATUS.READY,
    incidentIds,
    primaryIncidentId: primaryId,
    affectedNodeIds,
    recommendedActions,
    executionOrder: executableActions.map((a) => a.actionId),
    expectedImpact,
    policyStatus,
    reasoning: reasoningParts.join(' · ') || null,
    approvalStatus: PLAN_APPROVAL_STATUS.NONE,
    planKind: isContinue ? 'continuation' : isReplan ? 'replan' : 'fresh',
    /** STEP 16: previousPlanId only for genuine replan lineage — never normal continuation */
    previousPlanId: lineagePreviousId,
    replanCount: isReplan ? count : 0,
    replanContext: isReplan
      ? {
          previousPlanId: lineagePreviousId,
          previousPrimaryIncidentId: previousPlan?.primaryIncidentId ?? null,
          previousExecutableActionIds: (previousPlan?.recommendedActions ?? [])
            .filter((a) => a?.executable)
            .map((a) => a.actionId),
          previousTargets: Array.isArray(previousPlan?.affectedNodeIds)
            ? [...previousPlan.affectedNodeIds]
            : [],
          verificationVerdict: verification?.verdict ?? null,
          verificationReasons: Array.isArray(verification?.failReasons)
            ? [...verification.failReasons]
            : Array.isArray(verification?.reasons)
              ? [...verification.reasons]
              : [],
          adapted: adapted === true,
        }
      : null,
    continuationContext: isContinue
      ? {
          previousPrimaryIncidentId: previousPlan?.primaryIncidentId ?? null,
          previousExecutableActionIds: (previousPlan?.recommendedActions ?? [])
            .filter((a) => a?.executable)
            .map((a) => a.actionId),
          previousTargets: Array.isArray(previousPlan?.affectedNodeIds)
            ? [...previousPlan.affectedNodeIds]
            : [],
          continuationCount: contCount,
          adapted: adapted === true,
        }
      : null,
    primarySelectionReason,
    focusOverride,
    planSource: llmSelected ? 'llm' : 'policy',
  })

  const fingerprint = fingerprintFromPlanAndContext(plan, context, detection)

  return {
    ok: true,
    plan,
    fingerprint,
    primaryIncident: primary,
    executableCount: executableActions.length,
    policyStatus,
    adapted: adapted === true,
    primarySelectionReason,
    focusOverride,
  }
}

/**
 * Revalidate plan executable actions against live context.
 * Returns { ok, staleReason?, liveActions, policyStatus }.
 * Does not trust client action lists — rebuilds availability from context.
 *
 * Plan actions must remain a subset of live available actions (LLM may select
 * fewer than the full policy set). Exact equality is not required.
 */
export function revalidatePlanAgainstContext(plan, context, detection) {
  if (!plan || typeof plan !== 'object') {
    return { ok: false, reason: 'No plan', liveActions: [], policyStatus: null }
  }
  if (!context || typeof context !== 'object') {
    return { ok: false, reason: 'Context unavailable', liveActions: [], policyStatus: null }
  }

  const planExec = (plan.recommendedActions || []).filter((a) => a && a.executable === true)
  const planExecIds = planExec.map((a) => a.actionId)

  for (const action of planExec) {
    if (!isRegisteredResponseAction(action.actionId)) {
      return {
        ok: false,
        reason: 'Plan contains non-registered executable actionId',
        liveActions: [],
        policyStatus: 'INVALID_ACTION',
      }
    }
    const registered = getResponseAction(action.actionId)
    if (!registered || registered.supported !== true || !registered.executionTarget) {
      return {
        ok: false,
        reason: 'Plan contains a non-executable actionId',
        liveActions: [],
        policyStatus: 'INVALID_ACTION',
      }
    }
  }

  if (plan.planSource === 'llm') {
    const nodeId = affectedNodeIdFromContext(context)
    const primary = findIncident(detection?.incidents ?? [], plan.primaryIncidentId)
    if (plan.primaryIncidentId && !primary) {
      return {
        ok: false,
        reason: 'Primary incident no longer exists',
        liveActions: [],
        policyStatus: 'MISSING_INCIDENT',
      }
    }
    if (planExecIds.length === 0) {
      return {
        ok: false,
        reason: 'No executable actions in LLM plan',
        liveActions: [],
        policyStatus: 'NO_EXECUTABLE_ACTIONS',
      }
    }
    if (planExec.some((action) => {
      const registered = getResponseAction(action.actionId)
      return registered?.requiresNode && !nodeId
    })) {
      return {
        ok: false,
        reason: 'Incident node missing',
        liveActions: [],
        policyStatus: 'MISSING_TARGET',
      }
    }
    return {
      ok: true,
      liveActions: planExec,
      policyStatus: 'ALLOWED',
    }
  }

  const liveActions = buildRecommendedActionsFromContext(context)
  const liveIdSet = new Set(liveActions.map((a) => a.actionId))

  if (planExecIds.length === 0) {
    return {
      ok: false,
      reason: 'No executable actions available under current policy',
      liveActions,
      policyStatus: 'NO_EXECUTABLE_ACTIONS',
    }
  }

  for (const actionId of planExecIds) {
    if (!liveIdSet.has(actionId)) {
      return {
        ok: false,
        reason: 'Executable actions no longer match live policy',
        liveActions,
        policyStatus: 'STALE_ACTIONS',
      }
    }
  }

  if (liveActions.length === 0) {
    return {
      ok: false,
      reason: 'No executable actions available under current policy',
      liveActions,
      policyStatus: 'NO_EXECUTABLE_ACTIONS',
    }
  }

  const policy = context.responsePolicy || buildResponsePolicy(context)
  return {
    ok: true,
    liveActions,
    policyStatus:
      policy?.executionConstraints?.exposureOnly === true
        ? 'BLOCKED_EXPOSURE'
        : 'ALLOWED',
  }
}
