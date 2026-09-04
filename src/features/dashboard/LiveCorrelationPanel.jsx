import { useEffect, useMemo, useState } from 'react'
import { detectionTypeLabel } from '@shared/incidents.js'
import StatusBadge from '../../ui/StatusBadge'
import EmptyState from '../../ui/EmptyState'
import {
  correlationReasonLabels,
  formatPriorityScore,
  formatTimelineClock,
  groupChronologicalTimeline,
  groupDependencyChains,
  groupMemberIncidents,
  groupPrimaryIncident,
  nodeLabelFromList,
  recoveryImpactBand,
  recoveryPriorityValue,
  reliefCount,
} from './incidentStreamView.js'

function formatClock(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return new Date(n).toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function severityTone(severity) {
  if (severity === 'critical' || severity === 'high') return 'crit'
  if (severity === 'medium') return 'warn'
  return 'muted'
}

/**
 * Live correlation groups from detection.liveCorrelation (server).
 * Separate from history camp-h-* campaigns.
 */
export default function LiveCorrelationPanel({
  groups = [],
  incidents = [],
  nodes = [],
  edges = [],
  ready = true,
  onSelectIncident,
}) {
  const rows = Array.isArray(groups) ? groups : []
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    if (!rows.length) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !rows.some((g) => g.groupId === selectedId)) {
      setSelectedId(rows[0].groupId)
    }
  }, [rows, selectedId])

  const selected = rows.find((g) => g.groupId === selectedId) ?? null
  const relatedIncidentCount = useMemo(() => {
    const ids = new Set()
    for (const g of rows) {
      for (const id of g.incidentIds ?? []) ids.add(String(id))
    }
    return ids.size
  }, [rows])
  const relatedNodeCount = useMemo(() => {
    const ids = new Set()
    for (const g of rows) {
      for (const id of g.nodeIds ?? []) ids.add(String(id))
    }
    return ids.size
  }, [rows])

  if (!ready) {
    return (
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="soc-zone flex min-h-0 flex-1 flex-col overflow-hidden">
          <EmptyState
            title="Connecting live correlation"
            body="Waiting for detection state. Groups appear when multiple related open incidents exist."
          />
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="soc-zone shrink-0 px-4 py-3">
        <h2 className="text-sm font-medium">Live correlation</h2>
        <p className="tn-meta mt-1 text-[11px]">
          Related open incidents this match · triage context, not attack attribution
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <dt className="tn-label">Groups</dt>
            <dd className="mt-0.5 font-mono text-base tabular-nums">{rows.length}</dd>
          </div>
          <div>
            <dt className="tn-label">Related incidents</dt>
            <dd className="mt-0.5 font-mono text-base tabular-nums">{relatedIncidentCount}</dd>
          </div>
          <div>
            <dt className="tn-label">Assets in groups</dt>
            <dd className="mt-0.5 font-mono text-base tabular-nums">{relatedNodeCount}</dd>
          </div>
          <div>
            <dt className="tn-label">State</dt>
            <dd className="mt-0.5 text-sm">
              {rows.length === 0 ? 'No correlated group' : 'Live'}
            </dd>
          </div>
        </dl>
      </div>

      {rows.length === 0 ? (
        <div className="soc-zone flex min-h-0 flex-1 flex-col overflow-hidden">
          <EmptyState
            title="No live correlated group yet"
            body="Needs multiple related open incidents in the current detection tick."
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
          <div className="soc-zone flex min-h-0 max-h-[40vh] flex-col overflow-hidden lg:max-h-none">
            <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-[var(--tn-line)] px-4 py-2.5">
              <div className="text-sm font-medium">Correlation groups</div>
              <span className="font-mono text-xs tabular-nums text-[var(--tn-muted)]">
                {rows.length}
              </span>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {rows.map((group) => {
                const primary = groupPrimaryIncident(group, incidents)
                const label =
                  primary?.endpointLabel ||
                  nodeLabelFromList(nodes, primary?.endpointId) ||
                  primary?.endpointId ||
                  'Unnamed group'
                const active = group.groupId === selectedId
                return (
                  <li key={group.groupId}>
                    <button
                      type="button"
                      className="flex w-full text-left transition-colors duration-150"
                      style={active ? { background: 'var(--tn-select-bg)' } : undefined}
                      onClick={() => setSelectedId(group.groupId)}
                    >
                      <div className="min-w-0 flex-1 px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone="warn">Related</StatusBadge>
                          <span className="tn-meta text-[11px]">
                            {group.openIncidentCount ?? group.incidentIds?.length ?? 0}{' '}
                            incidents
                          </span>
                        </div>
                        <p className="mt-1.5 truncate text-sm font-medium">{label}</p>
                        <p className="tn-meta mt-1 text-[11px]">
                          {formatClock(group.firstSeenAt)} → {formatClock(group.lastSeenAt)}
                        </p>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="soc-zone flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-[var(--tn-line)] px-4 py-2.5">
              <div className="text-sm font-medium">Group detail</div>
              <p className="tn-meta mt-0.5 text-[11px]">
                Connected incidents · assets · relationships
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {selected ? (
                <LiveGroupDetail
                  group={selected}
                  incidents={incidents}
                  nodes={nodes}
                  edges={edges}
                  onSelectIncident={onSelectIncident}
                />
              ) : (
                <p className="tn-meta">Select a correlation group to inspect relatedness.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function LiveGroupDetail({ group, incidents, nodes, edges, onSelectIncident }) {
  const primary = groupPrimaryIncident(group, incidents)
  const members = groupMemberIncidents(group, incidents)
  const reasons = correlationReasonLabels(group.relationshipReasons)
  const nodeLabels = (group.nodeIds ?? []).map((id) => nodeLabelFromList(nodes, id))

  return (
    <div className="space-y-5">
      <ResolveFirstCallout
        primary={primary}
        nodes={nodes}
        onSelectIncident={onSelectIncident}
      />

      <div>
        <h3 className="soc-zone-title">Correlation relationships</h3>
        {reasons.length ? (
          <ul className="tn-meta mt-2 list-disc space-y-0.5 pl-4 text-[12px]">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="tn-meta mt-2">No relationship labels on this group.</p>
        )}
        {Number.isFinite(Number(group.correlationScore)) ? (
          <p className="tn-meta mt-2 font-mono text-[11px]">
            corr {Number(group.correlationScore).toFixed(2)}
          </p>
        ) : null}
      </div>

      <div>
        <h3 className="soc-zone-title">Relevant assets</h3>
        {nodeLabels.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {nodeLabels.map((label) => (
              <li
                key={label}
                className="border border-[var(--tn-line)] px-2 py-1 text-xs"
              >
                {label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="tn-meta mt-2">No mapped endpoints on this group.</p>
        )}
      </div>

      <GroupTimeline group={group} incidents={incidents} onSelectIncident={onSelectIncident} />

      <GroupDependencySection
        group={group}
        incidents={incidents}
        nodes={nodes}
        edges={edges}
      />

      <div>
        <h3 className="soc-zone-title mb-2">Connected incidents</h3>
        <ol className="space-y-2">
          {members.map((inc, idx) => {
            const isPrimary =
              String(inc.id) === String(group.primaryIncidentId) ||
              (primary && String(inc.id) === String(primary.id))
            const score = recoveryPriorityValue(inc)
            return (
              <li key={inc.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 text-left text-sm hover:underline"
                  onClick={() => onSelectIncident?.(inc)}
                >
                  <span className="font-mono text-[11px] tabular-nums text-[var(--tn-muted)]">
                    #{idx + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {inc.endpointLabel || inc.endpointId}
                    </span>
                    {isPrimary ? (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--tn-warn)]">
                        Resolve first
                      </span>
                    ) : null}
                    <span className="tn-meta mt-0.5 block text-[11px]">
                      {detectionTypeLabel(inc.detectionType)}
                      {' · '}
                      {inc.severity || 'low'}
                      {score != null ? ` · priority ${formatPriorityScore(score)}` : ''}
                      {reliefCount(inc) > 0 ? ` · relief ${reliefCount(inc)}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <p className="tn-meta text-[10px]">
        Temporally related within the correlation window · Related ≠ caused · Potential
        relief ≠ confirmed restore
      </p>
    </div>
  )
}

function ResolveFirstCallout({ primary, nodes, onSelectIncident }) {
  if (!primary) {
    return (
      <div className="border border-[var(--tn-line)] px-3 py-2">
        <p className="tn-meta text-[11px]">No primary incident selected for this group yet.</p>
      </div>
    )
  }

  const priority = recoveryPriorityValue(primary)
  const band = recoveryImpactBand(priority)
  const explanation = primary.recoveryImpact?.explanation
  const certainCount = explanation?.certain?.count ?? 1
  const relief = explanation?.exposureRelief?.count ?? reliefCount(primary)
  const criticalCount = explanation?.exposureRelief?.criticalCount ?? 0
  const excluded = explanation?.excludedIndependent?.count ?? 0
  const label =
    primary.endpointLabel ||
    nodeLabelFromList(nodes, primary.endpointId) ||
    primary.endpointId

  return (
    <div
      className="border px-3 py-3"
      style={{
        borderColor: 'color-mix(in srgb, var(--tn-warn) 55%, var(--tn-line))',
        background: 'color-mix(in srgb, var(--tn-warn) 12%, transparent)',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="text-[11px] font-bold uppercase tracking-[0.12em]"
          style={{ color: 'var(--tn-warn)' }}
        >
          Resolve first
        </span>
      </div>
      <button
        type="button"
        className="mt-1.5 text-left text-base font-semibold hover:underline"
        onClick={() => onSelectIncident?.(primary)}
      >
        {label}
      </button>
      <p className="mt-1 font-mono text-sm tabular-nums">
        Recovery priority {priority == null ? '—' : formatPriorityScore(priority)}
        {band ? <span className="tn-meta ml-1.5 text-[11px]">{band}</span> : null}
      </p>

      <div className="tn-label mt-3">Why?</div>
      <ul className="mt-1.5 space-y-1 text-[12px] leading-snug">
        <li>✓ Certain recovery: {certainCount} node{certainCount === 1 ? '' : 's'}</li>
        {relief > 0 ? (
          <li>↳ May reduce exposure: {relief} node{relief === 1 ? '' : 's'}</li>
        ) : (
          <li className="text-[var(--tn-muted)]">↳ No additional exposure-relief candidates</li>
        )}
        {criticalCount > 0 ? (
          <li>✓ {criticalCount} critical service{criticalCount === 1 ? '' : 's'} involved</li>
        ) : null}
      </ul>
      {excluded > 0 ? (
        <p className="tn-meta mt-2 text-[11px]">
          {excluded} independently compromised node{excluded === 1 ? '' : 's'}{' '}
          {excluded === 1 ? 'is' : 'are'} excluded from this estimate.
        </p>
      ) : null}
    </div>
  )
}

function GroupTimeline({ group, incidents, onSelectIncident }) {
  const events = groupChronologicalTimeline(group, incidents)
  if (events.length === 0) {
    return (
      <div>
        <h3 className="soc-zone-title">Group chronology</h3>
        <p className="tn-meta mt-1 text-[11px]">No detection timestamps on these members.</p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="soc-zone-title">Group chronology</h3>
      <p className="tn-meta mt-0.5 text-[10px]">
        Temporally related · detected within the correlation window · not causality
      </p>
      <ol className="mt-2 space-y-1.5">
        {events.map(({ incident: inc, detectedAtMs, recoveryRank }) => (
          <li key={inc.id}>
            <button
              type="button"
              className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-2 text-left text-[12px] hover:underline"
              onClick={() => onSelectIncident?.(inc)}
            >
              <span className="font-mono tabular-nums text-[var(--tn-muted)]">
                {formatTimelineClock(detectedAtMs)}
              </span>
              <span className="min-w-0 truncate font-medium">
                {inc.endpointLabel || inc.endpointId}
                <span className="tn-meta ml-1.5 font-normal">
                  {detectionTypeLabel(inc.detectionType)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <StatusBadge tone={severityTone(inc.severity)}>
                  {String(inc.severity || 'low').toUpperCase()}
                </StatusBadge>
                {recoveryRank != null ? (
                  <span className="font-mono text-[10px] tabular-nums text-[var(--tn-muted)]">
                    Priority #{recoveryRank}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function GroupDependencySection({ group, incidents, nodes, edges }) {
  const chains = groupDependencyChains(group, incidents, edges)
  if (chains.length === 0) {
    return (
      <div>
        <h3 className="soc-zone-title">Dependency relationship</h3>
        <p className="tn-meta mt-1 text-[11px]">
          No directed dependency edge among these incident endpoints in the current graph.
        </p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="soc-zone-title">Downstream dependency</h3>
      <p className="tn-meta mt-0.5 text-[10px]">
        Infrastructure topology · potential recovery leverage — not an attack path
      </p>
      <div className="mt-2 space-y-3">
        {chains.map((chain) => (
          <ol key={chain.join('>')} className="pl-0.5">
            {chain.map((id, i) => (
              <li key={`${id}-${i}`}>
                {i > 0 ? (
                  <div className="py-0.5 pl-2 text-[var(--tn-muted)]" aria-hidden="true">
                    ↓
                  </div>
                ) : null}
                <span className={`text-sm ${i === 0 ? 'font-medium' : ''}`}>
                  {nodeLabelFromList(nodes, id)}
                </span>
              </li>
            ))}
          </ol>
        ))}
      </div>
    </div>
  )
}
