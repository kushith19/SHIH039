/**
 * Sequential multi-incident orchestration queue helpers.
 * Wraps the existing per-incident workflow; does not change Planner / approval /
 * Response Agent / recovery semantics.
 */

import { ORCHESTRATION_CYCLE_STATUS, normalizeOrchestrationCycleStatus } from './orchestration.js'
import { filterActiveResponseIncidents } from '../incidentStatus.js'
import { rankIncidentsByRecoveryPriority } from '../recovery/priorityRank.js'

function incidentKey(inc) {
  if (!inc || typeof inc !== 'object') return null
  const id = inc.persistentId || inc.id
  return id != null && String(id).trim() ? String(id) : null
}

function findActiveById(detection, incidentId) {
  const want = String(incidentId ?? '').trim()
  if (!want) return null
  const active = filterActiveResponseIncidents(detection?.incidents ?? [])
  return (
    active.find(
      (inc) => String(inc.id ?? '') === want || String(inc.persistentId ?? '') === want
    ) ?? null
  )
}

/**
 * Stable queue of active incident IDs at cycle start.
 * Focused incident (if still active) is placed first; remaining follow recovery priority.
 */
export function buildStableOrchestrationQueue(detection = null, focusIncidentId = null) {
  const active = filterActiveResponseIncidents(detection?.incidents ?? [])
  if (!active.length) return []

  const ranked = rankIncidentsByRecoveryPriority(active)
  const keys = []
  const seen = new Set()

  const push = (inc) => {
    const key = incidentKey(inc)
    if (!key || seen.has(key)) return
    seen.add(key)
    keys.push(key)
  }

  const focus = focusIncidentId ? findActiveById(detection, focusIncidentId) : null
  if (focus) push(focus)
  for (const inc of ranked) push(inc)
  return keys
}

export function emptyOrchestrationQueueState() {
  return {
    orchestrationQueue: [],
    currentIncidentId: null,
    completedIncidentIds: [],
    orchestrationCycleStatus: ORCHESTRATION_CYCLE_STATUS.IDLE,
  }
}

export function queueProgressView(orchestrationState = null) {
  const queue = Array.isArray(orchestrationState?.orchestrationQueue)
    ? orchestrationState.orchestrationQueue.map(String)
    : []
  const completed = Array.isArray(orchestrationState?.completedIncidentIds)
    ? orchestrationState.completedIncidentIds.map(String)
    : []
  const currentIncidentId = orchestrationState?.currentIncidentId
    ? String(orchestrationState.currentIncidentId)
    : null
  const cycleStatus = normalizeOrchestrationCycleStatus(
    orchestrationState?.orchestrationCycleStatus
  )
  const total = queue.length
  let position = 0
  if (currentIncidentId && total > 0) {
    const idx = queue.indexOf(currentIncidentId)
    position = idx >= 0 ? idx + 1 : completed.length + (currentIncidentId ? 1 : 0)
  } else if (cycleStatus === ORCHESTRATION_CYCLE_STATUS.COMPLETED && total > 0) {
    position = total
  }
  const active =
    cycleStatus !== ORCHESTRATION_CYCLE_STATUS.IDLE &&
    cycleStatus !== ORCHESTRATION_CYCLE_STATUS.COMPLETED &&
    total > 0
  return {
    active,
    cycleStatus,
    queue,
    completedIncidentIds: completed,
    currentIncidentId,
    position,
    total,
    label:
      active && total > 0
        ? `Orchestration: ${Math.min(position || 1, total)} / ${total}`
        : cycleStatus === ORCHESTRATION_CYCLE_STATUS.COMPLETED && total > 0
          ? `Orchestration: ${total} / ${total}`
          : null,
  }
}

/**
 * Map per-incident workflow status onto cycle status while a queue is running.
 * Does not invent approvals or recoveries.
 */
export function cycleStatusForWorkflow(workflowStatus, queueState = {}) {
  const cycle = normalizeOrchestrationCycleStatus(queueState.orchestrationCycleStatus)
  const queue = Array.isArray(queueState.orchestrationQueue)
    ? queueState.orchestrationQueue
    : []
  if (!queue.length) {
    return cycle === ORCHESTRATION_CYCLE_STATUS.COMPLETED
      ? ORCHESTRATION_CYCLE_STATUS.COMPLETED
      : ORCHESTRATION_CYCLE_STATUS.IDLE
  }
  if (cycle === ORCHESTRATION_CYCLE_STATUS.COMPLETED) {
    return ORCHESTRATION_CYCLE_STATUS.COMPLETED
  }
  const wf = String(workflowStatus ?? '').toUpperCase()
  if (wf === 'AWAITING_APPROVAL' || wf === 'PLAN_READY') {
    return ORCHESTRATION_CYCLE_STATUS.AWAITING_APPROVAL
  }
  if (wf === 'EXECUTING' || wf === 'APPROVED' || wf === 'CONTINUING' || wf === 'VERIFYING') {
    return ORCHESTRATION_CYCLE_STATUS.RECOVERING
  }
  if (wf === 'RECOVERED') {
    return ORCHESTRATION_CYCLE_STATUS.RECOVERING
  }
  if (wf === 'LLM_ERROR' || wf === 'REPLAN_REQUIRED') {
    return ORCHESTRATION_CYCLE_STATUS.PROCESSING
  }
  return ORCHESTRATION_CYCLE_STATUS.PROCESSING
}

/**
 * Next queued id that is still an active detection incident and not completed.
 */
export function nextQueuedIncidentId(detection, queueState = {}) {
  const queue = Array.isArray(queueState.orchestrationQueue)
    ? queueState.orchestrationQueue.map(String)
    : []
  const done = new Set(
    (Array.isArray(queueState.completedIncidentIds)
      ? queueState.completedIncidentIds
      : []
    ).map(String)
  )
  const current = queueState.currentIncidentId
    ? String(queueState.currentIncidentId)
    : null
  for (const id of queue) {
    if (done.has(id)) continue
    if (current && id === current) continue
    if (!findActiveById(detection, id)) continue
    return id
  }
  return null
}
