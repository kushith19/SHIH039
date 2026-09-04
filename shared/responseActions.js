/**
 * Response Action Registry — facade over the Response Action Repository (STEP 17).
 *
 * RECOMMENDATION (Commander) is separate from EXECUTABLE ACTION.
 * Only supported repository actions may receive executeResponseAction.
 * This module does not execute anything.
 */

import { buildResponsePolicy } from './responsePolicy.js'
import {
  RESPONSE_ACTION_REPOSITORY,
  RESPONSE_ACTION_TYPES,
  getRepositoryAction,
  listRepositoryActions,
  isSupportedExecutableAction,
} from './response/responseActionRepository.js'

export { RESPONSE_ACTION_TYPES }

/**
 * Frozen registry keyed by actionId — supported executable entries only
 * (plus unsupported foreshadowing kept out of RESPONSE_ACTIONS for execute safety).
 * Backward-compatible shape for existing callers.
 */
function toLegacyShape(def) {
  return Object.freeze({
    actionId: def.actionId,
    actionType: def.actionType,
    label: def.label,
    description: def.description,
    requiresNode: def.requiresNode === true,
    requiresPeer: def.requiresPeer === true,
    supported: def.supported === true,
    reversible: def.reversible,
    mutation: def.mutation !== false,
    category: def.category,
    riskLevel: def.riskLevel,
    requiresApproval: def.requiresApproval !== false,
    executionTarget: def.executionTarget,
  })
}

const supportedEntries = listRepositoryActions({ supportedOnly: true }).map(toLegacyShape)

/** Frozen registry keyed by actionId (supported only). */
export const RESPONSE_ACTIONS = Object.freeze(
  Object.fromEntries(supportedEntries.map((a) => [a.actionId, a]))
)

export function listRegisteredResponseActions() {
  return Object.values(RESPONSE_ACTIONS)
}

export function getResponseAction(actionId) {
  if (actionId == null || actionId === '') return null
  const fromRegistry = RESPONSE_ACTIONS[String(actionId)]
  if (fromRegistry) return fromRegistry
  // Unsupported repository entries resolve for messaging but not for RESPONSE_ACTIONS
  const raw = getRepositoryAction(actionId)
  return raw ? toLegacyShape(raw) : null
}

export function isRegisteredResponseAction(actionId) {
  return RESPONSE_ACTIONS[String(actionId)] != null
}

export function isExecutableResponseAction(actionId) {
  return isSupportedExecutableAction(actionId) && isRegisteredResponseAction(actionId)
}

/** Non-empty affected node id from commander / incident context shapes. */
export function affectedNodeIdFromContext(incidentContext) {
  if (!incidentContext || typeof incidentContext !== 'object') return null
  const candidates = [
    incidentContext.affectedAsset?.id,
    incidentContext.affectedNodeId,
    incidentContext.endpointId,
  ]
  for (const raw of candidates) {
    if (raw == null) continue
    const id = String(raw).trim()
    if (id) return id
  }
  return null
}

const EXPOSURE_EVIDENCE_CODES = new Set(['peer_exposure', 'graph_propagation'])

/**
 * Exposure / propagated-risk records are context, not executable incidents.
 */
export function isExposureIncidentContext(incidentContext) {
  if (!incidentContext || typeof incidentContext !== 'object') return false
  if (incidentContext.isExposureIncident === true) return true
  const evidence = [
    ...(Array.isArray(incidentContext.anomalyEvidence) ? incidentContext.anomalyEvidence : []),
    ...(Array.isArray(incidentContext.evidence) ? incidentContext.evidence : []),
  ]
  return evidence.some((ev) => EXPOSURE_EVIDENCE_CODES.has(String(ev?.code ?? '')))
}

/**
 * Which registered actions are valid for the current incident.
 * Policy recommends actionIds; only registry ∩ policy ∩ seed constraints are returned.
 */
export function getAvailableResponseActions(incidentContext) {
  if (!incidentContext || typeof incidentContext !== 'object') return []
  const nodeId = affectedNodeIdFromContext(incidentContext)
  const policy = buildResponsePolicy(incidentContext)
  if (policy.executionConstraints?.exposureOnly === true) return []

  const available = []
  const seen = new Set()
  for (const rec of policy.recommendedActions ?? []) {
    const actionId = String(rec?.actionId ?? '')
    if (!actionId || seen.has(actionId)) continue
    const registered = getResponseAction(actionId)
    if (!registered || registered.supported !== true) continue
    if (registered.requiresNode && !nodeId) continue
    if (registered.requiresPeer && !rec.peerTargetId && !(rec.peerCandidates || []).length) {
      // Peer-required without a candidate — skip
      continue
    }
    seen.add(actionId)
    available.push({
      ...registered,
      rationale: rec.rationale || registered.description,
      priority: rec.priority ?? null,
      responseProfile: policy.responseProfile,
      profileLabel: rec.profileLabel || policy.responseProfile,
      peerTargetId: rec.peerTargetId ?? null,
      peerCandidates: rec.peerCandidates ?? null,
      playbookId: policy.playbookId ?? null,
    })
  }
  return available
}

/** Attach availableActions (+ responsePolicy snapshot) onto commander context. */
export function attachAvailableResponseActions(context) {
  if (!context || typeof context !== 'object') return null
  const responsePolicy = buildResponsePolicy(context)
  return {
    ...context,
    responsePolicy,
    availableActions: getAvailableResponseActions(context),
  }
}

export { RESPONSE_ACTION_REPOSITORY, listRepositoryActions, getRepositoryAction }
