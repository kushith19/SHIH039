import { useMemo, useState } from 'react'
import {
  assetCatalog,
  attackCatalog,
  getAssetsGroupedByDomain,
} from '../graph/assetCatalog'
import { ATTACK_PRESETS } from '../graph/attackPresets'
import { attackPresetTitle } from '@shared/attackPresets.js'
import {
  CAMPAIGN_PLAYBOOKS,
  activeCampaign,
  playbookTitle,
  stageProgressLabel,
} from '@shared/campaigns.js'

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
  campaigns = [],
  simulationTick = 0,
  onApplyAttackPreset,
  onStartCampaign,
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
  const liveCampaign = activeCampaign(campaigns)
  const hint =
    role === 'defender' && inLobby
      ? 'Drag a sector onto Bengaluru.'
      : role === 'defender' && !inLobby
        ? 'Add sectors or quarantine a node.'
        : role === 'attacker' && !inLobby
          ? 'Start a playbook or add a preset stage to the active campaign.'
          : null

  const canUsePresets =
    showAttackTools && selectedNodeId && onApplyAttackPreset
  const canStartPlaybook = showAttackTools && selectedNodeId && onStartCampaign

  const [sideTab, setSideTab] = useState(showAttackTools ? 'campaigns' : 'devices')

  const tabs = showAttackTools
    ? [
        { id: 'inject', label: 'Rogue' },
        { id: 'campaigns', label: 'Campaigns' },
      ]
    : [{ id: 'devices', label: 'Sectors' }]

  const nextStage = liveCampaign?.stages?.find((s) => s.status === 'pending')
  const lastApplied = [...(liveCampaign?.stages ?? [])]
    .reverse()
    .find((s) => s.status === 'applied' || s.status === 'skipped')
  const ticksUntilNext =
    liveCampaign && nextStage
      ? Math.max(
          0,
          (Number(lastApplied?.appliedTick ?? liveCampaign.startedTick) || 0) +
            (Number(nextStage.delayTicks) || 0) -
            (Number(simulationTick) || 0)
        )
      : null

  if (showDevices || showAttackTools) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <p className="flex items-center gap-1.5 text-xs leading-snug text-[var(--tn-muted)]">
          {showAttackTools ? (
            <span className="tn-pip" style={{ background: 'var(--tn-crit)' }} />
          ) : null}
          {hint ??
            (showAttackTools
              ? 'Select a node, then run a playbook or preset.'
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

        {showAttackTools && sideTab === 'campaigns' ? (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {liveCampaign ? (
              <div className="border border-[var(--tn-line)] px-2 py-1.5">
                <div className="text-xs font-medium">
                  {liveCampaign.title || playbookTitle(liveCampaign.playbookId)}
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-[var(--tn-muted)]">
                  {liveCampaign.status} · {stageProgressLabel(liveCampaign)}
                  {ticksUntilNext != null && nextStage
                    ? ` · next in ${ticksUntilNext}t`
                    : ''}
                </p>
                <ol className="mt-1 space-y-0.5 text-[11px] text-[var(--tn-muted)]">
                  {(liveCampaign.stages ?? []).map((stage) => (
                    <li key={stage.id}>
                      {stage.status === 'applied' ? '●' : stage.status === 'skipped' ? '○' : '·'}{' '}
                      {attackPresetTitle(stage.presetId)}
                      {stage.targetNodeId ? ` @ ${stage.targetNodeId}` : ''}
                    </li>
                  ))}
                </ol>
                {onAbortCampaigns ? (
                  <button
                    type="button"
                    className="tn-btn mt-1.5 w-full justify-start text-xs"
                    onClick={() => onAbortCampaigns()}
                  >
                    Abort campaign
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-[var(--tn-muted)]">
                {selectedNodeId
                  ? 'No active campaign. Start a playbook or a preset.'
                  : 'Select a target on the map.'}
              </p>
            )}

            <div>
              <div className="tn-label mb-1">Playbooks</div>
              <div className="grid grid-cols-1 gap-1">
                {CAMPAIGN_PLAYBOOKS.map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    disabled={!canStartPlaybook}
                    title={book.description}
                    onClick={() => {
                      if (!canStartPlaybook) return
                      onStartCampaign(book.id)
                    }}
                    className="tn-btn w-full justify-start text-xs disabled:opacity-35"
                  >
                    {book.title}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="tn-label mb-1">Add stage</div>
              {!selectedNodeId ? (
                <p className="text-xs text-[var(--tn-muted)]">Select a node to attach a preset.</p>
              ) : (
                <p className="mb-1 text-xs text-[var(--tn-muted)]">
                  Presets attach to the active campaign, or start a manual one.
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
                    className="tn-btn w-full justify-start text-xs disabled:opacity-35"
                  >
                    {preset.title}
                  </button>
                ))}
              </div>
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
