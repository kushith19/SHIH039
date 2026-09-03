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
  DEFAULT_HACK_SIMULATOR,
  getDefaultCanvasState,
} from './graphIO'
import { buildTrustByNodeId, getEdgeExpectedPps, getNodeBaselineMetrics, getNodeEffectiveMetrics, getNodeExpectedMetrics } from './peerTrust'
import { peerExposureFromFlags } from '@shared/trustModel.js'
import {
  NODE_METRIC_KEYS,
  clampNonNegative,
  normalizeMetricPatch,
  pruneOverrideToBaseline,
} from './nodeMetrics'

const NODE_TYPE = INFRASTRUCTURE_NODE_TYPE
const EDGE_TYPE = 'directedLabeled'
const EMPTY_TRUST = Object.freeze({})

function applyPeerExposure(scan, graphEdges, nodeIds) {
  const serverNodes = scan.atRiskNodeIds ?? []
  const serverEdges = scan.atRiskEdgeIds ?? []
  if (serverNodes.length > 0 || serverEdges.length > 0) {
    return { ...scan, atRiskNodeIds: serverNodes, atRiskEdgeIds: serverEdges }
  }
  const derived = peerExposureFromFlags(graphEdges, scan.anomalyNodeIds, nodeIds)
  return {
    ...scan,
    atRiskNodeIds: derived.atRiskNodeIds,
    atRiskEdgeIds: derived.atRiskEdgeIds,
  }
}

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
  const knownNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes])
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
        reasonsByNodeId: {},
        detectionMode: 'tgnn',
        tgnnCalibrating: false,
        tgnnWarmupCollected: 0,
        tgnnWarmupTicks: 15,
        tgnnSkippedAttackTicks: 0,
      }
    }
    if (mpPhase !== 'playing' || serverDetection == null) {
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
        reasonsByNodeId: {},
        detectionMode: 'tgnn',
        tgnnCalibrating: serverDetection?.tgnnCalibrating === true,
        tgnnWarmupCollected: serverDetection?.tgnnWarmupCollected ?? 0,
        tgnnWarmupTicks: serverDetection?.tgnnWarmupTicks ?? 15,
        tgnnSkippedAttackTicks: serverDetection?.tgnnSkippedAttackTicks ?? 0,
      }
    }
    return applyPeerExposure(
      {
        nodes: serverDetection.nodes ?? [],
        edges: serverDetection.edges ?? [],
        anomalyNodeIds: serverDetection.anomalyNodeIds ?? [],
        spreadEdgeIds: [],
        compromisedNodeIds: serverDetection.anomalyNodeIds ?? [],
        atRiskNodeIds: serverDetection.atRiskNodeIds ?? [],
        atRiskEdgeIds: serverDetection.atRiskEdgeIds ?? [],
        primarySpreadNodeId: null,
        primarySpreadEdgeId: null,
        isolationScoresByNodeId: serverDetection.isolationScoresByNodeId ?? {},
        reasonsByNodeId: serverDetection.reasonsByNodeId ?? {},
        detectionMode: 'tgnn',
        tgnnCalibrating: serverDetection.tgnnCalibrating === true,
        tgnnWarmupCollected: serverDetection.tgnnWarmupCollected ?? 0,
        tgnnWarmupTicks: serverDetection.tgnnWarmupTicks ?? 15,
        tgnnSkippedAttackTicks: serverDetection.tgnnSkippedAttackTicks ?? 0,
      },
      edges,
      knownNodeIds
    )
  }, [paused, serverDetection, mpPhase, edges, knownNodeIds])

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
    if (securityScan.tgnnCalibrating && (securityScan.anomalyNodeIds ?? []).length === 0) {
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
      setAnomalyToast({
        detail:
          nodeNames.length > 0
            ? nodeNames.slice(0, 6).join(', ') + (nodeNames.length > 6 ? '…' : '')
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
      reasonsByNodeId: securityScan.reasonsByNodeId ?? {},
      tgnnCalibrating: securityScan.tgnnCalibrating === true,
      tgnnWarmupCollected: securityScan.tgnnWarmupCollected ?? 0,
      tgnnWarmupTicks: securityScan.tgnnWarmupTicks ?? 15,
      tgnnSkippedAttackTicks: securityScan.tgnnSkippedAttackTicks ?? 0,
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
      securityScan.reasonsByNodeId,
      securityScan.tgnnCalibrating,
      securityScan.tgnnWarmupCollected,
      securityScan.tgnnWarmupTicks,
      securityScan.tgnnSkippedAttackTicks,
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
    if (!mpActions?.loadTopology) return
    if (nodes.length > 0) {
      forceDefaultAppliedRef.current = true
      return
    }
    const shouldLoad = forceDefaultOnMount || mpRole === 'defender'
    if (!shouldLoad) return
    if (forceDefaultAppliedRef.current) return
    forceDefaultAppliedRef.current = true
    applyDefaultArchitectureState()
  }, [
    forceDefaultOnMount,
    mpRole,
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
    if (mpActions?.abortCampaigns) {
      void mpActions.abortCampaigns()
      return
    }
    setHackSimulator((s) => ({
      ...s,
      nodeOverrides: {},
      edgeOverrides: {},
    }))
  }, [canClearAttacks, mpActions, setHackSimulator])

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
          className="tn-surface pointer-events-auto fixed top-4 right-4 z-[120] flex max-w-sm overflow-hidden shadow-[var(--tn-shadow-sm)]"
        >
          <div className="w-0.5 shrink-0 bg-[var(--tn-crit)]" />
          <div className="flex min-w-0 flex-1 items-start justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Anomaly detected</div>
              {anomalyToast.detail ? (
                <div className="tn-meta mt-1 break-words">
                  {anomalyToast.detail}
                </div>
              ) : (
                <div className="tn-meta mt-1">
                  Residual detector flagged unusual behavior vs the idle-window baseline.
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              className="shrink-0 px-1 text-lg leading-none text-[var(--tn-muted)]"
              onClick={() => setAnomalyToast(null)}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
      <Panel
        position="top-left"
        className="tn-surface pointer-events-none !m-3 flex flex-wrap items-center gap-2 p-2 sm:!max-w-[calc(100vw-1.5rem)] !max-w-[calc(100vw-1rem)] shadow-[var(--tn-shadow-sm)]"
      >
        <button
          type="button"
          onClick={() => zoomOut()}
          className="tn-btn pointer-events-auto h-9 w-9 p-0"
        >
          -
        </button>
        <button
          type="button"
          onClick={() => zoomIn()}
          className="tn-btn pointer-events-auto h-9 w-9 p-0"
        >
          +
        </button>

        <button
          type="button"
          onClick={() => fitView({ duration: 700, padding: 0.2 })}
          className="tn-btn-primary pointer-events-auto"
        >
          Fit
        </button>

        {mpRole === 'defender' ? (
          <button
            type="button"
            onClick={loadDefaultArchitecture}
            title="Reset the map to the City Model dependency graph"
            className="tn-btn-primary pointer-events-auto px-3"
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
            className="tn-btn pointer-events-auto"
            title="Clear attack overrides (match-start baseline unchanged)"
          >
            <span className="sm:hidden">Clear</span>
            <span className="hidden sm:inline">Clear attacks</span>
          </button>
        ) : null}
      </Panel>

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
              className="pointer-events-none !m-2 text-xs text-[var(--tn-muted)]"
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

