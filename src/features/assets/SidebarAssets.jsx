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

const paletteThemes = {
  defender: {
    tabWrap:
      'flex rounded-md border border-slate-200/80 dark:border-slate-700/70 p-0.5 bg-slate-100/70 dark:bg-slate-900/50',
    tabActive: 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm',
    tabIdle: 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200',
    sectionLabel: 'text-slate-500 dark:text-slate-400',
    row: 'group flex items-center gap-2 rounded-md px-1.5 py-1 cursor-grab active:cursor-grabbing hover:bg-slate-100 dark:hover:bg-slate-800/80',
    iconWrap:
      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200/80 bg-white dark:border-slate-700 dark:bg-slate-900',
    icon: 'text-slate-600 dark:text-slate-300',
    title: 'text-slate-800 dark:text-slate-100',
    presetBtn:
      'rounded-md border border-slate-200/80 dark:border-slate-700 bg-white/90 dark:bg-slate-900/50 px-2 py-1.5 text-[10px] font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed',
    search:
      'w-full rounded-md border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/60 px-2 py-1 text-[11px] text-slate-800 dark:text-slate-100 outline-none placeholder:text-slate-400 focus:ring-1 focus:ring-slate-400/50',
  },
  attacker: {
    tabWrap:
      'flex rounded-md border border-rose-200/70 dark:border-rose-900/50 p-0.5 bg-rose-50/50 dark:bg-rose-950/30',
    tabActive: 'bg-white dark:bg-rose-950/70 text-rose-900 dark:text-rose-100 shadow-sm',
    tabIdle: 'text-rose-700/70 dark:text-rose-300/70 hover:text-rose-900 dark:hover:text-rose-100',
    sectionLabel: 'text-rose-600/90 dark:text-rose-400/90',
    row: 'group flex items-center gap-2 rounded-md px-1.5 py-1 cursor-grab active:cursor-grabbing hover:bg-rose-50 dark:hover:bg-rose-950/40',
    iconWrap:
      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-rose-200/80 bg-white dark:border-rose-900/50 dark:bg-rose-950/40',
    icon: 'text-rose-600 dark:text-rose-300',
    title: 'text-rose-950 dark:text-rose-100',
    presetBtn:
      'rounded-md border border-rose-200/70 dark:border-rose-900/50 bg-white/90 dark:bg-rose-950/40 px-2 py-1.5 text-[10px] font-medium text-rose-950 dark:text-rose-100 hover:bg-rose-50 dark:hover:bg-rose-950/50 disabled:opacity-35 disabled:cursor-not-allowed',
    search:
      'w-full rounded-md border border-rose-200/70 dark:border-rose-900/50 bg-white dark:bg-rose-950/40 px-2 py-1 text-[11px] text-slate-800 dark:text-slate-100 outline-none placeholder:text-rose-400/70 focus:ring-1 focus:ring-rose-400/40',
  },
}

function AssetRow({ asset, theme, onDragStart }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, asset)}
      title={asset.title}
      aria-label={`Add ${asset.title}`}
      className={theme.row}
    >
      <span className={theme.iconWrap}>
        <asset.Icon size={13} className={theme.icon} />
      </span>
      <span className={`min-w-0 flex-1 truncate text-[11px] font-medium leading-tight ${theme.title}`}>
        {asset.title}
      </span>
    </div>
  )
}

function DomainAssetList({ assets, theme, onDragStart }) {
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
        className={theme.search}
      />
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        {visibleGroups.map((group) => {
          const open = q ? true : openDomain === group.domain
          const short = DOMAIN_SHORT[group.domain] ?? group.domain
          const accent = DOMAIN_ACCENT[group.domain] ?? 'bg-slate-400'
          return (
            <div
              key={group.domain}
              className="overflow-hidden rounded-lg border border-slate-200/70 bg-white/70 dark:border-slate-800 dark:bg-slate-900/40"
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
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                  {short}
                </span>
                <span className="tabular-nums text-[10px] text-slate-400">{group.assets.length}</span>
              </button>
              {open ? (
                <div className="border-t border-slate-100 px-0.5 pb-1 pt-0.5 dark:border-slate-800">
                  {group.assets.map((asset) => (
                    <AssetRow
                      key={asset.type}
                      asset={asset}
                      theme={theme}
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

function CompactDeviceList({ assets, theme, onDragStart }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <p className={`mb-1.5 text-[10px] uppercase tracking-wide ${theme.sectionLabel}`}>
        Drag onto map
      </p>
      <div className="space-y-0.5">
        {assets.map((asset) => (
          <AssetRow
            key={asset.type}
            asset={asset}
            theme={theme}
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
  const theme = showAttackTools ? paletteThemes.attacker : paletteThemes.defender

  const tabs = showAttackTools
    ? [
        { id: 'inject', label: 'Rogue' },
        { id: 'presets', label: 'Presets' },
      ]
    : [{ id: 'devices', label: 'Sectors' }]

  if (showDevices || showAttackTools) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
          {hint ??
            (showAttackTools
              ? 'Select a node, then run a preset.'
              : 'Drag a sector onto the map.')}
        </p>

        {tabs.length > 1 ? (
          <div className={theme.tabWrap}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSideTab(tab.id)}
                className={[
                  'flex-1 rounded px-1.5 py-1 text-[10px] font-medium transition',
                  sideTab === tab.id ? theme.tabActive : theme.tabIdle,
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
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Select a target on the map.
              </p>
            ) : (
              <p className="text-[10px] text-emerald-700 dark:text-emerald-400">
                Target selected.
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
                    onApplyAttackPreset(
                      preset.id,
                      presetToNodeDataPatch(preset.id, selectedNodeBaselineMetrics)
                    )
                  }}
                  className={theme.presetBtn}
                >
                  {preset.title}
                </button>
              ))}
            </div>
          </div>
        ) : showAttackTools && sideTab === 'inject' ? (
          <CompactDeviceList
            assets={attackCatalog}
            theme={theme}
            onDragStart={(e, asset) =>
              handleDragStart(e, asset.type, asset.provenance ?? 'injected')
            }
          />
        ) : showDevices ? (
          <DomainAssetList
            assets={assetCatalog}
            theme={theme}
            onDragStart={(e, asset) => handleDragStart(e, asset.type)}
          />
        ) : null}
      </div>
    )
  }

  return null
}
