/**
 * Recovery Agent — closed-loop verification (STEP 4).
 *
 * Answers: after approved response actions executed, is the system safer?
 * Compares a pre-execution baseline with the current post-response room state.
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

export const VERIFICATION_VERDICT = Object.freeze({
  RECOVERED: 'RECOVERED',
  REPLAN_REQUIRED: 'REPLAN_REQUIRED',
})

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

function captureCurrentSnapshot(room, plan = null) {
  return captureVerificationBaseline(room, plan)
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
 * Pure verification. No room mutations.
 *
 * Successful isolation + target remains quarantined = containment maintained (pass).
 * Quarantine is never "full recovery", but it must not cause failure by itself.
 * Remaining / decreasing in-scope active incidents are not hard fails — STEP 9
 * continuation handles them.
 *
 * Hard fail only when:
 * - execution incomplete/failed
 * - isolate target lost quarantine (containment not held)
 * - new out-of-scope anomaly seeds
 * - new independent open incidents outside containment scope
 * - residual clearly worsening on isolate targets
 *
 * @returns {{
 *   ok: boolean,
 *   verdict: 'RECOVERED'|'REPLAN_REQUIRED',
 *   reasons: string[],
 *   failReasons: string[],
 *   passNotes: string[],
 *   primaryReason: string|null,
 *   checks: object,
 *   recommendedNextActions: object[],
 *   verification: object,
 * }}
 */
export function runRecoveryAgent({
  room,
  plan,
  execution,
  baseline = null,
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
      ok: false,
      verdict: VERIFICATION_VERDICT.REPLAN_REQUIRED,
      reasons: ['Room and approved plan required for verification'],
      failReasons: ['Room and approved plan required for verification'],
      passNotes: [],
      primaryReason: 'Room and approved plan required for verification',
      checks,
      recommendedNextActions: [],
      verification: null,
    }
  }

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
    // Success note — never a failure reason. Quarantine ≠ episode recovery.
    passNotes.push(
      `Containment maintained on ${isolateTargets.length} isolate target${
        isolateTargets.length === 1 ? '' : 's'
      } (quarantine held — not auto-restored)`
    )
  }

  const current = captureCurrentSnapshot(room, plan)
  const base = baseline && typeof baseline === 'object' ? baseline : null
  const scope = new Set([
    ...(base?.affectedNodeIds ?? []),
    ...isolateTargets,
    ...(plan?.affectedNodeIds ?? []).map(String),
  ])

  // New anomaly seeds outside planned containment scope → replan
  const currentAnomalies = new Set(current.anomalyNodeIds)
  const baselineAnomalies = new Set(base?.anomalyNodeIds ?? [])
  const newOutOfScope = [...currentAnomalies].filter(
    (id) => !baselineAnomalies.has(id) && !scope.has(id)
  )
  checks.noNewOutOfScopeAnomalies = newOutOfScope.length === 0
  if (newOutOfScope.length) {
    failReasons.push(
      `New out-of-scope anomaly seeds after response: ${newOutOfScope.join(', ')}`
    )
  } else {
    passNotes.push('No new out-of-scope anomaly seeds observed')
  }

  // New independent open incidents outside containment scope (includes relief candidates).
  // Remaining baseline / in-scope open incidents are OK — STEP 9 continues those.
  const reliefIds = new Set(
    (plan?.expectedImpact?.reliefCandidateIds ?? []).map(String)
  )
  const baselineOpenEnds = new Set(base?.openEndpointIds ?? [])
  const currentOpenEnds = new Set(current.openEndpointIds)
  const newIndependentOpen = [...currentOpenEnds].filter(
    (id) => !baselineOpenEnds.has(id) && !scope.has(id)
  )
  checks.noNewIndependentOpenOnRelief = newIndependentOpen.length === 0
  if (newIndependentOpen.length) {
    failReasons.push(
      `New independent open incidents outside containment scope: ${newIndependentOpen.join(', ')}`
    )
  } else {
    const openCountBefore = baselineOpenEnds.size
    const openCountAfter = currentOpenEnds.size
    if (openCountAfter < openCountBefore) {
      passNotes.push(
        `Active open endpoints decreased (${openCountBefore} → ${openCountAfter}); remaining in-scope work is not a verification failure`
      )
    } else if (reliefIds.size > 0) {
      passNotes.push(
        'No new independent open incidents outside containment scope (exposure relief remains MAY)'
      )
    } else {
      passNotes.push('No new independent open incidents outside containment scope')
    }
  }

  // Residual: quarantine may leave residual elevated; only fail if clearly worse
  let residualWorse = false
  if (base?.residualByTarget) {
    for (const id of isolateTargets) {
      const before = Number(base.residualByTarget[id])
      const after = residualForNode(room.detection, id)
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

  const hardFail =
    !checks.executionComplete ||
    !checks.containmentHeld ||
    !checks.noNewOutOfScopeAnomalies ||
    !checks.noNewIndependentOpenOnRelief ||
    checks.residualNotWorsening === false

  const verdict = hardFail
    ? VERIFICATION_VERDICT.REPLAN_REQUIRED
    : VERIFICATION_VERDICT.RECOVERED

  if (verdict === VERIFICATION_VERDICT.RECOVERED) {
    passNotes.push(
      'Step verification passed — containment assessed safer under current detection. Quarantine is not full recovery and was not auto-restored.'
    )
  }

  /** Fail reasons first so callers using reasons[0] never surface a pass note as the failure. */
  const reasons = hardFail
    ? [...failReasons, ...passNotes]
    : [...passNotes]
  const primaryReason = hardFail
    ? failReasons[0] || 'Recovery verification failed'
    : passNotes[passNotes.length - 1] || 'Containment verified'

  /** Recommend restore only when step verified and targets still quarantined — never auto-run. */
  const recommendedNextActions = []
  if (verdict === VERIFICATION_VERDICT.RECOVERED) {
    for (const id of isolateTargets) {
      if (isQuarantined(room, id)) {
        recommendedNextActions.push({
          actionId: 'restore-connectivity',
          target: { id },
          executable: true,
          autoExecute: false,
          reason:
            'Containment maintained. Restore is optional operator action via executeResponseAction — not auto-run.',
        })
      }
    }
  }

  const verification = {
    verifiedAtMs: nowMs,
    verdict,
    reasons: [...reasons],
    failReasons: [...failReasons],
    passNotes: [...passNotes],
    primaryReason,
    checks: { ...checks },
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
    /** Explicit non-claims */
    autoRestored: false,
    incidentsClosedByAgent: false,
    mutatedQuarantine: false,
  }

  return {
    ok: verdict === VERIFICATION_VERDICT.RECOVERED,
    verdict,
    reasons,
    failReasons,
    passNotes,
    primaryReason,
    checks,
    recommendedNextActions,
    verification,
  }
}
