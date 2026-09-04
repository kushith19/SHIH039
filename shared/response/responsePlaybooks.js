/**
 * Deterministic response playbooks (STEP 17).
 * Maps classified incident profiles → ordered registry actionIds.
 * No LLM. Commander plans from these; Response Agent executes.
 */

/**
 * @typedef {{ actionId: string, rationale: string, priority: number, requirePeer?: boolean }} PlaybookStep
 */

/** @type {Readonly<Record<string, PlaybookStep[]>>} */
export const RESPONSE_PLAYBOOKS = Object.freeze({
  LATERAL_MOVEMENT: Object.freeze([
    Object.freeze({
      actionId: 'inspect-peer-history',
      rationale: 'Inspect peer history before containment for lateral movement.',
      priority: 1,
    }),
    Object.freeze({
      actionId: 'block-peer',
      rationale: 'Block suspicious peer communication path.',
      priority: 2,
      requirePeer: true,
    }),
    Object.freeze({
      actionId: 'isolate-node',
      rationale: 'Isolate the affected device if risk remains elevated.',
      priority: 3,
    }),
    Object.freeze({
      actionId: 'collect-telemetry-window',
      rationale: 'Collect telemetry window for forensic context.',
      priority: 4,
    }),
  ]),
  POLICY_VIOLATION: Object.freeze([
    Object.freeze({
      actionId: 'inspect-peer-history',
      rationale: 'Inspect peer history for unauthorized relationships.',
      priority: 1,
    }),
    Object.freeze({
      actionId: 'enforce-policy',
      rationale: 'Enforce expected communication allowlist.',
      priority: 2,
    }),
    Object.freeze({
      actionId: 'revoke-peer-access',
      rationale: 'Revoke unauthorized peer access.',
      priority: 3,
      requirePeer: true,
    }),
    Object.freeze({
      actionId: 'isolate-node',
      rationale: 'Isolate if policy enforcement is insufficient.',
      priority: 4,
    }),
  ]),
  COMPROMISED_DEVICE: Object.freeze([
    Object.freeze({
      actionId: 'capture-device-state',
      rationale: 'Capture device state before containment.',
      priority: 1,
    }),
    Object.freeze({
      actionId: 'isolate-node',
      rationale: 'Isolate the compromised device.',
      priority: 2,
    }),
    Object.freeze({
      actionId: 'inspect-peer-history',
      rationale: 'Inspect peer history after containment.',
      priority: 3,
    }),
    Object.freeze({
      actionId: 'collect-telemetry-window',
      rationale: 'Collect surrounding telemetry.',
      priority: 4,
    }),
  ]),
  EXTERNAL_C2: Object.freeze([
    Object.freeze({
      actionId: 'block-external-communication',
      rationale: 'Block outbound/external communication path.',
      priority: 1,
    }),
    Object.freeze({
      actionId: 'collect-telemetry-window',
      rationale: 'Collect telemetry around suspected C2 activity.',
      priority: 2,
    }),
    Object.freeze({
      actionId: 'isolate-node',
      rationale: 'Isolate if residual risk remains high.',
      priority: 3,
    }),
  ]),
  OT_SOFT_CONTAIN: Object.freeze([
    Object.freeze({
      actionId: 'capture-device-state',
      rationale: 'Capture OT device state before any containment.',
      priority: 1,
    }),
    Object.freeze({
      actionId: 'segment-device',
      rationale: 'Segment OT device into a restricted network zone.',
      priority: 2,
    }),
    Object.freeze({
      actionId: 'isolate-node',
      rationale: 'Escalate to isolation if risk remains high.',
      priority: 3,
    }),
  ]),
  CREDENTIAL_ABUSE: Object.freeze([
    Object.freeze({
      actionId: 'capture-device-state',
      rationale: 'Capture identity endpoint state.',
      priority: 1,
    }),
    Object.freeze({
      actionId: 'isolate-node',
      rationale: 'Isolate the authentication anomaly seed.',
      priority: 2,
    }),
    Object.freeze({
      actionId: 'collect-telemetry-window',
      rationale: 'Collect auth/telemetry window for investigation.',
      priority: 3,
    }),
  ]),
  DEFAULT_CONTAIN: Object.freeze([
    Object.freeze({
      actionId: 'isolate-node',
      rationale: 'Isolate the confirmed anomaly seed.',
      priority: 1,
    }),
  ]),
  RECOVERY: Object.freeze([
    Object.freeze({
      actionId: 'restore-connectivity',
      rationale: 'Restore connectivity after containment and recovery conditions.',
      priority: 1,
    }),
    Object.freeze({
      actionId: 'restore-peer-access',
      rationale: 'Restore previously blocked peer access when safe.',
      priority: 2,
      requirePeer: true,
    }),
    Object.freeze({
      actionId: 'restore-segment',
      rationale: 'Return device to normal network segment.',
      priority: 3,
    }),
  ]),
})

/**
 * Select playbook id from classified response profile + context signals.
 * Profile strings match RESPONSE_PROFILES in responsePolicy.js (no import cycle).
 */
export function selectPlaybookId(profile, context = null) {
  if (profile === 'PROPAGATED_EXPOSURE') return null

  const peers = [
    ...(Array.isArray(context?.peerExposure) ? context.peerExposure : []),
    ...(Array.isArray(context?.peerExposedNodeIds) ? context.peerExposedNodeIds : []),
    ...(Array.isArray(context?.propagatedNodeIds) ? context.propagatedNodeIds : []),
  ].filter(Boolean)
  const hasPeers = peers.length > 0

  if (profile === 'DATA_EXFILTRATION') return 'EXTERNAL_C2'
  if (profile === 'SERVICE_API_ABUSE') {
    return hasPeers ? 'POLICY_VIOLATION' : 'COMPROMISED_DEVICE'
  }
  if (profile === 'NETWORK_TRAFFIC_FLOOD') {
    return hasPeers ? 'LATERAL_MOVEMENT' : 'COMPROMISED_DEVICE'
  }
  if (profile === 'IDENTITY_CREDENTIAL_ATTACK') {
    return 'CREDENTIAL_ABUSE'
  }
  if (profile === 'OT_INFRASTRUCTURE_ANOMALY') {
    return 'OT_SOFT_CONTAIN'
  }
  if (profile === 'FINANCIAL_SERVICE_COMPROMISE') {
    return hasPeers ? 'LATERAL_MOVEMENT' : 'COMPROMISED_DEVICE'
  }
  if (hasPeers) return 'LATERAL_MOVEMENT'
  return 'DEFAULT_CONTAIN'
}

export function getPlaybookSteps(playbookId) {
  if (!playbookId) return []
  return RESPONSE_PLAYBOOKS[playbookId] ? [...RESPONSE_PLAYBOOKS[playbookId]] : []
}

export function peerCandidatesFromContext(context) {
  const ids = [
    ...(Array.isArray(context?.peerExposure) ? context.peerExposure : []),
    ...(Array.isArray(context?.peerExposedNodeIds) ? context.peerExposedNodeIds : []),
    ...(Array.isArray(context?.propagatedNodeIds) ? context.propagatedNodeIds : []),
  ]
  return [...new Set(ids.map(String).filter(Boolean))]
}

/**
 * Whether an actionId was already successfully recorded for the target.
 */
export function actionAlreadyTaken(context, actionId, targetNodeId = null) {
  const list = [
    ...(Array.isArray(context?.actionsAlreadyTaken) ? context.actionsAlreadyTaken : []),
    ...(Array.isArray(context?.actionsTaken) ? context.actionsTaken : []),
  ]
  return list.some((entry) => {
    if (!entry || typeof entry !== 'object') return false
    if (String(entry.actionId) !== String(actionId)) return false
    const st = String(entry.status || '').toUpperCase()
    if (st && st !== 'EXECUTED' && st !== 'ALREADY_EXECUTED' && st !== 'COMPLETED') {
      return false
    }
    if (targetNodeId != null && entry.targetNodeId != null) {
      return String(entry.targetNodeId) === String(targetNodeId)
    }
    return true
  })
}
