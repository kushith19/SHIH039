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
} = {}) {
  const focusId = String(incidentId ?? '').trim()
  const requestedActionId = String(actionId ?? '').trim()

  if (!focusId) return fail(400, 'incidentId required')
  if (!requestedActionId) return fail(400, 'actionId required')
  if (!room) return fail(404, 'Room not found')
  if (!context) return fail(404, 'Incident not found')

  const action = getResponseAction(requestedActionId)
  if (!action) return fail(400, 'Unknown action')

  const policyContext = contextForPolicy(room, roomId, focusId, context)
  if (isExposureIncidentContext(policyContext)) {
    return fail(400, 'Action is only available for confirmed anomaly incidents')
  }

  const targetNodeId = affectedNodeIdFromContext(policyContext)
  if (!targetNodeId) return fail(400, 'Incident has no affected node')

  const available = getAvailableResponseActions(policyContext)
  const isListed = available.some((a) => a.actionId === action.actionId)

  // Idempotent restore: prior isolate + already unquarantined → ALREADY_EXECUTED
  if (
    !isListed &&
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

  if (!isListed) {
    return fail(400, 'Action not available for this incident')
  }

  if (action.executionTarget === 'quarantine') {
    const liveSeeds = new Set((room.detection?.anomalyNodeIds ?? []).map(String))
    if (liveSeeds.size > 0 && !liveSeeds.has(String(targetNodeId))) {
      return fail(400, 'Action is only available for confirmed anomaly incidents')
    }

    const quarantine = setNodeQuarantined(room, targetNodeId, true)
    if (!quarantine.ok) {
      return fail(404, 'Target node not found')
    }

    const status = quarantine.already
      ? EXECUTION_STATUS.ALREADY_EXECUTED
      : EXECUTION_STATUS.EXECUTED
    const executedAtMs = Date.now()
    const target = {
      id: targetNodeId,
      name: nodeDisplayName(quarantine.node, targetNodeId),
    }

    appendActionsTaken(room, roomId, context.incidentId || focusId, {
      actionId: action.actionId,
      status,
      targetNodeId,
      executedAtMs,
    })

    if (!quarantine.already && typeof onRoomMutated === 'function') {
      onRoomMutated(room)
    }

    return {
      ok: true,
      incidentId: context.incidentId || focusId,
      actionId: action.actionId,
      actionType: action.actionType,
      target,
      status,
      executedAtMs,
    }
  }

  if (action.executionTarget === 'unquarantine') {
    // Independent of client availableActions: must be quarantined + prior isolate.
    if (!hasPriorCommanderIsolate(policyContext, targetNodeId)) {
      return fail(400, 'Action not available for this incident')
    }
    const node = findRoomNode(room, targetNodeId)
    if (!node) return fail(404, 'Target node not found')
    if (runtimeStateOf(node.data).quarantined !== true) {
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

    const restore = setNodeQuarantined(room, targetNodeId, false)
    if (!restore.ok) {
      return fail(404, 'Target node not found')
    }

    const status = restore.already
      ? EXECUTION_STATUS.ALREADY_EXECUTED
      : EXECUTION_STATUS.EXECUTED
    const executedAtMs = Date.now()
    const target = {
      id: targetNodeId,
      name: nodeDisplayName(restore.node, targetNodeId),
    }

    appendActionsTaken(room, roomId, context.incidentId || focusId, {
      actionId: action.actionId,
      status,
      targetNodeId,
      executedAtMs,
    })

    if (!restore.already && typeof onRoomMutated === 'function') {
      onRoomMutated(room)
    }

    return {
      ok: true,
      incidentId: context.incidentId || focusId,
      actionId: action.actionId,
      actionType: action.actionType,
      target,
      status,
      executedAtMs,
    }
  }

  return fail(400, 'Action execution target is not supported')
}
