/**
 * Response step verification — closed-loop checks (STEP 4 / 11 / 15).
 *
 * STEP 15: Orchestration decisions use verifyResponseStep() — not Recovery Agent
 * ownership. Remaining approved-scope work is continuation, never REPLAN.
 *
 * Step outcomes:
 *   verified=true  — iteration succeeded; orchestration may continue remaining work
 *   verified=false — genuine hard fail; orchestration → REPLAN_REQUIRED
 *
 * Episode RECOVERED is an orchestration-level outcome only
 * (no active non-quarantined response work remains).
 *
 * VERIFICATION ONLY — does NOT mutate:
 * - quarantine
 * - attack overrides
 * - incident status
 * - topology
 *
 * May recommend restore-connectivity without executing it.
 */

import { runtimeStateOf } from '../infrastructureNode.js'
import { EXECUTION_STEP_STATUS } from '../../shared/response/orchestration.js'
import { isActiveResponseIncident } from '../../shared/incidentStatus.js'
import {
  buildRecoveryCheckDetails,
  classifyPlanActions,
  quarantineLifecycleForTargets,
} from './workflowTrace.js'

/** Step-level verification outcomes (episode RECOVERED is orchestration-only). */
export const VERIFICATION_VERDICT = Object.freeze({
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  /** @deprecated alias — treat as VERIFIED (step pass, not episode recovered) */
  RECOVERED: 'VERIFIED',
  /** @deprecated alias — treat as FAILED */
  REPLAN_REQUIRED: 'FAILED',
})

export function normalizeVerificationVerdict(verdict) {
  const v = String(verdict ?? '')
  if (v === 'VERIFIED' || v === 'RECOVERED') return VERIFICATION_VERDICT.VERIFIED
  if (v === 'FAILED' || v === 'REPLAN_REQUIRED') return VERIFICATION_VERDICT.FAILED
  return null
}

export function isStepVerified(verdictOrResult) {
  if (verdictOrResult && typeof verdictOrResult === 'object') {
    if (verdictOrResult.verified === true) return true
    if (verdictOrResult.verified === false) return false
    return (
      normalizeVerificationVerdict(verdictOrResult.verdict) ===
      VERIFICATION_VERDICT.VERIFIED
    )
  }
  return normalizeVerificationVerdict(verdictOrResult) === VERIFICATION_VERDICT.VERIFIED
}

function isOpenStatus(status) {
  return isActiveResponseIncident({ status: status ?? 'open' })
}

function sortedUnique(ids = []) {
  return [...new Set((ids ?? []).map(String).filter(Boolean))].sort()
}

function findNode(room, nodeId) {
  const id = String(nodeId ?? '')
  if (!id || !Array.isArray(room?.nodes)) return null
  return room.nodes.find((n) => String(n.id) === id) ?? null
}

function isQuarantined(room, nodeId) {
  const node = findNode(room, nodeId)
  if (!node) return false
  return runtimeStateOf(node.data).quarantined === true
}

function openIncidentEndpointIds(detection) {
  const incidents = Array.isArray(detection?.incidents) ? detection.incidents : []
  return sortedUnique(
    incidents.filter((inc) => isOpenStatus(inc?.status)).map((inc) => inc.endpointId)
  )
}

function openIncidentIds(detection) {
  const incidents = Array.isArray(detection?.incidents) ? detection.incidents : []
  return sortedUnique(
    incidents
      .filter((inc) => isOpenStatus(inc?.status))
      .map((inc) => inc.persistentId || inc.id)
  )
}

function residualForNode(detection, nodeId) {
  const id = String(nodeId ?? '')
  const fromMap = detection?.isolationScoresByNodeId?.[id]
  if (Number.isFinite(Number(fromMap))) return Number(fromMap)
  const inc = (detection?.incidents ?? []).find(
    (i) => String(i.endpointId) === id && isOpenStatus(i.status)
  )
  const score = Number(inc?.anomalyScore ?? inc?.isolationScore)
  return Number.isFinite(score) ? score : null
}

/**
 * Freeze detection for Recovery so async telemetry ticks cannot rewrite the
 * post-execution graph mid-verify (STEP 13). Quarantine still read from room.nodes.
 */
export function cloneDetectionSnapshot(detection = null) {
  if (!detection || typeof detection !== 'object') return null
  const incidents = Array.isArray(detection.incidents)
    ? detection.incidents.map((inc) => ({ ...inc }))
    : []
  const scores =
    detection.isolationScoresByNodeId &&
    typeof detection.isolationScoresByNodeId === 'object'
      ? { ...detection.isolationScoresByNodeId }
      : {}
  return {
    ...detection,
    incidents,
    anomalyNodeIds: sortedUnique(detection.anomalyNodeIds ?? []),
    atRiskNodeIds: sortedUnique(detection.atRiskNodeIds ?? []),
    peerExposedNodeIds: sortedUnique(detection.peerExposedNodeIds ?? []),
    propagatedNodeIds: sortedUnique(detection.propagatedNodeIds ?? []),
    isolationScoresByNodeId: scores,
    liveCorrelation: detection.liveCorrelation
      ? {
          ...detection.liveCorrelation,
          groups: Array.isArray(detection.liveCorrelation.groups)
            ? detection.liveCorrelation.groups.map((g) => ({ ...g }))
            : [],
        }
      : detection.liveCorrelation,
  }
}

/**
 * Capture coherent post-execution detection for the Recovery Agent.
 * Call in the same synchronous turn as execute completion — before any yield/pace.
 */
export function capturePostExecutionDetection(room) {
  return cloneDetectionSnapshot(room?.detection ?? null)
}

/** Test/helper: re-bind Recovery freeze to current room.detection (authoritative update). */
export function bindPostExecutionDetection(room) {
  if (!room?.responseOrchestration) return null
  const snap = capturePostExecutionDetection(room)
  room.responseOrchestration.postExecutionDetection = snap
  return snap
}

/**
 * Known node IDs for this episode: iteration targets ∪ approvalScope targets.
 * Remaining approved-scope work is not "new out of scope."
 */
export function buildKnownEpisodeNodeScope({
  baseline = null,
  plan = null,
  isolateTargets = [],
  approvalScope = null,
} = {}) {
  return new Set(
    sortedUnique([
      ...(baseline?.affectedNodeIds ?? []),
      ...isolateTargets,
      ...(plan?.affectedNodeIds ?? []),
      ...(approvalScope?.targetNodeIds ?? []),
    ])
  )
}

/**
 * Capture a compact pre-response baseline for later verification.
 * Call at EXECUTING start — before Response Agent mutations.
 */
export function captureVerificationBaseline(room, plan = null) {
  const detection = room?.detection ?? null
  const affected = Array.isArray(plan?.affectedNodeIds)
    ? plan.affectedNodeIds.map(String)
    : []
  const primaryId = plan?.primaryIncidentId != null ? String(plan.primaryIncidentId) : null
  const primaryInc = (detection?.incidents ?? []).find(
    (inc) =>
      String(inc?.id) === primaryId ||
      String(inc?.persistentId ?? '') === primaryId
  )
  const targetIds = sortedUnique([
    ...affected,
    ...(plan?.recommendedActions ?? [])
      .map((a) => a?.target?.id)
      .filter(Boolean),
  ])

  const quarantineByTarget = {}
  const residualByTarget = {}
  for (const id of targetIds) {
    quarantineByTarget[id] = isQuarantined(room, id)
    residualByTarget[id] = residualForNode(detection, id)
  }

  return {
    capturedAtMs: Date.now(),
    primaryIncidentId: primaryId,
    incidentIds: Array.isArray(plan?.incidentIds)
      ? sortedUnique(plan.incidentIds)
      : [],
    affectedNodeIds: targetIds,
    anomalyNodeIds: sortedUnique(detection?.anomalyNodeIds ?? []),
    openIncidentIds: openIncidentIds(detection),
    openEndpointIds: openIncidentEndpointIds(detection),
    peerExposedNodeIds: sortedUnique(detection?.peerExposedNodeIds ?? []),
    propagatedNodeIds: sortedUnique(detection?.propagatedNodeIds ?? []),
    atRiskNodeIds: sortedUnique(detection?.atRiskNodeIds ?? []),
    quarantineByTarget,
    residualByTarget,
    recoveryPriority:
      Number.isFinite(Number(primaryInc?.recoveryPriority))
        ? Number(primaryInc.recoveryPriority)
        : Number.isFinite(Number(plan?.expectedImpact?.recoveryPriority))
          ? Number(plan.expectedImpact.recoveryPriority)
          : null,
    expectedImpact: plan?.expectedImpact
      ? {
          certainRecoveryCount: plan.expectedImpact.certainRecoveryCount ?? 0,
          mayReduceExposureCount: plan.expectedImpact.mayReduceExposureCount ?? 0,
          independentlyCompromisedCount:
            plan.expectedImpact.independentlyCompromisedCount ?? 0,
        }
      : null,
  }
}

/**
 * Isolate targets from completed isolate-node actions only.
 * Do NOT treat peer/relief affectedNodeIds as containment targets — quarantine
 * on the isolate seed is success; exposure relief remains MAY language only.
 */
export function isolateTargetsFromPlan(plan, execution = null) {
  const fromResults = (execution?.results ?? [])
    .filter(
      (r) =>
        r &&
        (r.actionId === 'isolate-node' || r.actionType === 'ISOLATE_NODE') &&
        r.status === EXECUTION_STEP_STATUS.COMPLETED
    )
    .map((r) => r.target?.id || r.result?.target?.id)
    .filter(Boolean)

  const fromPlan = (plan?.recommendedActions ?? [])
    .filter(
      (a) =>
        a &&
        a.executable === true &&
        (a.actionId === 'isolate-node' || a.actionType === 'ISOLATE_NODE')
    )
    .map((a) => a.target?.id)
    .filter(Boolean)

  return sortedUnique([...fromResults, ...fromPlan])
}

/**
 * STEP 15 — deterministic, read-only response-step verification.
 * Orchestration control flow must call this (not Recovery Agent ownership).
 *
 * Does NOT decide episode recovery or continuation — only whether THIS step held.
 * Remaining approved-scope incidents are continuation, never failure.
 *
 * @returns {{
 *   verified: boolean,
 *   checks: object,
 *   passNotes: string[],
 *   failReasons: string[],
 *   primaryReason: string|null,
 *   recommendedNextActions: object[],
 *   verification: object|null,
 *   checkDetails: object|null,
 * }}
 */
export function verifyResponseStep({
  room,
  plan,
  execution,
  baseline = null,
  approvalScope = null,
  /** Frozen post-execution detection — prefer over live room.detection (STEP 13) */
  detectionSnapshot = null,
  nowMs = Date.now(),
} = {}) {
  const failReasons = []
  const passNotes = []
  const checks = {
    executionComplete: false,
    containmentHeld: false,
    noNewOutOfScopeAnomalies: false,
    noNewIndependentOpenOnRelief: false,
    residualNotWorsening: null,
  }

  if (!room || !plan) {
    return {
      verified: false,
      checks,
      passNotes: [],
      failReasons: ['Room and approved plan required for verification'],
      primaryReason: 'Room and approved plan required for verification',
      recommendedNextActions: [],
      verification: null,
      checkDetails: null,
      verdict: VERIFICATION_VERDICT.FAILED,
      ok: false,
    }
  }

  const detection =
    detectionSnapshot && typeof detectionSnapshot === 'object'
      ? detectionSnapshot
      : room.detection ?? null

  const results = Array.isArray(execution?.results) ? execution.results : []
  const allCompleted =
    results.length > 0 &&
    results.every((r) => r.status === EXECUTION_STEP_STATUS.COMPLETED)
  const anyFailed = results.some(
    (r) =>
      r.status === EXECUTION_STEP_STATUS.FAILED ||
      r.status === EXECUTION_STEP_STATUS.BLOCKED
  )
  checks.executionComplete = allCompleted && !anyFailed
  if (!checks.executionComplete) {
    failReasons.push('Not all approved actions completed successfully')
  } else {
    passNotes.push('Approved response actions completed')
  }

  const isolateTargets = isolateTargetsFromPlan(plan, execution)
  const missingQuarantine = []
  for (const id of isolateTargets) {
    if (!isQuarantined(room, id)) missingQuarantine.push(id)
  }
  checks.containmentHeld = missingQuarantine.length === 0 && isolateTargets.length > 0
  if (isolateTargets.length === 0) {
    failReasons.push('No isolate targets found to verify containment')
    checks.containmentHeld = false
  } else if (missingQuarantine.length) {
    failReasons.push(
      `Containment not held on: ${missingQuarantine.join(', ')}`
    )
  } else {
    passNotes.push(
      `Containment maintained on ${isolateTargets.length} isolate target${
        isolateTargets.length === 1 ? '' : 's'
      } (quarantine held — step verified, not episode recovered)`
    )
  }

  const current = captureCurrentSnapshotFromDetection(room, plan, detection)
  const base = baseline && typeof baseline === 'object' ? baseline : null
  const knownScope = buildKnownEpisodeNodeScope({
    baseline: base,
    plan,
    isolateTargets,
    approvalScope,
  })

  const currentAnomalies = new Set(current.anomalyNodeIds)
  const baselineAnomalies = new Set(base?.anomalyNodeIds ?? [])
  const newOutOfScope = [...currentAnomalies].filter(
    (id) => !baselineAnomalies.has(id) && !knownScope.has(id)
  )
  checks.noNewOutOfScopeAnomalies = newOutOfScope.length === 0
  if (newOutOfScope.length) {
    failReasons.push(
      `New out-of-scope anomaly seeds after response: ${newOutOfScope.join(', ')}`
    )
  } else {
    passNotes.push(
      'No new anomaly seeds outside approved episode / iteration scope'
    )
  }

  const reliefIds = new Set(
    (plan?.expectedImpact?.reliefCandidateIds ?? []).map(String)
  )
  const baselineOpenEnds = new Set(base?.openEndpointIds ?? [])
  const currentOpenEnds = new Set(current.openEndpointIds)
  const newIndependentOpen = [...currentOpenEnds].filter(
    (id) => !baselineOpenEnds.has(id) && !knownScope.has(id)
  )
  checks.noNewIndependentOpenOnRelief = newIndependentOpen.length === 0
  if (newIndependentOpen.length) {
    failReasons.push(
      `New independent open incidents outside approval scope: ${newIndependentOpen.join(', ')}`
    )
  } else {
    const openCountBefore = baselineOpenEnds.size
    const openCountAfter = currentOpenEnds.size
    if (openCountAfter < openCountBefore) {
      passNotes.push(
        `Active open endpoints decreased (${openCountBefore} → ${openCountAfter}); remaining approved-scope work is continuation, not failure`
      )
    } else if (reliefIds.size > 0) {
      passNotes.push(
        'No new independent opens outside approval scope (exposure relief remains MAY)'
      )
    } else {
      passNotes.push('No new independent opens outside approval scope')
    }
  }

  let residualWorse = false
  const residualRows = []
  if (base?.residualByTarget) {
    for (const id of isolateTargets) {
      const before = Number(base.residualByTarget[id])
      const after = residualForNode(detection, id)
      residualRows.push({
        targetNodeId: id,
        before: Number.isFinite(before) ? before : null,
        after: Number.isFinite(after) ? after : null,
        threshold: 0.15,
        worsened:
          Number.isFinite(before) &&
          Number.isFinite(after) &&
          after > before + 0.15,
      })
      if (Number.isFinite(before) && Number.isFinite(after) && after > before + 0.15) {
        residualWorse = true
        failReasons.push(
          `Residual worsened on ${id} (${before.toFixed(2)} → ${after.toFixed(2)})`
        )
      }
    }
  }
  checks.residualNotWorsening = residualWorse ? false : true
  if (!residualWorse && isolateTargets.length > 0) {
    passNotes.push('Residual not worsening on isolate targets')
  }

  const classified = classifyPlanActions(plan)
  const catalogActionIds = classified.catalog.map((a) => a.actionId).filter(Boolean)
  const executableActionIds = classified.executable
    .map((a) => a.actionId)
    .filter(Boolean)
  const quarantineLifecycle = quarantineLifecycleForTargets(room, isolateTargets, {
    before: base?.quarantineByTarget ?? null,
    executeResult: results
      .filter(
        (r) =>
          r?.actionId === 'isolate-node' || r?.actionType === 'ISOLATE_NODE'
      )
      .map((r) => ({
        actionId: r.actionId,
        status: r.status,
        target: r.target?.id ?? null,
      })),
    after: Object.fromEntries(
      isolateTargets.map((id) => [id, isQuarantined(room, id)])
    ),
    verification: Object.fromEntries(
      isolateTargets.map((id) => [id, isQuarantined(room, id)])
    ),
  })

  const detectionSource =
    detectionSnapshot != null ? 'frozen_post_execution' : 'live_room_detection'
  const detectionIdentity = {
    source: detectionSource,
    usedFrozenDetection: detectionSnapshot != null,
    anomalyCount: (detection?.anomalyNodeIds ?? []).length,
    openIncidentCount: openIncidentIds(detection).length,
    capturedAtMs: detection?.capturedAtMs ?? null,
    liveAnomalyCount: (room.detection?.anomalyNodeIds ?? []).length,
    liveEqualsFrozen:
      detectionSnapshot != null && room.detection === detectionSnapshot,
  }

  const checkDetails = buildRecoveryCheckDetails({
    checks,
    results,
    isolateTargets,
    missingQuarantine,
    baselineAnomalies: [...baselineAnomalies],
    currentAnomalies: [...currentAnomalies],
    knownScope: [...knownScope],
    newOutOfScope,
    baselineOpenEnds: [...baselineOpenEnds],
    currentOpenEnds: [...currentOpenEnds],
    newIndependentOpen,
    residualRows,
    catalogActionIds,
    executableActionIds,
    quarantineLifecycle,
    detectionSource,
    detectionIdentity,
  })

  const hardFail =
    !checks.executionComplete ||
    !checks.containmentHeld ||
    !checks.noNewOutOfScopeAnomalies ||
    !checks.noNewIndependentOpenOnRelief ||
    checks.residualNotWorsening === false

  // STEP 14 forensic console — always on hard-fail; verbose when ORCHESTRATION_DEBUG=1
  const logChecks =
    hardFail ||
    process.env.ORCHESTRATION_DEBUG === '1' ||
    process.env.ORCHESTRATION_DEBUG === 'true'
  if (logChecks) {
    for (const key of [
      'executionComplete',
      'containmentHeld',
      'noNewOutOfScopeAnomalies',
      'noNewIndependentOpenOnRelief',
      'residualNotWorsening',
    ]) {
      const detail = checkDetails[key]
      if (!detail || typeof detail !== 'object') continue
      const line = [
        '[VERIFY CHECK]',
        detail.name || key,
        `expected: ${detail.expected}`,
        `actual: ${detail.actual}`,
        `passed: ${detail.passed}`,
        `reason: ${detail.reason || ''}`,
      ]
      if (detail.targets) line.push(`targets: ${JSON.stringify(detail.targets)}`)
      if (detail.missingQuarantine?.length) {
        line.push(`missingQuarantine: ${JSON.stringify(detail.missingQuarantine)}`)
      }
      if (detail.outsideScope?.length) {
        line.push(`outsideScope: ${JSON.stringify(detail.outsideScope)}`)
      }
      if (detail.baseline) line.push(`baseline: ${JSON.stringify(detail.baseline)}`)
      if (detail.current) line.push(`current: ${JSON.stringify(detail.current)}`)
      if (detail.knownScope) {
        line.push(`knownScope: ${JSON.stringify(detail.knownScope)}`)
      }
      console.info(line.join('\n  '))
    }
    console.info(
      '[VERIFY CHECK] catalog_actions',
      JSON.stringify({
        catalogActionIds,
        executableActionIds,
        catalogActionsDoNotAffectVerdict: true,
        detectionSource,
        detectionIdentity,
      })
    )
  }

  const verdict = hardFail
    ? VERIFICATION_VERDICT.FAILED
    : VERIFICATION_VERDICT.VERIFIED

  if (verdict === VERIFICATION_VERDICT.VERIFIED) {
    passNotes.push(
      'Step verified — iteration containment succeeded. Quarantine is not episode recovery and was not auto-restored.'
    )
  }

  const reasons = hardFail ? [...failReasons, ...passNotes] : [...passNotes]
  const primaryReason = hardFail
    ? failReasons[0] || 'Step verification failed'
    : passNotes[passNotes.length - 1] || 'Step verified'

  const recommendedNextActions = []
  if (verdict === VERIFICATION_VERDICT.VERIFIED) {
    for (const id of isolateTargets) {
      if (isQuarantined(room, id)) {
        recommendedNextActions.push({
          actionId: 'restore-connectivity',
          target: { id },
          executable: true,
          autoExecute: false,
          reason:
            'Step verified. Restore is optional operator action via executeResponseAction — not auto-run.',
        })
      }
    }
  }

  const verification = {
    verifiedAtMs: nowMs,
    verified: !hardFail,
    verdict,
    stepOutcome: verdict,
    reasons: [...reasons],
    failReasons: [...failReasons],
    passNotes: [...passNotes],
    primaryReason,
    checks: { ...checks },
    checkDetails,
    baseline: base,
    current: {
      anomalyNodeIds: current.anomalyNodeIds,
      openIncidentIds: current.openIncidentIds,
      openEndpointIds: current.openEndpointIds,
      quarantineByTarget: Object.fromEntries(
        isolateTargets.map((id) => [id, isQuarantined(room, id)])
      ),
    },
    isolateTargets,
    recommendedNextActions,
    autoRestored: false,
    incidentsClosedByAgent: false,
    mutatedQuarantine: false,
    usedFrozenDetection: detectionSnapshot != null,
    detectionSource,
    detectionIdentity,
    quarantineLifecycle,
    catalogActionIds,
    executableActionIds,
  }

  return {
    verified: !hardFail,
    checks: { ...checks },
    passNotes: [...passNotes],
    failReasons: [...failReasons],
    primaryReason,
    recommendedNextActions,
    verification,
    checkDetails,
    /** Compat aliases for older callers / storage */
    ok: !hardFail,
    verdict,
    reasons,
  }
}

/**
 * @deprecated Prefer verifyResponseStep for orchestration decisions (STEP 15).
 * Thin adapter preserving Recovery Agent test / forensic API shape.
 */
export function runRecoveryAgent(opts = {}) {
  const step = verifyResponseStep(opts)
  return {
    ok: step.verified === true,
    verdict: step.verdict,
    reasons: step.reasons ?? [
      ...(step.failReasons || []),
      ...(step.passNotes || []),
    ],
    failReasons: step.failReasons ?? [],
    passNotes: step.passNotes ?? [],
    primaryReason: step.primaryReason,
    checks: step.checks,
    checkDetails: step.checkDetails,
    recommendedNextActions: step.recommendedNextActions ?? [],
    verification: step.verification,
  }
}

function captureCurrentSnapshotFromDetection(room, plan, detection) {
  const affected = Array.isArray(plan?.affectedNodeIds)
    ? plan.affectedNodeIds.map(String)
    : []
  const primaryId = plan?.primaryIncidentId != null ? String(plan.primaryIncidentId) : null
  const primaryInc = (detection?.incidents ?? []).find(
    (inc) =>
      String(inc?.id) === primaryId ||
      String(inc?.persistentId ?? '') === primaryId
  )
  const targetIds = sortedUnique([
    ...affected,
    ...(plan?.recommendedActions ?? [])
      .map((a) => a?.target?.id)
      .filter(Boolean),
  ])

  const quarantineByTarget = {}
  const residualByTarget = {}
  for (const id of targetIds) {
    quarantineByTarget[id] = isQuarantined(room, id)
    residualByTarget[id] = residualForNode(detection, id)
  }

  return {
    capturedAtMs: Date.now(),
    primaryIncidentId: primaryId,
    incidentIds: Array.isArray(plan?.incidentIds)
      ? sortedUnique(plan.incidentIds)
      : [],
    affectedNodeIds: targetIds,
    anomalyNodeIds: sortedUnique(detection?.anomalyNodeIds ?? []),
    openIncidentIds: openIncidentIds(detection),
    openEndpointIds: openIncidentEndpointIds(detection),
    peerExposedNodeIds: sortedUnique(detection?.peerExposedNodeIds ?? []),
    propagatedNodeIds: sortedUnique(detection?.propagatedNodeIds ?? []),
    atRiskNodeIds: sortedUnique(detection?.atRiskNodeIds ?? []),
    quarantineByTarget,
    residualByTarget,
    recoveryPriority:
      Number.isFinite(Number(primaryInc?.recoveryPriority))
        ? Number(primaryInc.recoveryPriority)
        : Number.isFinite(Number(plan?.expectedImpact?.recoveryPriority))
          ? Number(plan.expectedImpact.recoveryPriority)
          : null,
    expectedImpact: plan?.expectedImpact
      ? {
          certainRecoveryCount: plan.expectedImpact.certainRecoveryCount ?? 0,
          mayReduceExposureCount: plan.expectedImpact.mayReduceExposureCount ?? 0,
          independentlyCompromisedCount:
            plan.expectedImpact.independentlyCompromisedCount ?? 0,
        }
      : null,
  }
}
