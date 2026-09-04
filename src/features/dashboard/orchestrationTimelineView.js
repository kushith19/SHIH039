/**
 * Merge Monitor detection chronology with per-incident orchestration lifecycle
 * events from responseOrchestration.workflowTrace (and related stamps).
 * Does not invent timestamps — only maps recorded backend transitions.
 */

import {
  annotateHistoryEventsWithCampaigns,
  formatHistoryClock,
  historyEventsFromIncidents,
} from './historyTimelineView.js'

export const ORCHESTRATION_TIMELINE_LABELS = Object.freeze({
  planner_started: 'Planner started',
  ai_plan_generated: 'AI plan generated',
  awaiting_approval: 'Awaiting approval',
  plan_approved: 'Plan approved',
  response_started: 'Response Agent started',
  response_executed: 'Response executed',
  recovery_verification: 'Recovery verification',
  incident_recovered: 'Incident recovered',
})

const KIND_ORDER = Object.freeze({
  detection: 0,
  evidence: 1,
  orchestration: 2,
})

function idsEqual(a, b) {
  if (a == null || b == null) return false
  return String(a) === String(b)
}

function atMsOf(entry) {
  const n = Number(entry?.atMs)
  if (Number.isFinite(n) && n > 0) return n
  const created = Number(entry?.createdAt)
  if (Number.isFinite(created) && created > 0) return created
  const iso = entry?.timestamp
  if (typeof iso === 'string' && iso) {
    const t = Date.parse(iso)
    if (Number.isFinite(t) && t > 0) return t
  }
  return 0
}

/**
 * Resolve a workflow primaryIncidentId onto a persisted history row id.
 */
export function resolveHistoryIncidentId(primaryIncidentId, historyEvents = []) {
  const want = String(primaryIncidentId ?? '').trim()
  if (!want) return null
  for (const row of historyEvents) {
    if (idsEqual(row.incidentId, want)) return String(row.incidentId)
    if (idsEqual(row.liveIncidentId, want)) return String(row.incidentId)
  }
  return want
}

function incidentEnteredOrchestration(incidentId, historyIncidentId, startedIds) {
  if (!incidentId && !historyIncidentId) return false
  if (incidentId && startedIds.has(String(incidentId))) return true
  if (historyIncidentId && startedIds.has(String(historyIncidentId))) return true
  return false
}

/**
 * Map workflowTrace (+ light orchestration stamps) to Monitor lifecycle rows.
 * Only emits events for incidents that have entered orchestration (PLANNER_STARTED
 * or a later agent_loop phase with primaryIncidentId).
 */
export function orchestrationLifecycleEventsFromState(
  orchestration = null,
  { historyEvents = [] } = {}
) {
  const trace = Array.isArray(orchestration?.workflowTrace)
    ? orchestration.workflowTrace
    : []
  if (!trace.length && !orchestration?.approvedAtMs && !orchestration?.plan) {
    return []
  }

  const startedIds = new Set()
  for (const row of trace) {
    const phase = String(row?.phase ?? '')
    const primary = row?.primaryIncidentId
    if (!primary) continue
    if (
      phase === 'PLANNER_STARTED' ||
      phase === 'COMMANDER_PLAN' ||
      phase === 'HUMAN_APPROVED' ||
      phase === 'RESPONSE_EXECUTING' ||
      phase === 'RESPONSE_COMPLETED' ||
      phase === 'EPISODE_RECOVERED'
    ) {
      startedIds.add(String(primary))
      const hist = resolveHistoryIncidentId(primary, historyEvents)
      if (hist) startedIds.add(String(hist))
    }
  }

  const out = []
  const seen = new Set()

  function pushEvent({
    lifecycleKey,
    label,
    atMs,
    primaryIncidentId,
    planId = null,
    detail = null,
  }) {
    const historyIncidentId = resolveHistoryIncidentId(
      primaryIncidentId,
      historyEvents
    )
    if (
      !incidentEnteredOrchestration(
        primaryIncidentId,
        historyIncidentId,
        startedIds
      )
    ) {
      return
    }
    const ms = Number(atMs)
    if (!Number.isFinite(ms) || ms <= 0) return
    const incidentId = historyIncidentId || String(primaryIncidentId)
    const dedupe = `${lifecycleKey}|${incidentId}|${planId ?? ''}`
    if (seen.has(dedupe)) return
    seen.add(dedupe)

    const histRow = historyEvents.find((h) => idsEqual(h.incidentId, incidentId))
    out.push({
      eventKind: 'orchestration',
      lifecycleKey,
      label,
      incidentId: String(incidentId),
      liveIncidentId: histRow?.liveIncidentId ?? null,
      primaryIncidentId: primaryIncidentId != null ? String(primaryIncidentId) : null,
      planId: planId != null ? String(planId) : null,
      atMs: ms,
      timeLabel: formatHistoryClock(ms),
      affectedNodeId: histRow?.affectedNodeId ?? null,
      affectedNodeLabel: histRow?.affectedNodeLabel ?? null,
      severity: histRow?.severity ?? null,
      status: histRow?.status ?? null,
      incidentType: histRow?.incidentType ?? null,
      campaignId: histRow?.campaignId ?? null,
      detail,
    })
  }

  for (const row of trace) {
    const ms = atMsOf(row)
    const primary = row?.primaryIncidentId ?? null
    const planId = row?.planId ?? null
    const kind = String(row?.kind ?? '')
    const phase = String(row?.phase ?? '')

    if (kind === 'agent_loop') {
      if (phase === 'PLANNER_STARTED') {
        pushEvent({
          lifecycleKey: 'planner_started',
          label: ORCHESTRATION_TIMELINE_LABELS.planner_started,
          atMs: ms,
          primaryIncidentId: primary,
          planId,
        })
      } else if (phase === 'COMMANDER_PLAN') {
        // Only after a successful LLM-validated plan — never policy/deterministic.
        if (String(row.planSource ?? '') === 'llm') {
          pushEvent({
            lifecycleKey: 'ai_plan_generated',
            label: ORCHESTRATION_TIMELINE_LABELS.ai_plan_generated,
            atMs: ms,
            primaryIncidentId: primary,
            planId,
          })
        }
      } else if (phase === 'HUMAN_APPROVED') {
        pushEvent({
          lifecycleKey: 'plan_approved',
          label: ORCHESTRATION_TIMELINE_LABELS.plan_approved,
          atMs: ms,
          primaryIncidentId: primary,
          planId,
        })
      } else if (phase === 'RESPONSE_EXECUTING') {
        pushEvent({
          lifecycleKey: 'response_started',
          label: ORCHESTRATION_TIMELINE_LABELS.response_started,
          atMs: ms,
          primaryIncidentId: primary,
          planId,
        })
      } else if (phase === 'RESPONSE_COMPLETED') {
        pushEvent({
          lifecycleKey: 'response_executed',
          label: ORCHESTRATION_TIMELINE_LABELS.response_executed,
          atMs: ms,
          primaryIncidentId: primary,
          planId,
        })
      } else if (phase === 'VERIFICATION_EVIDENCE') {
        pushEvent({
          lifecycleKey: 'recovery_verification',
          label: ORCHESTRATION_TIMELINE_LABELS.recovery_verification,
          atMs: ms,
          primaryIncidentId: primary,
          planId,
        })
      } else if (phase === 'EPISODE_RECOVERED') {
        pushEvent({
          lifecycleKey: 'incident_recovered',
          label: ORCHESTRATION_TIMELINE_LABELS.incident_recovered,
          atMs: ms,
          primaryIncidentId: primary,
          planId,
        })
      }
      continue
    }

    if (kind === 'status_transition' && row?.newStatus === 'AWAITING_APPROVAL') {
      pushEvent({
        lifecycleKey: 'awaiting_approval',
        label: ORCHESTRATION_TIMELINE_LABELS.awaiting_approval,
        atMs: ms,
        primaryIncidentId: primary,
        planId,
      })
      continue
    }

    if (kind === 'observational_verification') {
      pushEvent({
        lifecycleKey: 'recovery_verification',
        label: ORCHESTRATION_TIMELINE_LABELS.recovery_verification,
        atMs: ms,
        primaryIncidentId: primary ?? orchestration?.plan?.primaryIncidentId,
        planId: planId ?? orchestration?.plan?.planId,
      })
    }
  }

  // Fallback stamps when agent_loop rows are sparse but state has real times.
  const plan = orchestration?.plan
  if (plan?.planSource === 'llm' && Number(plan.createdAt) > 0) {
    pushEvent({
      lifecycleKey: 'ai_plan_generated',
      label: ORCHESTRATION_TIMELINE_LABELS.ai_plan_generated,
      atMs: plan.createdAt,
      primaryIncidentId: plan.primaryIncidentId,
      planId: plan.planId,
    })
  }
  if (Number(orchestration?.approvedAtMs) > 0) {
    pushEvent({
      lifecycleKey: 'plan_approved',
      label: ORCHESTRATION_TIMELINE_LABELS.plan_approved,
      atMs: orchestration.approvedAtMs,
      primaryIncidentId: plan?.primaryIncidentId ?? orchestration?.currentIncidentId,
      planId: plan?.planId,
    })
  }
  const verifiedAt = Number(orchestration?.verification?.verifiedAtMs)
  if (Number.isFinite(verifiedAt) && verifiedAt > 0) {
    pushEvent({
      lifecycleKey: 'recovery_verification',
      label: ORCHESTRATION_TIMELINE_LABELS.recovery_verification,
      atMs: verifiedAt,
      primaryIncidentId: plan?.primaryIncidentId ?? orchestration?.currentIncidentId,
      planId: plan?.planId,
    })
  }

  return out
}

/**
 * Evidence collected — only when Level-1 evidence is present on the history row.
 * Uses the same detectedAtMs (no fabricated offset).
 */
export function evidenceTimelineEventsFromHistory(historyEvents = []) {
  const out = []
  for (const row of historyEvents) {
    const evidence = row?.evidence
    if (!Array.isArray(evidence) || evidence.length === 0) continue
    const ms = Number(row.detectedAtMs)
    if (!Number.isFinite(ms) || ms <= 0) continue
    out.push({
      eventKind: 'evidence',
      lifecycleKey: 'evidence_collected',
      label: 'Evidence collected',
      incidentId: String(row.incidentId),
      liveIncidentId: row.liveIncidentId ? String(row.liveIncidentId) : null,
      atMs: ms,
      timeLabel: formatHistoryClock(ms),
      affectedNodeId: row.affectedNodeId ?? null,
      affectedNodeLabel: row.affectedNodeLabel ?? null,
      severity: row.severity ?? null,
      status: row.status ?? null,
      incidentType: row.incidentType ?? null,
      campaignId: row.campaignId ?? null,
      detail: `${evidence.length} Level-1 item${evidence.length === 1 ? '' : 's'}`,
    })
  }
  return out
}

function sortMonitorEvents(events, order = 'newest-first') {
  const oldestFirst =
    String(order).toLowerCase() === 'asc' ||
    String(order).toLowerCase() === 'oldest' ||
    String(order).toLowerCase() === 'oldest-first'
  const list = [...events]
  list.sort((a, b) => {
    const dt = a.atMs - b.atMs
    if (dt !== 0) return dt
    const ka = KIND_ORDER[a.eventKind] ?? 9
    const kb = KIND_ORDER[b.eventKind] ?? 9
    if (ka !== kb) return ka - kb
    return String(a.incidentId).localeCompare(String(b.incidentId))
  })
  if (oldestFirst) return list
  return list.reverse()
}

/**
 * Full Monitor timeline: detection rows (unchanged shape) + evidence + orchestration.
 */
export function mergeMonitorTimelineEvents({
  incidents = [],
  campaigns = [],
  orchestration = null,
  order = 'newest-first',
} = {}) {
  const detectionBase = annotateHistoryEventsWithCampaigns(
    historyEventsFromIncidents(incidents, { order: 'oldest-first' }),
    campaigns
  ).map((ev) => ({
    ...ev,
    eventKind: 'detection',
    lifecycleKey: 'incident_detected',
    label: 'Incident detected',
    atMs: ev.detectedAtMs,
  }))

  // Attach evidence arrays from raw history for evidence rows (detection view omits them).
  const withEvidenceMeta = detectionBase.map((ev) => {
    const raw = (incidents ?? []).find(
      (row) =>
        String(row?.incidentId ?? row?.id ?? '') === String(ev.incidentId)
    )
    return { ...ev, evidence: raw?.evidence }
  })

  const evidence = evidenceTimelineEventsFromHistory(withEvidenceMeta)
  const orchestrationEvents = orchestrationLifecycleEventsFromState(orchestration, {
    historyEvents: detectionBase,
  })

  return sortMonitorEvents(
    [...detectionBase, ...evidence, ...orchestrationEvents],
    order
  )
}
