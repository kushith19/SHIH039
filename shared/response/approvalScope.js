/**
 * Server-generated approval scope for multi-incident orchestration (STEP 9).
 *
 * Human approval authorizes a response strategy for the active episode.
 * Subsequent automatic plans may continue only within this scope.
 * Client cannot create or modify the scope.
 */

import { filterActiveResponseIncidents } from '../incidentStatus.js'
import { isExposureIncidentContext } from '../responseActions.js'
import { missionAuthorizedActionIds } from './responseActionRepository.js'

/** Exposure / peer-propagated records are assessment context — not Response Agent work. */
export function isExecutableResponseIncident(inc) {
  if (!inc || typeof inc !== 'object') return false
  return !isExposureIncidentContext(inc)
}

function sortedUnique(ids = []) {
  return [...new Set((ids ?? []).map(String).filter(Boolean))].sort()
}

/**
 * Snapshot authorization at human approval time (STEP 17 mission scope).
 * Includes active incident IDs / endpoints plus mission-authorized capabilities
 * so the autonomous loop can escalate within the mission without re-approval.
 */
export function buildApprovalScope({
  plan = null,
  detection = null,
  approvedAtMs = Date.now(),
} = {}) {
  const active = filterActiveResponseIncidents(detection?.incidents ?? [])
  const incidentIds = sortedUnique(
    active.map((inc) => inc.persistentId || inc.id)
  )
  const peerIds = sortedUnique(
    active.flatMap((inc) => [
      ...(Array.isArray(inc.peerExposedNodeIds) ? inc.peerExposedNodeIds : []),
      ...(Array.isArray(inc.propagatedNodeIds) ? inc.propagatedNodeIds : []),
    ])
  )
  const targetNodeIds = sortedUnique([
    ...active.map((inc) => inc.endpointId),
    ...(plan?.affectedNodeIds ?? []),
    ...(plan?.recommendedActions ?? [])
      .flatMap((a) => [a?.target?.id, a?.target?.peerId])
      .filter(Boolean),
    ...peerIds,
  ])
  const planActions = (plan?.recommendedActions ?? [])
    .filter((a) => a?.executable === true && a?.actionId)
    .map((a) => a.actionId)
  const actionTypes = sortedUnique([
    ...planActions,
    ...missionAuthorizedActionIds(),
  ])

  const scopeFingerprint = [
    `incidents=${incidentIds.join(',')}`,
    `targets=${targetNodeIds.join(',')}`,
    `actions=${actionTypes.join(',')}`,
  ].join('|')

  return {
    planId: plan?.planId ?? null,
    incidentIds,
    actionTypes,
    targetNodeIds,
    /** STEP 17 — human authorized an autonomous mission */
    autoContinue: true,
    missionCapabilities: missionAuthorizedActionIds(),
    scopeFingerprint,
    approvedAtMs: Number(approvedAtMs) || Date.now(),
  }
}

/**
 * Whether a newly built plan stays inside the human-approved strategy.
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function isPlanWithinApprovalScope(plan, scope) {
  if (!scope || typeof scope !== 'object') {
    return { ok: false, reason: 'No approval scope — human approval required' }
  }
  if (!plan || typeof plan !== 'object') {
    return { ok: false, reason: 'No plan to authorize' }
  }

  const allowedIncidents = new Set((scope.incidentIds ?? []).map(String))
  const allowedTargets = new Set((scope.targetNodeIds ?? []).map(String))
  const allowedActions = new Set((scope.actionTypes ?? []).map(String))

  const primary = plan.primaryIncidentId != null ? String(plan.primaryIncidentId) : null
  if (primary && allowedIncidents.size > 0 && !allowedIncidents.has(primary)) {
    return {
      ok: false,
      reason: `Primary incident ${primary} is outside approved incident scope`,
    }
  }

  for (const id of plan.incidentIds ?? []) {
    if (allowedIncidents.size > 0 && !allowedIncidents.has(String(id))) {
      return {
        ok: false,
        reason: `Incident ${id} is outside approved incident scope`,
      }
    }
  }

  for (const id of plan.affectedNodeIds ?? []) {
    if (allowedTargets.size > 0 && !allowedTargets.has(String(id))) {
      return {
        ok: false,
        reason: `Target ${id} is outside approved target scope`,
      }
    }
  }

  for (const action of plan.recommendedActions ?? []) {
    if (action?.executable !== true) continue
    const actionId = String(action.actionId ?? '')
    if (!actionId || !allowedActions.has(actionId)) {
      return {
        ok: false,
        reason: `Action ${actionId || '(unknown)'} is outside approved action scope`,
      }
    }
    const targetId = action.target?.id != null ? String(action.target.id) : null
    if (targetId && allowedTargets.size > 0 && !allowedTargets.has(targetId)) {
      return {
        ok: false,
        reason: `Action target ${targetId} is outside approved target scope`,
      }
    }
  }

  return { ok: true, reason: null }
}

/**
 * Active seed incidents whose endpoint is not yet quarantined — still need response.
 * Exposure-only / propagated-risk records are never response candidates (STEP 14).
 */
export function remainingResponseCandidates(room) {
  const active = filterActiveResponseIncidents(room?.detection?.incidents ?? []).filter(
    isExecutableResponseIncident
  )
  const quarantined = new Set()
  for (const n of room?.nodes ?? []) {
    const q =
      n?.data?.runtimeState?.quarantined === true || n?.data?.quarantined === true
    if (q) quarantined.add(String(n.id))
  }
  return active.filter((inc) => !quarantined.has(String(inc.endpointId ?? '')))
}

export function hasRemainingResponseWork(room) {
  return remainingResponseCandidates(room).length > 0
}
