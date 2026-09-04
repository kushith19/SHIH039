import { useState } from 'react'
import { Link } from 'react-router-dom'
import StatusBadge from '../../ui/StatusBadge'
import { FilterChip } from '../../ui/Toolbar'
import { COMMANDER_MODES } from '@shared/commanderIncidentIntel.js'
import CommanderInput from './CommanderInput'
import CommanderKnowledgeDrawer from './CommanderKnowledgeDrawer'
import { investigateChatSeedMessages } from './commanderFollowUp.js'

function severityTone(severity) {
  const s = String(severity ?? '').toLowerCase()
  if (s === 'critical' || s === 'high') return 'crit'
  if (s === 'medium') return 'warn'
  return 'muted'
}

function priorityTone(priority) {
  const p = String(priority ?? '').toUpperCase()
  if (p === 'CRITICAL' || p === 'HIGH') return 'crit'
  if (p === 'MEDIUM') return 'warn'
  return 'muted'
}

export default function IncidentCommanderAgent({
  context,
  mode,
  onModeChange,
  intel,
  roomId = '',
  incidentId = null,
  responseHref = null,
}) {
  if (!context) return null
  const asset =
    context.affectedAsset?.summary || context.affectedAsset?.id || 'Incident'
  const fin = context.financialExposure
  const money =
    fin?.simulated && fin.exposureLabel && fin.exposureLabel !== '₹0'
      ? fin.exposureLabel
      : null
  const risk =
    context.riskScore == null || !Number.isFinite(Number(context.riskScore))
      ? null
      : Number(context.riskScore) <= 1
        ? Math.round(Number(context.riskScore) * 100)
        : Math.round(Number(context.riskScore))
  const trust =
    context.trustScore == null || !Number.isFinite(Number(context.trustScore))
      ? null
      : Math.round(Number(context.trustScore))

  const header = (
    <AgentHeader
      context={context}
      intel={intel}
      mode={mode}
      onModeChange={onModeChange}
      asset={asset}
      money={money}
      risk={risk}
      trust={trust}
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {mode === COMMANDER_MODES.INVESTIGATE && intel?.sections ? (
        <InvestigateView
          header={header}
          intel={intel}
          roomId={roomId}
          incidentId={incidentId}
          mode={mode}
        />
      ) : null}

      {mode === COMMANDER_MODES.RESPOND && intel?.plan ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="shrink-0">{header}</div>
          <div className="min-h-0 flex-1 overflow-auto pr-1">
            <RespondView intel={intel} responseHref={responseHref} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AgentHeader({ context, intel, mode, onModeChange, asset, money, risk, trust }) {
  return (
    <header className="soc-zone overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{asset}</span>
          <StatusBadge tone={severityTone(context.severity)}>
            {context.severity || '—'}
          </StatusBadge>
          <StatusBadge tone="muted">{context.currentStatus || context.status || 'open'}</StatusBadge>
          <span className="soc-role-chip soc-role-advisory">Advisory</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={mode === COMMANDER_MODES.INVESTIGATE}
            onClick={() => onModeChange(COMMANDER_MODES.INVESTIGATE)}
          >
            Investigate
          </FilterChip>
          <FilterChip
            active={mode === COMMANDER_MODES.RESPOND}
            onClick={() => onModeChange(COMMANDER_MODES.RESPOND)}
          >
            Respond
          </FilterChip>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-[var(--tn-line)] px-4 py-2 font-mono text-sm tabular-nums sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="tn-label">Risk</dt>
          <dd>{risk ?? '—'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="tn-label">Trust</dt>
          <dd>{trust ?? '—'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="tn-label">Type</dt>
          <dd className="truncate font-sans">
            {intel?.primary?.typeLabel || context.incidentType || '—'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="tn-label">Simulated exposure</dt>
          <dd className="flex items-center gap-1.5 font-sans">
            <span className="truncate">{money || '—'}</span>
            {money ? <span className="soc-role-chip soc-role-simulated">Sim</span> : null}
          </dd>
        </div>
      </dl>
      {context.campaignId ? (
        <p className="tn-meta border-t border-[var(--tn-line)] px-4 py-1.5 text-[11px]">
          History campaign: {context.campaignId}
        </p>
      ) : null}
    </header>
  )
}

function InvestigateView({ header, intel, roomId, incidentId, mode }) {
  const [isKnowledgeOpen, setIsKnowledgeOpen] = useState(false)
  const s = intel.sections
  const path = s.graphImpact?.pathLabels ?? []
  const chatSeed = investigateChatSeedMessages(
    intel.epistemic?.observed,
    intel.knowledgeContext,
    intel.knowledgeStatus
  )
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pr-12">
        <div className="shrink-0 pb-3">{header}</div>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto">
        <section className="soc-zone px-5 py-4">
          <h2 className="soc-zone-title">Commander analysis</h2>
          <div className="mt-3 space-y-4">
            <Block title="Incident summary">{s.incidentSummary}</Block>
            <Block title="Why suspicious">
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
                {(s.whySuspicious || []).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </Block>
            <Block title="Current state">
              <p className="mt-1.5 text-sm">
                Severity {s.currentState?.severity ?? '—'} · Risk{' '}
                {s.currentState?.riskScore ?? '—'} · Trust{' '}
                {s.currentState?.trustScore ?? '—'} · Status{' '}
                {s.currentState?.status ?? '—'}
              </p>
            </Block>
          </div>
        </section>

        <GraphImpactBlock graph={s.graphImpact} path={path} />

        <section className="soc-zone px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="soc-zone-title">Financial / economic impact</h2>
            <span className="soc-role-chip soc-role-simulated">Simulated</span>
          </div>
          <p className="tn-meta mt-1.5 text-[11px] leading-relaxed">
            Simulated potential economic impact. Not actual financial loss.
          </p>
          {s.financialImpact?.exposureLabel ? (
            <p className="mt-2 font-mono text-xl font-medium tabular-nums">
              {s.financialImpact.exposureLabel}
            </p>
          ) : null}
          {s.financialImpact?.breakdown?.length ? (
            <ul className="mt-3 space-y-1 border-t border-[var(--tn-line)] pt-3 text-sm">
              {s.financialImpact.breakdown.map((row) => (
                <li
                  key={row.id || row.label}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span>{row.label}</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {row.exposureLabel || '—'}
                  </span>
                </li>
              ))}
            </ul>
          ) : s.financialImpact?.narrative ? (
            <p className="mt-2 text-sm leading-relaxed">{s.financialImpact.narrative}</p>
          ) : null}
        </section>

        {s.relatedIncidents?.length ? (
          <section className="soc-zone px-5 py-4">
            <h2 className="soc-zone-title">Related incidents</h2>
            <p className="tn-meta mt-1 text-[11px]">Context only — not additional confirmed origins</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {s.relatedIncidents.map((r, i) => (
                <li key={r.incidentId || i} className="flex flex-wrap items-center gap-2">
                  <span>{r.label}</span>
                  {r.severity ? (
                    <StatusBadge tone={severityTone(r.severity)}>{r.severity}</StatusBadge>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        </div>
      </div>

      <CommanderKnowledgeDrawer
        open={isKnowledgeOpen}
        onToggle={() => setIsKnowledgeOpen((open) => !open)}
        onClose={() => setIsKnowledgeOpen(false)}
      >
        <CommanderInput
          roomId={roomId}
          incidentId={incidentId}
          focused
          fillPanel
          mode={mode}
          initialMessages={chatSeed}
        />
      </CommanderKnowledgeDrawer>
    </div>
  )
}

function RespondView({ intel, responseHref }) {
  return (
    <section className="soc-zone overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--tn-line)] px-5 py-3">
        <div>
          <h2 className="soc-zone-title">Advisory response plan</h2>
          <p className="tn-meta mt-1 text-[11px]">
            Recommended actions only · Commander does not execute
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={priorityTone(intel.priority)}>
            Priority {intel.priority}
          </StatusBadge>
          <span className="soc-role-chip soc-role-advisory">Advisory</span>
        </div>
      </div>
      <ul className="px-5">
        {(intel.plan || []).map((step) => (
          <li
            key={step.phase}
            className="border-t border-[var(--tn-line)] py-3.5 first:border-t-0"
          >
            <div className="flex gap-4">
              <div className="w-8 shrink-0 font-mono text-sm">{step.step}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium tracking-wide">{step.title}</div>
                <p className="mt-1 text-sm leading-relaxed">{step.action}</p>
                {step.rationale ? (
                  <p className="tn-meta mt-1 text-[12px]">{step.rationale}</p>
                ) : null}
                <p className="tn-meta mt-1 text-[11px]">Recommended · not executed</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {responseHref ? (
        <div className="border-t border-[var(--tn-line)] px-5 py-4">
          <Link to={responseHref} replace className="tn-btn-primary inline-flex">
            Open Response Console →
          </Link>
          <p className="tn-meta mt-2 text-[11px]">
            Execution of registered containment actions happens only in Response.
          </p>
        </div>
      ) : null}
    </section>
  )
}

function GraphImpactBlock({ graph, path }) {
  if (!graph && !(path?.length > 0)) return null
  return (
    <section className="soc-zone px-5 py-4">
      <h2 className="soc-zone-title">Graph impact</h2>
      <p className="tn-meta mt-1 text-[11px]">{graph?.distinction}</p>
      {path?.length > 0 ? (
        <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
          {path.map((label, i) => (
            <li key={`${label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 ? (
                <span className="text-[var(--tn-muted)]" aria-hidden>
                  →
                </span>
              ) : null}
              <span className={i === 0 ? 'font-medium text-[var(--tn-crit)]' : 'text-[var(--tn-warn)]'}>
                {i === 0 ? `${label}` : label}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {path?.length > 0 ? (
        <p className="tn-meta mt-2 text-[11px]">
          First hop confirmed anomaly · later hops exposed / propagated (assessment)
        </p>
      ) : null}
      {graph?.lines?.length ? (
        <ul className="tn-meta mt-3 list-disc space-y-1 pl-5 text-[12px]">
          {graph.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function Block({ title, children }) {
  return (
    <div>
      <div className="tn-label">{title}</div>
      {typeof children === 'string' ? (
        <p className="mt-1.5 text-sm leading-relaxed">{children}</p>
      ) : (
        children
      )}
    </div>
  )
}
