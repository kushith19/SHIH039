import { TRUST_CONFIG } from '../shared/trustConfig.js'
import {
  applyIntrinsicCaps,
  criticalityFromTrust,
  intrinsicFromTypeAndCriticality,
} from '../shared/trustModel.js'
import { numericTelemetryBag } from '../shared/telemetryKeys.js'

export const INFRASTRUCTURE_NODE_TYPE = 'infrastructureNode'
export const LEGACY_REACT_FLOW_NODE_TYPE = 'iotDevice'

export const CRITICALITY_LEVELS = ['low', 'medium', 'high', 'critical']

export { applyIntrinsicCaps, criticalityFromTrust }

export function normalizeCriticality(raw, fallback = 'medium') {
  const s = String(raw ?? '').toLowerCase()
  return CRITICALITY_LEVELS.includes(s) ? s : fallback
}

export function nodeTypeOf(data) {
  const raw = data?.type ?? data?.assetType
  const s = String(raw ?? '').trim()
  return s || 'unknown'
}

export function runtimeStateOf(data) {
  const rs = data?.runtimeState && typeof data.runtimeState === 'object' ? data.runtimeState : {}
  return {
    provenance:
      rs.provenance === 'injected' || data?.provenance === 'injected'
        ? 'injected'
        : 'legitimate',
    quarantined: rs.quarantined === true || data?.quarantined === true,
  }
}

function clampNonNegative(n) {
  const num = Number(n)
  if (!Number.isFinite(num) || num < 0) return 0
  return num
}

export function telemetryOf(data) {
  const nested =
    data?.telemetry && typeof data.telemetry === 'object' ? data.telemetry : {}
  const merged = { ...nested }
  for (const key of ['packetsPerSecond', 'httpRequestsPerMin', 'filesDownloaded', 'failedLoginsPerMin']) {
    if (merged[key] === undefined && data?.[key] != null) merged[key] = data[key]
  }
  return numericTelemetryBag(merged)
}

export function getNodeTypeTrust(data) {
  const hinted = data?.behaviour?.intrinsicTrust
  if (typeof hinted === 'number' && Number.isFinite(hinted)) {
    return Math.max(0, Math.min(100, hinted))
  }
  return TRUST_CONFIG.intrinsic.fallbackTypeTrust
}

export function getNodeIntrinsicTrust(data) {
  return intrinsicFromTypeAndCriticality({
    typeTrust: getNodeTypeTrust(data),
    criticality: data?.criticality,
    runtime: runtimeStateOf(data),
  })
}

export function endpointTypeTrust(ep) {
  const hinted = ep?.behaviour?.intrinsicTrust
  if (typeof hinted === 'number' && Number.isFinite(hinted)) {
    return Math.max(0, Math.min(100, hinted))
  }
  return TRUST_CONFIG.intrinsic.fallbackTypeTrust
}

export function endpointIntrinsicTrust(ep) {
  return intrinsicFromTypeAndCriticality({
    typeTrust: endpointTypeTrust(ep),
    criticality: ep?.criticality,
    runtime: ep?.runtimeState ?? {},
  })
}

export function normalizeInfrastructureData(rawData) {
  const data = rawData && typeof rawData === 'object' ? rawData : {}
  const type = nodeTypeOf(data)
  const runtime = runtimeStateOf(data)
  const telemetry = telemetryOf(data)
  const hintedTrust = data.behaviour?.intrinsicTrust
  const intrinsicTrust =
    typeof hintedTrust === 'number' && Number.isFinite(hintedTrust)
      ? Math.max(0, Math.min(100, hintedTrust))
      : TRUST_CONFIG.intrinsic.fallbackTypeTrust
  const criticality = normalizeCriticality(
    data.criticality,
    criticalityFromTrust(intrinsicTrust)
  )
  return {
    type,
    label: String(data.label ?? 'Untitled system'),
    sector: String(data.sector ?? data.category ?? ''),
    criticality,
    runtimeState: {
      provenance: runtime.provenance,
      quarantined: runtime.quarantined,
    },
    behaviour: { intrinsicTrust },
    telemetry,
  }
}
