/**
 * Execute a registered response action against an incident's affected node.
 * Only registry actions may run; LLM text is never executed.
 */
import {
  getResponseAction,
  getAvailableResponseActions,
  affectedNodeIdFromContext,
  isExposureIncidentContext,
} from '../../shared/responseActions.js'
import { hasPriorCommanderIsolate } from '../../shared/responsePolicy.js'
import { getIncident, updateIncidentStatus } from '../metrics/incidents.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { setNodeQuarantined } from './quarantineNode.js'
import {
  addExternalBlock,
  addPeerBlock,
  addRevokedPeer,
  enforceNodePolicy,
  hasPeerBlock,
  recordDiagnostic,
  removePeerBlock,
  restoreRevokedPeer,
  setDeviceSegment,
} from './responseRuntime.js'

export const EXECUTION_STATUS = Object.freeze({
  EXECUTED: 'EXECUTED',
  ALREADY_EXECUTED: 'ALREADY_EXECUTED',
})

function nodeDisplayName(node, fallbackId) {
  const label = node?.data?.label
  if (label != null && String(label).trim()) return String(label)
  return String(fallbackId)
}

function findLiveIncident(room, incidentId) {
  const id = String(incidentId ?? '')
  if (!id || !room?.detection?.incidents) return null
  return (
    room.detection.incidents.find(
      (inc) => inc.id === id || inc.persistentId === id
    ) ?? null
  )
}

function findRoomNode(room, nodeId) {
  const id = String(nodeId ?? '')
  if (!id || !Array.isArray(room?.nodes)) return null
  return room.nodes.find((n) => String(n.id) === id) ?? null
}

function hasActionRecord(actionsTaken, actionId, targetNodeId) {
  if (!Array.isArray(actionsTaken)) return false
  return actionsTaken.some(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      String(entry.actionId) === String(actionId) &&
      String(entry.targetNodeId) === String(targetNodeId)
  )
}

function appendActionsTaken(room, roomId, incidentId, record) {
  const stored = getIncident(roomId, incidentId)
  const live = findLiveIncident(room, incidentId)
  const prior = stored?.actionsTaken ?? live?.actionsTaken ?? []
  if (hasActionRecord(prior, record.actionId, record.targetNodeId)) {
    return prior
  }
  const next = [...prior, record]
  if (stored) {
    updateIncidentStatus(roomId, stored.incidentId, { actionsTaken: next })
  }
  if (live) {
    live.actionsTaken = next
  }
  return next
}

function fail(statusCode, message) {
  return { ok: false, statusCode, message }
}

/**
 * Merge live room quarantine + actionsTaken into context before policy checks.
 * Server must not trust stale client availableActions.
 */
function contextForPolicy(room, roomId, incidentId, context) {
  const nodeId = affectedNodeIdFromContext(context)
  const node = findRoomNode(room, nodeId)
  const quarantined = node ? runtimeStateOf(node.data).quarantined === true : false
  const stored = getIncident(roomId, incidentId)
  const live = findLiveIncident(room, incidentId) ?? findLiveIncident(room, context?.incidentId)
  const actionsAlreadyTaken =
    stored?.actionsTaken ??
    live?.actionsTaken ??
    context?.actionsAlreadyTaken ??
    context?.actionsTaken ??
    []
  const prevAsset =
    context?.affectedAsset && typeof context.affectedAsset === 'object'
      ? context.affectedAsset
      : { id: nodeId }
  return {
    ...context,
    isExposureIncident:
      context?.isExposureIncident === true || live?.isExposureIncident === true,
    anomalyEvidence: context?.anomalyEvidence ?? live?.evidence ?? context?.evidence,
    evidence: context?.evidence ?? live?.evidence,
    actionsAlreadyTaken,
    affectedAsset: {
      ...prevAsset,
      ...(nodeId ? { id: nodeId } : {}),
      quarantined,
    },
  }
}

/**
 * @param {object} opts
 * @param {object} opts.room - in-memory room (source of truth for nodes)
 * @param {string} opts.roomId
 * @param {string} opts.incidentId
 * @param {string} opts.actionId
 * @param {object|null} opts.context - commander context for the incident
 * @param {((room: object) => void)|undefined} opts.onRoomMutated - e.g. syncWithTelemetry
 */
export function executeResponseAction({
  room,
  roomId,
  incidentId,
  actionId,
  context,
  onRoomMutated,
  /** Peer target for block-peer / revoke / restore-peer */
  peerTargetId = null,
  /** When true, skip live availability list (approved plan step) */
  approvedPlanStep = false,
} = {}) {
  const focusId = String(incidentId ?? '').trim()
  const requestedActionId = String(actionId ?? '').trim()

  if (!focusId) return fail(400, 'incidentId required')
  if (!requestedActionId) return fail(400, 'actionId required')
  if (!room) return fail(404, 'Room not found')
  if (!context) return fail(404, 'Incident not found')

  const action = getResponseAction(requestedActionId)
  if (!action) return fail(400, 'Unknown action')
  if (action.supported !== true || !action.executionTarget) {
    return fail(400, 'Action is not supported for execution')
  }

  const policyContext = contextForPolicy(room, roomId, focusId, context)
  if (isExposureIncidentContext(policyContext)) {
    return fail(400, 'Action is only available for confirmed anomaly incidents')
  }

  const targetNodeId =
    action.requiresNode === false
      ? affectedNodeIdFromContext(policyContext)
      : affectedNodeIdFromContext(policyContext)
  if (action.requiresNode !== false && !targetNodeId) {
    return fail(400, 'Incident has no affected node')
  }

  const available = getAvailableResponseActions(policyContext)
  const isListed = available.some((a) => a.actionId === action.actionId)

  // Idempotent restore: prior isolate + already unquarantined → ALREADY_EXECUTED
  if (
    !isListed &&
    !approvedPlanStep &&
    action.executionTarget === 'unquarantine' &&
    hasPriorCommanderIsolate(policyContext, targetNodeId) &&
    policyContext.affectedAsset?.quarantined !== true
  ) {
    const node = findRoomNode(room, targetNodeId)
    if (!node) return fail(404, 'Target node not found')
    const executedAtMs = Date.now()
    appendActionsTaken(room, roomId, context.incidentId || focusId, {
      actionId: action.actionId,
      status: EXECUTION_STATUS.ALREADY_EXECUTED,
      targetNodeId,
      executedAtMs,
    })
    return {
      ok: true,
      incidentId: context.incidentId || focusId,
      actionId: action.actionId,
      actionType: action.actionType,
      target: {
        id: targetNodeId,
        name: nodeDisplayName(node, targetNodeId),
      },
      status: EXECUTION_STATUS.ALREADY_EXECUTED,
      executedAtMs,
    }
  }

  if (!isListed && !approvedPlanStep) {
    return fail(400, 'Action not available for this incident')
  }

  const peerId =
    peerTargetId != null && String(peerTargetId).trim()
      ? String(peerTargetId).trim()
      : available.find((a) => a.actionId === action.actionId)?.peerTargetId != null
        ? String(available.find((a) => a.actionId === action.actionId).peerTargetId)
        : null

  if (action.requiresPeer === true && !peerId) {
    return fail(400, 'Action requires a peer target')
  }

  const succeed = ({ status, target, already = false, evidence = null, mutated = false }) => {
    const executedAtMs = Date.now()
    appendActionsTaken(room, roomId, context.incidentId || focusId, {
      actionId: action.actionId,
      status,
      targetNodeId: target?.id ?? targetNodeId,
      peerTargetId: peerId,
      executedAtMs,
    })
    if (mutated && typeof onRoomMutated === 'function') onRoomMutated(room)
    return {
      ok: true,
      incidentId: context.incidentId || focusId,
      actionId: action.actionId,
      actionType: action.actionType,
      target,
      status,
      executedAtMs,
      evidence,
      mutation: action.mutation !== false,
    }
  }

  if (action.executionTarget === 'quarantine') {
    const liveSeeds = new Set((room.detection?.anomalyNodeIds ?? []).map(String))
    if (liveSeeds.size > 0 && !liveSeeds.has(String(targetNodeId))) {
      return fail(400, 'Action is only available for confirmed anomaly incidents')
    }
    const quarantine = setNodeQuarantined(room, targetNodeId, true)
    if (!quarantine.ok) return fail(404, 'Target node not found')
    const status = quarantine.already
      ? EXECUTION_STATUS.ALREADY_EXECUTED
      : EXECUTION_STATUS.EXECUTED
    return succeed({
      status,
      target: {
        id: targetNodeId,
        name: nodeDisplayName(quarantine.node, targetNodeId),
      },
      already: quarantine.already,
      mutated: !quarantine.already,
    })
  }

  if (action.executionTarget === 'unquarantine') {
    if (!hasPriorCommanderIsolate(policyContext, targetNodeId)) {
      return fail(400, 'Action not available for this incident')
    }
    const node = findRoomNode(room, targetNodeId)
    if (!node) return fail(404, 'Target node not found')
    if (runtimeStateOf(node.data).quarantined !== true) {
      return succeed({
        status: EXECUTION_STATUS.ALREADY_EXECUTED,
        target: {
          id: targetNodeId,
          name: nodeDisplayName(node, targetNodeId),
        },
        already: true,
      })
    }
    const restore = setNodeQuarantined(room, targetNodeId, false)
    if (!restore.ok) return fail(404, 'Target node not found')
    const status = restore.already
      ? EXECUTION_STATUS.ALREADY_EXECUTED
      : EXECUTION_STATUS.EXECUTED
    return succeed({
      status,
      target: {
        id: targetNodeId,
        name: nodeDisplayName(restore.node, targetNodeId),
      },
      already: restore.already,
      mutated: !restore.already,
    })
  }

  if (action.executionTarget === 'block_peer') {
    const node = findRoomNode(room, targetNodeId)
    if (!node) return fail(404, 'Target node not found')
    const peerNode = findRoomNode(room, peerId)
    const result = addPeerBlock(room, targetNodeId, peerId, {
      actionId: action.actionId,
      incidentId: focusId,
    })
    return succeed({
      status: result.already
        ? EXECUTION_STATUS.ALREADY_EXECUTED
        : EXECUTION_STATUS.EXECUTED,
      target: {
        id: targetNodeId,
        name: nodeDisplayName(node, targetNodeId),
        peerId,
        peerName: peerNode
          ? nodeDisplayName(peerNode, peerId)
          : peerId,
      },
      already: result.already,
      mutated: !result.already,
    })
  }

  if (action.executionTarget === 'block_external') {
    const node = findRoomNode(room, targetNodeId)
    if (!node) return fail(404, 'Target node not found')
    const result = addExternalBlock(room, targetNodeId, {
      actionId: action.actionId,
      incidentId: focusId,
    })
    return succeed({
      status: result.already
        ? EXECUTION_STATUS.ALREADY_EXECUTED
        : EXECUTION_STATUS.EXECUTED,
      target: {
        id: targetNodeId,
        name: nodeDisplayName(node, targetNodeId),
      },
      already: result.already,
      mutated: !result.already,
    })
  }

  if (action.executionTarget === 'segment') {
    const node = findRoomNode(room, targetNodeId)
    if (!node) return fail(404, 'Target node not found')
    const result = setDeviceSegment(room, targetNodeId, 'restricted')
    return succeed({
      status: result.already
        ? EXECUTION_STATUS.ALREADY_EXECUTED
        : EXECUTION_STATUS.EXECUTED,
      target: {
        id: targetNodeId,
        name: nodeDisplayName(node, targetNodeId),
        segment: result.segment,
      },
      already: result.already,
      mutated: !result.already,
    })
  }

  if (action.executionTarget === 'revoke_peer') {
    const node = findRoomNode(room, targetNodeId)
    if (!node) return fail(404, 'Target node not found')
    const result = addRevokedPeer(room, targetNodeId, peerId, {
      actionId: action.actionId,
    })
    // Also record a peer block for demo visibility
    if (!hasPeerBlock(room, targetNodeId, peerId)) {
      addPeerBlock(room, targetNodeId, peerId, { via: 'revoke-peer-access' })
    }
    return succeed({
      status: result.already
        ? EXECUTION_STATUS.ALREADY_EXECUTED
        : EXECUTION_STATUS.EXECUTED,
      target: {
        id: targetNodeId,
        name: nodeDisplayName(node, targetNodeId),
        peerId,
      },
      already: result.already,
      mutated: !result.already,
    })
  }

  if (action.executionTarget === 'enforce_policy') {
    const node = findRoomNode(room, targetNodeId)
    if (!node) return fail(404, 'Target node not found')
    // Allowlist: known peers from edges + peer candidates
    const allowed = new Set()
    for (const e of room.edges ?? []) {
      if (String(e.source) === String(targetNodeId)) allowed.add(String(e.target))
      if (String(e.target) === String(targetNodeId)) allowed.add(String(e.source))
    }
    enforceNodePolicy(room, targetNodeId, [...allowed], {
      actionId: action.actionId,
    })
    return succeed({
      status: EXECUTION_STATUS.EXECUTED,
      target: {
        id: targetNodeId,
        name: nodeDisplayName(node, targetNodeId),
        allowedTargets: [...allowed],
      },
      mutated: true,
    })
  }

  if (action.executionTarget === 'restore_peer') {
    const node = findRoomNode(room, targetNodeId)
    if (!node) return fail(404, 'Target node not found')
    if (!peerId) return fail(400, 'Action requires a peer target')
    restoreRevokedPeer(room, targetNodeId, peerId)
    const result = removePeerBlock(room, targetNodeId, peerId)
    return succeed({
      status: result.already
        ? EXECUTION_STATUS.ALREADY_EXECUTED
        : EXECUTION_STATUS.EXECUTED,
      target: {
        id: targetNodeId,
        name: nodeDisplayName(node, targetNodeId),
        peerId,
      },
      already: result.already,
      mutated: !result.already,
    })
  }

  if (action.executionTarget === 'restore_segment') {
    const node = findRoomNode(room, targetNodeId)
    if (!node) return fail(404, 'Target node not found')
    const result = setDeviceSegment(room, targetNodeId, 'normal')
    return succeed({
      status: result.already
        ? EXECUTION_STATUS.ALREADY_EXECUTED
        : EXECUTION_STATUS.EXECUTED,
      target: {
        id: targetNodeId,
        name: nodeDisplayName(node, targetNodeId),
        segment: result.segment,
      },
      already: result.already,
      mutated: !result.already,
    })
  }

  if (action.executionTarget === 'diagnostic') {
    const node = targetNodeId ? findRoomNode(room, targetNodeId) : null
    const snapshot = {
      actionId: action.actionId,
      nodeId: targetNodeId,
      quarantined: node
        ? runtimeStateOf(node.data).quarantined === true
        : null,
      anomalyNodeIds: [...(room.detection?.anomalyNodeIds ?? [])],
      peerExposure: policyContext.peerExposure ?? policyContext.peerExposedNodeIds ?? [],
      edgeCount: Array.isArray(room.edges) ? room.edges.length : 0,
      nodeCount: Array.isArray(room.nodes) ? room.nodes.length : 0,
    }
    const recorded = recordDiagnostic(room, {
      actionId: action.actionId,
      incidentId: focusId,
      nodeId: targetNodeId,
      snapshot,
    })
    return succeed({
      status: EXECUTION_STATUS.EXECUTED,
      target: targetNodeId
        ? {
            id: targetNodeId,
            name: node ? nodeDisplayName(node, targetNodeId) : targetNodeId,
          }
        : { id: 'network', name: 'Network' },
      evidence: recorded.entry,
      mutated: false,
    })
  }

  return fail(400, 'Action execution target is not supported')
}
