import trustNetLogo from '../../logo/logo.png'
import SidebarAssets from '../features/assets/SidebarAssets'
import GraphCanvas from '../features/graph/GraphCanvas'
import InspectorPanel from '../features/inspector/InspectorPanel'
import CityContextMenu from '../features/graph/CityContextMenu'
import DashboardPage from './DashboardPage'
import { DEMO_ROOM_ID, useGameRoom } from '../multiplayer/useGameRoom'
import { LayoutDashboard, Map, PanelLeft, PanelRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

function defaultPanelsForRole(role) {
  if (role === 'attacker' || role === 'defender') {
    return { assetsOpen: true, inspectorOpen: false }
  }
  return { assetsOpen: true, inspectorOpen: false }
}

const panelToggleBtn = (active) =>
  [
    'tn-btn h-9 w-9 p-0',
    active ? 'border-[var(--tn-text)]' : '',
  ].join(' ')

const leftPanelClass = (open) => {
  const base =
    'shrink-0 overflow-auto border-r border-[var(--tn-line)] bg-[var(--tn-surface)] transition-[width] duration-150 ease-out max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:left-0 max-lg:z-40 max-lg:max-w-[85vw]'
  return open
    ? `${base} w-60 p-4 max-lg:translate-x-0 max-lg:w-60`
    : `${base} w-0 overflow-hidden border-r-0 p-0 max-lg:-translate-x-full max-lg:w-60`
}

const rightPanelClass = (open) => {
  const base =
    'shrink-0 overflow-auto border-l border-[var(--tn-line)] bg-[var(--tn-surface)] transition-[width] duration-150 ease-out max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:right-0 max-lg:z-40 max-lg:max-w-[90vw]'
  return open
    ? `${base} w-[25rem] p-4 max-lg:translate-x-0 max-lg:w-[25rem]`
    : `${base} w-0 overflow-hidden border-l-0 p-0 max-lg:translate-x-full max-lg:w-[25rem]`
}

function StatusPip({ ok, warn, muted, label, title }) {
  const bg = muted
    ? 'var(--tn-muted)'
    : ok
      ? 'var(--tn-ok)'
      : warn
        ? 'var(--tn-warn)'
        : 'var(--tn-crit)'
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span className="tn-pip" style={{ background: bg }} />
      <span className="hidden text-sm text-[var(--tn-muted)] xl:inline">{label}</span>
    </span>
  )
}

export default function GamePage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const forceDefaultOnMount =
    searchParams.get('loadDefault') === '1' ||
    location.state?.loadDefault === true

  const {
    room,
    role,
    connected,
    connectError,
    error,
    actions,
    joinRoom,
    setCityContext,
    resetMatch,
  } = useGameRoom()

  useEffect(() => {
    if (!connected) return
    void joinRoom()
  }, [connected, joinRoom])

  const graphRef = useRef(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [selectedEdge, setSelectedEdge] = useState(null)
  const [hackModeActive, setHackModeActive] = useState(false)
  const [hackSimulator, setHackSimulator] = useState(null)
  const [assetsOpen, setAssetsOpen] = useState(() => defaultPanelsForRole(role).assetsOpen)
  const [inspectorOpen, setInspectorOpen] = useState(
    () => defaultPanelsForRole(role).inspectorOpen
  )

  const prevRoleRef = useRef(null)
  useEffect(() => {
    if (!role || role === prevRoleRef.current) return
    prevRoleRef.current = role
    const next = defaultPanelsForRole(role)
    setAssetsOpen(next.assetsOpen)
    setInspectorOpen(next.inspectorOpen)
  }, [role])

  useEffect(() => {
    if (!assetsOpen && !inspectorOpen) return
    const mq = window.matchMedia('(max-width: 1023px)')
    if (!mq.matches) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [assetsOpen, inspectorOpen])

  const activeHackSimulator = hackSimulator ?? room.hackSimulator
  const activeHackMode = hackModeActive || activeHackSimulator?.active === true
  const inspectorSim = useMemo(
    () => ({
      ...(activeHackSimulator ?? {}),
      ...(room.detection ?? {}),
      simulationTick: room.simulationTick ?? 0,
      cityContext: room.cityContext,
      liveTelemetryByNodeId: room.liveTelemetryByNodeId ?? {},
    }),
    [
      activeHackSimulator,
      room.detection,
      room.simulationTick,
      room.cityContext,
      room.liveTelemetryByNodeId,
    ]
  )

  const selectionIdsRef = useRef({ nodeId: null, edgeId: null })
  const onSelectionChange = useCallback(({ selectedNode, selectedEdge }) => {
    const nodeId = selectedNode?.id ?? null
    const edgeId = selectedEdge?.id ?? null
    const prev = selectionIdsRef.current
    const selectionChanged = nodeId !== prev.nodeId || edgeId !== prev.edgeId
    selectionIdsRef.current = { nodeId, edgeId }

    setSelectedNode(selectedNode)
    setSelectedEdge(selectedEdge)
    // Only auto-open on a real selection change — live graph/sim re-emits
    // must not reopen the panel after the operator closes it.
    if (selectionChanged && (selectedNode || selectedEdge)) {
      setInspectorOpen(true)
    }
  }, [])

  const multiplayer = useMemo(
    () => ({
      enabled: true,
      role,
      phase: room.phase,
      nodes: room.nodes,
      edges: room.edges,
      hackSimulator: room.hackSimulator,
      viewport: room.viewport,
      detection: room.detection ?? null,
      simulationTick: room.simulationTick ?? 0,
      cityContext: room.cityContext,
      liveTelemetryByNodeId: room.liveTelemetryByNodeId ?? {},
      actions,
    }),
    [
      role,
      room.phase,
      room.nodes,
      room.edges,
      room.hackSimulator,
      room.viewport,
      room.detection,
      room.simulationTick,
      room.cityContext,
      room.liveTelemetryByNodeId,
      actions,
    ]
  )

  const canDefenderManageNodes = role === 'defender'
  const canUseAttackTools = role === 'attacker' && room.phase === 'playing'
  const readOnlyInspector = room.phase === 'playing' && role === 'defender'
  const canEditScenarioTelemetry =
    room.phase === 'playing' && (role === 'defender' || role === 'attacker')
  const canDeleteTopology =
    (role === 'defender') ||
    (role === 'attacker' && room.phase === 'playing')

  const onUpdateNodeData = useCallback(
    (nodeId, patch) => {
      graphRef.current?.updateNodeData?.(nodeId, patch)
    },
    []
  )

  const onUpdateEdgeData = useCallback(
    (edgeId, patch) => {
      graphRef.current?.updateEdgeData?.(edgeId, patch)
    },
    []
  )

  const onDeleteNodeById = useCallback((nodeId) => {
    graphRef.current?.deleteNodeById?.(nodeId)
  }, [])

  const onDeleteEdgeById = useCallback((edgeId) => {
    graphRef.current?.deleteEdgeById?.(edgeId)
  }, [])

  const autoInspectorRef = useRef(false)
  useEffect(() => {
    if (role !== 'defender') return
    const n = (room.detection?.anomalyNodeIds ?? []).length
    if (n > 0 && !autoInspectorRef.current) {
      autoInspectorRef.current = true
      setInspectorOpen(true)
    }
    if (n === 0) autoInspectorRef.current = false
  }, [role, room.detection?.anomalyNodeIds])

  const onQuarantine = useCallback(
    (nodeId, quarantined = true) => {
      actions.quarantine(nodeId, quarantined)
    },
    [actions]
  )

  const onApplyAttackPreset = useCallback(
    (presetId) => {
      if (!selectedNode?.id || !presetId) return
      void actions.applyCampaignPreset?.(selectedNode.id, presetId)
    },
    [selectedNode, actions]
  )

  const onAbortCampaigns = useCallback(() => {
    void actions.abortCampaigns?.()
  }, [actions])

  const waitingForOpponent =
    room.phase === 'lobby' &&
    role &&
    ((role === 'defender' && !room.players.attacker) ||
      (role === 'attacker' && !room.players.defender))
  const waitingCopy =
    role === 'defender' ? 'Waiting for the other player' : 'Waiting for defender'

  const isDashboardView = role === 'defender' && searchParams.get('view') === 'dashboard'
  const tgnnCalibrating = room.phase === 'playing' && room.detection?.tgnnCalibrating === true
  const tgnnWarmupCollected = room.detection?.tgnnWarmupCollected ?? 0
  const tgnnWarmupTicks = room.detection?.tgnnWarmupTicks ?? 15
  const tgnnSkippedAttackTicks = room.detection?.tgnnSkippedAttackTicks ?? 0
  const tgnnWarmupPaused = tgnnCalibrating && tgnnSkippedAttackTicks > 0

  const setMatchView = useCallback(
    (next) => {
      const nextParams = new URLSearchParams(searchParams)
      if (next === 'dashboard') nextParams.set('view', 'dashboard')
      else nextParams.delete('view')
      setSearchParams(nextParams, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  return (
    <div className="tn-app flex h-[100svh] flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--tn-line)] bg-[var(--tn-surface)] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={trustNetLogo}
            alt="CityNet AI"
            className="h-6 w-6 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[15px] font-medium tracking-tight">CityNet AI</span>
              {role ? (
                <span className="hidden capitalize text-sm text-[var(--tn-muted)] sm:inline">
                  {role}
                </span>
              ) : (
                <span className="text-sm text-[var(--tn-muted)]">joining…</span>
              )}
            </div>
          </div>
        </div>

        {role === 'defender' ? (
          <div className="flex h-14 items-stretch">
            <button
              type="button"
              className={[
                'inline-flex items-center gap-2 border-b-2 px-3 text-sm font-medium',
                !isDashboardView
                  ? 'border-[var(--tn-text)] text-[var(--tn-text)]'
                  : 'border-transparent text-[var(--tn-muted)] hover:text-[var(--tn-text)]',
              ].join(' ')}
              onClick={() => setMatchView('map')}
            >
              <Map className="h-4 w-4" />
              Map
            </button>
            <button
              type="button"
              className={[
                'inline-flex items-center gap-2 border-b-2 px-3 text-sm font-medium',
                isDashboardView
                  ? 'border-[var(--tn-text)] text-[var(--tn-text)]'
                  : 'border-transparent text-[var(--tn-muted)] hover:text-[var(--tn-text)]',
              ].join(' ')}
              onClick={() => setMatchView('dashboard')}
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </button>
          </div>
        ) : null}

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-3">
          {role ? (
            <div className="hidden items-center gap-3 lg:flex">
              <span className="font-mono text-sm tabular-nums text-[var(--tn-muted)]">
                {waitingForOpponent
                  ? waitingCopy
                  : room.phase === 'playing'
                    ? tgnnCalibrating
                      ? tgnnWarmupPaused
                        ? `Paused ${tgnnWarmupCollected}/${tgnnWarmupTicks}`
                        : `Idle ${tgnnWarmupCollected}/${tgnnWarmupTicks}`
                      : `Tick ${room.simulationTick ?? 0}`
                    : 'Lobby'}
              </span>
              <StatusPip
                ok={connected}
                warn={!connected}
                label={connected ? 'Socket' : 'Socket off'}
                title={connected ? 'Socket connected' : 'Socket disconnected'}
              />
              <StatusPip
                ok={room.ingestionStatus === 'ok'}
                warn={room.ingestionStatus !== 'down'}
                label={
                  room.ingestionStatus === 'ok'
                    ? 'Ingest'
                    : `Ingest ${room.ingestionStatus || 'empty'}`
                }
                title={`Ingest ${room.ingestionStatus || 'empty'}`}
              />
              <StatusPip
                ok={room.phase === 'playing' && !tgnnCalibrating}
                warn={room.phase === 'playing' && tgnnCalibrating}
                muted={room.phase !== 'playing'}
                label={
                  room.phase !== 'playing'
                    ? 'Detector idle'
                    : tgnnWarmupPaused
                      ? 'Paused'
                      : tgnnCalibrating
                        ? 'Warmup'
                        : 'Detector'
                }
                title={
                  room.phase !== 'playing'
                    ? 'Detector idle until the match starts'
                    : tgnnWarmupPaused
                      ? 'Idle-window collection paused while an attack override is active. Clear attacks to finish 15/15.'
                      : tgnnCalibrating
                        ? 'Idle-window calibrator collecting residual baseline'
                        : 'Graph residual detector live'
                }
              />
            </div>
          ) : null}

          <div className="hidden items-center gap-2 sm:flex">
            <CityContextMenu
              cityContext={room.cityContext ?? 'normal_day'}
              locked={room.cityContextLocked === true}
              onSelect={(id) => void setCityContext(id)}
              disabled={!role}
            />
            {role === 'defender' ? (
              <button
                type="button"
                className="tn-btn"
                onClick={() => void resetMatch()}
                title="Clear overrides and restart the idle window"
              >
                Reset
              </button>
            ) : null}
          </div>

          <details className="relative sm:hidden">
            <summary className="tn-btn cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              Session
            </summary>
            <div className="tn-surface-outlined absolute right-0 z-50 mt-1.5 flex min-w-[12rem] flex-col gap-2 p-2 shadow-[var(--tn-shadow-sm)]">
              <CityContextMenu
                cityContext={room.cityContext ?? 'normal_day'}
                locked={room.cityContextLocked === true}
                onSelect={(id) => void setCityContext(id)}
                disabled={!role}
              />
              {role === 'defender' ? (
                <button
                  type="button"
                  className="tn-btn w-full"
                  onClick={() => void resetMatch()}
                >
                  Reset match
                </button>
              ) : null}
            </div>
          </details>

          {!isDashboardView ? (
            <>
              <button
                type="button"
                className={panelToggleBtn(assetsOpen)}
                aria-label={assetsOpen ? 'Hide assets panel' : 'Show assets panel'}
                aria-expanded={assetsOpen}
                onClick={() => setAssetsOpen((o) => !o)}
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={panelToggleBtn(inspectorOpen)}
                aria-label={inspectorOpen ? 'Hide inspector panel' : 'Show inspector panel'}
                aria-expanded={inspectorOpen}
                onClick={() => setInspectorOpen((o) => !o)}
              >
                <PanelRight className="h-4 w-4" />
              </button>
            </>
          ) : null}
        </div>
      </header>

      {connectError && !connected ? (
        <div className="shrink-0 border-b border-[var(--tn-line)] bg-[var(--tn-surface)] px-6 py-2 text-sm text-[var(--tn-warn)]">
          {connectError}
        </div>
      ) : null}

      {error ? (
        <div className="shrink-0 border-b border-[var(--tn-line)] bg-[var(--tn-surface)] px-6 py-2 text-sm text-[var(--tn-crit)]">
          {error}
        </div>
      ) : null}

      {tgnnCalibrating && !isDashboardView ? (
        <div className="shrink-0 border-b border-[var(--tn-line)] bg-[var(--tn-surface)] px-6 py-2 text-sm">
          <span className="font-medium">
            {tgnnWarmupPaused ? 'Idle-window calibrator paused' : 'Idle-window calibrator'}
          </span>
          <span className="font-mono text-[var(--tn-muted)]">
            {' '}
            {tgnnWarmupCollected}/{tgnnWarmupTicks}
          </span>
          <span className="text-[var(--tn-muted)]">
            {tgnnWarmupPaused
              ? ' — attack override is active, so idle ticks are not collected. Clear attacks to finish 15/15. Extreme spikes can still flag vs expected embeddings until then.'
              : role === 'attacker'
                ? ' — wait 15/15 before attacking. Residual baseline is collected while idle.'
                : ' — do not treat this as online learning. Detection starts when this finishes.'}
          </span>
        </div>
      ) : null}

      {isDashboardView ? (
        <div className="flex min-h-0 flex-1 flex-col">
        <DashboardPage
          roomId={room.id || DEMO_ROOM_ID}
          phase={room.phase}
          tick={room.simulationTick ?? 0}
          nodes={room.nodes}
          edges={room.edges}
          detection={room.detection}
          cityContext={room.cityContext}
          cityContextLocked={room.cityContextLocked === true}
          simHour={room.simHour}
          connected={connected}
          ingestionStatus={room.ingestionStatus}
          hackSimulator={room.hackSimulator}
          commanderBriefing={room.commanderBriefing ?? null}
          cityPosture={room.cityPosture ?? null}
        />
        </div>
      ) : null}

      <main className={isDashboardView ? 'hidden' : 'relative flex min-h-0 flex-1'}>
        {(assetsOpen || inspectorOpen) && (
          <button
            type="button"
            aria-label="Close panel"
            className="fixed inset-0 top-14 z-30 bg-black/40 lg:hidden"
            onClick={() => {
              setAssetsOpen(false)
              setInspectorOpen(false)
            }}
          />
        )}

        <aside className={leftPanelClass(assetsOpen)}>
          <SidebarAssets
            role={role}
            phase={room.phase}
            showDevices={canDefenderManageNodes}
            showAttackTools={canUseAttackTools}
            selectedNodeId={selectedNode?.id ?? null}
            tgnnCalibrating={tgnnCalibrating}
            onApplyAttackPreset={
              role === 'attacker' && room.phase === 'playing' && !tgnnCalibrating
                ? onApplyAttackPreset
                : undefined
            }
            onAbortCampaigns={
              role === 'attacker' && room.phase === 'playing'
                ? onAbortCampaigns
                : undefined
            }
          />
        </aside>

        <section className="relative min-h-0 min-w-0 flex-1 bg-[var(--tn-canvas)]">
          <GraphCanvas
            ref={graphRef}
            multiplayer={multiplayer}
            paused={isDashboardView}
            forceDefaultOnMount={forceDefaultOnMount}
            onSelectionChange={onSelectionChange}
            onHackModeChange={setHackModeActive}
            onHackSimulatorChange={setHackSimulator}
          />
        </section>

        <aside className={rightPanelClass(inspectorOpen)}>
          <InspectorPanel
            hackModeActive={activeHackMode}
            hackSimulator={inspectorSim}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            onUpdateNodeData={
              canEditScenarioTelemetry || !readOnlyInspector
                ? onUpdateNodeData
                : undefined
            }
            onUpdateEdgeData={
              canEditScenarioTelemetry || !readOnlyInspector
                ? onUpdateEdgeData
                : undefined
            }
            onDeleteNodeById={canDeleteTopology ? onDeleteNodeById : undefined}
            onDeleteEdgeById={canDeleteTopology ? onDeleteEdgeById : undefined}
            readOnly={readOnlyInspector}
            gameRole={role}
            gamePhase={room.phase}
            onQuarantine={
              role === 'defender' && room.phase === 'playing' ? onQuarantine : undefined
            }
          />
        </aside>
      </main>
    </div>
  )
}
