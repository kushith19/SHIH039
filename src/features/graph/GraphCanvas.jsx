import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  ReactFlowProvider,
  MarkerType,
  Panel,
  useOnSelectionChange,
  useReactFlow,
} from '@xyflow/react'
import InfrastructureNode from './nodeTypes/InfrastructureNode'
import DirectedLabeledEdge from './edgeTypes/DirectedLabeledEdge'
import CityMapBackground from './CityMapBackground'
import { MAP_TRANSLATE_EXTENT } from './cityMap'
import { getAssetByType } from './assetCatalog'
import { dataFromAsset, INFRASTRUCTURE_NODE_TYPE, telemetryOf } from './infrastructureNode'
import { HackSimulatorContext } from './hackSimulatorContext'
import {
  buildAttackLayerFromGraph,
  buildCanvasPersistPayload,
  DEFAULT_HACK_SIMULATOR,
  getDefaultCanvasState,
  parseGraphJson,
} from './graphIO'
import { buildTrustByNodeId, collectActiveAnomalies, getEdgeExpectedPps, getNodeBaselineMetrics, getNodeEffectiveMetrics, getNodeExpectedMetrics } from './peerTrust'
import {
  NODE_METRIC_KEYS,
  clampNonNegative,
  normalizeMetricPatch,
  pruneOverrideToBaseline,
} from './nodeMetrics'

const NODE_TYPE = INFRASTRUCTURE_NODE_TYPE
const EDGE_TYPE = 'directedLabeled'
const EMPTY_TRUST = Object.freeze({})

function graphApplySignature(nodes, edges) {
  let s = `${nodes.length},${edges.length}`
  for (const n of nodes) {
    const d = n.data ?? {}
    const rs = d.runtimeState ?? {}
    const t = d.telemetry ?? {}
    s += `|n${n.id},${n.position?.x},${n.position?.y},${d.type ?? ''},${rs.quarantined ? 1 : 0},${rs.provenance ?? ''},${d.label ?? ''},${t.packetsPerSecond ?? ''},${t.httpRequestsPerMin ?? ''},${t.filesDownloaded ?? ''},${t.failedLoginsPerMin ?? ''}`
  }
  for (const e of edges) {
    const d = e.data ?? {}
    s += `|e${e.id},${e.source},${e.target},${d.packetsPerSecond ?? ''},${d.label ?? ''}`
  }
  return s
}

function scenarioEdgeBaseline(e, sim) {
  const live = Number.isFinite(Number(e.data?.packetsPerSecond))
    ? Number(e.data.packetsPerSecond)
    : 0
  if (sim.active !== true) return live
  const locked = sim.edgeScenarioBaselines?.[e.id]
  if (locked !== undefined && Number.isFinite(locked)) return locked
  return live
}

function mergeNodeForInspector(n, sim) {
  const baselineMetrics = getNodeBaselineMetrics(n, sim)
  const expectedMetrics = getNodeExpectedMetrics(n, sim)
  const effectiveMetrics = getNodeEffectiveMetrics(n, sim)
  return {
    ...n,
    inspectorBaselineMetrics: baselineMetrics,
    inspectorExpectedMetrics: expectedMetrics,
    inspectorBaselinePps: baselineMetrics.packetsPerSecond,
    data: {
      ...n.data,
      telemetry: effectiveMetrics,
    },
  }
}

function mergeEdgeForInspector(e, sim) {
  if (sim.active !== true) return e
  const baseline = scenarioEdgeBaseline(e, sim)
  const expected = getEdgeExpectedPps(e, sim)
  const override = sim.edgeOverrides[e.id]
  const effective = override !== undefined ? override : expected
  return {
    ...e,
    data: {
      ...e.data,
      packetsPerSecond: effective,
    },
    inspectorBaselinePps: baseline,
    inspectorExpectedPps: expected,
  }
}

function GraphCanvasInner({
  onSelectionChange,
  onHackModeChange,
  onHackSimulatorChange,
  controllerRef,
  forceDefaultOnMount = false,
  multiplayer = null,
  paused = false,
}) {
  const mpRole = multiplayer?.role ?? null
  const mpPhase = multiplayer?.phase ?? 'lobby'
  const mpActions = multiplayer?.actions ?? null
  const reactFlowWrapper = useRef(null)
  const reactFlowInstanceRef = useRef(null)
  const pendingViewportRef = useRef(null)
  const forceDefaultAppliedRef = useRef(false)

  const [snapToGrid] = useState(false)
  const gridSize = 24

  const [exportOpen, setExportOpen] = useState(false)
  const [exportText, setExportText] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importError, setImportError] = useState('')

  const [optimisticHackSim, setOptimisticHackSim] = useState(null)

  const [mpNodes, setMpNodes] = useState([])
  const [mpEdges, setMpEdges] = useState([])
  const draggingRef = useRef(false)
  const appliedMpViewportRef = useRef(null)
  const mpGraphSigRef = useRef('')
  const mpSyncingRef = useRef(false)

  useEffect(() => {
    if (paused) return
    if (!multiplayer?.enabled) return
    if (draggingRef.current) return
    const serverNodes = multiplayer.nodes ?? []
    const serverEdges = multiplayer.edges ?? []
    const sig = graphApplySignature(serverNodes, serverEdges)
    if (mpGraphSigRef.current === sig) return
    mpGraphSigRef.current = sig
    const keepNodeId = selectionIdsRef.current.nodeId
    const keepEdgeId = selectionIdsRef.current.edgeId
    mpSyncingRef.current = true
    setMpNodes(
      serverNodes.map((n) => ({
        ...n,
        selected: keepNodeId != null && n.id === keepNodeId,
      }))
    )
    setMpEdges(
      serverEdges.map((e) => ({
        ...e,
        selected: keepEdgeId != null && e.id === keepEdgeId,
      }))
    )
    requestAnimationFrame(() => {
      mpSyncingRef.current = false
    })
  }, [paused, multiplayer, multiplayer?.nodes, multiplayer?.edges])

  const nodes = mpNodes
  const edges = mpEdges
  const serverHackSimulator =
    multiplayer?.hackSimulator ?? DEFAULT_HACK_SIMULATOR

  useEffect(() => {
    setOptimisticHackSim(null)
  }, [serverHackSimulator])

  const hackSimulator = useMemo(() => {
    const base = optimisticHackSim ?? serverHackSimulator
    return {
      ...base,
      simulationTick: multiplayer?.simulationTick ?? 0,
      cityContext: multiplayer?.cityContext,
      liveTelemetryByNodeId:
        multiplayer?.liveTelemetryByNodeId ?? base.liveTelemetryByNodeId ?? {},
    }
  }, [
    optimisticHackSim,
    serverHackSimulator,
    multiplayer?.simulationTick,
    multiplayer?.cityContext,
    multiplayer?.liveTelemetryByNodeId,
  ])

  const setHackSimulator = useCallback(
    (updater) => {
      const current = optimisticHackSim ?? serverHackSimulator
      const next = typeof updater === 'function' ? updater(current) : updater
      setOptimisticHackSim(next)
      if (mpActions?.patchSim) {
        void mpActions.patchSim(next)
      }
    },
    [mpActions, optimisticHackSim, serverHackSimulator]
  )

  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const hackSimulatorRef = useRef(hackSimulator)
  const selectionIdsRef = useRef({ nodeId: null, edgeId: null })

  nodesRef.current = nodes
  edgesRef.current = edges
  hackSimulatorRef.current = hackSimulator

  const serverDetection = multiplayer?.detection ?? null
  const securityScan = useMemo(() => {
    if (paused) {
      return {
        nodes: [],
        edges: [],
        anomalyNodeIds: [],
        spreadEdgeIds: [],
        compromisedNodeIds: [],
        atRiskNodeIds: [],
        atRiskEdgeIds: [],
        primarySpreadNodeId: null,
        primarySpreadEdgeId: null,
        isolationScoresByNodeId: {},
        temporalScoresByNodeId: {},
        fusedScoresByNodeId: {},
        reasonsByNodeId: {},
        detectionMode: 'fusion',
      }
    }
    if (serverDetection != null) {
      return {
        nodes: serverDetection.nodes ?? [],
        edges: serverDetection.edges ?? [],
        anomalyNodeIds: serverDetection.anomalyNodeIds ?? [],
        spreadEdgeIds: serverDetection.spreadEdgeIds ?? [],
        compromisedNodeIds: serverDetection.compromisedNodeIds ?? [],
        atRiskNodeIds: serverDetection.atRiskNodeIds ?? [],
        atRiskEdgeIds: serverDetection.atRiskEdgeIds ?? [],
        primarySpreadNodeId: serverDetection.primarySpreadNodeId ?? null,
        primarySpreadEdgeId: serverDetection.primarySpreadEdgeId ?? null,
        isolationScoresByNodeId: serverDetection.isolationScoresByNodeId ?? {},
        temporalScoresByNodeId: serverDetection.temporalScoresByNodeId ?? {},
        fusedScoresByNodeId: serverDetection.fusedScoresByNodeId ?? {},
        reasonsByNodeId: serverDetection.reasonsByNodeId ?? {},
        detectionMode: serverDetection.detectionMode === 'tgnn' ? 'tgnn' : 'fusion',
      }
    }
    return collectActiveAnomalies(nodes, edges, hackSimulator)
  }, [paused, serverDetection, nodes, edges, hackSimulator])

  const trustByNodeId = useMemo(() => {
    if (paused) return EMPTY_TRUST
    return buildTrustByNodeId(nodes, edges, hackSimulator)
  }, [paused, nodes, edges, hackSimulator])

  const [anomalyToast, setAnomalyToast] = useState(null)
  const anomalySigRef = useRef('')

  useEffect(() => {
    if (!hackSimulator.active) {
      anomalySigRef.current = ''
      setAnomalyToast(null)
      return
    }
    const sig = [
      ...securityScan.nodes.map((n) => `n:${n.id}`),
      ...securityScan.edges.map((e) => `e:${e.id}`),
    ]
      .sort()
      .join('|')
    if (!sig) {
      anomalySigRef.current = ''
      setAnomalyToast(null)
      return
    }
    if (sig !== anomalySigRef.current) {
      anomalySigRef.current = sig
      const nodeNames = securityScan.nodes.map((n) => n.label).filter(Boolean)
      const spreadSuffix = securityScan.primarySpreadNodeId
        ? ' — spread to highest-risk neighbor'
        : ''
      setAnomalyToast({
        detail:
          nodeNames.length > 0
            ? nodeNames.slice(0, 6).join(', ') +
              (nodeNames.length > 6 ? '…' : '') +
              spreadSuffix
            : spreadSuffix
              ? spreadSuffix.trim().replace(/^—\s*/, '')
              : undefined,
      })
    }
  }, [hackSimulator.active, securityScan])

  useEffect(() => {
    if (!anomalyToast) return undefined
    const id = window.setTimeout(() => setAnomalyToast(null), 14000)
    return () => window.clearTimeout(id)
  }, [anomalyToast])

  const hackContextValue = useMemo(
    () => ({
      active: hackSimulator.active === true,
      nodeOverrides: hackSimulator.nodeOverrides,
      edgeOverrides: hackSimulator.edgeOverrides,
      nodeScenarioBaselines: hackSimulator.nodeScenarioBaselines,
      edgeScenarioBaselines: hackSimulator.edgeScenarioBaselines,
      isolationScoresByNodeId: securityScan.isolationScoresByNodeId ?? {},
      temporalScoresByNodeId: securityScan.temporalScoresByNodeId ?? {},
      fusedScoresByNodeId: securityScan.fusedScoresByNodeId ?? {},
      reasonsByNodeId: securityScan.reasonsByNodeId ?? {},
      anomalyNodeIds: securityScan.anomalyNodeIds ?? [],
      spreadEdgeIds: securityScan.spreadEdgeIds ?? [],
      compromisedNodeIds: securityScan.compromisedNodeIds ?? [],
      atRiskNodeIds: securityScan.atRiskNodeIds ?? [],
      atRiskEdgeIds: securityScan.atRiskEdgeIds ?? [],
      primarySpreadNodeId: securityScan.primarySpreadNodeId ?? null,
      primarySpreadEdgeId: securityScan.primarySpreadEdgeId ?? null,
      simulationTick: hackSimulator.simulationTick ?? 0,
      cityContext: hackSimulator.cityContext,
      liveTelemetryByNodeId: hackSimulator.liveTelemetryByNodeId ?? {},
      trustByNodeId,
    }),
    [
      hackSimulator.active,
      hackSimulator.nodeOverrides,
      hackSimulator.edgeOverrides,
      hackSimulator.nodeScenarioBaselines,
      hackSimulator.edgeScenarioBaselines,
      hackSimulator.simulationTick,
      hackSimulator.cityContext,
      hackSimulator.liveTelemetryByNodeId,
      trustByNodeId,
      securityScan.isolationScoresByNodeId,
      securityScan.temporalScoresByNodeId,
      securityScan.fusedScoresByNodeId,
      securityScan.reasonsByNodeId,
      securityScan.anomalyNodeIds,
      securityScan.spreadEdgeIds,
      securityScan.compromisedNodeIds,
      securityScan.atRiskNodeIds,
      securityScan.atRiskEdgeIds,
      securityScan.primarySpreadNodeId,
      securityScan.primarySpreadEdgeId,
    ]
  )

  useLayoutEffect(() => {
    if (paused) return
    onHackSimulatorChange?.(hackContextValue)
  }, [paused, hackContextValue, onHackSimulatorChange])

  const onNodesChange = useCallback(
    (changes) => {
      if (changes.some((c) => c.type === 'position' && c.dragging === true)) {
        draggingRef.current = true
      }
      if (changes.some((c) => c.type === 'position' && c.dragging === false)) {
        draggingRef.current = false
      }

      setMpNodes((nds) => applyNodeChanges(changes, nds))

      if (mpRole === 'defender' && mpActions?.nodeChanges) {
        const done = changes.filter(
          (c) => c.type === 'position' && c.dragging === false
        )
        if (done.length) void mpActions.nodeChanges(done)
      }
    },
    [mpRole, mpActions]
  )

  const onEdgesChange = useCallback((changes) => {
    setMpEdges((eds) => applyEdgeChanges(changes, eds))
  }, [])

  const nodeTypes = useMemo(() => ({ [NODE_TYPE]: InfrastructureNode }), [])
  const edgeTypes = useMemo(() => ({ [EDGE_TYPE]: DirectedLabeledEdge }), [])

  const onInit = useCallback((instance) => {
    reactFlowInstanceRef.current = instance
    const pending = pendingViewportRef.current
    if (pending) {
      instance.setViewport(pending, { duration: 0 })
      pendingViewportRef.current = null
    }
  }, [])

  const applyDefaultArchitectureState = useCallback(() => {
    const state = getDefaultCanvasState()
    if (mpActions?.loadTopology) {
      void mpActions.loadTopology({
        nodes: state.nodes,
        edges: state.edges,
        viewport: state.viewport,
      })
      pendingViewportRef.current = state.viewport
      selectionIdsRef.current = { nodeId: null, edgeId: null }
      setAnomalyToast(null)
    }
    return state
  }, [mpActions])

  useEffect(() => {
    if (paused) return
    if (!multiplayer) return
    const v = multiplayer.viewport
    if (v) {
      const sig = `${v.x}|${v.y}|${v.zoom}`
      if (appliedMpViewportRef.current !== sig || !reactFlowInstanceRef.current) {
        appliedMpViewportRef.current = sig
        pendingViewportRef.current = v
        reactFlowInstanceRef.current?.setViewport?.(v, { duration: 0 })
      }
    }
  }, [paused, multiplayer, multiplayer?.viewport])

  useEffect(() => {
    if (paused) return
    if (!forceDefaultOnMount || !mpActions?.loadTopology) return
    if (forceDefaultAppliedRef.current) return
    if (nodes.length > 0) {
      forceDefaultAppliedRef.current = true
      return
    }
    forceDefaultAppliedRef.current = true
    applyDefaultArchitectureState()
  }, [
    forceDefaultOnMount,
    nodes.length,
    mpActions,
    applyDefaultArchitectureState,
    paused,
  ])

  const onDragOver = useCallback((event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event) => {
      event.preventDefault()
      const raw = event.dataTransfer.getData('application/reactflow')
      if (!raw) return

      let payload
      try {
        payload = JSON.parse(raw)
      } catch {
        return
      }

      const assetType = payload?.assetType ?? payload?.type
      const asset = getAssetByType(assetType)
      if (!asset) return

      const defenderEdit =
        mpRole === 'defender' &&
        (mpPhase === 'lobby' || mpPhase === 'playing') &&
        payload?.provenance !== 'injected'
      const attackerPlay =
        mpRole === 'attacker' && mpPhase === 'playing' && payload?.provenance === 'injected'
      if (!defenderEdit && !attackerPlay) return

      const position = reactFlowInstanceRef.current?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const newNode = {
        id: crypto.randomUUID(),
        type: NODE_TYPE,
        position: position ?? { x: 0, y: 0 },
        data: dataFromAsset(asset, {
          provenance: payload?.provenance === 'injected' ? 'injected' : 'legitimate',
        }),
      }

      if (mpActions?.addNode) {
        void mpActions.addNode(newNode)
      }
    },
    [mpRole, mpPhase, mpActions]
  )

  const onConnect = useCallback(
    (params) => {
      const defenderEdit = mpRole === 'defender' && (mpPhase === 'lobby' || mpPhase === 'playing')
      const attackerPlay = mpRole === 'attacker' && mpPhase === 'playing'
      if (!defenderEdit && !attackerPlay) return

      const newEdge = {
        id: crypto.randomUUID(),
        type: EDGE_TYPE,
        ...params,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: { label: 'API', packetsPerSecond: 0 },
      }

      if (mpActions?.addEdge) {
        void mpActions.addEdge(newEdge)
      }
    },
    [mpRole, mpPhase, mpActions]
  )

  const _exportGraph = useCallback(() => {
    const instance = reactFlowInstanceRef.current
    if (!instance) return

    const obj = instance.toObject()
    const payload = buildCanvasPersistPayload({
      nodes,
      edges,
      viewport: obj.viewport,
      hackSimulator,
    })

    setExportText(JSON.stringify(payload, null, 2))
    setExportOpen(true)
  }, [edges, nodes, hackSimulator])

  const downloadExportGraph = useCallback(() => {
    if (!exportText) return

    const blob = new Blob([exportText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `city-topology-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [exportText])

  const importGraph = useCallback(
    (jsonText) => {
      const { nodes: nextNodes, edges: nextEdges, viewport } =
        parseGraphJson(jsonText)

      if (mpActions?.loadTopology) {
        void mpActions.loadTopology({ nodes: nextNodes, edges: nextEdges, viewport })
      }
    },
    [mpActions]
  )

  const emitSelection = useCallback(() => {
    if (!onSelectionChange) return
    const { nodeId, edgeId } = selectionIdsRef.current
    const sim = hackSimulatorRef.current
    const n = nodeId ? nodesRef.current.find((x) => x.id === nodeId) : null
    const e = edgeId ? edgesRef.current.find((x) => x.id === edgeId) : null
    onSelectionChange({
      selectedNode: n ? mergeNodeForInspector(n, sim) : null,
      selectedEdge: e ? mergeEdgeForInspector(e, sim) : null,
    })
  }, [onSelectionChange])

  useEffect(() => {
    emitSelection()
  }, [nodes, edges, hackSimulator, emitSelection])

  useEffect(() => {
    onHackModeChange?.(hackSimulator.active === true)
  }, [hackSimulator.active, onHackModeChange])

  const updateNodeData = useCallback((nodeId, patch) => {
    const metricPatch = {}
    for (const key of NODE_METRIC_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        metricPatch[key] = clampNonNegative(patch[key])
      }
    }
    const { label, ...rest } = patch
    const nonMetricRest = { ...rest }
    for (const key of NODE_METRIC_KEYS) {
      delete nonMetricRest[key]
    }
    const hasLabel = Object.prototype.hasOwnProperty.call(patch, 'label')
    const hasMetrics = Object.keys(metricPatch).length > 0
    const hasRest = Object.keys(nonMetricRest).length > 0

    if (hasRest || hasLabel) {
      const dataPatch = { ...nonMetricRest }
      if (hasLabel) dataPatch.label = label
      if (mpActions?.updateNode) {
        void mpActions.updateNode(nodeId, dataPatch)
      }
    }

    if (hasMetrics) {
      if (mpRole === 'defender') {
        setMpNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    telemetry: { ...telemetryOf(n.data), ...metricPatch },
                  },
                  selected: selectionIdsRef.current.nodeId === nodeId,
                }
              : n
          )
        )
        if (mpActions?.updateNode) {
          void mpActions.updateNode(nodeId, metricPatch)
        }
        return
      }
      if (hackSimulatorRef.current.active === true) {
        const n = nodesRef.current.find((nn) => nn.id === nodeId)
        const sim = hackSimulatorRef.current
        const baseline = getNodeBaselineMetrics(n ?? { id: nodeId, data: {} }, sim)
        setHackSimulator((simState) => {
          const prev = normalizeMetricPatch(simState.nodeOverrides[nodeId])
          const nextOverride = pruneOverrideToBaseline(
            { ...prev, ...metricPatch },
            baseline
          )
          const nodeOverrides = { ...simState.nodeOverrides }
          if (Object.keys(nextOverride).length === 0) {
            delete nodeOverrides[nodeId]
          } else {
            nodeOverrides[nodeId] = nextOverride
          }
          return { ...simState, nodeOverrides }
        })
      } else if (mpActions?.updateNode) {
        void mpActions.updateNode(nodeId, metricPatch)
      }
    }
  }, [mpRole, mpActions, setHackSimulator])

  const updateEdgeData = useCallback((edgeId, patch) => {
    const { label, packetsPerSecond, ...rest } = patch
    const hasLabel = Object.prototype.hasOwnProperty.call(patch, 'label')
    const hasPps = Object.prototype.hasOwnProperty.call(patch, 'packetsPerSecond')
    const hasRest = Object.keys(rest).length > 0

    if (hasRest || hasLabel) {
      const patch = { ...rest }
      if (hasLabel) patch.label = label
      if (mpActions?.updateEdge) {
        void mpActions.updateEdge(edgeId, patch)
      }
    }

    if (hasPps) {
      const nextVal = clampNonNegative(packetsPerSecond)
      if (mpRole === 'defender') {
        setMpEdges((eds) =>
          eds.map((e) =>
            e.id === edgeId
              ? {
                  ...e,
                  data: { ...e.data, packetsPerSecond: nextVal },
                  selected: selectionIdsRef.current.edgeId === edgeId,
                }
              : e
          )
        )
        if (mpActions?.updateEdge) {
          void mpActions.updateEdge(edgeId, { packetsPerSecond: nextVal })
        }
        return
      }
      if (hackSimulatorRef.current.active === true) {
        const e = edgesRef.current.find((ee) => ee.id === edgeId)
        const sim = hackSimulatorRef.current
        const baseline = scenarioEdgeBaseline(e ?? { id: edgeId, data: {} }, sim)
        setHackSimulator((sim) => {
          const edgeOverrides = { ...sim.edgeOverrides }
          if (nextVal === baseline) {
            delete edgeOverrides[edgeId]
          } else {
            edgeOverrides[edgeId] = nextVal
          }
          return { ...sim, edgeOverrides }
        })
      } else if (mpActions?.updateEdge) {
        void mpActions.updateEdge(edgeId, { packetsPerSecond: nextVal })
      }
    }
  }, [mpRole, mpActions, setHackSimulator])

  const deleteNodeById = useCallback((nodeId) => {
    if (mpActions?.deleteNode) {
      void mpActions.deleteNode(nodeId)
    }
  }, [mpActions])

  const deleteEdgeById = useCallback((edgeId) => {
    if (mpActions?.deleteEdge) {
      void mpActions.deleteEdge(edgeId)
    }
  }, [mpActions])

  const canClearAttacks = mpRole === 'attacker' && mpPhase === 'playing'

  const clearAttacks = useCallback(() => {
    if (!canClearAttacks) return
    setHackSimulator((s) => ({
      ...s,
      nodeOverrides: {},
      edgeOverrides: {},
    }))
  }, [canClearAttacks, setHackSimulator])

  useEffect(() => {
    if (mpPhase !== 'playing') return
    if (hackSimulator.active === true) return
    if (nodes.length === 0) return
    setHackSimulator(buildAttackLayerFromGraph(nodes, edges))
  }, [mpPhase, hackSimulator.active, nodes, edges, setHackSimulator])

  useImperativeHandle(
    controllerRef,
    () => ({
      updateNodeData,
      updateEdgeData,
      deleteNodeById,
      deleteEdgeById,
    }),
    [deleteEdgeById, deleteNodeById, updateEdgeData, updateNodeData]
  )

  useOnSelectionChange({
    onChange: ({ nodes: selectedNodes, edges: selectedEdges }) => {
      const nodeId = selectedNodes[0]?.id ?? null
      const edgeId = selectedEdges[0]?.id ?? null
      if (
        mpSyncingRef.current &&
        !nodeId &&
        !edgeId &&
        (selectionIdsRef.current.nodeId || selectionIdsRef.current.edgeId)
      ) {
        return
      }
      selectionIdsRef.current = { nodeId, edgeId }
      emitSelection()
    },
  })

  const _onImportClick = useCallback(() => {
    setImportError('')
    setImportOpen(true)
  }, [])

  const onImportFileChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      const text = await file.text()
      try {
        importGraph(text)
        setImportOpen(false)
      } catch (err) {
        setImportError(err?.message ?? 'Failed to import graph')
      } finally {
        e.target.value = ''
      }
    },
    [importGraph]
  )

  const { fitView, zoomIn, zoomOut } = useReactFlow()

  const loadDefaultArchitecture = useCallback(() => {
    if (mpRole !== 'defender') return
    if (
      nodes.length > 0 &&
      !window.confirm('Replace current topology with the default architecture?')
    ) {
      return
    }
    applyDefaultArchitectureState()
    emitSelection()
    requestAnimationFrame(() => {
      fitView({ duration: 700, padding: 0.55, maxZoom: 0.95 })
    })
  }, [nodes.length, applyDefaultArchitectureState, emitSelection, fitView, mpRole])


  return (
    <div className="h-full w-full relative">
      {anomalyToast ? (
        <div
          role="alert"
          className="fixed top-4 right-4 z-[120] max-w-sm rounded-xl border border-rose-200/90 bg-rose-50 px-4 py-3 shadow-lg dark:border-rose-900/60 dark:bg-rose-950/90 pointer-events-auto"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                Anomaly detected
              </div>
              {anomalyToast.detail ? (
                <div className="mt-1 text-xs text-rose-800/90 dark:text-rose-200/90 break-words">
                  {anomalyToast.detail}
                </div>
              ) : (
                <div className="mt-1 text-xs text-rose-800/90 dark:text-rose-200/90">
                  TGNN flagged unusual behavior on the map.
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              className="shrink-0 rounded-md px-2 py-0.5 text-lg leading-none text-rose-700 hover:bg-rose-200/60 dark:text-rose-300 dark:hover:bg-rose-900/50"
              onClick={() => setAnomalyToast(null)}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
      <Panel
        position="top-left"
        className="!m-2 sm:!m-3 !max-w-[calc(100vw-1rem)] sm:!max-w-[calc(100vw-1.5rem)] p-2 rounded-xl border border-slate-200/70 dark:border-slate-800/70 bg-white/70 dark:bg-slate-950/60 shadow-sm flex flex-wrap items-center gap-1.5 sm:gap-2 pointer-events-none"
      >
        <button
          type="button"
          onClick={() => zoomOut()}
          className="pointer-events-auto h-8 px-2 rounded-lg border border-slate-200/70 dark:border-slate-800/70 text-xs hover:bg-slate-100/70 dark:hover:bg-slate-800/40"
        >
          -
        </button>
        <button
          type="button"
          onClick={() => zoomIn()}
          className="pointer-events-auto h-8 px-2 rounded-lg border border-slate-200/70 dark:border-slate-800/70 text-xs hover:bg-slate-100/70 dark:hover:bg-slate-800/40"
        >
          +
        </button>

        <button
          type="button"
          onClick={() => fitView({ duration: 700, padding: 0.2 })}
          className="pointer-events-auto h-8 px-3 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs hover:opacity-90"
        >
          Fit
        </button>

        {mpRole === 'defender' ? (
          <button
            type="button"
            onClick={loadDefaultArchitecture}
            title="Reset the map to the City Model dependency graph"
            className="pointer-events-auto h-8 px-2 sm:px-3 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            <span className="sm:hidden">Default</span>
            <span className="hidden sm:inline">Default architecture</span>
          </button>
        ) : null}

        {canClearAttacks && hackSimulator.active ? (
          <button
            type="button"
            onClick={clearAttacks}
            disabled={
              Object.keys(hackSimulator.nodeOverrides).length === 0 &&
              Object.keys(hackSimulator.edgeOverrides).length === 0
            }
            className="pointer-events-auto h-8 px-2 rounded-lg border border-slate-200/70 dark:border-slate-800/70 text-xs hover:bg-slate-100/70 dark:hover:bg-slate-800/40 disabled:opacity-40 disabled:pointer-events-none"
            title="Clear attack overrides (match-start baseline unchanged)"
          >
            <span className="sm:hidden">Clear</span>
            <span className="hidden sm:inline">Clear attacks</span>
          </button>
        ) : null}
      </Panel>

      {exportOpen ? (
        <div className="absolute inset-0 z-50 bg-slate-950/40 flex items-start justify-center p-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-950 shadow-xl mt-16">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70">
              <div className="font-semibold text-slate-900 dark:text-slate-50">
                Export graph JSON
              </div>
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="h-8 px-3 rounded-lg border border-slate-200/70 dark:border-slate-800/70 text-xs hover:bg-slate-100/70 dark:hover:bg-slate-800/40"
              >
                Close
              </button>
            </div>

            <textarea
              className="w-full h-64 px-4 py-3 font-mono text-[11px] bg-slate-50 dark:bg-slate-900/60 text-slate-900 dark:text-slate-100 outline-none"
              value={exportText}
              readOnly
            />

            <div className="px-4 py-3 flex items-center justify-end gap-2 border-t border-slate-200/70 dark:border-slate-800/70">
              <button
                type="button"
                onClick={downloadExportGraph}
                className="h-9 px-4 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-sm hover:opacity-90"
              >
                Download JSON
              </button>
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="h-9 px-4 rounded-lg border border-slate-200/70 dark:border-slate-800/70 text-sm hover:bg-slate-100/70 dark:hover:bg-slate-800/40"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {importOpen ? (
        <div className="absolute inset-0 z-50 bg-slate-950/40 flex items-start justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-950 shadow-xl mt-16">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70">
              <div className="font-semibold text-slate-900 dark:text-slate-50">
                Import graph JSON
              </div>
              <button
                type="button"
                onClick={() => {
                  setImportOpen(false)
                  setImportError('')
                }}
                className="h-8 px-3 rounded-lg border border-slate-200/70 dark:border-slate-800/70 text-xs hover:bg-slate-100/70 dark:hover:bg-slate-800/40"
              >
                Close
              </button>
            </div>

            <div className="px-4 py-4 space-y-3">
              <div className="text-sm text-slate-600 dark:text-slate-300">
                Choose a JSON file exported from this app.
              </div>

              <input
                type="file"
                accept="application/json"
                className="block w-full text-sm text-slate-600 dark:text-slate-300"
                onChange={onImportFileChange}
              />

              {importError ? (
                <div className="text-sm text-rose-600 dark:text-rose-400">
                  {importError}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setImportOpen(false)
                    setImportError('')
                  }}
                  className="h-9 px-4 rounded-lg border border-slate-200/70 dark:border-slate-800/70 text-sm hover:bg-slate-100/70 dark:hover:bg-slate-800/40"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <HackSimulatorContext.Provider value={hackContextValue}>
        <div ref={reactFlowWrapper} className="h-full w-full">
          {paused ? (
            <div className="h-full w-full" />
          ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={onInit}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodesConnectable={
              (mpRole === 'defender' && (mpPhase === 'lobby' || mpPhase === 'playing')) ||
              (mpRole === 'attacker' && mpPhase === 'playing')
            }
            nodesDraggable={mpRole === 'defender'}
            onDrop={onDrop}
            onDragOver={onDragOver}
            snapToGrid={snapToGrid}
            snapGrid={[gridSize, gridSize]}
            deleteKeyCode={[]}
            fitView={false}
            proOptions={{ hideAttribution: true }}
            minZoom={0.18}
            maxZoom={2.8}
            onlyRenderVisibleElements
            translateExtent={MAP_TRANSLATE_EXTENT}
            nodeExtent={MAP_TRANSLATE_EXTENT}
            className="city-map-flow"
            panOnDrag
            selectionOnDrag={false}
          >
            <CityMapBackground />
            <Panel
              position="bottom-left"
              className="!m-2 pointer-events-none text-[10px] text-slate-700/90 dark:text-slate-200/80"
            >
              Bengaluru · Map © OpenStreetMap · © CARTO
            </Panel>
          </ReactFlow>
          )}
        </div>
      </HackSimulatorContext.Provider>
    </div>
  )
}

const GraphCanvas = memo(
  forwardRef(function GraphCanvas(props, ref) {
    return (
      <ReactFlowProvider>
        <GraphCanvasInner
          onSelectionChange={props.onSelectionChange}
          onHackModeChange={props.onHackModeChange}
          onHackSimulatorChange={props.onHackSimulatorChange}
          controllerRef={ref}
          forceDefaultOnMount={props.forceDefaultOnMount}
          multiplayer={props.multiplayer}
          paused={props.paused === true}
        />
      </ReactFlowProvider>
    )
  })
)

export default GraphCanvas

