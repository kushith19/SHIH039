/**
 * Server-side response orchestration (STEP 2 + STEP 3 execute gate).
 * Plan generation + human approval + Response Agent execution entry.
 * Mutations go through executeResponseAction via responseAgent only.
 */

import {
  AGENT_SLOT_STATUS,
  ORCHESTRATION_CYCLE_STATUS,
  ORCHESTRATION_STATUS,
  PLAN_APPROVAL_STATUS,
  agentSlotsForStatus,
  canTransitionOrchestration,
  createEmptyOrchestrationState,
  normalizeOrchestrationCycleStatus,
  normalizeOrchestrationStatus,
} from '../../shared/response/orchestration.js'
import {
  cycleStatusForWorkflow,
  emptyOrchestrationQueueState,
  nextQueuedIncidentId,
  queueProgressView,
} from '../../shared/response/orchestrationQueue.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { INCIDENT_STATUS } from '../../shared/incidentIntel.js'
import { updateIncidentStatus } from '../metrics/incidents.js'
import { schedulePostAnalysisAfterRecovery } from '../postAnalysis/pipeline.js'
import { setNodeQuarantined } from './quarantineNode.js'
import {
  buildResponsePlan,
  fingerprintFromPlanAndContext,
  revalidatePlanAgainstContext,
  selectPrimaryIncidentForPlanWithReason,
  selectPrimaryIncidentForReplan,
} from '../../shared/response/responsePlan.js'
import {
  llmResponsePlanEnabled,
  recordLlmCommanderFinalPlan,
  recordLlmCommanderPlanningError,
  recordLlmCommanderSkipped,
  requestLlmCommanderActions,
} from './llmCommanderClient.js'
import { isActiveResponseIncident } from '../../shared/incidentStatus.js'
import {
  orderedExecutableSteps,
  runResponseAgent,
} from './responseAgent.js'
import {
  captureVerificationBaseline,
  capturePostExecutionDetection,
  isStepVerified,
  verifyResponseStep,
} from './recoveryAgent.js'
import {
  buildApprovalScope,
  hasRemainingResponseWork,
} from '../../shared/response/approvalScope.js'
import {
  buildOrchestrationGroups,
  logOrchestrationGroupCompleted,
  logOrchestrationGroupStarting,
  logOrchestrationGroups,
  resolveOrchestrationGroupMode,
  ORCHESTRATION_GROUP_MODES,
} from '../../shared/response/orchestrationGroups.js'
import {
  clearOrchestrationLoopInFlight,
  isOrchestrationLoopInFlight,
  recordObservationalVerification,
  runOrchestrationContinuation,
} from './orchestrationLoop.js'
import {
  classifyPlanActions,
  logStatusTransition,
  pushWorkflowTrace,
  publicWorkflowTrace,
  latestIterationTrace,
} from './workflowTrace.js'

/** Prevent concurrent Response Agent runs per room+group. */
const executionInFlight = new Set()
/** Prevent overlapping queue advances (one Planner at a time per group). */
const queueAdvanceInFlight = new Set()

function orchestrationLockKey(roomOrId, groupId = null) {
  const roomId =
    typeof roomOrId === 'object' && roomOrId
      ? String(roomOrId.id ?? '').toUpperCase()
      : String(roomOrId ?? '').toUpperCase()
  if (!roomId) return ''
  const gid =
    groupId != null && String(groupId).trim()
      ? String(groupId).trim()
      : typeof roomOrId === 'object' && roomOrId?.responseOrchestration?.groupId
        ? String(roomOrId.responseOrchestration.groupId)
        : 'default'
  return `${roomId}::${gid}`
}

function clearAllOrchestrationLocks(room) {
  if (!room?.id) return
  const roomId = String(room.id).toUpperCase()
  executionInFlight.delete(roomId)
  queueAdvanceInFlight.delete(roomId)
  clearOrchestrationLoopInFlight(roomId)
  const keys = new Set(['default'])
  for (const gid of Object.keys(room.orchestrationGroupRuns || {})) keys.add(gid)
  if (room.responseOrchestration?.groupId) keys.add(String(room.responseOrchestration.groupId))
  for (const gid of keys) {
    const k = `${roomId}::${gid}`
    executionInFlight.delete(k)
    queueAdvanceInFlight.delete(k)
    clearOrchestrationLoopInFlight(k)
  }
}

export function isOrchestrationExecutionInFlight(roomId, groupId = null) {
  if (groupId != null) {
    return executionInFlight.has(orchestrationLockKey(roomId, groupId))
  }
  const id = String(roomId ?? '').toUpperCase()
  if (executionInFlight.has(id)) return true
  for (const k of executionInFlight) {
    if (k === id || k.startsWith(`${id}::`)) return true
  }
  return false
}

export { isOrchestrationLoopInFlight }

function shoutQueue(msg) {
  console.log(msg)
}

function groupIncidentAllowlist(room) {
  const queue = room?.responseOrchestration?.orchestrationQueue
  if (Array.isArray(queue) && queue.length > 0) return queue.map(String)
  return null
}

function ensureGroupRunStore(room) {
  if (!room.orchestrationGroupRuns || typeof room.orchestrationGroupRuns !== 'object') {
    room.orchestrationGroupRuns = {}
  }
  if (!Array.isArray(room.orchestrationGroupsMeta)) {
    room.orchestrationGroupsMeta = []
  }
  return room
}

/**
 * Room view that redirects responseOrchestration to one group run.
 * Enables parallel planning without shared-state races.
 */
export function roomViewForGroup(room, groupId) {
  ensureGroupRunStore(room)
  const gid = String(groupId)
  if (!room.orchestrationGroupRuns[gid]) {
    throw new Error(`Unknown orchestration group ${gid}`)
  }
  return new Proxy(room, {
    get(target, prop, receiver) {
      if (prop === 'responseOrchestration') {
        return target.orchestrationGroupRuns[gid]
      }
      return Reflect.get(target, prop, receiver)
    },
    set(target, prop, value, receiver) {
      if (prop === 'responseOrchestration') {
        target.orchestrationGroupRuns[gid] = value
        return true
      }
      return Reflect.set(target, prop, value, receiver)
    },
  })
}

export function focusOrchestrationGroup(room, groupId) {
  ensureRoomOrchestration(room)
  ensureGroupRunStore(room)
  const gid = String(groupId ?? '').trim()
  if (!gid || !room.orchestrationGroupRuns[gid]) {
    return {
      ok: false,
      statusCode: 404,
      message: `Orchestration group not found: ${gid || '(empty)'}`,
      orchestration: publicOrchestrationState(room),
    }
  }
  room.focusedGroupId = gid
  room.responseOrchestration = room.orchestrationGroupRuns[gid]
  room.responseOrchestration.focusedGroupId = gid
  room.responseOrchestration.orchestrationGroups = room.orchestrationGroupsMeta || []
  room.responseOrchestration.groupId = gid
  return {
    ok: true,
    focusedGroupId: gid,
    orchestration: publicOrchestrationState(room),
  }
}

/**
 * Change how incidents are grouped for the next Analyze cycle.
 * Modes: sector (city model, default) | none (all parallel) | link (edge/campaign rules).
 * Does not interrupt an in-flight group run — takes effect on next analyze / new cycle.
 */
export function setOrchestrationGroupMode(room, mode) {
  ensureRoomOrchestration(room)
  const next = resolveOrchestrationGroupMode(mode)
  room.orchestrationGroupMode = next
  return {
    ok: true,
    groupMode: next,
    modes: Object.values(ORCHESTRATION_GROUP_MODES),
    orchestration: publicOrchestrationState(room),
    message: `Group mode set to ${next} — applies on next Analyze`,
  }
}

function groupProgressSummaries(room) {
  ensureGroupRunStore(room)
  const meta = room.orchestrationGroupsMeta || []
  const runs = room.orchestrationGroupRuns || {}
  return meta.map((g) => {
    const run = runs[g.groupId] || null
    const status = normalizeOrchestrationStatus(run?.workflowStatus ?? run?.status)
    const cycle = normalizeOrchestrationCycleStatus(run?.orchestrationCycleStatus)
    return {
      groupId: g.groupId,
      index: g.index,
      label: g.label,
      reason: g.reason,
      incidentIds: g.incidentIds,
      labels: g.labels,
      workflowStatus: status,
      orchestrationCycleStatus: cycle,
      currentIncidentId: run?.currentIncidentId ?? g.incidentIds?.[0] ?? null,
      completedIncidentIds: Array.isArray(run?.completedIncidentIds)
        ? run.completedIncidentIds.map(String)
        : [],
      queueTotal: Array.isArray(g.incidentIds) ? g.incidentIds.length : 0,
      focused: room.focusedGroupId === g.groupId,
    }
  })
}

function allGroupCyclesCompleted(room) {
  ensureGroupRunStore(room)
  const meta = room.orchestrationGroupsMeta || []
  if (!meta.length) return false
  const runs = room.orchestrationGroupRuns || {}
  return meta.every((g) => {
    const cycle = normalizeOrchestrationCycleStatus(
      runs[g.groupId]?.orchestrationCycleStatus
    )
    return cycle === ORCHESTRATION_CYCLE_STATUS.COMPLETED
  })
}

function readQueueState(state) {
  return {
    orchestrationQueue: Array.isArray(state?.orchestrationQueue)
      ? state.orchestrationQueue.map(String)
      : [],
    currentIncidentId: state?.currentIncidentId ?? null,
    completedIncidentIds: Array.isArray(state?.completedIncidentIds)
      ? state.completedIncidentIds.map(String)
      : [],
    orchestrationCycleStatus: normalizeOrchestrationCycleStatus(
      state?.orchestrationCycleStatus
    ),
  }
}

function writeQueueFields(room, patch, { source = 'queue' } = {}) {
  const prev = ensureRoomOrchestration(room)
  const next = {
    ...readQueueState(prev),
    ...patch,
  }
  next.orchestrationCycleStatus = normalizeOrchestrationCycleStatus(
    next.orchestrationCycleStatus
  )
  writeState(
    room,
    {
      orchestrationQueue: next.orchestrationQueue,
      currentIncidentId: next.currentIncidentId,
      completedIncidentIds: next.completedIncidentIds,
      orchestrationCycleStatus: next.orchestrationCycleStatus,
      updatedAtMs: Date.now(),
    },
    { source }
  )
  return readQueueState(room.responseOrchestration)
}

/**
 * Begin parallel orchestration groups when Analyze starts a new cycle.
 * Each group gets its own sequential incident queue; independent groups may
 * run concurrently. Does not invoke Planner — only records group runs.
 */
export function beginOrchestrationCycleQueue(room, { focusIncidentId = null } = {}) {
  ensureRoomOrchestration(room)
  ensureGroupRunStore(room)

  const meta = room.orchestrationGroupsMeta || []
  const anyRunning = meta.some((g) => {
    const run = room.orchestrationGroupRuns?.[g.groupId]
    const cycle = normalizeOrchestrationCycleStatus(run?.orchestrationCycleStatus)
    return (
      Array.isArray(run?.orchestrationQueue) &&
      run.orchestrationQueue.length > 0 &&
      cycle !== ORCHESTRATION_CYCLE_STATUS.IDLE &&
      cycle !== ORCHESTRATION_CYCLE_STATUS.COMPLETED
    )
  })

  if (anyRunning) {
    const focused =
      room.focusedGroupId ||
      meta.find((g) => g.incidentIds?.includes(String(focusIncidentId ?? '')))?.groupId ||
      meta[0]?.groupId ||
      null
    if (focused) focusOrchestrationGroup(room, focused)
    return {
      started: false,
      resumed: true,
      ...readQueueState(room.responseOrchestration),
      groups: groupProgressSummaries(room),
    }
  }

  const built = buildOrchestrationGroups({
    detection: room.detection,
    edges: room.edges,
    nodes: room.nodes,
    focusIncidentId,
    groupMode: room.orchestrationGroupMode ?? null,
  })
  logOrchestrationGroups(built)
  room.orchestrationGroupMode = built.groupMode

  if (!built.groups.length) {
    room.orchestrationGroupRuns = {}
    room.orchestrationGroupsMeta = []
    room.focusedGroupId = null
    writeQueueFields(room, emptyOrchestrationQueueState(), {
      source: 'beginOrchestrationCycleQueue:empty',
    })
    shoutQueue('[ORCHESTRATION QUEUE] cycle skipped total=0')
    return { started: false, resumed: false, ...emptyOrchestrationQueueState(), groups: [] }
  }

  const priorTrace = Array.isArray(room.responseOrchestration?.workflowTrace)
    ? room.responseOrchestration.workflowTrace
    : []
  const focusedGroupId = built.groups[0].groupId
  room.orchestrationGroupsMeta = built.groups
  room.orchestrationGroupRuns = {}
  room.focusedGroupId = focusedGroupId

  for (const g of built.groups) {
    room.orchestrationGroupRuns[g.groupId] = createEmptyOrchestrationState({
      workflowStatus: ORCHESTRATION_STATUS.IDLE,
      updatedAtMs: Date.now(),
      orchestrationQueue: g.incidentIds,
      currentIncidentId: g.incidentIds[0] ?? null,
      completedIncidentIds: [],
      orchestrationCycleStatus: ORCHESTRATION_CYCLE_STATUS.PROCESSING,
      groupId: g.groupId,
      focusedGroupId,
      orchestrationGroups: built.groups,
      workflowTrace: g.groupId === focusedGroupId ? priorTrace : [],
    })
  }

  focusOrchestrationGroup(room, focusedGroupId)

  const totalIncidents = built.groups.reduce((n, g) => n + g.incidentIds.length, 0)
  shoutQueue(
    `[ORCHESTRATION QUEUE] cycle started groups=${built.groups.length} incidents=${totalIncidents}`
  )
  for (const g of built.groups) {
    shoutQueue(
      `[ORCHESTRATION QUEUE] group=${g.groupId} queue=${g.incidentIds.join(',')} reason=${g.reason}`
    )
  }

  return {
    started: true,
    resumed: false,
    ...readQueueState(room.responseOrchestration),
    groups: groupProgressSummaries(room),
  }
}

function syncCycleStatusToWorkflow(room) {
  const state = ensureRoomOrchestration(room)
  const queue = readQueueState(state)
  if (!queue.orchestrationQueue.length) return queue
  if (queue.orchestrationCycleStatus === ORCHESTRATION_CYCLE_STATUS.COMPLETED) {
    return queue
  }
  const nextStatus = cycleStatusForWorkflow(state.workflowStatus ?? state.status, queue)
  if (nextStatus !== queue.orchestrationCycleStatus) {
    writeQueueFields(
      room,
      { orchestrationCycleStatus: nextStatus },
      { source: 'syncCycleStatusToWorkflow' }
    )
  }
  return readQueueState(room.responseOrchestration)
}

/**
 * After an incident reaches RECOVERED: mark complete and optionally start the next
 * incident in THIS group. Independent groups advance on their own timelines.
 */
export async function continueOrchestrationQueueAfterRecovery(
  room,
  {
    recoveredIncidentId = null,
    resolveContext = null,
    nowMs = Date.now(),
    onProgress = null,
  } = {}
) {
  ensureRoomOrchestration(room)
  const lockKey = orchestrationLockKey(room)
  if (lockKey && queueAdvanceInFlight.has(lockKey)) {
    return {
      ok: false,
      advanced: false,
      message: 'Orchestration queue advance already in progress',
      orchestration: publicOrchestrationState(room),
    }
  }
  if (lockKey) queueAdvanceInFlight.add(lockKey)

  try {
    const prev = readQueueState(room.responseOrchestration)
    if (!prev.orchestrationQueue.length) {
      return {
        ok: true,
        advanced: false,
        completed: false,
        orchestration: publicOrchestrationState(room),
      }
    }

    const recoveredId = String(
      recoveredIncidentId ||
        prev.currentIncidentId ||
        room.responseOrchestration?.plan?.primaryIncidentId ||
        ''
    ).trim()

    const completed = [...prev.completedIncidentIds]
    if (recoveredId && !completed.includes(recoveredId)) {
      completed.push(recoveredId)
    }

    writeQueueFields(
      room,
      {
        completedIncidentIds: completed,
        orchestrationCycleStatus: ORCHESTRATION_CYCLE_STATUS.RECOVERING,
      },
      { source: 'continueOrchestrationQueueAfterRecovery:complete' }
    )

    const nextId = nextQueuedIncidentId(room.detection, {
      ...prev,
      completedIncidentIds: completed,
      currentIncidentId: recoveredId || prev.currentIncidentId,
    })

    if (!nextId) {
      writeQueueFields(
        room,
        {
          currentIncidentId: null,
          completedIncidentIds: completed,
          orchestrationCycleStatus: ORCHESTRATION_CYCLE_STATUS.COMPLETED,
        },
        { source: 'continueOrchestrationQueueAfterRecovery:done' }
      )
      const groupMeta = (room.orchestrationGroupsMeta || []).find(
        (g) => g.groupId === room.responseOrchestration?.groupId
      )
      if (groupMeta) logOrchestrationGroupCompleted(groupMeta)
      else shoutQueue('[ORCHESTRATION QUEUE] cycle completed')

      if (allGroupCyclesCompleted(room)) {
        shoutQueue('[ORCHESTRATION] all groups completed')
      }

      if (typeof onProgress === 'function') onProgress(publicOrchestrationState(room))
      return {
        ok: true,
        advanced: false,
        completed: true,
        groupCompleted: true,
        allGroupsCompleted: allGroupCyclesCompleted(room),
        orchestration: publicOrchestrationState(room),
      }
    }

    const total = prev.orchestrationQueue.length
    const position = prev.orchestrationQueue.indexOf(nextId) + 1
    shoutQueue(
      `[ORCHESTRATION QUEUE] starting incident=${nextId} position=${position}/${total} group=${room.responseOrchestration?.groupId ?? 'default'}`
    )

    // Preserve queue + workflowTrace across RECOVERED → IDLE for the next incident.
    const preserved = {
      orchestrationQueue: prev.orchestrationQueue,
      completedIncidentIds: completed,
      currentIncidentId: nextId,
      orchestrationCycleStatus: ORCHESTRATION_CYCLE_STATUS.PROCESSING,
      groupId: room.responseOrchestration?.groupId ?? null,
      focusedGroupId: room.focusedGroupId ?? room.responseOrchestration?.focusedGroupId ?? null,
      orchestrationGroups: room.orchestrationGroupsMeta || room.responseOrchestration?.orchestrationGroups || [],
      workflowTrace: Array.isArray(room.responseOrchestration?.workflowTrace)
        ? room.responseOrchestration.workflowTrace
        : [],
    }

    const status = normalizeOrchestrationStatus(
      room.responseOrchestration.workflowStatus
    )
    if (status === ORCHESTRATION_STATUS.RECOVERED) {
      if (room.id) {
        executionInFlight.delete(orchestrationLockKey(room))
        clearOrchestrationLoopInFlight(orchestrationLockKey(room))
      }
      const nextState = createEmptyOrchestrationState({
        workflowStatus: ORCHESTRATION_STATUS.IDLE,
        updatedAtMs: nowMs,
        ...preserved,
      })
      room.responseOrchestration = nextState
      const gid = preserved.groupId
      if (gid && room.orchestrationGroupRuns) {
        room.orchestrationGroupRuns[gid] = nextState
      }
    } else {
      writeQueueFields(room, preserved, {
        source: 'continueOrchestrationQueueAfterRecovery:next',
      })
    }

    if (typeof onProgress === 'function') onProgress(publicOrchestrationState(room))

    const planned = await generateOrchestrationPlanMaybeLlm(room, {
      focusIncidentId: nextId,
      resolveContext,
      nowMs,
      _queueAdvance: true,
    })

    syncCycleStatusToWorkflow(room)
    if (typeof onProgress === 'function') onProgress(publicOrchestrationState(room))

    return {
      ok: planned.ok !== false,
      advanced: true,
      completed: false,
      nextIncidentId: nextId,
      statusCode: planned.statusCode,
      message: planned.message,
      orchestration: publicOrchestrationState(room),
    }
  } finally {
    if (lockKey) queueAdvanceInFlight.delete(lockKey)
  }
}

export { queueProgressView }

export function ensureRoomOrchestration(room) {
  if (!room || typeof room !== 'object') return null
  ensureGroupRunStore(room)
  if (!room.responseOrchestration || typeof room.responseOrchestration !== 'object') {
    room.responseOrchestration = createEmptyOrchestrationState({
      updatedAtMs: Date.now(),
    })
  }
  return room.responseOrchestration
}

export function resetRoomOrchestration(room) {
  if (!room || typeof room !== 'object') return null
  clearAllOrchestrationLocks(room)
  room.orchestrationGroupRuns = {}
  room.orchestrationGroupsMeta = []
  room.focusedGroupId = null
  room.responseOrchestration = createEmptyOrchestrationState({
    updatedAtMs: Date.now(),
  })
  return room.responseOrchestration
}

/** Public sync shape — no internal resolve helpers. */
export function publicOrchestrationState(room) {
  const state = ensureRoomOrchestration(room)
  const status = normalizeOrchestrationStatus(state.workflowStatus ?? state.status)
  const queue = readQueueState(state)
  const progress = queueProgressView(queue)
  const groups = groupProgressSummaries(room)
  return {
    status,
    workflowStatus: status,
    plan: state.plan ?? null,
    agents: state.agents ?? agentSlotsForStatus(status),
    lastUpdatedAt: state.lastUpdatedAt ?? state.updatedAtMs ?? null,
    updatedAtMs: state.updatedAtMs ?? state.lastUpdatedAt ?? null,
    approvedAtMs: state.approvedAtMs ?? null,
    fingerprint: state.fingerprint ?? null,
    stale: state.stale === true,
    staleReason: state.staleReason ?? null,
    execution: state.execution ?? null,
    verification: state.verification ?? null,
    verificationBaseline: state.verificationBaseline ?? null,
    /** Frozen post-execution detection for Recovery (not live telemetry) */
    postExecutionDetection: state.postExecutionDetection ?? null,
    previousPlanId: state.previousPlanId ?? null,
    replanCount: Number.isFinite(Number(state.replanCount))
      ? Math.max(0, Math.floor(Number(state.replanCount)))
      : 0,
    lastReplanReason: state.lastReplanReason ?? null,
    planHistory: Array.isArray(state.planHistory) ? state.planHistory : [],
    approvalScope: state.approvalScope ?? null,
    autoIteration: Number.isFinite(Number(state.autoIteration))
      ? Math.max(0, Math.floor(Number(state.autoIteration)))
      : 0,
    continuationReason: state.continuationReason ?? null,
    pausedForApprovalReason: state.pausedForApprovalReason ?? null,
    orchestrationQueue: queue.orchestrationQueue,
    currentIncidentId: queue.currentIncidentId,
    completedIncidentIds: queue.completedIncidentIds,
    orchestrationCycleStatus: queue.orchestrationCycleStatus,
    orchestrationProgress: progress,
    /** Parallel orchestration groups (focused run projected above). */
    orchestrationGroups: groups,
    focusedGroupId: room.focusedGroupId ?? state.focusedGroupId ?? null,
    groupId: state.groupId ?? null,
    parallelGroupCount: groups.length,
    groupMode:
      room.orchestrationGroupMode ??
      resolveOrchestrationGroupMode(null),
    groupModes: Object.values(ORCHESTRATION_GROUP_MODES),
    /** STEP 14 forensic workflow trace (latest iterations) */
    workflowTrace: publicWorkflowTrace(room),
    latestIterationTrace: latestIterationTrace(room),
  }
}

const PLAN_HISTORY_LIMIT = 5

function appendPlanHistory(prevHistory, entry) {
  const list = Array.isArray(prevHistory) ? [...prevHistory] : []
  list.push(entry)
  while (list.length > PLAN_HISTORY_LIMIT) list.shift()
  return list
}

function historyEntryFromPlan(plan, {
  outcome = null,
  verificationVerdict = null,
  atMs = Date.now(),
} = {}) {
  return {
    planId: plan?.planId ?? null,
    previousPlanId: plan?.previousPlanId ?? null,
    planKind: plan?.planKind ?? null,
    replanCount: Number(plan?.replanCount) || 0,
    continuationCount: Number(plan?.continuationContext?.continuationCount) || 0,
    primaryIncidentId: plan?.primaryIncidentId ?? null,
    executableActionIds: (plan?.recommendedActions ?? [])
      .filter((a) => a?.executable)
      .map((a) => a.actionId),
    targets: Array.isArray(plan?.affectedNodeIds) ? [...plan.affectedNodeIds] : [],
    verificationVerdict: verificationVerdict ?? null,
    outcome,
    createdAt: plan?.createdAt ?? atMs,
    recordedAt: atMs,
  }
}

/**
 * Authoritative write. Rejects illegal status transitions unless forceReplace.
 * Same-status writes are always allowed (progress fields / plan updates).
 */
function writeState(room, patch, { forceReplace = false, source = 'writeState' } = {}) {
  const prev = ensureRoomOrchestration(room)
  const from = normalizeOrchestrationStatus(prev.workflowStatus ?? prev.status)
  const workflowStatus = normalizeOrchestrationStatus(
    patch.workflowStatus ?? patch.status ?? prev.workflowStatus
  )
  if (!forceReplace && workflowStatus !== from) {
    if (!canTransitionOrchestration(from, workflowStatus)) {
      const err = new Error(
        `Invalid orchestration transition ${from} → ${workflowStatus}`
      )
      err.code = 'INVALID_ORCHESTRATION_TRANSITION'
      err.from = from
      err.to = workflowStatus
      throw err
    }
  }
  const now = Number.isFinite(Number(patch.updatedAtMs))
    ? Number(patch.updatedAtMs)
    : Date.now()
  if (workflowStatus !== from) {
    logStatusTransition(room, {
      previousStatus: from,
      newStatus: workflowStatus,
      reason:
        patch.continuationReason ??
        patch.lastReplanReason ??
        patch.staleReason ??
        patch.pausedForApprovalReason ??
        null,
      planId: (patch.plan ?? prev.plan)?.planId ?? null,
      primaryIncidentId:
        (patch.plan ?? prev.plan)?.primaryIncidentId ??
        patch.currentIncidentId ??
        prev.currentIncidentId ??
        null,
      iteration: patch.autoIteration ?? prev.autoIteration ?? 0,
      source,
    })
    if (
      workflowStatus === ORCHESTRATION_STATUS.REPLAN_REQUIRED ||
      process.env.ORCHESTRATION_DEBUG === '1' ||
      process.env.ORCHESTRATION_DEBUG === 'true'
    ) {
      console.info(
        '[ORCHESTRATION TRANSITION]',
        JSON.stringify({
          previousStatus: from,
          newStatus: workflowStatus,
          reason:
            patch.continuationReason ??
            patch.lastReplanReason ??
            patch.staleReason ??
            null,
          planId: (patch.plan ?? prev.plan)?.planId ?? null,
          iteration: patch.autoIteration ?? prev.autoIteration ?? 0,
          source,
        })
      )
    }
  }
  room.responseOrchestration = {
    ...prev,
    ...patch,
    workflowStatus,
    status: workflowStatus,
    agents: patch.agents ?? agentSlotsForStatus(workflowStatus),
    updatedAtMs: now,
    lastUpdatedAt: now,
  }
  const gid = room.responseOrchestration.groupId
  if (gid && room.orchestrationGroupRuns && typeof room.orchestrationGroupRuns === 'object') {
    room.orchestrationGroupRuns[String(gid)] = room.responseOrchestration
  }
  return room.responseOrchestration
}

/**
 * STEP 15 — sole writer of REPLAN_REQUIRED.
 * Every transition into (or remaining on) REPLAN_REQUIRED must pass through here
 * with an explicit source + genuine reason. No hidden telemetry path.
 */
export function setReplanRequired(
  room,
  {
    reason = 'Replan required',
    source = 'setReplanRequired',
    execution = undefined,
    plan = undefined,
    patch = {},
  } = {}
) {
  const prev = ensureRoomOrchestration(room)
  const previousStatus = normalizeOrchestrationStatus(
    prev.workflowStatus ?? prev.status
  )
  const nextPlan =
    plan !== undefined
      ? plan
      : prev.plan
        ? {
            ...prev.plan,
            approvalStatus:
              prev.plan.approvalStatus === PLAN_APPROVAL_STATUS.APPROVED
                ? PLAN_APPROVAL_STATUS.APPROVED
                : PLAN_APPROVAL_STATUS.REJECTED,
          }
        : null

  const entry = {
    kind: 'replan_required',
    timestamp: new Date().toISOString(),
    atMs: Date.now(),
    source,
    previousStatus,
    reason: reason || 'Replan required',
    planId: nextPlan?.planId ?? prev.plan?.planId ?? null,
    autoIteration: Number(prev.autoIteration) || 0,
  }
  pushWorkflowTrace(room, entry)
  console.info('[REPLAN_REQUIRED]', JSON.stringify(entry))

  return writeState(
    room,
    {
      workflowStatus: ORCHESTRATION_STATUS.REPLAN_REQUIRED,
      plan: nextPlan,
      stale: true,
      staleReason: reason || 'Replan required',
      lastReplanReason: reason || 'Replan required',
      continuationReason:
        patch.continuationReason ??
        (previousStatus === ORCHESTRATION_STATUS.EXECUTING
          ? 'execution_failed'
          : prev.continuationReason),
      ...(execution !== undefined ? { execution } : {}),
      ...patch,
    },
    { source }
  )
}

/** @deprecated use setReplanRequired */
function markReplanRequired(room, reason, execution = undefined) {
  return setReplanRequired(room, {
    reason,
    source: 'markReplanRequired',
    execution,
  })
}

/**
 * Intentional new cycle after RECOVERED.
 * Clears plan, approval, execution, verification, and lineage so unrelated
 * cycles are not connected. Never executes.
 */
export function startNewOrchestrationCycle(room, { nowMs = Date.now() } = {}) {
  ensureRoomOrchestration(room)
  const current = normalizeOrchestrationStatus(
    room.responseOrchestration.workflowStatus
  )
  if (current !== ORCHESTRATION_STATUS.RECOVERED) {
    return {
      ok: false,
      statusCode: 409,
      message: `New cycle requires RECOVERED status (status=${current})`,
      orchestration: publicOrchestrationState(room),
    }
  }
  if (!canTransitionOrchestration(current, ORCHESTRATION_STATUS.IDLE)) {
    return {
      ok: false,
      statusCode: 409,
      message: `Invalid orchestration transition ${current} → IDLE`,
      orchestration: publicOrchestrationState(room),
    }
  }
  if (room.id) {
    clearAllOrchestrationLocks(room)
  }
  const priorTrace = Array.isArray(room.responseOrchestration?.workflowTrace)
    ? room.responseOrchestration.workflowTrace
    : []
  room.orchestrationGroupRuns = {}
  room.orchestrationGroupsMeta = []
  room.focusedGroupId = null
  room.responseOrchestration = createEmptyOrchestrationState({
    workflowStatus: ORCHESTRATION_STATUS.IDLE,
    updatedAtMs: nowMs,
    workflowTrace: priorTrace,
  })
  return {
    ok: true,
    orchestration: publicOrchestrationState(room),
    executed: false,
  }
}

/**
 * Telemetry may refresh detection anytime, but must NEVER write REPLAN_REQUIRED
 * (STEP 16). Pre-approval pending plans may be marked stale for approve rejection;
 * mid-episode / approved-scope states are never interrupted by freshness.
 */
export function refreshOrchestrationFreshness(room, resolveContext) {
  const state = ensureRoomOrchestration(room)
  const status = normalizeOrchestrationStatus(state.workflowStatus)

  // In-flight / terminal / mid-episode — detection may update; workflow must not.
  if (
    status === ORCHESTRATION_STATUS.APPROVED ||
    status === ORCHESTRATION_STATUS.EXECUTING ||
    status === ORCHESTRATION_STATUS.CONTINUING ||
    status === ORCHESTRATION_STATUS.VERIFYING ||
    status === ORCHESTRATION_STATUS.ANALYZING ||
    status === ORCHESTRATION_STATUS.RECOVERED ||
    status === ORCHESTRATION_STATUS.REPLAN_REQUIRED ||
    status === ORCHESTRATION_STATUS.IDLE
  ) {
    return state
  }

  if (
    status !== ORCHESTRATION_STATUS.AWAITING_APPROVAL &&
    status !== ORCHESTRATION_STATUS.PLAN_READY
  ) {
    return state
  }

  // Episode already human-authorized — freshness never invents REPLAN or stale-plan gates.
  if (state.approvalScope != null) {
    return state
  }

  const pauseReason = String(state.continuationReason || '')
  if (
    pauseReason === 'planning_failed' ||
    pauseReason === 'max_iterations' ||
    pauseReason === 'scope_expansion' ||
    pauseReason === 'scope_missing' ||
    pauseReason === 'remaining_incidents' ||
    pauseReason === 'step_verified' ||
    pauseReason === 'auto_approved_within_scope' ||
    pauseReason === 'pacing_commander_continuation'
  ) {
    return state
  }

  const plan = state.plan
  if (!plan?.primaryIncidentId) return state

  const context =
    typeof resolveContext === 'function'
      ? resolveContext(room, room.id, plan.primaryIncidentId)
      : null
  if (!context) {
    // Observational stale flag only — never REPLAN_REQUIRED
    return writeState(room, {
      stale: true,
      staleReason: 'Primary incident context unavailable',
      updatedAtMs: Date.now(),
    }, { source: 'refreshOrchestrationFreshness:no_context' })
  }

  const liveFp = fingerprintFromPlanAndContext(plan, context, room.detection)
  if (state.fingerprint && liveFp !== state.fingerprint) {
    return writeState(room, {
      stale: true,
      staleReason: 'Incidents or policy changed since plan was created',
      updatedAtMs: Date.now(),
    }, { source: 'refreshOrchestrationFreshness:fingerprint' })
  }

  const reval = revalidatePlanAgainstContext(plan, context, room.detection)
  if (!reval.ok) {
    return writeState(room, {
      stale: true,
      staleReason: reval.reason || 'Policy revalidation failed',
      updatedAtMs: Date.now(),
    }, { source: 'refreshOrchestrationFreshness:revalidate' })
  }

  if (state.stale === true) {
    return writeState(room, {
      stale: false,
      staleReason: null,
      updatedAtMs: Date.now(),
    }, { source: 'refreshOrchestrationFreshness:clear' })
  }

  return state
}

/**
 * IDLE → ANALYZING → PLAN_READY → AWAITING_APPROVAL (when executable actions exist).
 * Never mutates quarantine / attacks / incidents.
 * REPLAN_REQUIRED must use replanOrchestrationPlan (preserves verification lineage).
 */
export function generateOrchestrationPlan(room, {
  focusIncidentId = null,
  resolveContext,
  nowMs = Date.now(),
  /** Server-validated LLM action IDs only — never trust client body */
  selectedActionIds = null,
  /** Internal: queue already started / advancing — do not rebuild */
  _queueAdvance = false,
  /** Internal: PLANNER_STARTED already recorded (LLM path before Ollama) */
  _plannerStarted = false,
  /** Internal: member of parallel group bootstrap */
  _parallelMember = false,
} = {}) {
  ensureRoomOrchestration(room)
  if (_queueAdvance !== true && _parallelMember !== true) {
    beginOrchestrationCycleQueue(room, { focusIncidentId })
    const groups = room.orchestrationGroupsMeta || []
    if (groups.length > 1) {
      const focusedId = room.focusedGroupId || groups[0].groupId
      for (const g of groups) {
        logOrchestrationGroupStarting(g)
        const view = roomViewForGroup(room, g.groupId)
        generateOrchestrationPlan(view, {
          focusIncidentId: g.incidentIds[0] ?? null,
          resolveContext,
          nowMs,
          selectedActionIds: null,
          _queueAdvance: true,
          _parallelMember: true,
          _plannerStarted: false,
        })
      }
      focusOrchestrationGroup(room, focusedId)
      return {
        ok: true,
        orchestration: publicOrchestrationState(room),
        executed: false,
        parallelGroupsStarted: groups.length,
      }
    }
    if (groups.length === 1) {
      logOrchestrationGroupStarting(groups[0])
    }
  }
  const queueSnap = readQueueState(room.responseOrchestration)
  const effectiveFocus =
    focusIncidentId || queueSnap.currentIncidentId || null
  if (
    effectiveFocus &&
    queueSnap.orchestrationQueue.length > 0 &&
    queueSnap.currentIncidentId !== effectiveFocus
  ) {
    writeQueueFields(
      room,
      {
        currentIncidentId: effectiveFocus,
        orchestrationCycleStatus: ORCHESTRATION_CYCLE_STATUS.PROCESSING,
      },
      { source: 'generateOrchestrationPlan:current' }
    )
  }

  const current = normalizeOrchestrationStatus(room.responseOrchestration.workflowStatus)

  if (current === ORCHESTRATION_STATUS.REPLAN_REQUIRED) {
    return {
      ok: false,
      statusCode: 409,
      message:
        'Verification failed — use replan to run Commander re-analysis (preserves prior plan context)',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  if (current === ORCHESTRATION_STATUS.RECOVERED) {
    return {
      ok: false,
      statusCode: 409,
      message:
        'Response cycle recovered — start a new cycle before analyzing again',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  if (current === ORCHESTRATION_STATUS.APPROVED) {
    return {
      ok: false,
      statusCode: 409,
      message: 'An approved plan already exists — execute it or reset the match',
    }
  }
  if (
    current === ORCHESTRATION_STATUS.EXECUTING ||
    current === ORCHESTRATION_STATUS.CONTINUING ||
    current === ORCHESTRATION_STATUS.VERIFYING
  ) {
    return {
      ok: false,
      statusCode: 409,
      message: 'Orchestration is past approval — cannot regenerate now',
    }
  }

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
    plan: null,
    fingerprint: null,
    stale: false,
    staleReason: null,
    approvedAtMs: null,
    execution: null,
    verificationBaseline: null,
    verification: null,
    previousPlanId: null,
    replanCount: 0,
    lastReplanReason: null,
    planHistory: [],
    approvalScope: null,
    autoIteration: 0,
    continuationReason: null,
    pausedForApprovalReason: null,
    updatedAtMs: nowMs,
  })

  const detection = room.detection ?? null
  const selected = selectPrimaryIncidentForPlanWithReason(
    detection,
    effectiveFocus
  )
  const contextIncidentId =
    selected.incident?.persistentId || selected.incident?.id || null

  if (!contextIncidentId) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.IDLE,
      plan: null,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 404,
      message: 'No open incident available for planning',
    }
  }

  if (
    queueSnap.orchestrationQueue.length > 0 &&
    String(room.responseOrchestration.currentIncidentId ?? '') !==
      String(contextIncidentId)
  ) {
    writeQueueFields(
      room,
      { currentIncidentId: String(contextIncidentId) },
      { source: 'generateOrchestrationPlan:bind' }
    )
  }

  if (_plannerStarted !== true) {
    pushWorkflowTrace(room, {
      kind: 'agent_loop',
      phase: 'PLANNER_STARTED',
      primaryIncidentId: contextIncidentId,
      atMs: nowMs,
    })
  }

  if (typeof resolveContext !== 'function') {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.IDLE,
      plan: null,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 500,
      message: 'Context resolver unavailable',
    }
  }

  const context = resolveContext(room, room.id, contextIncidentId)
  if (!context) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.IDLE,
      plan: null,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 404,
      message: 'Incident context not found',
    }
  }

  const built = buildResponsePlan({
    detection,
    context,
    focusIncidentId: contextIncidentId,
    nowMs,
    selectedActionIds,
  })

  if (!built.ok || !built.plan) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.IDLE,
      plan: null,
      updatedAtMs: nowMs,
    })
    return {
      ok: false,
      statusCode: 400,
      message: built.message || 'Failed to build response plan',
    }
  }

  const planReady = {
    ...built.plan,
    commanderStatus: AGENT_SLOT_STATUS.READY,
    approvalStatus:
      built.executableCount > 0
        ? PLAN_APPROVAL_STATUS.PENDING
        : PLAN_APPROVAL_STATUS.NONE,
  }

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.PLAN_READY,
    plan: planReady,
    fingerprint: built.fingerprint,
    stale: false,
    staleReason: null,
    approvedAtMs: null,
    execution: null,
    updatedAtMs: nowMs,
  })

  pushWorkflowTrace(room, {
    kind: 'agent_loop',
    phase: 'COMMANDER_PLAN',
    planId: planReady.planId,
    primaryIncidentId: planReady.primaryIncidentId,
    planSource: planReady.planSource ?? null,
    target: planReady.affectedNodeIds?.[0] ?? null,
    atMs: nowMs,
  })

  if (built.executableCount > 0 && planReady.policyStatus === 'ALLOWED') {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
      plan: planReady,
      fingerprint: built.fingerprint,
      stale: false,
      updatedAtMs: nowMs,
    })
  }

  syncCycleStatusToWorkflow(room)

  return {
    ok: true,
    orchestration: publicOrchestrationState(room),
    executed: false,
    executedActions: [],
  }
}

/**
 * LLM-assisted analyze when LLM_RESPONSE_PLAN=1; otherwise deterministic.
 * On LLM failure: clear planning error — never invent actions or execute.
 */
function shoutLlm(msg) {
  console.log(msg)
}

function selectActiveIncidentForAnalyze(detection, focusIncidentId = null) {
  const selected = selectPrimaryIncidentForPlanWithReason(
    detection,
    focusIncidentId
  )
  const incident = selected.incident
  if (!incident) {
    shoutLlm('[LLM COMMANDER] SKIPPED_NO_ACTIVE_INCIDENT')
    return selected
  }
  const id = incident.persistentId || incident.id || null
  shoutLlm('[PLANNER] INCIDENT_SELECTED')
  shoutLlm(`incidentId=${id}`)
  shoutLlm(
    `[LLM COMMANDER] SELECTED INCIDENT: ${id} status=${incident.status ?? 'open'} reason=${selected.reason}`
  )
  return selected
}

export async function generateOrchestrationPlanMaybeLlm(room, opts = {}) {
  if (!llmResponsePlanEnabled()) {
    shoutLlm(
      '[LLM COMMANDER] LLM_RESPONSE_PLAN is OFF — deterministic plan only (no Ollama plan call)'
    )
    return generateOrchestrationPlan(room, opts)
  }

  const {
    focusIncidentId = null,
    resolveContext,
    nowMs = Date.now(),
    _queueAdvance = false,
    _parallelMember = false,
  } = opts

  shoutLlm(`[LLM ANALYZE] room=${room?.id ?? ''} focus=${focusIncidentId ?? ''}`)

  ensureRoomOrchestration(room)
  if (_queueAdvance !== true && _parallelMember !== true) {
    beginOrchestrationCycleQueue(room, { focusIncidentId })
    const groups = room.orchestrationGroupsMeta || []
    if (groups.length > 1) {
      const focusedId = room.focusedGroupId || groups[0].groupId
      await Promise.all(
        groups.map(async (g) => {
          logOrchestrationGroupStarting(g)
          const view = roomViewForGroup(room, g.groupId)
          return generateOrchestrationPlanMaybeLlm(view, {
            ...opts,
            focusIncidentId: g.incidentIds[0] ?? null,
            _queueAdvance: true,
            _parallelMember: true,
          })
        })
      )
      focusOrchestrationGroup(room, focusedId)
      return {
        ok: true,
        orchestration: publicOrchestrationState(room),
        executed: false,
        parallelGroupsStarted: groups.length,
      }
    }
    if (groups.length === 1) {
      logOrchestrationGroupStarting(groups[0])
    }
  }
  const queueSnap = readQueueState(room.responseOrchestration)
  const effectiveFocus =
    focusIncidentId || queueSnap.currentIncidentId || null

  let current = normalizeOrchestrationStatus(room.responseOrchestration.workflowStatus)
  if (current === ORCHESTRATION_STATUS.RECOVERED) {
    const reset = startNewOrchestrationCycle(room, { nowMs })
    if (reset.ok === false) {
      shoutLlm(`[LLM ANALYZE] result=WORKFLOW_BLOCKED status=${current}`)
      return {
        ok: false,
        statusCode: reset.statusCode ?? 409,
        message: reset.message || 'Orchestration status blocks Analyze (RECOVERED)',
        orchestration: publicOrchestrationState(room),
        executed: false,
      }
    }
    // New explicit Analyze after RECOVERED — rebuild queue for remaining actives.
    beginOrchestrationCycleQueue(room, { focusIncidentId: effectiveFocus })
    current = ORCHESTRATION_STATUS.IDLE
  }

  if (
    current === ORCHESTRATION_STATUS.ANALYZING ||
    current === ORCHESTRATION_STATUS.REPLAN_REQUIRED ||
    current === ORCHESTRATION_STATUS.APPROVED ||
    current === ORCHESTRATION_STATUS.EXECUTING ||
    current === ORCHESTRATION_STATUS.CONTINUING ||
    current === ORCHESTRATION_STATUS.VERIFYING
  ) {
    shoutLlm(`[LLM ANALYZE] result=WORKFLOW_BLOCKED status=${current}`)
    const message = `Orchestration status blocks Analyze (${current})`
    recordLlmCommanderSkipped(message, {
      code: 'WORKFLOW_BLOCKED',
    })
    return {
      ok: false,
      statusCode: 409,
      message,
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
    plan: null,
    fingerprint: null,
    stale: false,
    staleReason: null,
    approvedAtMs: null,
    execution: null,
    verificationBaseline: null,
    verification: null,
    previousPlanId: null,
    replanCount: 0,
    lastReplanReason: null,
    planHistory: [],
    approvalScope: null,
    autoIteration: 0,
    continuationReason: null,
    pausedForApprovalReason: null,
    updatedAtMs: nowMs,
  })

  const detection = room.detection ?? null
  let selected
  if (effectiveFocus) {
    selected = selectActiveIncidentForAnalyze(detection, effectiveFocus)
    if (!selected.focusOverride || !selected.incident) {
      writeState(room, {
        workflowStatus: ORCHESTRATION_STATUS.IDLE,
        plan: null,
        updatedAtMs: nowMs,
      })
      const message = 'Selected incident is not an active planning target'
      shoutLlm(`[LLM ANALYZE] result=INCIDENT_NOT_SELECTED ${message}`)
      recordLlmCommanderSkipped(message, {
        incidentId: effectiveFocus,
        code: 'INCIDENT_NOT_SELECTED',
      })
      return {
        ok: false,
        statusCode: 404,
        message,
        orchestration: publicOrchestrationState(room),
        executed: false,
      }
    }
  } else {
    selected = selectActiveIncidentForAnalyze(detection, null)
  }
  const contextIncidentId =
    selected.incident?.persistentId || selected.incident?.id || null

  if (
    contextIncidentId &&
    readQueueState(room.responseOrchestration).orchestrationQueue.length > 0
  ) {
    writeQueueFields(
      room,
      {
        currentIncidentId: String(contextIncidentId),
        orchestrationCycleStatus: ORCHESTRATION_CYCLE_STATUS.PROCESSING,
      },
      { source: 'generateOrchestrationPlanMaybeLlm:bind' }
    )
  }

  if (!contextIncidentId || typeof resolveContext !== 'function') {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.IDLE,
      plan: null,
      updatedAtMs: nowMs,
    })
    const message = contextIncidentId
      ? 'Context resolver unavailable'
      : 'No active incident available for planning'
    shoutLlm(
      `[LLM ANALYZE] result=${contextIncidentId ? 'NO_CONTEXT' : 'NO_ACTIVE_INCIDENT'} ${message}`
    )
    recordLlmCommanderSkipped(message, {
      incidentId: contextIncidentId,
      code: contextIncidentId ? 'NO_CONTEXT' : 'NO_ACTIVE_INCIDENT',
    })
    return {
      ok: false,
      statusCode: contextIncidentId ? 500 : 404,
      message,
    }
  }

  pushWorkflowTrace(room, {
    kind: 'agent_loop',
    phase: 'PLANNER_STARTED',
    primaryIncidentId: contextIncidentId,
    atMs: nowMs,
  })

  const context = resolveContext(room, room.id, contextIncidentId)
  if (!context) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.IDLE,
      plan: null,
      updatedAtMs: nowMs,
    })
    shoutLlm('[LLM ANALYZE] result=NO_CONTEXT Incident context not found')
    recordLlmCommanderSkipped('Incident context not found', {
      incidentId: contextIncidentId,
      code: 'NO_CONTEXT',
    })
    return {
      ok: false,
      statusCode: 404,
      message: 'Incident context not found',
    }
  }

  const attackHint =
    room?.hackSimulator?.nodePresetIds?.[selected.incident?.endpointId] ?? null
  shoutLlm(
    `[LLM ANALYZE] incident=${contextIncidentId} attackPreset=${attackHint ?? ''} result=LLM_INVOCATION`
  )
  shoutLlm(`[LLM REQUEST] incident=${contextIncidentId}`)

  const llm = await requestLlmCommanderActions(context, { room })
  if (!llm.ok) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.LLM_ERROR,
      plan: null,
      continuationReason: 'planning_failed',
      pausedForApprovalReason: llm.error || 'LLM Commander planning failed',
      updatedAtMs: nowMs,
    })
    syncCycleStatusToWorkflow(room)
    shoutLlm(
      `[LLM COMMANDER] LLM FAILED: ${llm.error || llm.code || 'unknown'}`
    )
    return {
      ok: false,
      statusCode: 422,
      message: `LLM Commander planning failed: ${llm.error || llm.code || 'unknown'}`,
      code: llm.code ?? 'LLM_PLAN_FAILED',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  shoutLlm(
    `[LLM COMMANDER PLAN] actions=${JSON.stringify(llm.actions)} summary=${JSON.stringify(llm.summary ?? null)}`
  )

  // Reset to IDLE so generateOrchestrationPlan can transition ANALYZING cleanly
  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.IDLE,
    plan: null,
    updatedAtMs: nowMs,
  })

  const built = generateOrchestrationPlan(room, {
    ...opts,
    focusIncidentId: contextIncidentId,
    selectedActionIds: llm.actions,
    nowMs,
    _queueAdvance: true,
    _plannerStarted: true,
  })

  // Separate merged LLM fields: summary/notes enrich reasoning only (never execute)
  if (built?.ok && room.responseOrchestration?.plan) {
    const plan = room.responseOrchestration.plan
    const parts = []
    if (llm.summary) parts.push(llm.summary)
    if (llm.uncertainty) parts.push(`Uncertainty: ${llm.uncertainty}`)
    if (plan.reasoning) parts.push(plan.reasoning)
    plan.reasoning = parts.join(' · ') || plan.reasoning
    plan.llmSummary = llm.summary ?? null
    plan.attackInterpretation = llm.attackInterpretation ?? null
    plan.llmReview = llm.review ?? null
    plan.strategy = llm.strategy ?? null
    plan.riskAssessment = llm.riskAssessment ?? null
    plan.llmConfidence = llm.confidence ?? null
    plan.llmUncertainty = llm.uncertainty ?? null
    plan.llmActions = llm.actions
    recordLlmCommanderFinalPlan(plan)
    shoutLlm('[PLANNER] PLAN_READY')
    shoutLlm(`incidentId=${contextIncidentId}`)
    shoutLlm(
      `actions=${JSON.stringify(
        (plan.recommendedActions ?? [])
          .filter((a) => a?.executable)
          .map((a) => a.actionId)
      )}`
    )
  } else {
    recordLlmCommanderPlanningError(
      built?.message || 'ResponsePlan assembly failed'
    )
  }

  return built
}

/**
 * LLM-assisted replan when LLM_RESPONSE_PLAN=1; otherwise deterministic.
 */
export async function replanOrchestrationPlanMaybeLlm(room, opts = {}) {
  if (!llmResponsePlanEnabled()) {
    return replanOrchestrationPlan(room, opts)
  }

  const { resolveContext, nowMs = Date.now() } = opts
  ensureRoomOrchestration(room)
  const prev = room.responseOrchestration
  const current = normalizeOrchestrationStatus(prev.workflowStatus)
  if (current !== ORCHESTRATION_STATUS.REPLAN_REQUIRED) {
    return {
      ok: false,
      statusCode: 409,
      message: `LLM replan requires REPLAN_REQUIRED status (current: ${current})`,
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  if (typeof resolveContext !== 'function') {
    recordLlmCommanderSkipped('Context resolver unavailable', {
      code: 'SKIPPED_CONTEXT_RESOLVER_UNAVAILABLE',
    })
    return {
      ok: false,
      statusCode: 500,
      message: 'Context resolver unavailable',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const detection = room.detection ?? null
  const adaptive = selectPrimaryIncidentForReplan(detection, {
    nodes: room.nodes ?? [],
    previousAffectedNodeIds: prev.plan?.affectedNodeIds ?? [],
    previousPrimaryIncidentId: prev.plan?.primaryIncidentId ?? null,
  })
  const contextIncidentId = adaptive?.persistentId || adaptive?.id || null
  if (!contextIncidentId) {
    recordLlmCommanderSkipped('No active incident available for replan', {
      code: 'SKIPPED_NO_ACTIVE_INCIDENT',
    })
    return {
      ok: false,
      statusCode: 404,
      message: 'No active incident available for replan',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const context = resolveContext(room, room.id, contextIncidentId)
  if (!context) {
    recordLlmCommanderSkipped('Incident context not found', {
      incidentId: contextIncidentId,
      code: 'SKIPPED_CONTEXT_NOT_FOUND',
    })
    return {
      ok: false,
      statusCode: 404,
      message: 'Incident context not found',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const llm = await requestLlmCommanderActions(context, {
    room,
    previousPlan: prev.plan ?? null,
    verification: prev.verification ?? null,
  })
  if (!llm.ok) {
    return {
      ok: false,
      statusCode: 422,
      message: `LLM Commander replan failed: ${llm.error || llm.code || 'unknown'}`,
      code: llm.code ?? 'LLM_PLAN_FAILED',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const built = replanOrchestrationPlan(room, {
    ...opts,
    selectedActionIds: llm.actions,
    nowMs,
  })
  if (built?.ok && room.responseOrchestration?.plan) {
    const plan = room.responseOrchestration.plan
    const parts = []
    if (llm.summary) parts.push(llm.summary)
    if (llm.uncertainty) parts.push(`Uncertainty: ${llm.uncertainty}`)
    if (plan.reasoning) parts.push(plan.reasoning)
    plan.reasoning = parts.join(' · ') || plan.reasoning
    plan.llmSummary = llm.summary ?? null
    plan.attackInterpretation = llm.attackInterpretation ?? null
    plan.strategy = llm.strategy ?? null
    plan.riskAssessment = llm.riskAssessment ?? null
    plan.llmConfidence = llm.confidence ?? null
    plan.llmUncertainty = llm.uncertainty ?? null
    plan.llmActions = llm.actions
    recordLlmCommanderFinalPlan(plan)
  } else {
    recordLlmCommanderPlanningError(
      built?.message || 'ResponsePlan replan assembly failed'
    )
  }
  return built
}

/**
 * STEP 5: Commander re-planning after failed verification.
 *
 * REPLAN_REQUIRED → ANALYZING → AWAITING_APPROVAL (or remain REPLAN_REQUIRED)
 *
 * Fresh detection / correlation / recovery / quarantine / Commander context.
 * Previous plan + verification are CONTEXT only — never authoritative.
 * Never executes, quarantines, restores, or auto-approves.
 */
export function replanOrchestrationPlan(room, {
  resolveContext,
  nowMs = Date.now(),
  /** Ignored — client cannot inject plan / actions / targets */
  clientActionIds = null,
  clientTargets = null,
  clientPlan = null,
  /** Server-validated LLM action IDs only */
  selectedActionIds = null,
} = {}) {
  ensureRoomOrchestration(room)

  if (clientActionIds != null || clientTargets != null || clientPlan != null) {
    // Explicit no-op: server state is the only authority
  }

  const prev = room.responseOrchestration
  const current = normalizeOrchestrationStatus(prev.workflowStatus)

  if (current !== ORCHESTRATION_STATUS.REPLAN_REQUIRED) {
    return {
      ok: false,
      statusCode: 409,
      message: `Re-plan requires REPLAN_REQUIRED status (status=${current})`,
      orchestration: publicOrchestrationState(room),
      executed: false,
      mutatedQuarantine: false,
      mutatedOverrides: false,
    }
  }

  const previousPlan = prev.plan
  const previousPlanId = previousPlan?.planId ?? prev.previousPlanId ?? null
  const previousVerification = prev.verification
  const previousExecution = prev.execution
  const nextReplanCount =
    (Number.isFinite(Number(prev.replanCount))
      ? Math.max(0, Math.floor(Number(prev.replanCount)))
      : 0) + 1

  const historySeed = previousPlan
    ? appendPlanHistory(
        prev.planHistory,
        historyEntryFromPlan(previousPlan, {
          outcome: 'verification_failed',
          verificationVerdict: previousVerification?.verdict ?? null,
          atMs: nowMs,
        })
      )
    : Array.isArray(prev.planHistory)
      ? [...prev.planHistory]
      : []

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
    plan: previousPlan,
    fingerprint: null,
    stale: false,
    staleReason: null,
    approvedAtMs: null,
    // Preserve verification + prior execution as evidence; new cycle clears active exec after plan
    execution: previousExecution,
    verification: previousVerification,
    verificationBaseline: prev.verificationBaseline,
    previousPlanId,
    replanCount: nextReplanCount,
    lastReplanReason: null,
    planHistory: historySeed,
    updatedAtMs: nowMs,
  })

  const detection = room.detection ?? null
  const openIncidents = (detection?.incidents ?? []).filter(isActiveResponseIncident)

  if (!openIncidents.length) {
    setReplanRequired(room, {
      reason:
        'Incident state stabilized externally — no open incidents for a new response plan',
      source: 'replanOrchestrationPlan:no_open',
      plan: previousPlan,
      execution: previousExecution,
      patch: {
        verification: previousVerification,
        verificationBaseline: prev.verificationBaseline,
        previousPlanId,
        replanCount: nextReplanCount,
        planHistory: historySeed,
        staleReason:
          'No open incidents available for re-planning; previous verification preserved',
      },
    })
    return {
      ok: false,
      statusCode: 409,
      message:
        'No open incidents available for re-planning. Previous verification evidence is preserved.',
      orchestration: publicOrchestrationState(room),
      executed: false,
      mutatedQuarantine: false,
      mutatedOverrides: false,
    }
  }

  if (typeof resolveContext !== 'function') {
    setReplanRequired(room, {
      reason: 'Context resolver unavailable',
      source: 'replanOrchestrationPlan:no_resolver',
      plan: previousPlan,
      patch: {
        previousPlanId,
        replanCount: nextReplanCount,
        planHistory: historySeed,
      },
    })
    return {
      ok: false,
      statusCode: 500,
      message: 'Context resolver unavailable',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const adaptivePrimary = selectPrimaryIncidentForReplan(detection, {
    nodes: room.nodes ?? [],
    previousAffectedNodeIds: previousPlan?.affectedNodeIds ?? [],
    previousPrimaryIncidentId: previousPlan?.primaryIncidentId ?? null,
  })
  const contextIncidentId =
    adaptivePrimary?.persistentId || adaptivePrimary?.id || null

  if (!contextIncidentId) {
    setReplanRequired(room, {
      reason: 'No suitable primary incident for re-planning',
      source: 'replanOrchestrationPlan:no_primary',
      plan: previousPlan,
      patch: {
        previousPlanId,
        replanCount: nextReplanCount,
        planHistory: historySeed,
      },
    })
    return {
      ok: false,
      statusCode: 404,
      message: 'No suitable primary incident for re-planning',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const context = resolveContext(room, room.id, contextIncidentId)
  if (!context) {
    setReplanRequired(room, {
      reason: 'Fresh Commander context unavailable',
      source: 'replanOrchestrationPlan:no_context',
      plan: previousPlan,
      patch: {
        previousPlanId,
        replanCount: nextReplanCount,
        planHistory: historySeed,
      },
    })
    return {
      ok: false,
      statusCode: 404,
      message: 'Fresh Commander context unavailable',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const built = buildResponsePlan({
    detection,
    context,
    focusIncidentId: contextIncidentId,
    nowMs,
    mode: 'replan',
    nodes: room.nodes ?? [],
    previousPlan,
    verification: previousVerification,
    previousPlanId,
    replanCount: nextReplanCount,
    selectedActionIds,
  })

  if (!built.ok || !built.plan) {
    setReplanRequired(room, {
      reason: built.message || 'Commander re-analysis failed',
      source: 'replanOrchestrationPlan:build_failed',
      plan: previousPlan,
      patch: {
        previousPlanId,
        replanCount: nextReplanCount,
        planHistory: historySeed,
      },
    })
    return {
      ok: false,
      statusCode: 400,
      message: built.message || 'Commander re-analysis failed',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  if (built.executableCount <= 0 || built.policyStatus !== 'ALLOWED') {
    setReplanRequired(room, {
      reason: 'No policy-approved response action is currently available',
      source: 'replanOrchestrationPlan:no_executable',
      plan: previousPlan,
      execution: previousExecution,
      patch: {
        previousPlanId,
        replanCount: nextReplanCount,
        planHistory: historySeed,
        verification: previousVerification,
        staleReason: 'No policy-approved response action is currently available',
      },
    })
    return {
      ok: false,
      statusCode: 409,
      message: 'No policy-approved response action is currently available',
      orchestration: publicOrchestrationState(room),
      executed: false,
      mutatedQuarantine: false,
      mutatedOverrides: false,
    }
  }

  const planReady = {
    ...built.plan,
    commanderStatus: AGENT_SLOT_STATUS.READY,
    approvalStatus: PLAN_APPROVAL_STATUS.PENDING,
  }

  const historyWithNew = appendPlanHistory(
    historySeed,
    historyEntryFromPlan(planReady, {
      outcome: 'awaiting_approval',
      verificationVerdict: null,
      atMs: nowMs,
    })
  )

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.AWAITING_APPROVAL,
    plan: planReady,
    fingerprint: built.fingerprint,
    stale: false,
    staleReason: null,
    approvedAtMs: null,
    // New plan cycle — clear active execution; keep verification as last evidence
    execution: null,
    verification: previousVerification,
    verificationBaseline: null,
    previousPlanId,
    replanCount: nextReplanCount,
    lastReplanReason:
      previousVerification?.primaryReason ||
      previousVerification?.failReasons?.[0] ||
      previousVerification?.reasons?.[0] ||
      'Additional response required after verification failure',
    planHistory: historyWithNew,
    updatedAtMs: nowMs,
  })

  return {
    ok: true,
    orchestration: publicOrchestrationState(room),
    executed: false,
    executedActions: [],
    mutatedQuarantine: false,
    mutatedOverrides: false,
    autoApproved: false,
  }
}

/**
 * Approve current plan. Revalidates policy + freshness.
 * Establishes approvalScope and, by default, starts the multi-incident agent loop
 * (execute → verify → continue within scope). Never lets the client inject actions.
 */
export function approveOrchestrationPlan(room, {
  resolveContext,
  nowMs = Date.now(),
  /** Ignored — present only to prove client action injection is rejected */
  clientActionIds = null,
  /** When true (default), start automatic continuation after approval */
  autoContinue = true,
  /** Stage delay for automatic loop (ms). Null = server default / env. */
  stepDelayMs = null,
  onProgress = null,
  onCompleteSync = null,
  /** Optional: focus a parallel orchestration group before approving */
  groupId = null,
} = {}) {
  ensureRoomOrchestration(room)
  if (groupId) {
    const focused = focusOrchestrationGroup(room, groupId)
    if (!focused.ok) return { ...focused, executed: false }
  }
  refreshOrchestrationFreshness(room, resolveContext)

  const state = room.responseOrchestration
  const status = normalizeOrchestrationStatus(state.workflowStatus)

  if (status === ORCHESTRATION_STATUS.REPLAN_REQUIRED) {
    return {
      ok: false,
      statusCode: 409,
      message: state.lastReplanReason || 'Replan required — run Commander re-analysis',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  if (
    status !== ORCHESTRATION_STATUS.AWAITING_APPROVAL &&
    status !== ORCHESTRATION_STATUS.PLAN_READY
  ) {
    return {
      ok: false,
      statusCode: 409,
      message: `Plan is not approval-ready (status=${status})`,
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const plan = state.plan
  if (!plan || !plan.planId) {
    return {
      ok: false,
      statusCode: 400,
      message: 'No plan to approve',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  if (clientActionIds != null) {
    // no-op — server plan is authoritative
  }

  if (typeof resolveContext !== 'function') {
    return {
      ok: false,
      statusCode: 500,
      message: 'Context resolver unavailable',
      executed: false,
    }
  }

  const context = resolveContext(room, room.id, plan.primaryIncidentId)
  if (!context) {
    writeState(room, {
      stale: true,
      staleReason: 'Primary incident context unavailable',
      updatedAtMs: Date.now(),
    })
    return {
      ok: false,
      statusCode: 409,
      message: 'Primary incident context unavailable — refresh analysis before approval',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const liveFp = fingerprintFromPlanAndContext(plan, context, room.detection)
  if (state.fingerprint && liveFp !== state.fingerprint) {
    writeState(room, {
      stale: true,
      staleReason: 'Incidents or policy changed since plan was created',
      updatedAtMs: Date.now(),
    })
    return {
      ok: false,
      statusCode: 409,
      message: 'Plan is stale — refresh Commander analysis before approval',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const reval = revalidatePlanAgainstContext(plan, context, room.detection)
  if (!reval.ok) {
    writeState(room, {
      stale: true,
      staleReason: reval.reason || 'Policy revalidation failed',
      updatedAtMs: Date.now(),
    })
    return {
      ok: false,
      statusCode: 409,
      message: reval.reason || 'Policy revalidation failed',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  if (state.stale === true) {
    return {
      ok: false,
      statusCode: 409,
      message: state.staleReason || 'Plan is stale — refresh Commander analysis before approval',
      orchestration: publicOrchestrationState(room),
      executed: false,
    }
  }

  const approvedPlan = {
    ...plan,
    approvalStatus: PLAN_APPROVAL_STATUS.APPROVED,
    commanderStatus: AGENT_SLOT_STATUS.READY,
    policyStatus: reval.policyStatus || plan.policyStatus,
    recommendedActions: (plan.recommendedActions || []).map((a) =>
      a?.executable
        ? { ...a, policyStatus: 'ALLOWED', status: 'approved' }
        : a
    ),
  }

  // Expand scope when re-approving after pause (union with prior scope)
  const freshScope = buildApprovalScope({
    plan: approvedPlan,
    detection: room.detection,
    approvedAtMs: nowMs,
    incidentIdAllowlist: groupIncidentAllowlist(room),
  })
  const prior = state.approvalScope
  const approvalScope = prior
    ? {
        ...freshScope,
        incidentIds: [
          ...new Set([...(prior.incidentIds ?? []), ...(freshScope.incidentIds ?? [])]),
        ].sort(),
        targetNodeIds: [
          ...new Set([...(prior.targetNodeIds ?? []), ...(freshScope.targetNodeIds ?? [])]),
        ].sort(),
        actionTypes: [
          ...new Set([...(prior.actionTypes ?? []), ...(freshScope.actionTypes ?? [])]),
        ].sort(),
        scopeFingerprint: [
          `incidents=${[...new Set([...(prior.incidentIds ?? []), ...(freshScope.incidentIds ?? [])])].sort().join(',')}`,
          `targets=${[...new Set([...(prior.targetNodeIds ?? []), ...(freshScope.targetNodeIds ?? [])])].sort().join(',')}`,
          `actions=${[...new Set([...(prior.actionTypes ?? []), ...(freshScope.actionTypes ?? [])])].sort().join(',')}`,
        ].join('|'),
      }
    : freshScope

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.APPROVED,
    plan: approvedPlan,
    fingerprint: state.fingerprint,
    stale: false,
    staleReason: null,
    approvedAtMs: nowMs,
    execution: null,
    approvalScope,
    autoIteration: 0,
    continuationReason: 'human_approved',
    pausedForApprovalReason: null,
    previousPlanId: null,
    updatedAtMs: nowMs,
  })

  pushWorkflowTrace(room, {
    kind: 'agent_loop',
    phase: 'HUMAN_APPROVED',
    planId: approvedPlan.planId,
    primaryIncidentId: approvedPlan.primaryIncidentId,
    target: approvedPlan.affectedNodeIds?.[0] ?? null,
    atMs: nowMs,
  })

  shoutLlm('[HUMAN APPROVAL]')
  shoutLlm(`incidentId=${approvedPlan.primaryIncidentId}`)
  shoutLlm('approved=true')
  shoutLlm(`planId=${approvedPlan.planId}`)

  if (autoContinue === false) {
    return {
      ok: true,
      orchestration: publicOrchestrationState(room),
      executed: false,
      executedActions: [],
      autoContinued: false,
    }
  }

  const continued = runOrchestrationContinuation(room, {
    resolveContext,
    onProgress,
    onCompleteSync,
    nowMs,
    stepDelayMs,
    mode: 'from_approved',
    writeState,
    publicOrchestrationState,
    executeOrchestrationPlan,
    markEpisodeRecovered,
  })

  return {
    ok: continued.ok !== false || continued.pausedForApproval === true || continued.episodeComplete === true,
    statusCode: continued.statusCode,
    message: continued.message,
    orchestration: publicOrchestrationState(room),
    executed: true,
    autoContinued: true,
    episodeComplete: continued.episodeComplete === true,
    pausedForApproval: continued.pausedForApproval === true,
    maxIterationsReached: continued.maxIterationsReached === true,
    continuationLog: continued.continuationLog ?? [],
    recovered: continued.recovered === true,
    mutatedQuarantine: false,
    autoRestored: false,
  }
}

function markEpisodeRecovered(room, { nowMs = Date.now(), reason = null } = {}) {
  const prev = ensureRoomOrchestration(room)
  const primaryIncidentId =
    prev.plan?.primaryIncidentId ?? prev.currentIncidentId ?? null
  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.RECOVERED,
    plan: prev.plan,
    execution: prev.execution,
    verification: prev.verification,
    verificationBaseline: prev.verificationBaseline,
    approvalScope: prev.approvalScope,
    stale: false,
    staleReason: null,
    continuationReason: reason || 'episode_complete',
    pausedForApprovalReason: null,
    updatedAtMs: nowMs,
  })
  pushWorkflowTrace(room, {
    kind: 'agent_loop',
    phase: 'EPISODE_RECOVERED',
    primaryIncidentId,
    planId: prev.plan?.planId ?? null,
    reason: reason || 'episode_complete',
    atMs: nowMs,
  })

  // Async post-analysis — never blocks recovery / queue advance.
  try {
    const actions = Array.isArray(prev.execution?.executedActions)
      ? prev.execution.executedActions
      : Array.isArray(prev.plan?.recommendedActions)
        ? prev.plan.recommendedActions
        : []
    schedulePostAnalysisAfterRecovery(room, {
      liveIncidentId: primaryIncidentId,
      persistentIncidentId: primaryIncidentId,
      responseActions: actions,
      recoveryStatus: 'recovered',
    })
  } catch (err) {
    console.error('[POST-ANALYSIS] recovery hook failed', err?.message ?? err)
  }
}

function incidentMatchesId(inc, incidentId) {
  const want = String(incidentId ?? '')
  if (!want || !inc) return false
  return String(inc.id ?? '') === want || String(inc.persistentId ?? '') === want
}

/**
 * Demo remediation: clear ONLY the selected incident's anomaly. Other incidents stay active.
 */
export function applyDummySelectedIncidentRecovery(room, incidentId) {
  const id = String(incidentId ?? '').trim()
  if (!id || !room) return { ok: false, cleared: false }
  const detection = room.detection
  const incidents = Array.isArray(detection?.incidents) ? detection.incidents : []
  const selected = incidents.find((inc) => incidentMatchesId(inc, id)) ?? null
  const nodeId = selected?.endpointId ? String(selected.endpointId) : null

  if (nodeId) {
    setNodeQuarantined(room, nodeId, true)
  }
  if (selected) {
    selected.status = INCIDENT_STATUS.CLEARED
  }
  if (detection) {
    detection.incidents = incidents.filter((inc) => !incidentMatchesId(inc, id))
    if (nodeId && Array.isArray(detection.anomalyNodeIds)) {
      detection.anomalyNodeIds = detection.anomalyNodeIds.filter(
        (nid) => String(nid) !== nodeId
      )
    }
  }
  const persistentId = selected?.persistentId || selected?.id || id
  if (room.id && persistentId) {
    try {
      updateIncidentStatus(room.id, persistentId, { status: INCIDENT_STATUS.CLEARED })
    } catch {
      /* SQLite row may not exist yet */
    }
  }
  shoutLlm('[RECOVERY]')
  shoutLlm(`incidentId=${id}`)
  shoutLlm('status=recovered')
  return { ok: true, cleared: true, incidentId: id, nodeId }
}

/**
 * After Response Agent (or dummy) execution: recover the selected incident only.
 */
export function completeSelectedIncidentDummyRecovery(room, incidentId, {
  nowMs = Date.now(),
} = {}) {
  ensureRoomOrchestration(room)
  const status = normalizeOrchestrationStatus(room.responseOrchestration.workflowStatus)
  if (status === ORCHESTRATION_STATUS.APPROVED) {
    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.EXECUTING,
      execution: {
        currentStep: 1,
        totalSteps: 1,
        completedSteps: 1,
        activeAction: null,
        results: [
          {
            actionId: 'dummy-recover-selected',
            status: 'completed',
            startedAtMs: nowMs,
            completedAtMs: nowMs,
          },
        ],
      },
      continuationReason: 'dummy_selected_recovery',
      updatedAtMs: nowMs,
    })
  }
  const recovered = applyDummySelectedIncidentRecovery(room, incidentId)
  markEpisodeRecovered(room, { nowMs, reason: 'selected_incident_recovered' })
  const queue = readQueueState(room.responseOrchestration)
  if (queue.orchestrationQueue.length > 0) {
    writeQueueFields(
      room,
      {
        orchestrationCycleStatus: ORCHESTRATION_CYCLE_STATUS.RECOVERING,
        currentIncidentId:
          incidentId != null && String(incidentId).trim()
            ? String(incidentId)
            : queue.currentIncidentId,
      },
      { source: 'completeSelectedIncidentDummyRecovery' }
    )
  }
  return {
    ok: true,
    recovered: true,
    cleared: recovered.cleared === true,
    incidentId,
    orchestration: publicOrchestrationState(room),
  }
}

/**
 * STEP 3 / 16: Execute the server-stored APPROVED plan via Response Agent.
 * Client cannot inject/modify plan actions. Never auto-recovers.
 *
 * APPROVED → EXECUTING → CONTINUING | REPLAN_REQUIRED (execution failure only)
 * Verification is recorded as observational evidence — never a workflow gate.
 */
export function executeOrchestrationPlan(room, {
  resolveContext,
  onProgress = null,
  onCompleteSync = null,
  nowMs = Date.now(),
  /** Ignored — client cannot supply a plan or action list */
  clientPlan = null,
  clientActionIds = null,
  /** Internal: skip post-exec sync / auto-continue (continuation loop owns next stage) */
  _internalContinuation = false,
  /** When true (default for HTTP), start Commander continuation after success */
  autoContinue = true,
  stepDelayMs = null,
  /** Optional: focus a parallel orchestration group before execute */
  groupId = null,
} = {}) {
  ensureRoomOrchestration(room)
  if (groupId) {
    const focused = focusOrchestrationGroup(room, groupId)
    if (!focused.ok) return focused
  }
  const roomKey = orchestrationLockKey(room)

  if (clientPlan != null || clientActionIds != null) {
    // Explicit no-op: server plan is the only authority
  }

  if (executionInFlight.has(roomKey)) {
    return {
      ok: false,
      statusCode: 409,
      message: 'Response Agent already executing for this room',
      orchestration: publicOrchestrationState(room),
    }
  }

  // External HTTP execute must not race the paced automatic loop
  if (isOrchestrationLoopInFlight(roomKey) && _internalContinuation !== true) {
    return {
      ok: false,
      statusCode: 409,
      message: 'Orchestration continuation already in progress for this room',
      orchestration: publicOrchestrationState(room),
    }
  }

  const state = room.responseOrchestration
  const status = normalizeOrchestrationStatus(state.workflowStatus)

  if (status !== ORCHESTRATION_STATUS.APPROVED) {
    return {
      ok: false,
      statusCode: 409,
      message: `Execution requires APPROVED status (status=${status})`,
      orchestration: publicOrchestrationState(room),
    }
  }

  const plan = state.plan
  if (!plan?.planId) {
    return {
      ok: false,
      statusCode: 400,
      message: 'No approved plan to execute',
      orchestration: publicOrchestrationState(room),
    }
  }
  if (plan.approvalStatus !== PLAN_APPROVAL_STATUS.APPROVED) {
    return {
      ok: false,
      statusCode: 409,
      message: 'Plan approval metadata is not approved',
      orchestration: publicOrchestrationState(room),
    }
  }

  const steps = orderedExecutableSteps(plan)
  shoutLlm('[RESPONSE AGENT]')
  shoutLlm(`incidentId=${plan.primaryIncidentId}`)
  shoutLlm(
    `actions=${JSON.stringify(steps.map((s) => s.actionId))}`
  )
  if (!steps.length) {
    return {
      ok: false,
      statusCode: 400,
      message: 'Approved plan has no executable actions',
      orchestration: publicOrchestrationState(room),
    }
  }

  if (typeof resolveContext !== 'function') {
    return {
      ok: false,
      statusCode: 500,
      message: 'Context resolver unavailable',
      orchestration: publicOrchestrationState(room),
    }
  }

  const preContext = resolveContext(room, room.id, plan.primaryIncidentId)
  if (!preContext) {
    markReplanRequired(room, 'Primary incident context unavailable before execution')
    return {
      ok: false,
      statusCode: 409,
      message: 'Primary incident context unavailable — replan required',
      orchestration: publicOrchestrationState(room),
    }
  }

  // Immediate APPROVED → EXECUTING (blocks double execute)
  // Capture baseline BEFORE Response Agent mutates quarantine.
  const verificationBaseline = captureVerificationBaseline(room, plan)
  const prevVerification = state.verification
  const keepPriorVerified =
    isStepVerified(prevVerification?.verdict) === true
  executionInFlight.add(roomKey)
  const initialExecution = {
    currentStep: 0,
    totalSteps: steps.length,
    completedSteps: 0,
    activeAction: null,
    results: steps.map((action) => ({
      stepId: action.stepId ?? null,
      actionId: action.actionId,
      actionType: action.actionType ?? null,
      label: action.label ?? null,
      target: action.target ?? null,
      executionOrder: action.executionOrder ?? null,
      status: 'pending',
      startedAtMs: null,
      completedAtMs: null,
      result: null,
      error: null,
    })),
  }

  writeState(room, {
    workflowStatus: ORCHESTRATION_STATUS.EXECUTING,
    plan,
    execution: initialExecution,
    verificationBaseline,
    postExecutionDetection: null,
    verification: keepPriorVerified ? prevVerification : null,
    lastReplanReason: null,
    stale: false,
    updatedAtMs: nowMs,
  }, { source: 'executeOrchestrationPlan:start' })

  // Quarantine lifecycle BEFORE for isolate targets
  const preIsolateTargets = (plan.recommendedActions || [])
    .filter(
      (a) =>
        a?.executable === true &&
        (a.actionId === 'isolate-node' || a.actionType === 'ISOLATE_NODE')
    )
    .map((a) => a.target?.id)
    .filter(Boolean)
  const quarantineBefore = Object.fromEntries(
    preIsolateTargets.map((id) => {
      const n = (room.nodes ?? []).find((x) => String(x.id) === String(id))
      const q = n
        ? runtimeStateOf(n.data).quarantined === true
        : false
      return [id, q]
    })
  )
  pushWorkflowTrace(room, {
    kind: 'quarantine_lifecycle',
    phase: 'BEFORE',
    targets: quarantineBefore,
    planId: plan.planId,
    iteration: state.autoIteration ?? 0,
  })

  pushWorkflowTrace(room, {
    kind: 'agent_loop',
    phase: 'RESPONSE_EXECUTING',
    planId: plan.planId,
    primaryIncidentId: plan.primaryIncidentId,
    target: plan.affectedNodeIds?.[0] ?? null,
    atMs: nowMs,
  })

  if (typeof onProgress === 'function') {
    onProgress(publicOrchestrationState(room))
  }

  try {
    const frozenPlan = {
      ...plan,
      recommendedActions: (plan.recommendedActions || []).map((a) => ({ ...a })),
      executionOrder: Array.isArray(plan.executionOrder) ? [...plan.executionOrder] : [],
      affectedNodeIds: Array.isArray(plan.affectedNodeIds) ? [...plan.affectedNodeIds] : [],
      incidentIds: Array.isArray(plan.incidentIds) ? [...plan.incidentIds] : [],
    }

    const agentResult = runResponseAgent({
      room,
      plan: frozenPlan,
      resolveContext,
      nowMs,
      onProgress: (execution) => {
        writeState(room, {
          workflowStatus: ORCHESTRATION_STATUS.EXECUTING,
          plan,
          execution,
        })
        if (typeof onProgress === 'function') {
          onProgress(publicOrchestrationState(room))
        }
      },
    })

    if (!agentResult.ok) {
      markReplanRequired(
        room,
        agentResult.reason || 'Response Agent execution failed',
        agentResult.execution
      )
      if (typeof onCompleteSync === 'function') onCompleteSync(room)
      return {
        ok: false,
        statusCode: 409,
        message: agentResult.reason || 'Response Agent execution failed',
        orchestration: publicOrchestrationState(room),
        execution: agentResult.execution,
      }
    }

    const postExecutionDetection = capturePostExecutionDetection(room)

    const quarantineAfter = Object.fromEntries(
      preIsolateTargets.map((id) => {
        const n = (room.nodes ?? []).find((x) => String(x.id) === String(id))
        const q = n
          ? runtimeStateOf(n.data).quarantined === true
          : false
        return [id, q]
      })
    )
    pushWorkflowTrace(room, {
      kind: 'quarantine_lifecycle',
      phase: 'AFTER_EXECUTE',
      before: quarantineBefore,
      after: quarantineAfter,
      executeResults: (agentResult.execution?.results ?? []).map((r) => ({
        actionId: r.actionId,
        status: r.status,
        target: r.target?.id ?? null,
        error: r.error ?? null,
      })),
      planId: plan.planId,
      catalogFiltered: classifyPlanActions(plan).catalog.map((a) => a.actionId),
      executableOnly: classifyPlanActions(plan).executable.map((a) => a.actionId),
    })

    writeState(room, {
      workflowStatus: ORCHESTRATION_STATUS.CONTINUING,
      plan,
      execution: agentResult.execution,
      verificationBaseline,
      postExecutionDetection,
      verification: keepPriorVerified ? prevVerification : null,
      continuationReason: 'execution_complete',
      stale: false,
      staleReason: null,
      previousPlanId: null,
      updatedAtMs: Date.now(),
    }, { source: 'executeOrchestrationPlan:complete' })

    // Observational evidence only — never gates continuation
    recordObservationalVerification(room)

    for (const r of agentResult.execution?.results ?? []) {
      if (String(r.status).toLowerCase() !== 'completed') continue
      pushWorkflowTrace(room, {
        kind: 'agent_loop',
        phase: 'ACTION_EXECUTED',
        actionId: r.actionId,
        planId: plan.planId,
        primaryIncidentId: plan.primaryIncidentId,
        target: r.target?.id ?? null,
        peerId: r.target?.peerId ?? null,
        result: r.result?.status || 'ok',
        atMs: r.completedAtMs ?? Date.now(),
      })
    }

    pushWorkflowTrace(room, {
      kind: 'agent_loop',
      phase: 'RESPONSE_COMPLETED',
      planId: plan.planId,
      primaryIncidentId: plan.primaryIncidentId,
      target: agentResult.execution?.results?.[0]?.target?.id ?? null,
      result: 'ok',
      atMs: Date.now(),
    })

    pushWorkflowTrace(room, {
      kind: 'agent_loop',
      phase: 'VERIFICATION_EVIDENCE',
      planId: plan.planId,
      primaryIncidentId: plan.primaryIncidentId,
      controlFlow: 'ignored',
      atMs: Date.now(),
    })

    if (typeof onCompleteSync === 'function' && _internalContinuation !== true) {
      onCompleteSync(room)
    }

    const shouldContinue =
      autoContinue === true &&
      _internalContinuation !== true &&
      typeof resolveContext === 'function'

    if (shouldContinue) {
      const continued = runOrchestrationContinuation(room, {
        resolveContext,
        onProgress,
        onCompleteSync,
        nowMs: Date.now(),
        stepDelayMs,
        mode: 'after_execution',
        writeState,
        publicOrchestrationState,
        executeOrchestrationPlan,
        markEpisodeRecovered,
      })
      return {
        ok: true,
        orchestration: publicOrchestrationState(room),
        execution: agentResult.execution,
        episodeComplete: continued.episodeComplete === true,
        autoContinued: true,
        pausedForApproval: continued.pausedForApproval === true,
        continuationLog: continued.continuationLog ?? [],
        recovered: continued.recovered === true,
        incidentsClosed: false,
        autoRestored: false,
      }
    }

    return {
      ok: true,
      orchestration: publicOrchestrationState(room),
      execution: agentResult.execution,
      recovered: false,
      incidentsClosed: false,
      autoRestored: false,
    }
  } finally {
    executionInFlight.delete(roomKey)
  }
}

/**
 * STEP 16: Observational verification only.
 * Never writes REPLAN_REQUIRED, never blocks continuation, never changes
 * workflow control status (except legacy VERIFYING → CONTINUING normalize).
 */
export function verifyOrchestrationPlan(room, {
  nowMs = Date.now(),
  resolveContext = null,
  onProgress = null,
  onCompleteSync = null,
  autoContinue = false,
  stepDelayMs = null,
  _internalContinuation = false,
} = {}) {
  ensureRoomOrchestration(room)
  const state = room.responseOrchestration
  const status = normalizeOrchestrationStatus(state.workflowStatus)
  const priorStatus = status

  // Accept post-execute statuses; never require VERIFYING as a gate.
  if (
    status !== ORCHESTRATION_STATUS.VERIFYING &&
    status !== ORCHESTRATION_STATUS.CONTINUING &&
    status !== ORCHESTRATION_STATUS.EXECUTING &&
    status !== ORCHESTRATION_STATUS.RECOVERED &&
    status !== ORCHESTRATION_STATUS.APPROVED &&
    status !== ORCHESTRATION_STATUS.AWAITING_APPROVAL
  ) {
    return {
      ok: false,
      statusCode: 409,
      message: `Verification evidence unavailable (status=${status})`,
      orchestration: publicOrchestrationState(room),
    }
  }

  const plan = state.plan
  const execution = state.execution
  if (!plan?.planId) {
    return {
      ok: false,
      statusCode: 400,
      message: 'No plan available for verification evidence',
      orchestration: publicOrchestrationState(room),
    }
  }

  const step = verifyResponseStep({
    room,
    plan,
    execution,
    baseline: state.verificationBaseline,
    approvalScope: state.approvalScope ?? null,
    detectionSnapshot: state.postExecutionDetection ?? null,
    nowMs,
  })

  const classified = classifyPlanActions(plan)
  pushWorkflowTrace(room, {
    kind: 'observational_verification',
    verified: step.verified === true,
    verdict: step.verdict,
    failReasons: step.failReasons ?? [],
    passNotes: step.passNotes ?? [],
    checks: step.checks ?? null,
    checkDetails: step.checkDetails ?? step.verification?.checkDetails ?? null,
    planId: plan.planId,
    primaryIncidentId: plan.primaryIncidentId,
    catalogActionsIgnored: classified.catalog.map((a) => a.actionId),
    controlFlow: 'ignored',
    priorStatus,
    atMs: nowMs,
  })

  // Attach evidence without changing control-flow status (normalize legacy VERIFYING).
  const nextStatus =
    status === ORCHESTRATION_STATUS.VERIFYING
      ? ORCHESTRATION_STATUS.CONTINUING
      : status

  writeState(room, {
    workflowStatus: nextStatus,
    plan,
    execution,
    verificationBaseline: state.verificationBaseline,
    postExecutionDetection: state.postExecutionDetection,
    verification: step.verification,
    updatedAtMs: nowMs,
  }, { source: 'verifyOrchestrationPlan:observational' })

  if (typeof onProgress === 'function') {
    onProgress(publicOrchestrationState(room))
  }

  // Optional HTTP helper: start continuation after evidence record (not gated on verdict)
  const shouldContinue =
    autoContinue === true &&
    _internalContinuation !== true &&
    typeof resolveContext === 'function' &&
    (nextStatus === ORCHESTRATION_STATUS.CONTINUING ||
      nextStatus === ORCHESTRATION_STATUS.VERIFYING)

  if (shouldContinue && hasRemainingResponseWork(room, { incidentIdAllowlist: groupIncidentAllowlist(room) })) {
    const continued = runOrchestrationContinuation(room, {
      resolveContext,
      onProgress,
      onCompleteSync,
      nowMs: Date.now(),
      stepDelayMs,
      mode: 'after_execution',
      writeState,
      publicOrchestrationState,
      executeOrchestrationPlan,
      markEpisodeRecovered,
    })
    return {
      ok: true,
      verified: step.verified === true,
      verdict: step.verdict,
      stepVerified: step.verified === true,
      observational: true,
      workflowUnchangedByVerdict: true,
      episodeComplete: continued.episodeComplete === true,
      autoContinued: true,
      pausedForApproval: continued.pausedForApproval === true,
      continuationLog: continued.continuationLog ?? [],
      orchestration: publicOrchestrationState(room),
      verification: step.verification,
      recovered: continued.recovered === true,
      incidentsClosed: false,
      autoRestored: false,
      mutatedQuarantine: false,
    }
  }

  if (
    shouldContinue &&
    !hasRemainingResponseWork(room, { incidentIdAllowlist: groupIncidentAllowlist(room) }) &&
    nextStatus !== ORCHESTRATION_STATUS.RECOVERED
  ) {
    markEpisodeRecovered(room, {
      nowMs,
      reason: 'No active non-quarantined incidents remain',
    })
  }

  if (typeof onCompleteSync === 'function') onCompleteSync(room)

  return {
    ok: true,
    verified: step.verified === true,
    verdict: step.verdict,
    stepVerified: step.verified === true,
    observational: true,
    workflowUnchangedByVerdict: true,
    episodeComplete:
      normalizeOrchestrationStatus(room.responseOrchestration.workflowStatus) ===
      ORCHESTRATION_STATUS.RECOVERED,
    orchestration: publicOrchestrationState(room),
    verification: step.verification,
    recovered:
      normalizeOrchestrationStatus(room.responseOrchestration.workflowStatus) ===
      ORCHESTRATION_STATUS.RECOVERED,
    remainingWork: hasRemainingResponseWork(room, {
      incidentIdAllowlist: groupIncidentAllowlist(room),
    }),
    incidentsClosed: false,
    autoRestored: false,
    mutatedQuarantine: false,
  }
}
