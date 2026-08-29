import { TRUST_CONFIG } from '@shared/trustConfig.js'
import {
  applyIntrinsicCaps,
  criticalityFromTrust,
  intrinsicFromTypeAndCriticality,
} from '@shared/trustModel.js'
import { getAssetByType } from './assetCatalog'
import { clampNonNegative, normalizeMetricSnapshot } from './nodeMetrics'
import { numericTelemetryBag } from '@shared/telemetryKeys.js'
import { yamlIdForCatalogType } from '@shared/cityModel/endpointMap.js'

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

/**
 * Catalog / stored type reputation (not mixed with criticality).
 */
export function getNodeTypeTrust(data) {
  const hinted = data?.behaviour?.intrinsicTrust
  if (typeof hinted === 'number' && Number.isFinite(hinted)) {
    return Math.max(0, Math.min(100, hinted))
  }
  const asset = getAssetByType(nodeTypeOf(data))
  const catalogTrust =
    typeof asset?.intrinsicTrust === 'number' && Number.isFinite(asset.intrinsicTrust)
      ? asset.intrinsicTrust
      : TRUST_CONFIG.intrinsic.fallbackTypeTrust
  return catalogTrust
}

/**
 * Prefer node-owned behaviour.intrinsicTrust as type reputation, then mix criticality + caps.
 */
export function getNodeIntrinsicTrust(data) {
  return intrinsicFromTypeAndCriticality({
    typeTrust: getNodeTypeTrust(data),
    criticality: data?.criticality,
    runtime: runtimeStateOf(data),
  })
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

export function dataFromAsset(asset, { provenance, label } = {}) {
  const trust =
    typeof asset?.intrinsicTrust === 'number' && Number.isFinite(asset.intrinsicTrust)
      ? Math.max(0, Math.min(100, asset.intrinsicTrust))
      : TRUST_CONFIG.intrinsic.fallbackTypeTrust
  const telemetry = {
    packetsPerSecond: clampNonNegative(asset?.defaultPacketsPerSecond ?? 0),
    httpRequestsPerMin: clampNonNegative(asset?.defaultHttpRequestsPerMin ?? 0),
    filesDownloaded: clampNonNegative(asset?.defaultFilesDownloaded ?? 0),
    failedLoginsPerMin: clampNonNegative(asset?.defaultFailedLoginsPerMin ?? 0),
  }
  const prov =
    provenance === 'injected' || asset?.provenance === 'injected'
      ? 'injected'
      : 'legitimate'
  return {
    type: String(asset?.type ?? 'unknown'),
    label: String(label ?? asset?.title ?? 'Untitled system'),
    sector: String(asset?.domain ?? ''),
    criticality: normalizeCriticality(
      asset?.defaultCriticality,
      criticalityFromTrust(trust)
    ),
    runtimeState: {
      provenance: prov,
      quarantined: false,
    },
    behaviour: { intrinsicTrust: trust },
    telemetry,
    cityEndpointId: yamlIdForCatalogType(asset?.type) ?? undefined,
  }
}

function fillFromCatalog(type, data) {
  const asset = getAssetByType(type)
  if (!asset) return data
  const fromAsset = dataFromAsset(asset, {
    provenance: data.runtimeState?.provenance,
    label: data.label,
  })
  return {
    type: data.type || fromAsset.type,
    label: data.label || fromAsset.label,
    sector: data.sector || fromAsset.sector,
    criticality: data.criticality || fromAsset.criticality,
    runtimeState: data.runtimeState,
    behaviour: {
      intrinsicTrust:
        typeof data.behaviour?.intrinsicTrust === 'number'
          ? data.behaviour.intrinsicTrust
          : fromAsset.behaviour.intrinsicTrust,
    },
    telemetry: {
      packetsPerSecond:
        data.telemetry.packetsPerSecond || fromAsset.telemetry.packetsPerSecond,
      httpRequestsPerMin:
        data.telemetry.httpRequestsPerMin || fromAsset.telemetry.httpRequestsPerMin,
      filesDownloaded:
        data.telemetry.filesDownloaded || fromAsset.telemetry.filesDownloaded,
      failedLoginsPerMin:
        data.telemetry.failedLoginsPerMin || fromAsset.telemetry.failedLoginsPerMin,
    },
    cityEndpointId: data.cityEndpointId || fromAsset.cityEndpointId,
  }
}

/**
 * Lift legacy flat `assetType` / metric / provenance fields into InfrastructureNode data.
 */
export function normalizeInfrastructureData(rawData, extra = {}) {
  const data = rawData && typeof rawData === 'object' ? rawData : {}
  const type = nodeTypeOf({ ...data, type: extra.type ?? data.type })
  const runtime = runtimeStateOf(data)
  const telemetry = normalizeMetricSnapshot(
    {
      ...telemetryOf(data),
      ...(extra.telemetry ?? {}),
    },
    { data: { ...data, type, telemetry: telemetryOf(data) } }
  )
  const hintedTrust = data.behaviour?.intrinsicTrust
  let next = {
    type,
    label: String(data.label ?? extra.label ?? 'Untitled system'),
    sector: String(data.sector ?? data.category ?? extra.sector ?? ''),
    criticality: normalizeCriticality(data.criticality ?? extra.criticality, ''),
    runtimeState: {
      provenance: runtime.provenance,
      quarantined: runtime.quarantined,
    },
    behaviour: {
      intrinsicTrust:
        typeof hintedTrust === 'number' && Number.isFinite(hintedTrust)
          ? Math.max(0, Math.min(100, hintedTrust))
          : undefined,
    },
    telemetry,
    cityEndpointId: data.cityEndpointId || extra.cityEndpointId || yamlIdForCatalogType(type) || undefined,
  }
  next = fillFromCatalog(type, next)
  if (!CRITICALITY_LEVELS.includes(next.criticality)) {
    next.criticality = criticalityFromTrust(next.behaviour.intrinsicTrust)
  }
  if (typeof next.behaviour.intrinsicTrust !== 'number') {
    next.behaviour.intrinsicTrust = TRUST_CONFIG.intrinsic.fallbackTypeTrust
  }
  return next
}

export function normalizeInfrastructureNode(raw) {
  const n = raw && typeof raw === 'object' ? raw : {}
  const data = normalizeInfrastructureData(n.data, {})
  const rfType = INFRASTRUCTURE_NODE_TYPE
  return {
    id: String(n.id),
    type: rfType,
    position: {
      x: Number(n.position?.x ?? 0),
      y: Number(n.position?.y ?? 0),
    },
    data,
  }
}

export function persistInfrastructureData(data) {
  const n = normalizeInfrastructureData(data)
  return {
    type: n.type,
    label: n.label,
    sector: n.sector,
    criticality: n.criticality,
    runtimeState: n.runtimeState,
    behaviour: n.behaviour,
    telemetry: n.telemetry,
  }
}
