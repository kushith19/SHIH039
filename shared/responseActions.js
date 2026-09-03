/**
 * Response Action Registry — executable simulator actions only.
 *
 * RECOMMENDATION (AI Commander advisory text) is separate from EXECUTABLE ACTION
 * (what the simulator actually knows how to perform). Only registered actions
 * may receive a future EXECUTE operation.
 *
 * Availability (Stage 3+): response policy recommendedActions ∩ registry,
 * subject to seed-only / exposure / recovery constraints. RAG/LLM cannot invent actionIds.
 *
 * ISOLATE_NODE → setNodeQuarantined(true) (+ clear attack override).
 * RESTORE_CONNECTIVITY → setNodeQuarantined(false) (does not restore attack).
 * This module does not execute anything.
 */

import { buildResponsePolicy } from './responsePolicy.js'

export const RESPONSE_ACTION_TYPES = Object.freeze({
  ISOLATE_NODE: 'ISOLATE_NODE',
  RESTORE_CONNECTIVITY: 'RESTORE_CONNECTIVITY',
})

const ISOLATE_NODE_ACTION = Object.freeze({
  actionId: 'isolate-node',
  actionType: RESPONSE_ACTION_TYPES.ISOLATE_NODE,
  label: 'Isolate Node',
  description: 'Isolate the affected endpoint from active communication.',
  requiresNode: true,
  supported: true,
  /** Execute target: setNodeQuarantined(true) / defender:quarantine
   *  (quarantine also clears that node's active nodeOverrides entry). */
  executionTarget: 'quarantine',
})

const RESTORE_CONNECTIVITY_ACTION = Object.freeze({
  actionId: 'restore-connectivity',
  actionType: RESPONSE_ACTION_TYPES.RESTORE_CONNECTIVITY,
  label: 'Restore Connectivity',
  description:
    'Restore connectivity to a previously contained endpoint after recovery conditions are satisfied.',
  requiresNode: true,
  supported: true,
  /** Execute target: setNodeQuarantined(false). Does not restore attack overrides. */
  executionTarget: 'unquarantine',
})

/** Frozen registry keyed by actionId. */
export const RESPONSE_ACTIONS = Object.freeze({
  [ISOLATE_NODE_ACTION.actionId]: ISOLATE_NODE_ACTION,
  [RESTORE_CONNECTIVITY_ACTION.actionId]: RESTORE_CONNECTIVITY_ACTION,
})

export function listRegisteredResponseActions() {
  return Object.values(RESPONSE_ACTIONS)
}

export function getResponseAction(actionId) {
  if (actionId == null || actionId === '') return null
  const action = RESPONSE_ACTIONS[String(actionId)]
  return action ?? null
}

export function isRegisteredResponseAction(actionId) {
  return getResponseAction(actionId) != null
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
 * Historical SQLite rows may still exist; detect them from the stored flag or evidence.
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
  if (!nodeId) return []

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
    seen.add(actionId)
    available.push({
      ...registered,
      rationale: rec.rationale || registered.description,
      priority: rec.priority ?? null,
      responseProfile: policy.responseProfile,
      profileLabel: rec.profileLabel || policy.responseProfile,
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
