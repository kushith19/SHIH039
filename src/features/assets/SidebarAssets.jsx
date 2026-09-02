import { useMemo, useState } from 'react'
import {
  assetCatalog,
  attackCatalog,
  getAssetsGroupedByDomain,
} from '../graph/assetCatalog'
import { ATTACK_PRESETS, presetToNodeDataPatch } from '../graph/attackPresets'

const DOMAIN_SHORT = {
  'Energy & Utilities': 'Energy',
  'Water & Waste': 'Water',
  Transportation: 'Transport',
  'Telecommunications & Digital': 'Telecom',
  'Government & Civic Services': 'Civic',
  Healthcare: 'Health',
  'Public Safety & Emergency': 'Safety',
  Environment: 'Environment',
  'Financial & Commercial': 'Finance',
  'Urban Infrastructure': 'Urban',
}

const DOMAIN_ACCENT = {
  'Energy & Utilities': 'bg-amber-500',
  'Water & Waste': 'bg-sky-500',
  Transportation: 'bg-slate-500',
  'Telecommunications & Digital': 'bg-violet-500',
  'Government & Civic Services': 'bg-indigo-500',
  Healthcare: 'bg-rose-500',
  'Public Safety & Emergency': 'bg-red-500',
  Environment: 'bg-emerald-500',
  'Financial & Commercial': 'bg-teal-500',
  'Urban Infrastructure': 'bg-stone-500',
}

function AssetRow({ asset, onDragStart }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, asset)}
      title={asset.title}
      aria-label={`Add ${asset.title}`}
      className="group flex cursor-grab items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--tn-elevated)] active:cursor-grabbing"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--tn-line)] bg-[var(--tn-surface)]">
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
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${assets.length} sectors`}
        className="tn-input px-2 py-1.5 text-sm placeholder:text-[var(--tn-muted)]"
      />
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        {visibleGroups.map((group) => {
          const open = q ? true : openDomain === group.domain
          const short = DOMAIN_SHORT[group.domain] ?? group.domain
          const accent = DOMAIN_ACCENT[group.domain] ?? 'bg-slate-400'
          return (
            <div
              key={group.domain}
              className="overflow-hidden border border-[var(--tn-line)]"
            >
              <button
                type="button"
                onClick={() =>
                  setOpenDomain((prev) => (prev === group.domain ? null : group.domain))
                }
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
                aria-expanded={open}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${accent}`} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{short}</span>
                <span className="tabular-nums text-xs text-[var(--tn-muted)]">
                  {group.assets.length}
                </span>
              </button>
              {open ? (
                <div className="border-t border-[var(--tn-line)] px-0.5 pb-1 pt-0.5">
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
  selectedNodeBaselineMetrics = null,
  onApplyAttackPreset,
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
          ? 'Drop a rogue device, then attack.'
          : null

  const canUsePresets =
    showAttackTools && selectedNodeId && selectedNodeBaselineMetrics && onApplyAttackPreset

  const [sideTab, setSideTab] = useState(showAttackTools ? 'inject' : 'devices')

  const tabs = showAttackTools
    ? [
        { id: 'inject', label: 'Rogue' },
        { id: 'presets', label: 'Presets' },
      ]
    : [{ id: 'devices', label: 'Sectors' }]

  if (showDevices || showAttackTools) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <p className="flex items-center gap-1.5 text-xs leading-snug text-[var(--tn-muted)]">
          {showAttackTools ? (
            <span className="tn-pip" style={{ background: 'var(--tn-crit)' }} />
          ) : null}
          {hint ??
            (showAttackTools
              ? 'Select a node, then run a preset.'
              : 'Drag a sector onto the map.')}
        </p>

        {tabs.length > 1 ? (
          <div className="flex border border-[var(--tn-line)] p-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSideTab(tab.id)}
                className={[
                  'flex-1 rounded px-1.5 py-1 text-xs font-medium',
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
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {!selectedNodeId ? (
              <p className="text-xs text-[var(--tn-muted)]">Select a target on the map.</p>
            ) : (
              <p className="text-xs">Target selected.</p>
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
                    onApplyAttackPreset(
                      preset.id,
                      presetToNodeDataPatch(preset.id, selectedNodeBaselineMetrics)
                    )
                  }}
                  className="tn-btn w-full justify-start text-xs disabled:opacity-35"
                >
                  {preset.title}
                </button>
              ))}
            </div>
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
