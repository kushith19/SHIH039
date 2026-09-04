import { MarkerType } from '@xyflow/react'
import { buildCityDependencyGraph } from './cityModel'
import {
  INFRASTRUCTURE_NODE_TYPE,
  persistInfrastructureData,
  normalizeInfrastructureNode,
  normalizeInfrastructureData,
} from './infrastructureNode'
import {
  buildAttackLayerFromGraph,
  clampNonNegative,
  normalizeMetricPatch,
  normalizeMetricSnapshot,
} from './nodeMetrics'

export const GRAPH_IO_VERSION = 5
const GRAPH_IO_VERSION_4 = 4
const GRAPH_IO_VERSION_3 = 3
const GRAPH_IO_VERSION_2 = 2
const LEGACY_GRAPH_IO_VERSION = 1
const NODE_TYPE = INFRASTRUCTURE_NODE_TYPE
const EDGE_TYPE = 'directedLabeled'

/** Maps v1 sector keys onto city catalog types (never onto IoT role names). */
const LEGACY_V1_TYPE_TO_CITY = {
  traffic: 'traffic_management',
  healthcare: 'healthcare',
  financial: 'banking_financial',
  citizen: 'citizen_services',
  data_center: 'data_centers',
  iot: 'environmental_monitoring',
  power_grid: 'power_grid',
}

function migrateLegacyAssetType(assetType) {
  const raw = String(assetType ?? '')
  return LEGACY_V1_TYPE_TO_CITY[raw] ?? raw
}

/** v1 JSON used `risk` (0–100); keyed by legacy `assetType` before migration */
const LEGACY_DEFAULT_RISK_BY_TYPE = {
  traffic: 25,
  healthcare: 35,
  financial: 55,
  citizen: 20,
  data_center: 40,
  iot: 65,
  power_grid: 45,
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`Graph JSON: "${name}" must be an array`)
  return value
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeNodeDataCurrent(n) {
  return normalizeInfrastructureNode(n)
}

function normalizeNodeDataV1(n) {
  if (!isRecord(n)) throw new Error('Invalid node entry')
  const rawAssetType = String(n.data?.assetType ?? n.data?.type ?? '')
  const riskFallback = LEGACY_DEFAULT_RISK_BY_TYPE[rawAssetType] ?? 0
  const riskRaw = Number(n.data?.risk ?? riskFallback)
  const risk = Number.isFinite(riskRaw)
    ? Math.max(0, Math.min(100, riskRaw))
    : 0
  const packetsPerSecond = Math.round(risk * 1000)
  const type = migrateLegacyAssetType(rawAssetType)
  return normalizeInfrastructureNode({
    id: n.id,
    type: NODE_TYPE,
    position: n.position,
    data: {
      ...n.data,
      type,
      label: n.data?.label,
      telemetry: { packetsPerSecond },
    },
  })
}

export function serializeGraph({ nodes, edges, viewport }) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new Error('serializeGraph expects { nodes: Node[], edges: Edge[] }')
  }

  const safeNodes = nodes.map((n) => {
    const normalized = normalizeInfrastructureNode(n)
    return {
      id: normalized.id,
      type: NODE_TYPE,
      position: normalized.position,
      data: persistInfrastructureData(normalized.data),
    }
  })

  const safeEdges = edges.map((e) => ({
    id: String(e.id),
    type: EDGE_TYPE,
    source: String(e.source),
    target: String(e.target),
    sourceHandle: e.sourceHandle ? String(e.sourceHandle) : null,
    targetHandle: e.targetHandle ? String(e.targetHandle) : null,
    markerEndType: 'arrowClosed',
    data: {
      label: String(e.data?.label ?? ''),
      packetsPerSecond: clampNonNegative(e.data?.packetsPerSecond ?? 0),
    },
  }))

  const safeViewport = viewport
    ? {
        x: Number(viewport.x ?? 0),
        y: Number(viewport.y ?? 0),
        zoom: Number(viewport.zoom ?? 1),
      }
    : { x: 0, y: 0, zoom: 1 }

  const nodeById = Object.fromEntries(safeNodes.map((n) => [n.id, n]))

  function endpoint(nodeId) {
    const n = nodeById[nodeId]
    return {
      nodeId,
      label: n?.data?.label ?? '',
      type: n?.data?.type ?? '',
      packetsPerSecond: n?.data?.telemetry?.packetsPerSecond ?? 0,
    }
  }

  const directedEdges = safeEdges.map((e) => ({
    edgeId: e.id,
    from: endpoint(e.source),
    to: endpoint(e.target),
    linkLabel: e.data.label,
    packetsPerSecondOnLink: e.data.packetsPerSecond,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }))

  const directedAdjacency = Object.fromEntries(
    safeNodes.map((n) => [n.id, { outgoing: [], incoming: [] }])
  )

  for (const arc of directedEdges) {
    const {
      edgeId,
      from,
      to,
      linkLabel,
      packetsPerSecondOnLink,
      sourceHandle,
      targetHandle,
    } = arc
    directedAdjacency[from.nodeId].outgoing.push({
      edgeId,
      toNodeId: to.nodeId,
      toLabel: to.label,
      toType: to.type,
      linkLabel,
      packetsPerSecondOnLink,
      sourceHandle,
      targetHandle,
    })
    directedAdjacency[to.nodeId].incoming.push({
      edgeId,
      fromNodeId: from.nodeId,
      fromLabel: from.label,
      fromType: from.type,
      linkLabel,
      packetsPerSecondOnLink,
      sourceHandle,
      targetHandle,
    })
  }

  const graph = {
    directedEdges,
    directedAdjacency,
    connections: directedEdges.map((arc) => ({
      edgeId: arc.edgeId,
      fromNodeId: arc.from.nodeId,
      toNodeId: arc.to.nodeId,
      fromLabel: arc.from.label,
      toLabel: arc.to.label,
      fromType: arc.from.type,
      toType: arc.to.type,
      linkLabel: arc.linkLabel,
      packetsPerSecondOnLink: arc.packetsPerSecondOnLink,
      sourceHandle: arc.sourceHandle,
      targetHandle: arc.targetHandle,
    })),
  }

  return {
    version: GRAPH_IO_VERSION,
    nodes: safeNodes,
    edges: safeEdges,
    viewport: safeViewport,
    graph,
  }
}

export const DEFAULT_HACK_SIMULATOR = {
  active: false,
  nodeOverrides: {},
  edgeOverrides: {},
  nodeScenarioBaselines: undefined,
  edgeScenarioBaselines: undefined,
  attackSpreadMode: 'manual',
}

export function getDefaultCanvasState() {
  const { nodes, edges, viewport } = buildCityDependencyGraph()
  const serialized = serializeGraph({ nodes, edges, viewport })
  return parseGraphJson(
    JSON.stringify({
      ...serialized,
      hackSimulator: DEFAULT_HACK_SIMULATOR,
    })
  )
}

export function recoverScenarioBaselinesIfNeeded(sim, nodes, edges) {
  if (!sim.active || !isRecord(sim)) return sim
  const nodeLocks = sim.nodeScenarioBaselines
  const edgeLocks = sim.edgeScenarioBaselines
  const hasNodeLocks = isRecord(nodeLocks) && Object.keys(nodeLocks).length > 0
  const hasEdgeLocks = isRecord(edgeLocks) && Object.keys(edgeLocks).length > 0
  if (hasNodeLocks && hasEdgeLocks) return sim

  return {
    ...sim,
    nodeScenarioBaselines: hasNodeLocks
      ? nodeLocks
      : Object.fromEntries(
          nodes.map((n) => [n.id, normalizeMetricSnapshot(n.data, n)])
        ),
    edgeScenarioBaselines: hasEdgeLocks
      ? edgeLocks
      : Object.fromEntries(
          edges.map((e) => [e.id, clampNonNegative(e.data?.packetsPerSecond ?? 0)])
        ),
  }
}

export { buildAttackLayerFromGraph }

export function sanitizeHackSimulator(value, nodeIds, edgeIds) {
  const nodeSet = new Set(nodeIds)
  const edgeSet = new Set(edgeIds)
  if (!isRecord(value)) {
    return {
      active: false,
      nodeOverrides: {},
      edgeOverrides: {},
      nodeScenarioBaselines: undefined,
      edgeScenarioBaselines: undefined,
    }
  }
  const active = value.active === true
  const nodeOverrides = {}
  const edgeOverrides = {}
  if (isRecord(value.nodeOverrides)) {
    for (const [k, v] of Object.entries(value.nodeOverrides)) {
      const id = String(k)
      if (!nodeSet.has(id)) continue
      const patch = normalizeMetricPatch(v)
      if (Object.keys(patch).length > 0) nodeOverrides[id] = patch
    }
  }
  if (isRecord(value.edgeOverrides)) {
    for (const [k, v] of Object.entries(value.edgeOverrides)) {
      const id = String(k)
      if (edgeSet.has(id)) edgeOverrides[id] = clampNonNegative(v)
    }
  }

  const nodeScenarioBaselines = {}
  if (isRecord(value.nodeScenarioBaselines)) {
    for (const [k, v] of Object.entries(value.nodeScenarioBaselines)) {
      const id = String(k)
      if (!nodeSet.has(id)) continue
      if (typeof v === 'number' && Number.isFinite(v)) {
        nodeScenarioBaselines[id] = { packetsPerSecond: clampNonNegative(v) }
      } else if (isRecord(v)) {
        nodeScenarioBaselines[id] = normalizeMetricPatch(v)
        if (Object.keys(nodeScenarioBaselines[id]).length === 0) {
          delete nodeScenarioBaselines[id]
        }
      }
    }
  }
  const edgeScenarioBaselines = {}
  if (isRecord(value.edgeScenarioBaselines)) {
    for (const [k, v] of Object.entries(value.edgeScenarioBaselines)) {
      const id = String(k)
      if (edgeSet.has(id)) edgeScenarioBaselines[id] = clampNonNegative(v)
    }
  }

  return {
    active,
    nodeOverrides,
    edgeOverrides,
    nodeScenarioBaselines:
      Object.keys(nodeScenarioBaselines).length > 0 ? nodeScenarioBaselines : undefined,
    edgeScenarioBaselines:
      Object.keys(edgeScenarioBaselines).length > 0 ? edgeScenarioBaselines : undefined,
  }
}

export function buildCanvasPersistPayload({ nodes, edges, viewport, hackSimulator }) {
  return {
    ...serializeGraph({ nodes, edges, viewport }),
    hackSimulator: {
      active: hackSimulator.active === true,
      nodeOverrides: { ...hackSimulator.nodeOverrides },
      edgeOverrides: { ...hackSimulator.edgeOverrides },
      ...(hackSimulator.nodeScenarioBaselines &&
      Object.keys(hackSimulator.nodeScenarioBaselines).length > 0
        ? { nodeScenarioBaselines: { ...hackSimulator.nodeScenarioBaselines } }
        : {}),
      ...(hackSimulator.edgeScenarioBaselines &&
      Object.keys(hackSimulator.edgeScenarioBaselines).length > 0
        ? { edgeScenarioBaselines: { ...hackSimulator.edgeScenarioBaselines } }
        : {}),
    },
  }
}

export const CANVAS_GRAPH_STORAGE_KEY = 'smarthackathon.canvas.graph.v1'

export function loadPersistedGraph() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(CANVAS_GRAPH_STORAGE_KEY)
    if (!raw) return null
    return parseGraphJson(raw)
  } catch {
    return null
  }
}

export function persistGraphJson(jsonText) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CANVAS_GRAPH_STORAGE_KEY, jsonText)
  } catch {
    /* quota / private mode */
  }
}

export function parseGraphJson(jsonText) {
  let obj
  if (typeof jsonText === 'string') {
    obj = JSON.parse(jsonText)
  } else {
    obj = jsonText
  }

  if (!isRecord(obj)) throw new Error('Invalid graph JSON (expected an object)')

  const version = obj.version
  if (
    version !== GRAPH_IO_VERSION &&
    version !== GRAPH_IO_VERSION_4 &&
    version !== GRAPH_IO_VERSION_3 &&
    version !== GRAPH_IO_VERSION_2 &&
    version !== LEGACY_GRAPH_IO_VERSION
  ) {
    throw new Error(
      `Unsupported graph version. Expected ${GRAPH_IO_VERSION}, ${GRAPH_IO_VERSION_4}, ${GRAPH_IO_VERSION_3}, ${GRAPH_IO_VERSION_2}, or ${LEGACY_GRAPH_IO_VERSION}, got ${version}`
    )
  }

  const nodesArr = requireArray(obj.nodes, 'nodes')
  const edgesArr = requireArray(obj.edges, 'edges')

  const viewportObj = isRecord(obj.viewport) ? obj.viewport : null
  const viewport = viewportObj
    ? {
        x: Number(viewportObj.x ?? 0),
        y: Number(viewportObj.y ?? 0),
        zoom: Number(viewportObj.zoom ?? 1),
      }
    : { x: 0, y: 0, zoom: 1 }

  const normalizeNode =
    version === LEGACY_GRAPH_IO_VERSION ? normalizeNodeDataV1 : normalizeNodeDataCurrent

  const nodes = nodesArr.map((n) => normalizeNode(n))

  const edges = edgesArr.map((e) => {
    if (!isRecord(e)) throw new Error('Invalid edge entry')
    const edgePps =
      version === GRAPH_IO_VERSION ||
      version === GRAPH_IO_VERSION_4 ||
      version === GRAPH_IO_VERSION_3
        ? clampNonNegative(e.data?.packetsPerSecond ?? 0)
        : 0
    return {
      id: String(e.id),
      type: EDGE_TYPE,
      source: String(e.source),
      target: String(e.target),
      sourceHandle: e.sourceHandle ? String(e.sourceHandle) : undefined,
      targetHandle: e.targetHandle ? String(e.targetHandle) : undefined,
      markerEnd: { type: MarkerType.ArrowClosed },
      data: {
        label: String(e.data?.label ?? ''),
        packetsPerSecond: edgePps,
      },
    }
  })

  const nodeIds = nodes.map((n) => n.id)
  const edgeIds = edges.map((e) => e.id)
  const rawHack = sanitizeHackSimulator(obj.hackSimulator, nodeIds, edgeIds)
  const hackSimulator = recoverScenarioBaselinesIfNeeded(rawHack, nodes, edges)

  return { nodes, edges, viewport, hackSimulator }
}

export { NODE_TYPE, normalizeInfrastructureData }
