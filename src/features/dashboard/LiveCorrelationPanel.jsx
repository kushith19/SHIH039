import { useState } from 'react'
import { detectionTypeLabel } from '@shared/incidents.js'
import StatusBadge from '../../ui/StatusBadge'
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
  compact = false,
  onSelectIncident,
}) {
  const rows = Array.isArray(groups) ? groups : []
  const [openId, setOpenId] = useState(null)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-[var(--tn-line)] px-4 py-2">
        <p className="tn-meta text-[11px]">
          {compact
            ? 'Live related incidents · triage context, not attack attribution'
            : 'Live correlation groups from open incidents this match'}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {rows.length === 0 ? (
          <p className="tn-meta">
            No live correlated group yet — needs multiple related open incidents.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((group) => (
              <LiveGroupCard
                key={group.groupId}
                group={group}
                incidents={incidents}
                nodes={nodes}
                edges={edges}
                expanded={openId === group.groupId}
                onToggle={() =>
                  setOpenId((cur) => (cur === group.groupId ? null : group.groupId))
                }
                onSelectIncident={onSelectIncident}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LiveGroupCard({
  group,
  incidents,
  nodes,
  edges,
  expanded,
  onToggle,
  onSelectIncident,
}) {
  const primary = groupPrimaryIncident(group, incidents)
  const members = groupMemberIncidents(group, incidents)
  const reasons = correlationReasonLabels(group.relationshipReasons)
  const priority = recoveryPriorityValue(primary)
  const band = recoveryImpactBand(priority)
  const relief = reliefCount(primary)
  const primaryLabel =
    primary?.endpointLabel ||
    nodeLabelFromList(nodes, primary?.endpointId) ||
    primary?.endpointId ||
    '—'

  return (
    <article className="border border-[var(--tn-line)] bg-[var(--tn-elevated)]/40">
      <button type="button" className="w-full px-3 py-2.5 text-left" onClick={onToggle}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="warn">Related</StatusBadge>
          <span className="tn-meta text-[11px]">
            {group.openIncidentCount ?? group.incidentIds?.length ?? 0} incidents
          </span>
          {Number.isFinite(Number(group.correlationScore)) ? (
            <span className="font-mono text-[11px] tabular-nums text-[var(--tn-muted)]">
              corr {Number(group.correlationScore).toFixed(2)}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm leading-snug">
          <span className="tn-label">Resolve first</span>
          <span className="mt-0.5 block font-medium">{primaryLabel}</span>
        </p>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--tn-muted)]">
          {priority != null ? (
            <span>
              Priority {formatPriorityScore(priority)}
              {band ? ` · ${band}` : ''}
            </span>
          ) : null}
          {relief > 0 ? <span>Potential relief: {relief}</span> : null}
          <span>
            {(group.nodeIds ?? [])
              .slice(0, 4)
              .map((id) => nodeLabelFromList(nodes, id))
              .join(' · ') || '—'}
          </span>
        </div>
        {reasons.length ? (
          <ul className="tn-meta mt-2 list-disc space-y-0.5 pl-4 text-[11px]">
            {reasons.slice(0, 4).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
        <p className="tn-meta mt-2 text-[10px]">
          {formatClock(group.firstSeenAt)} → {formatClock(group.lastSeenAt)}
          <span className="ml-2">{expanded ? 'Hide detail' : 'Open detail'}</span>
        </p>
      </button>

      {expanded ? (
        <div className="border-t border-[var(--tn-line)] px-3 py-3 space-y-4">
          <ResolveFirstCallout
            primary={primary}
            nodes={nodes}
            onSelectIncident={onSelectIncident}
          />

          <GroupTimeline
            group={group}
            incidents={incidents}
            onSelectIncident={onSelectIncident}
          />

          <GroupDependencySection
            group={group}
            incidents={incidents}
            nodes={nodes}
            edges={edges}
          />

          <div>
            <div className="soc-zone-title mb-2">Members by recovery priority</div>
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
      ) : null}
    </article>
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
  if (events.length === 0) return null

  return (
    <div>
      <div className="soc-zone-title">Correlation timeline</div>
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
        <div className="soc-zone-title">Dependency relationship</div>
        <p className="tn-meta mt-1 text-[11px]">
          No directed dependency edge among these incident endpoints in the current graph.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="soc-zone-title">Downstream dependency</div>
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
