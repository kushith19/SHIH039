import { useEffect, useMemo, useState } from 'react'
import {
  assetCatalog,
  attackCatalog,
  getAssetsGroupedByDomain,
} from '../graph/assetCatalog'
import { ATTACK_PRESETS } from '../graph/attackPresets'

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
                <span className="tabular-nums text-sm text-[var(--tn-muted)]">
                  {group.assets.length}
                </span>
              </button>
              {open ? (
                <div className="pb-1 pl-1">
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
          <AssetRow
            key={asset.type}
            asset={asset}
            onDragStart={onDragStart}
          />
        ))}
      </div>
    </div>
  )
}

export default function SidebarAssets({
  role = null,
  phase = 'lobby',
  showDevices = true,
  showAttackTools = false,
  selectedNodeId = null,
  tgnnCalibrating = false,
  onApplyAttackPreset,
  onAbortCampaigns,
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
        : role === 'attacker' && !inLobby
          ? tgnnCalibrating
            ? 'Wait for the 15-tick idle window before injecting. Clear attacks if collection is paused.'
            : 'Apply a preset on a selected node. Hit two connected nodes within ~12 seconds for a defender pattern match.'
          : null

  const canUsePresets =
    showAttackTools && selectedNodeId && onApplyAttackPreset && !tgnnCalibrating

  const [sideTab, setSideTab] = useState(showAttackTools ? 'inject' : 'devices')

  useEffect(() => {
    if (showAttackTools) setSideTab('inject')
  }, [showAttackTools])

  const tabs = showAttackTools
    ? [
        { id: 'inject', label: 'Rogue' },
        { id: 'presets', label: 'Presets' },
      ]
    : [{ id: 'devices', label: 'Sectors' }]

  if (showDevices || showAttackTools) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <p className="flex items-start gap-2 text-sm leading-snug text-[var(--tn-muted)]">
          {showAttackTools ? (
            <span className="tn-pip" style={{ background: 'var(--tn-crit)' }} />
          ) : null}
          {hint ??
            (showAttackTools
              ? tgnnCalibrating
                ? 'Wait for the 15-tick idle window before injecting an anomaly.'
                : 'Select a node, then apply a preset. Two connected nodes in ~12s can form a pattern.'
              : 'Drag a sector onto the map.')}
        </p>

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

        {showAttackTools && sideTab === 'presets' ? (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {!selectedNodeId ? (
              <p className="text-sm text-[var(--tn-muted)]">Select a node to apply a metric override.</p>
            ) : (
              <p className="text-sm text-[var(--tn-muted)]">
                Presets only change telemetry on the selected node. Patterns are recognized on the defender side after incidents exist.
              </p>
            )}
            <div className="grid grid-cols-1 gap-1">
              {ATTACK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={!canUsePresets}
                  title={preset.description}
                  onClick={() => {
                    if (!canUsePresets) return
                    onApplyAttackPreset(preset.id)
                  }}
                  className="tn-btn w-full justify-start text-sm disabled:opacity-35"
                >
                  {preset.title}
                </button>
              ))}
            </div>
            {onAbortCampaigns ? (
              <button
                type="button"
                className="tn-btn mt-1.5 w-full justify-start text-sm"
                onClick={() => onAbortCampaigns()}
              >
                Clear attack overrides
              </button>
            ) : null}
          </div>
        ) : showAttackTools && sideTab === 'inject' ? (
          <CompactDeviceList
            assets={attackCatalog}
            onDragStart={(e, asset) =>
              handleDragStart(e, asset.type, asset.provenance ?? 'injected')
            }
          />
        ) : showDevices ? (
          <DomainAssetList
            assets={assetCatalog}
            onDragStart={(e, asset) => handleDragStart(e, asset.type)}
          />
        ) : null}
      </div>
    )
  }

  return null
}
