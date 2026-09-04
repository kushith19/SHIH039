/**
 * Response Action Repository — single authoritative registry of response capabilities.
 *
 * Commander selects from registered actions only. Unsupported entries never execute.
 * Mutation actions go through executeResponseAction on the server.
 * Read-only (mutation: false) actions produce evidence only.
 */

export const RESPONSE_ACTION_CATEGORIES = Object.freeze({
  CONTAINMENT: 'containment',
  POLICY: 'policy',
  RECOVERY: 'recovery',
  DIAGNOSTIC: 'diagnostic',
})

export const RESPONSE_ACTION_TYPES = Object.freeze({
  ISOLATE_NODE: 'ISOLATE_NODE',
  RESTORE_CONNECTIVITY: 'RESTORE_CONNECTIVITY',
  BLOCK_PEER: 'BLOCK_PEER',
  BLOCK_EXTERNAL: 'BLOCK_EXTERNAL',
  SEGMENT_DEVICE: 'SEGMENT_DEVICE',
  REVOKE_PEER_ACCESS: 'REVOKE_PEER_ACCESS',
  ENFORCE_POLICY: 'ENFORCE_POLICY',
  RESTORE_PEER_ACCESS: 'RESTORE_PEER_ACCESS',
  RESTORE_SEGMENT: 'RESTORE_SEGMENT',
  CAPTURE_DEVICE_STATE: 'CAPTURE_DEVICE_STATE',
  SNAPSHOT_NETWORK_STATE: 'SNAPSHOT_NETWORK_STATE',
  COLLECT_TELEMETRY_WINDOW: 'COLLECT_TELEMETRY_WINDOW',
  INSPECT_PEER_HISTORY: 'INSPECT_PEER_HISTORY',
})

/** @typedef {'quarantine'|'unquarantine'|'block_peer'|'block_external'|'segment'|'revoke_peer'|'enforce_policy'|'restore_peer'|'restore_segment'|'diagnostic'|null} ExecutionTarget */

/**
 * @typedef {object} ResponseActionDef
 * @property {string} actionId
 * @property {string} actionType
 * @property {string} label
 * @property {string} description
 * @property {string} category
 * @property {boolean} supported
 * @property {boolean} requiresNode
 * @property {boolean} [requiresPeer]
 * @property {boolean} reversible
 * @property {boolean} mutation
 * @property {string} riskLevel
 * @property {boolean} requiresApproval
 * @property {ExecutionTarget} executionTarget
 */

/** @type {Readonly<Record<string, ResponseActionDef>>} */
export const RESPONSE_ACTION_REPOSITORY = Object.freeze({
  'isolate-node': Object.freeze({
    actionId: 'isolate-node',
    actionType: RESPONSE_ACTION_TYPES.ISOLATE_NODE,
    label: 'Isolate Device',
    description: 'Quarantine a compromised or high-risk device from active communication.',
    category: RESPONSE_ACTION_CATEGORIES.CONTAINMENT,
    supported: true,
    requiresNode: true,
    requiresPeer: false,
    reversible: true,
    mutation: true,
    riskLevel: 'high',
    requiresApproval: true,
    executionTarget: 'quarantine',
  }),
  'block-peer': Object.freeze({
    actionId: 'block-peer',
    actionType: RESPONSE_ACTION_TYPES.BLOCK_PEER,
    label: 'Block Peer',
    description: 'Temporarily block communication between two devices.',
    category: RESPONSE_ACTION_CATEGORIES.CONTAINMENT,
    supported: true,
    requiresNode: true,
    requiresPeer: true,
    reversible: true,
    mutation: true,
    riskLevel: 'medium',
    requiresApproval: true,
    executionTarget: 'block_peer',
  }),
  'block-external-communication': Object.freeze({
    actionId: 'block-external-communication',
    actionType: RESPONSE_ACTION_TYPES.BLOCK_EXTERNAL,
    label: 'Block External Communication',
    description: 'Block an IoT device’s communication with external/untrusted endpoints.',
    category: RESPONSE_ACTION_CATEGORIES.CONTAINMENT,
    supported: true,
    requiresNode: true,
    requiresPeer: false,
    reversible: true,
    mutation: true,
    riskLevel: 'medium',
    requiresApproval: true,
    executionTarget: 'block_external',
  }),
  'segment-device': Object.freeze({
    actionId: 'segment-device',
    actionType: RESPONSE_ACTION_TYPES.SEGMENT_DEVICE,
    label: 'Segment Device',
    description: 'Move the device into a restricted network segment (softer than full isolation).',
    category: RESPONSE_ACTION_CATEGORIES.CONTAINMENT,
    supported: true,
    requiresNode: true,
    requiresPeer: false,
    reversible: true,
    mutation: true,
    riskLevel: 'medium',
    requiresApproval: true,
    executionTarget: 'segment',
  }),
  'revoke-peer-access': Object.freeze({
    actionId: 'revoke-peer-access',
    actionType: RESPONSE_ACTION_TYPES.REVOKE_PEER_ACCESS,
    label: 'Revoke Peer Access',
    description: 'Remove a previously allowed peer relationship.',
    category: RESPONSE_ACTION_CATEGORIES.POLICY,
    supported: true,
    requiresNode: true,
    requiresPeer: true,
    reversible: true,
    mutation: true,
    riskLevel: 'medium',
    requiresApproval: true,
    executionTarget: 'revoke_peer',
  }),
  'enforce-policy': Object.freeze({
    actionId: 'enforce-policy',
    actionType: RESPONSE_ACTION_TYPES.ENFORCE_POLICY,
    label: 'Enforce Policy',
    description: 'Apply expected communication policy for a device (allowlist enforcement).',
    category: RESPONSE_ACTION_CATEGORIES.POLICY,
    supported: true,
    requiresNode: true,
    requiresPeer: false,
    reversible: true,
    mutation: true,
    riskLevel: 'low',
    requiresApproval: true,
    executionTarget: 'enforce_policy',
  }),
  'restore-connectivity': Object.freeze({
    actionId: 'restore-connectivity',
    actionType: RESPONSE_ACTION_TYPES.RESTORE_CONNECTIVITY,
    label: 'Restore Connectivity',
    description:
      'Restore connectivity to a previously contained endpoint after recovery conditions are satisfied.',
    category: RESPONSE_ACTION_CATEGORIES.RECOVERY,
    supported: true,
    requiresNode: true,
    requiresPeer: false,
    reversible: false,
    mutation: true,
    riskLevel: 'medium',
    requiresApproval: true,
    executionTarget: 'unquarantine',
  }),
  'restore-peer-access': Object.freeze({
    actionId: 'restore-peer-access',
    actionType: RESPONSE_ACTION_TYPES.RESTORE_PEER_ACCESS,
    label: 'Restore Peer Access',
    description: 'Restore a previously blocked peer relationship after recovery.',
    category: RESPONSE_ACTION_CATEGORIES.RECOVERY,
    supported: true,
    requiresNode: true,
    requiresPeer: true,
    reversible: false,
    mutation: true,
    riskLevel: 'low',
    requiresApproval: true,
    executionTarget: 'restore_peer',
  }),
  'restore-segment': Object.freeze({
    actionId: 'restore-segment',
    actionType: RESPONSE_ACTION_TYPES.RESTORE_SEGMENT,
    label: 'Restore Segment',
    description: 'Return a device to its normal network segment.',
    category: RESPONSE_ACTION_CATEGORIES.RECOVERY,
    supported: true,
    requiresNode: true,
    requiresPeer: false,
    reversible: false,
    mutation: true,
    riskLevel: 'low',
    requiresApproval: true,
    executionTarget: 'restore_segment',
  }),
  'capture-device-state': Object.freeze({
    actionId: 'capture-device-state',
    actionType: RESPONSE_ACTION_TYPES.CAPTURE_DEVICE_STATE,
    label: 'Capture Device State',
    description: 'Collect current device runtime state for forensic context.',
    category: RESPONSE_ACTION_CATEGORIES.DIAGNOSTIC,
    supported: true,
    requiresNode: true,
    requiresPeer: false,
    reversible: false,
    mutation: false,
    riskLevel: 'low',
    requiresApproval: false,
    executionTarget: 'diagnostic',
  }),
  'snapshot-network-state': Object.freeze({
    actionId: 'snapshot-network-state',
    actionType: RESPONSE_ACTION_TYPES.SNAPSHOT_NETWORK_STATE,
    label: 'Snapshot Network State',
    description: 'Capture current graph/topology state for investigation.',
    category: RESPONSE_ACTION_CATEGORIES.DIAGNOSTIC,
    supported: true,
    requiresNode: false,
    requiresPeer: false,
    reversible: false,
    mutation: false,
    riskLevel: 'low',
    requiresApproval: false,
    executionTarget: 'diagnostic',
  }),
  'collect-telemetry-window': Object.freeze({
    actionId: 'collect-telemetry-window',
    actionType: RESPONSE_ACTION_TYPES.COLLECT_TELEMETRY_WINDOW,
    label: 'Collect Telemetry Window',
    description: 'Collect telemetry surrounding the incident for evidence.',
    category: RESPONSE_ACTION_CATEGORIES.DIAGNOSTIC,
    supported: true,
    requiresNode: true,
    requiresPeer: false,
    reversible: false,
    mutation: false,
    riskLevel: 'low',
    requiresApproval: false,
    executionTarget: 'diagnostic',
  }),
  'inspect-peer-history': Object.freeze({
    actionId: 'inspect-peer-history',
    actionType: RESPONSE_ACTION_TYPES.INSPECT_PEER_HISTORY,
    label: 'Inspect Peer History',
    description: 'Retrieve recent communication / peer exposure history.',
    category: RESPONSE_ACTION_CATEGORIES.DIAGNOSTIC,
    supported: true,
    requiresNode: true,
    requiresPeer: false,
    reversible: false,
    mutation: false,
    riskLevel: 'low',
    requiresApproval: false,
    executionTarget: 'diagnostic',
  }),
  // Explicit unsupported foreshadowing — never executable
  'disable-camera': Object.freeze({
    actionId: 'disable-camera',
    actionType: 'DISABLE_CAMERA',
    label: 'Disable Camera',
    description: 'Recommended but unavailable in the simulator.',
    category: RESPONSE_ACTION_CATEGORIES.CONTAINMENT,
    supported: false,
    requiresNode: true,
    requiresPeer: false,
    reversible: null,
    mutation: true,
    riskLevel: 'high',
    requiresApproval: true,
    executionTarget: null,
  }),
})

export function listRepositoryActions({ supportedOnly = false } = {}) {
  const all = Object.values(RESPONSE_ACTION_REPOSITORY)
  return supportedOnly ? all.filter((a) => a.supported === true) : [...all]
}

export function getRepositoryAction(actionId) {
  if (actionId == null || actionId === '') return null
  return RESPONSE_ACTION_REPOSITORY[String(actionId)] ?? null
}

export function isSupportedExecutableAction(actionId) {
  const a = getRepositoryAction(actionId)
  return Boolean(a && a.supported === true && a.executionTarget)
}

export function listSupportedMutatingActionIds() {
  return listRepositoryActions({ supportedOnly: true })
    .filter((a) => a.mutation === true)
    .map((a) => a.actionId)
}

export function listSupportedDiagnosticActionIds() {
  return listRepositoryActions({ supportedOnly: true })
    .filter((a) => a.mutation === false)
    .map((a) => a.actionId)
}

/**
 * Mission capability set authorized at human approval (bounded episode).
 * Includes all supported containment/policy/diagnostic actions so the loop
 * can escalate within scope without re-approval for every action flavor.
 */
export function missionAuthorizedActionIds() {
  return listRepositoryActions({ supportedOnly: true })
    .filter(
      (a) =>
        a.category === RESPONSE_ACTION_CATEGORIES.CONTAINMENT ||
        a.category === RESPONSE_ACTION_CATEGORIES.POLICY ||
        a.category === RESPONSE_ACTION_CATEGORIES.DIAGNOSTIC ||
        a.actionId === 'restore-connectivity'
    )
    .map((a) => a.actionId)
}

export function repositoryActionsByCategory() {
  const order = Object.values(RESPONSE_ACTION_CATEGORIES)
  return order
    .map((category) => ({
      category,
      items: listRepositoryActions().filter((a) => a.category === category),
    }))
    .filter((g) => g.items.length > 0)
}
