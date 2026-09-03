import { detectionTypeLabel, formatEvidenceItem } from './incidents.js'

export const INCIDENT_STATUS = Object.freeze({
  OPEN: 'open',
  CLEARED: 'cleared',
})

export function riskPercent(anomalyScore) {
  if (anomalyScore == null || !Number.isFinite(Number(anomalyScore))) return null
  return Math.round(Number(anomalyScore) * 100)
}

export function nodeLabelFromRoom(room, id) {
  if (!id) return ''
  const n = (room?.nodes ?? []).find((node) => String(node.id) === String(id))
  return n?.data?.label ?? n?.label ?? String(id)
}

/**
 * Longest observed propagation path that starts at the incident seed.
 * Does not invent hops.
 */
export function primaryAttackPath(incident) {
  const seed = String(incident?.endpointId ?? '')
  let best = null

  const consider = (path) => {
    if (!Array.isArray(path) || path.length === 0) return
    const ids = path.map(String)
    if (seed && ids[0] !== seed) return
    if (!best || ids.length > best.length) best = ids
  }

  for (const d of incident?.affectedDependencies ?? []) {
    consider(d?.path)
  }
  const fromContext = incident?.graphContext?.primaryPath ?? incident?.graph_context?.primaryPath
  consider(fromContext)
  const paths = incident?.propagationPaths || incident?.graphContext?.propagationPaths || {}
  for (const path of Object.values(paths)) consider(path)

  if (best) return best
  return seed ? [seed] : []
}

export function hopDistanceOf(path) {
  const n = Array.isArray(path) ? path.length : 0
  return n > 1 ? n - 1 : 0
}

export function keySignals(incident) {
  const out = []
  const evidence = Array.isArray(incident?.evidence) ? incident.evidence : []
  const hasTgnn = evidence.some((ev) => {
    const code = String(ev?.code ?? '')
    const detail = String(ev?.detail ?? '')
    return code.startsWith('tgnn') || detail.startsWith('tgnn')
  })
  if (hasTgnn) out.push('Graph residual anomaly detected')

  // Peer exposure signal — secondary incident promoted from peer-exposed nodes
  const isPeerExposure = evidence.some((ev) => ev?.code === 'peer_exposure')
  if (isPeerExposure) {
    const hop = evidence.find((ev) => ev?.code === 'peer_exposure')?.hopDistance
    out.push(hop != null ? `Peer exposure (hop ${hop})` : 'Peer exposure')
  }

  // Graph propagation signal — secondary incident from BFS propagated nodes
  const isPropagation = evidence.some((ev) => ev?.code === 'graph_propagation')
  if (isPropagation && !isPeerExposure) {
    const hop = evidence.find((ev) => ev?.code === 'graph_propagation')?.hopDistance
    out.push(hop != null ? `Graph propagation risk (hop ${hop})` : 'Graph propagation risk')
  }

  const trustDrop = evidence.some((ev) => ev?.code === 'peer_trust_decrease')
  if (trustDrop) out.push('Trust degradation')

  const hops = hopDistanceOf(primaryAttackPath(incident))
  const propagated = (incident?.propagatedNodeIds ?? incident?.graphContext?.propagatedNodeIds ?? [])
    .length
  if (!isPeerExposure && !isPropagation && (hops > 0 || propagated > 0)) {
    out.push(hops > 0 ? `${hops}-hop propagation` : 'Downstream exposure')
  }

  if (out.length < 3) {
    const metric = evidence.find((ev) => ev?.code === 'metric_deviation')
    const line = metric ? formatEvidenceItem(metric) : ''
    if (line) out.push(line)
  }

  if (out.length < 3 && evidence.some((ev) => ev?.code === 'critical_infrastructure')) {
    out.push('Critical infrastructure asset')
  }

  return out.slice(0, 3)
}

export function whyItMatters(incident) {
  const label = incident?.endpointLabel || incident?.endpointId || 'This asset'
  const type = detectionTypeLabel(incident?.detectionType)
  const hops = hopDistanceOf(primaryAttackPath(incident))
  const fin = incident?.financialContext || incident?.financial_context
  const money =
    fin?.simulated === true && fin?.exposureLabel && fin.exposureLabel !== '₹0'
      ? ` Simulated economic exposure on mapped Smart City infrastructure is ${fin.exposureLabel} (demo mapping, not a loss forecast).`
      : ''
  const spread =
    hops > 0
      ? ` Observed dependency path continues ${hops} hop${hops === 1 ? '' : 's'} downstream (propagated risk, not additional confirmed anomalies).`
      : ''
  return `${label} was promoted as ${type}. Residual and trust signals are from this tick's detection.${spread}${money}`
}

export function labelPath(path, room) {
  return (path ?? []).map((id) => nodeLabelFromRoom(room, id) || String(id))
}
