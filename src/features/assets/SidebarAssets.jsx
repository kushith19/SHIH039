import { useEffect, useMemo, useRef, useState } from 'react'
import {
  attackCatalog,
  getAssetsGroupedByDomain,
  getLiveCityAssets,
} from '../graph/assetCatalog'
import { ATTACK_PRESETS, getAttackPreset } from '../graph/attackPresets'
import {
  hasActiveAttackOverride,
  listEligibleSpreadTargets,
} from '@shared/attackSpread.js'
import {
  ATTACK_SPREAD_MODE_AUTO,
  ATTACK_SPREAD_MODE_MANUAL,
  getAttackSpreadMode,
} from '@shared/attackSpreadMode.js'
import {
  applyStablePresentationOrder,
  clearAllSpreadOrderLocks,
  clearSpreadOrderForSource,
} from './stableSpreadOrder.js'

const DOMAIN_SHORT = {
  Energy: 'Energy',
  Water: 'Water',
  Transportation: 'Transport',
  Telecommunications: 'Telecom',
  Government: 'Civic',
  Education: 'Education',
  Healthcare: 'Health',
  'Emergency Services': 'Emergency',
  'Public Safety': 'Safety',
  Environment: 'Environment',
  Finance: 'Finance',
  'Urban Infrastructure': 'Urban',
}

const DOMAIN_ACCENT = {
  Energy: 'bg-amber-500',
  Water: 'bg-sky-500',
  Transportation: 'bg-slate-500',
  Telecommunications: 'bg-violet-500',
  Government: 'bg-indigo-500',
  Education: 'bg-lime-500',
  Healthcare: 'bg-rose-500',
  'Emergency Services': 'bg-orange-500',
  'Public Safety': 'bg-red-500',
  Environment: 'bg-emerald-500',
  Finance: 'bg-teal-500',
  'Urban Infrastructure': 'bg-stone-500',
}

function AssetRow({ asset, onDragStart }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, asset)}
      title={asset.title}
      aria-label={`Add ${asset.title}`}
      className="group flex cursor-grab items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-[var(--tn-elevated)] active:cursor-grabbing"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--tn-elevated)]">
        <asset.Icon size={13} className="text-[var(--tn-muted)]" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
        {asset.title}
      </span>
    </div>
  )
}

function DomainAssetList({ assets, onDragStart }) {
  const grouped = useMemo(() => getAssetsGroupedByDomain(), [])
  const [query, setQuery] = useState('')
  const [openDomain, setOpenDomain] = useState(grouped[0]?.domain ?? null)
  const q = query.trim().toLowerCase()

  const visibleGroups = useMemo(() => {
    if (!q) return grouped
    return grouped
      .map((g) => ({
        ...g,
        assets: g.assets.filter(
          (a) =>
            a.title.toLowerCase().includes(q) ||
            a.domain.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.assets.length > 0)
  }, [grouped, q])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${assets.length} sectors`}
        className="tn-input px-3 text-sm placeholder:text-[var(--tn-muted)]"
      />
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        {visibleGroups.map((group) => {
          const open = q ? true : openDomain === group.domain
          const short = DOMAIN_SHORT[group.domain] ?? group.domain
          const accent = DOMAIN_ACCENT[group.domain] ?? 'bg-slate-400'
          return (
            <div key={group.domain}>
              <button
                type="button"
                onClick={() =>
                  setOpenDomain((prev) => (prev === group.domain ? null : group.domain))
                }
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--tn-elevated)]"
                aria-expanded={open}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${accent}`} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{short}</span>
                <span className="text-xs text-[var(--tn-muted)]">{group.assets.length}</span>
              </button>
              {open ? (
                <div className="mb-1 ml-1 space-y-0.5 border-l border-[var(--tn-line)] pl-2">
                  {group.assets.map((asset) => (
                    <AssetRow
                      key={asset.type}
                      asset={asset}
                      onDragStart={onDragStart}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CompactDeviceList({ assets, onDragStart }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <p className="tn-label mb-1.5">Drag onto map</p>
      <div className="space-y-0.5">
        {assets.map((asset) => (
          <AssetRow key={asset.type} asset={asset} onDragStart={onDragStart} />
        ))}
      </div>
    </div>
  )
}

function isValidSpreadSource(sourceNodeId, nodes, detection, hackSimulator) {
  const source = String(sourceNodeId ?? '')
  if (!source) return false
  const sourceNode = (nodes ?? []).find((n) => String(n.id) === source)
  if (!sourceNode) return false
  if (sourceNode?.data?.runtimeState?.quarantined === true) return false
  const anomalySet = new Set((detection?.anomalyNodeIds ?? []).map(String))
  if (!anomalySet.has(source)) return false
  return hasActiveAttackOverride(hackSimulator, source)
}

function presetTitle(presetId) {
  return getAttackPreset(presetId)?.title ?? ATTACK_PRESETS.find((p) => p.id === presetId)?.title ?? String(presetId ?? '')
}

function PresetMeta({ presetId }) {
  const preset = getAttackPreset(presetId)
  if (!preset) return null
  const seeds = (preset.preferredSeedTypes ?? []).slice(0, 3).join(', ')
  const stageNames = (preset.stages ?? []).map((s) => s.name).join(' → ')
  return (
    <div className="mt-2 space-y-1 rounded-md border border-[var(--tn-line)] bg-[var(--tn-elevated)] px-2.5 py-2 text-[11px] text-[var(--tn-muted)]">
      <p>
        <span className="font-semibold text-[var(--tn-text)]">Type </span>
        {preset.attackType}
      </p>
      {stageNames ? (
        <p>
          <span className="font-semibold text-[var(--tn-text)]">Stages </span>
          {stageNames}
        </p>
      ) : null}
      {seeds ? (
        <p className="truncate" title={(preset.preferredSeedTypes ?? []).join(', ')}>
          <span className="font-semibold text-[var(--tn-text)]">Preferred seeds </span>
          {seeds}
          {(preset.preferredSeedTypes?.length ?? 0) > 3 ? '…' : ''}
        </p>
      ) : null}
      <p>
        <span className="font-semibold text-[var(--tn-text)]">Expect </span>
        {preset.expectedBehavior}
      </p>
    </div>
  )
}

function AttackConsole({
  selectedNodeId,
  selectedNodeLabel,
  tgnnCalibrating,
  nodes,
  edges,
  detection,
  hackSimulator,
  autoSpreadSafety = null,
  spreadPresetId,
  setSpreadPresetId,
  canUsePresets,
  canSpread,
  onApplyAttackPreset,
  onSpreadAttack,
  onAbortCampaigns,
  onSetAttackSpreadMode,
}) {
  const orderBySourceRef = useRef(/** @type {Record<string, string[]>} */ ({}))
  const spreadMode = getAttackSpreadMode(hackSimulator)
  const isAuto = spreadMode === ATTACK_SPREAD_MODE_AUTO

  const liveEligible = useMemo(() => {
    if (!selectedNodeId || tgnnCalibrating) return []
    return listEligibleSpreadTargets(
      { nodes, edges, detection, hackSimulator },
      selectedNodeId
    )
  }, [selectedNodeId, tgnnCalibrating, nodes, edges, detection, hackSimulator])

  /** Live risk-ranked next auto target (not UI presentation order). */
  const nextAutoTarget = isAuto && liveEligible.length > 0 ? liveEligible[0] : null

  const sourceValid = useMemo(
    () =>
      Boolean(selectedNodeId) &&
      !tgnnCalibrating &&
      isValidSpreadSource(selectedNodeId, nodes, detection, hackSimulator),
    [selectedNodeId, tgnnCalibrating, nodes, detection, hackSimulator]
  )

  useEffect(() => {
    if (!selectedNodeId) return
    if (!sourceValid) {
      clearSpreadOrderForSource(orderBySourceRef.current, selectedNodeId)
    }
  }, [selectedNodeId, sourceValid])

  const displayTargets = useMemo(() => {
    if (!selectedNodeId || !sourceValid || isAuto) return []
    return applyStablePresentationOrder(
      selectedNodeId,
      liveEligible,
      orderBySourceRef.current
    )
  }, [selectedNodeId, sourceValid, liveEligible, isAuto])

  const attackActive = Boolean(
    selectedNodeId && hasActiveAttackOverride(hackSimulator, selectedNodeId)
  )
  const isAnomaly =
    selectedNodeId &&
    (detection?.anomalyNodeIds ?? []).some((id) => String(id) === String(selectedNodeId))

  const statusLabel = tgnnCalibrating
    ? 'CALIBRATING'
    : !selectedNodeId
      ? 'NO SOURCE'
      : attackActive
        ? isAnomaly
          ? 'ACTIVE'
          : 'SEEDED'
        : 'IDLE'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tn-muted)]">
          Attack console
        </p>
        {tgnnCalibrating ? (
          <p className="mt-1 text-xs text-[var(--tn-muted)]">
            Wait for the idle window before injecting.
          </p>
        ) : null}
      </div>

      <AttackSpreadModePanel
        hackSimulator={hackSimulator}
        detection={detection}
        nodes={nodes}
        edges={edges}
        autoSpreadSafety={autoSpreadSafety}
        onSetAttackSpreadMode={onSetAttackSpreadMode}
      />

      <section className="space-y-1.5 rounded-md border border-[var(--tn-line)] bg-[var(--tn-elevated)] px-2.5 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tn-muted)]">
          Active attack
        </p>
        <div className="space-y-0.5 text-sm">
          <p className="truncate">
            <span className="text-[var(--tn-muted)]">Source </span>
            <span className="font-medium text-[var(--tn-text)]">
              {selectedNodeLabel || selectedNodeId || '—'}
            </span>
          </p>
          <p>
            <span className="text-[var(--tn-muted)]">Status </span>
            <span className="font-medium text-[var(--tn-text)]">{statusLabel}</span>
          </p>
          <p className="truncate">
            <span className="text-[var(--tn-muted)]">Preset </span>
            <span className="font-medium text-[var(--tn-text)]">
              {presetTitle(spreadPresetId)}
            </span>
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tn-muted)]">
            Initial attack
          </p>
          <p className="mt-0.5 text-xs text-[var(--tn-muted)]">
            Choose a preset to seed an attack.
          </p>
        </div>
        {!selectedNodeId ? (
          <p className="text-sm text-[var(--tn-muted)]">Select a node on the map.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-1">
              {ATTACK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={!canUsePresets}
                  title={`${preset.attackType ?? ''}: ${preset.description}`}
                  onClick={() => {
                    if (!canUsePresets) return
                    setSpreadPresetId(preset.id)
                    onApplyAttackPreset(preset.id)
                  }}
                  className={[
                    'tn-btn w-full flex-col items-start justify-start gap-0.5 py-2 text-left text-sm disabled:opacity-35',
                    spreadPresetId === preset.id ? 'ring-1 ring-[var(--tn-ink)]' : '',
                  ].join(' ')}
                >
                  <span className="font-medium">{preset.title}</span>
                  <span className="text-[11px] font-normal text-[var(--tn-muted)]">
                    {preset.attackType}
                    {preset.stages?.length > 1 ? ` · ${preset.stages.length} stages` : ''}
                  </span>
                </button>
              ))}
            </div>
            <PresetMeta presetId={spreadPresetId} />
          </>
        )}
      </section>

      <section className="space-y-2 border-t border-[var(--tn-line)] pt-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tn-muted)]">
            Spread attack
          </p>
          <p className="mt-0.5 text-xs text-[var(--tn-muted)]">
            {isAuto
              ? 'Automatic mode selects the highest-risk eligible adjacent target.'
              : 'Choose a target to spread the attack.'}
          </p>
        </div>

        {isAuto ? (
          !selectedNodeId ? (
            <p className="text-sm text-[var(--tn-muted)]">Select a node to inspect.</p>
          ) : !sourceValid ? (
            <p className="text-sm text-[var(--tn-muted)]">
              Select an active anomaly node to see the auto target.
            </p>
          ) : !nextAutoTarget ? (
            <p className="text-sm text-[var(--tn-muted)]">No eligible auto target right now.</p>
          ) : (
            <div className="rounded-md border border-[var(--tn-line)] bg-[var(--tn-elevated)] px-2.5 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tn-muted)]">
                Next auto target
              </p>
              <p className="mt-1 truncate text-sm font-medium text-[var(--tn-text)]">
                {nextAutoTarget.label || nextAutoTarget.nodeId}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--tn-muted)]">
                {nextAutoTarget.propagationRisk != null
                  ? `Risk ${Math.round(nextAutoTarget.propagationRisk)}`
                  : 'Risk —'}
                {nextAutoTarget.peerExposed ? ' · Peer' : ''}
                {' · Auto selected'}
              </p>
            </div>
          )
        ) : !selectedNodeId ? (
          <p className="text-sm text-[var(--tn-muted)]">Select a node to spread.</p>
        ) : !sourceValid ? (
          <p className="text-sm text-[var(--tn-muted)]">
            Select an active anomaly node to spread.
          </p>
        ) : displayTargets.length === 0 ? (
          <p className="text-sm text-[var(--tn-muted)]">No eligible targets right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {displayTargets.map((t) => (
              <li
                key={t.nodeId}
                className="flex items-center gap-2 rounded-md border border-[var(--tn-line)] bg-[var(--tn-elevated)] px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--tn-text)]">
                    {t.label || t.nodeId}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--tn-muted)]">
                    {t.propagationRisk != null
                      ? `Risk ${Math.round(t.propagationRisk)}`
                      : 'Risk —'}
                    {t.peerExposed ? ' · Peer' : ''}
                    {t.highestRiskCandidate ? ' · Highest' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!canSpread}
                  className="tn-btn shrink-0 px-2 py-1 text-xs disabled:opacity-35"
                  onClick={() => {
                    if (!canSpread) return
                    onSpreadAttack(selectedNodeId, t.nodeId, spreadPresetId)
                  }}
                >
                  Spread
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {onAbortCampaigns ? (
        <div className="mt-auto border-t border-[var(--tn-line)] pt-3">
          <button
            type="button"
            className="tn-btn w-full justify-start text-sm"
            onClick={() => {
              clearAllSpreadOrderLocks(orderBySourceRef.current)
              onAbortCampaigns()
            }}
          >
            Clear attacks
          </button>
        </div>
      ) : null}
    </div>
  )
}

function AttackSpreadModePanel({
  hackSimulator,
  detection,
  nodes,
  edges,
  autoSpreadSafety = null,
  onSetAttackSpreadMode,
}) {
  const mode = getAttackSpreadMode(hackSimulator)
  const isAuto = mode === ATTACK_SPREAD_MODE_AUTO
  const cap =
    Number.isFinite(Number(autoSpreadSafety?.cap)) && Number(autoSpreadSafety.cap) > 0
      ? Math.floor(Number(autoSpreadSafety.cap))
      : null
  const count =
    Number.isFinite(Number(autoSpreadSafety?.count)) && Number(autoSpreadSafety.count) >= 0
      ? Math.floor(Number(autoSpreadSafety.count))
      : 0
  const limitReached = cap != null && count >= cap

  const nextAuto = useMemo(() => {
    if (!isAuto || limitReached) return null
    const anomalyIds = detection?.anomalyNodeIds ?? []
    for (const sourceId of anomalyIds) {
      const eligible = listEligibleSpreadTargets(
        { nodes, edges, detection, hackSimulator },
        sourceId
      )
      if (eligible.length > 0) {
        return { sourceId: String(sourceId), target: eligible[0] }
      }
    }
    return null
  }, [isAuto, limitReached, detection, nodes, edges, hackSimulator])

  return (
    <section className="space-y-2 rounded-md border border-[var(--tn-line)] bg-[var(--tn-elevated)] px-2.5 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tn-muted)]">
        Attack control
      </p>
      <p className="text-xs text-[var(--tn-muted)]">How should attacks spread?</p>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={typeof onSetAttackSpreadMode !== 'function'}
          onClick={() => onSetAttackSpreadMode?.(ATTACK_SPREAD_MODE_MANUAL)}
          className={[
            'tn-btn flex-1 px-2 py-1.5 text-xs disabled:opacity-35',
            !isAuto ? 'ring-1 ring-[var(--tn-ink)]' : '',
          ].join(' ')}
        >
          Manual
        </button>
        <button
          type="button"
          disabled={typeof onSetAttackSpreadMode !== 'function'}
          onClick={() => onSetAttackSpreadMode?.(ATTACK_SPREAD_MODE_AUTO)}
          className={[
            'tn-btn flex-1 px-2 py-1.5 text-xs disabled:opacity-35',
            isAuto ? 'ring-1 ring-[var(--tn-ink)]' : '',
          ].join(' ')}
        >
          Auto
        </button>
      </div>
      <p className="text-[11px] text-[var(--tn-muted)]">
        {isAuto
          ? 'System selects the highest-risk eligible target.'
          : 'You choose each target.'}
      </p>
      <p className="text-sm">
        <span className="text-[var(--tn-muted)]">Current </span>
        <span className="font-medium text-[var(--tn-text)]">
          {isAuto ? 'AUTOMATIC' : 'MANUAL'}
        </span>
      </p>
      {isAuto && cap != null ? (
        <p className="text-sm">
          {limitReached ? (
            <span className="font-medium text-[var(--tn-text)]">
              AUTO SPREAD LIMIT REACHED
            </span>
          ) : (
            <>
              <span className="text-[var(--tn-muted)]">AUTO SPREAD </span>
              <span className="font-medium text-[var(--tn-text)]">
                {count} / {cap}
              </span>
            </>
          )}
        </p>
      ) : null}
      {isAuto && nextAuto ? (
        <div className="border-t border-[var(--tn-line)] pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tn-muted)]">
            Next target
          </p>
          <p className="mt-0.5 truncate text-sm font-medium">
            {nextAuto.target.label || nextAuto.target.nodeId}
          </p>
          <p className="text-[11px] text-[var(--tn-muted)]">
            From {nextAuto.sourceId}
            {nextAuto.target.propagationRisk != null
              ? ` · Risk ${Math.round(nextAuto.target.propagationRisk)}`
              : ''}
          </p>
        </div>
      ) : null}
    </section>
  )
}

export default function SidebarAssets({
  role = null,
  phase = 'lobby',
  showDevices = true,
  showAttackTools = false,
  selectedNodeId = null,
  selectedNodeLabel = null,
  tgnnCalibrating = false,
  nodes = [],
  edges = [],
  detection = null,
  hackSimulator = null,
  autoSpreadSafety = null,
  onApplyAttackPreset,
  onSpreadAttack,
  onAbortCampaigns,
  onSetAttackSpreadMode,
}) {
  function handleDragStart(event, assetType, provenance = 'legitimate') {
    event.dataTransfer.setData(
      'application/reactflow',
      JSON.stringify({ assetType, provenance })
    )
    event.dataTransfer.effectAllowed = 'move'
  }

  const inLobby = phase === 'lobby'
  const hint =
    role === 'defender' && inLobby
      ? 'Drag a sector onto Bengaluru.'
      : role === 'defender' && !inLobby
        ? 'Add sectors or quarantine a node.'
        : null

  const canUsePresets =
    showAttackTools && selectedNodeId && onApplyAttackPreset && !tgnnCalibrating

  const [sideTab, setSideTab] = useState(showAttackTools ? 'attack' : 'devices')
  const [spreadPresetId, setSpreadPresetId] = useState(
    ATTACK_PRESETS[0]?.id ?? 'traffic_flood'
  )
  const consoleEpochRef = useRef(0)
  const [, bumpConsole] = useState(0)

  useEffect(() => {
    if (showAttackTools) setSideTab('attack')
  }, [showAttackTools])

  useEffect(() => {
    if (!showAttackTools || phase !== 'playing') {
      consoleEpochRef.current += 1
      bumpConsole((n) => n + 1)
    }
  }, [showAttackTools, phase])

  const canSpread =
    showAttackTools &&
    selectedNodeId &&
    typeof onSpreadAttack === 'function' &&
    !tgnnCalibrating &&
    Boolean(spreadPresetId) &&
    getAttackSpreadMode(hackSimulator) !== ATTACK_SPREAD_MODE_AUTO

  const tabs = showAttackTools
    ? [
        { id: 'attack', label: 'Attack' },
        { id: 'inject', label: 'Inject' },
      ]
    : [{ id: 'devices', label: 'Sectors' }]

  if (showDevices || showAttackTools) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        {!showAttackTools && hint ? (
          <p className="flex items-start gap-2 text-sm leading-snug text-[var(--tn-muted)]">
            {hint}
          </p>
        ) : null}

        {tabs.length > 1 ? (
          <div className="flex rounded-md bg-[var(--tn-elevated)] p-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSideTab(tab.id)}
                className={[
                  'flex-1 rounded-md px-2 py-1.5 text-sm font-medium',
                  sideTab === tab.id
                    ? 'bg-[var(--tn-ink)] text-[var(--tn-ink-fg)]'
                    : 'text-[var(--tn-muted)] hover:text-[var(--tn-text)]',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

        {showAttackTools && sideTab === 'attack' ? (
          <AttackConsole
            key={consoleEpochRef.current}
            selectedNodeId={selectedNodeId}
            selectedNodeLabel={selectedNodeLabel}
            tgnnCalibrating={tgnnCalibrating}
            nodes={nodes}
            edges={edges}
            detection={detection}
            hackSimulator={hackSimulator}
            autoSpreadSafety={autoSpreadSafety}
            spreadPresetId={spreadPresetId}
            setSpreadPresetId={setSpreadPresetId}
            canUsePresets={canUsePresets}
            canSpread={canSpread}
            onApplyAttackPreset={onApplyAttackPreset}
            onSpreadAttack={onSpreadAttack}
            onAbortCampaigns={onAbortCampaigns}
            onSetAttackSpreadMode={onSetAttackSpreadMode}
          />
        ) : showAttackTools && sideTab === 'inject' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <p className="text-xs text-[var(--tn-muted)]">
              Drag a rogue device onto the map.
            </p>
            <CompactDeviceList
              assets={attackCatalog}
              onDragStart={(e, asset) =>
                handleDragStart(e, asset.type, asset.provenance ?? 'injected')
              }
            />
          </div>
        ) : showDevices ? (
          <DomainAssetList
            assets={getLiveCityAssets()}
            onDragStart={(e, asset) => handleDragStart(e, asset.type)}
          />
        ) : null}
      </div>
    )
  }

  return null
}
