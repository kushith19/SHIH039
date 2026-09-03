/**
 * Pure view helpers for the persisted-incident chronology.
 * Does not correlate campaigns and does not invent events.
 */

export const HISTORY_TIMELINE_CAPTION =
  'This match — chronological detections. Clears with the match, not a global archive.'

export function formatHistoryClock(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return new Date(n).toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function compactExposure(financialContext) {
  const fin = financialContext
  if (!fin || fin.simulated !== true) return null
  const label = String(fin.exposureLabel ?? '').trim()
  if (!label || label === '₹0') return null
  return `${label} simulated exposure`
}

/**
 * Map persisted history rows to compact timeline events (1:1).
 * order: newest-first (default, matches history API) or oldest-first.
 */
export function historyEventsFromIncidents(incidents, { order = 'newest-first' } = {}) {
  const rows = (Array.isArray(incidents) ? incidents : [])
    .filter((row) => row && (row.incidentId || row.id) && (row.affectedNodeId || row.endpointId))
    .map((row) => ({
      incidentId: String(row.incidentId ?? row.id),
      liveIncidentId: row.liveIncidentId ? String(row.liveIncidentId) : null,
      detectedAtMs: Number(row.detectedAtMs) || 0,
      timeLabel: formatHistoryClock(row.detectedAtMs),
      affectedNodeId: String(row.affectedNodeId ?? row.endpointId ?? ''),
      affectedNodeLabel: String(
        row.affectedNodeLabel || row.endpointLabel || row.affectedNodeId || row.endpointId || ''
      ),
      incidentType: row.incidentType ?? row.detectionType ?? null,
      severity: String(row.severity ?? 'low').toLowerCase(),
      status: String(row.status ?? 'open').toLowerCase(),
      summary: row.summary ? String(row.summary) : null,
      campaignId: row.campaignId || null,
      exposureLabel: compactExposure(row.financialContext),
    }))

  const dir = String(order).toLowerCase()
  const oldestFirst = dir === 'asc' || dir === 'oldest' || dir === 'oldest-first'
  rows.sort((a, b) => {
    const dt = oldestFirst
      ? a.detectedAtMs - b.detectedAtMs
      : b.detectedAtMs - a.detectedAtMs
    if (dt !== 0) return dt
    return oldestFirst
      ? String(a.incidentId).localeCompare(String(b.incidentId))
      : String(b.incidentId).localeCompare(String(a.incidentId))
  })
  return rows
}

/**
 * Attach backend campaign metadata onto timeline events.
 * Does not invent campaigns — only copies ids already present on incidents
 * and annotates with status/count from the campaigns API payload.
 */
export function annotateHistoryEventsWithCampaigns(events, campaigns) {
  const byId = new Map()
  for (const c of campaigns ?? []) {
    if (!c?.campaignId) continue
    byId.set(String(c.campaignId), {
      campaignId: String(c.campaignId),
      status: c.status || 'suspected',
      incidentCount: c.incidentCount ?? c.sequence?.length ?? 0,
    })
  }
  return (events ?? []).map((ev) => {
    const meta = ev.campaignId ? byId.get(String(ev.campaignId)) : null
    return {
      ...ev,
      campaignStatus: meta?.status ?? null,
      campaignIncidentCount: meta?.incidentCount ?? null,
    }
  })
}

/**
 * Selection key for the live IncidentsPanel queue / Incident Card.
 * Prefers affected node id so it matches streamKey(inc) = endpointId.
 */
export function timelineSelectionKey(event) {
  if (!event) return null
  if (event.affectedNodeId) return String(event.affectedNodeId)
  if (event.liveIncidentId) return String(event.liveIncidentId)
  return null
}

/** True when a live incident row can be opened from a history timeline event. */
export function liveIncidentMatchesTimelineEvent(liveInc, event) {
  if (!liveInc || !event) return false
  const node = String(liveInc.endpointId ?? '')
  if (node && node === String(event.affectedNodeId ?? '')) return true
  const liveId = String(liveInc.id ?? '')
  if (liveId && liveId === String(event.liveIncidentId ?? '')) return true
  const persistent = String(liveInc.persistentId ?? '')
  if (persistent && persistent === String(event.incidentId ?? '')) return true
  return false
}
