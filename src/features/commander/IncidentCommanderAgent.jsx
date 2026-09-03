import StatusBadge from '../../ui/StatusBadge'
import { FilterChip } from '../../ui/Toolbar'
import { COMMANDER_MODES } from '@shared/commanderIncidentIntel.js'

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

  return (
    <div className="space-y-6">
      <header className="tn-surface px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="tn-label">AI Commander</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge tone="ok">Operational</StatusBadge>
              <span className="tn-meta">Incident response agent</span>
            </div>
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
      </header>

      <section className="tn-surface px-5 py-5">
        <h2 className="tn-section-title">Incident context</h2>
        <p className="tn-meta mt-1">
          Structured context from backend · primary incident only
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-lg font-medium">{asset}</span>
          <StatusBadge tone={severityTone(context.severity)}>
            {context.severity || '—'}
          </StatusBadge>
          <StatusBadge tone="muted">{context.currentStatus || context.status || 'open'}</StatusBadge>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 font-mono tabular-nums sm:grid-cols-4">
          <div>
            <dt className="tn-label">Risk</dt>
            <dd className="mt-1 text-base">{risk ?? '—'}</dd>
          </div>
          <div>
            <dt className="tn-label">Trust</dt>
            <dd className="mt-1 text-base">{trust ?? '—'}</dd>
          </div>
          <div>
            <dt className="tn-label">Type</dt>
            <dd className="mt-1 truncate text-sm font-sans">
              {intel?.primary?.typeLabel || context.incidentType || '—'}
            </dd>
          </div>
          <div>
            <dt className="tn-label">Simulated exposure</dt>
            <dd className="mt-1 text-sm font-sans">{money || '—'}</dd>
          </div>
        </dl>
        {context.campaignId ? (
          <p className="tn-meta mt-3">History campaign: {context.campaignId}</p>
        ) : null}
      </section>

      {mode === COMMANDER_MODES.INVESTIGATE && intel?.sections ? (
        <InvestigateView intel={intel} />
      ) : null}

      {mode === COMMANDER_MODES.INVESTIGATE ? (
        <KnowledgeSection intel={intel} />
      ) : null}

      {mode === COMMANDER_MODES.RESPOND && intel?.plan ? (
        <RespondView intel={intel} />
      ) : null}
    </div>
  )
}

function InvestigateView({ intel }) {
  const s = intel.sections
  const path = s.graphImpact?.pathLabels ?? []
  return (
    <>
      <section className="tn-surface px-5 py-5">
        <h2 className="tn-section-title">Commander analysis</h2>
        <div className="mt-4 space-y-5">
          <Block title="Incident summary">{s.incidentSummary}</Block>
          <Block title="Why suspicious">
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {(s.whySuspicious || []).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </Block>
          <Block title="Current state">
            <p className="mt-2 text-sm">
              Severity {s.currentState?.severity ?? '—'} · Risk{' '}
              {s.currentState?.riskScore ?? '—'} · Trust{' '}
              {s.currentState?.trustScore ?? '—'} · Status{' '}
              {s.currentState?.status ?? '—'}
            </p>
          </Block>
        </div>
      </section>

      <GraphImpactBlock graph={s.graphImpact} path={path} />

      <section className="tn-surface px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="tn-section-title">Financial / Economic Impact</h2>
          <StatusBadge tone="muted">Simulated exposure</StatusBadge>
        </div>
        <p className="tn-meta mt-2 leading-relaxed">
          Simulated potential economic impact across affected Smart City
          infrastructure. Not actual financial loss.
        </p>
        {s.financialImpact?.exposureLabel ? (
          <p className="mt-3 font-mono text-2xl font-medium tabular-nums">
            {s.financialImpact.exposureLabel}
          </p>
        ) : null}
        {s.financialImpact?.breakdown?.length ? (
          <div className="mt-4 border-t border-[var(--tn-line)] pt-4">
            <div className="tn-label">Affected infrastructure</div>
            <ul className="mt-2 space-y-1.5 text-sm">
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
            <p className="tn-meta mt-3">
              {s.financialImpact.affectedServices ??
                s.financialImpact.breakdown.length}{' '}
              affected economic service
              {(s.financialImpact.affectedServices ??
                s.financialImpact.breakdown.length) === 1
                ? ''
                : 's'}
            </p>
          </div>
        ) : s.financialImpact?.narrative ? (
          <p className="mt-3 text-sm leading-relaxed">
            {s.financialImpact.narrative}
          </p>
        ) : null}
      </section>

      {s.relatedIncidents?.length ? (
        <section className="tn-surface px-5 py-5">
          <h2 className="tn-section-title">Related incidents</h2>
          <p className="tn-meta mt-1">Context only — not additional confirmed origins</p>
          <ul className="mt-3 space-y-2 text-sm">
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
    </>
  )
}

function RespondView({ intel }) {
  const path = intel.sections?.graphImpact?.pathLabels ?? []
  return (
    <>
      <section className="tn-surface overflow-hidden px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="tn-section-title">Response plan</h2>
          <StatusBadge tone={priorityTone(intel.priority)}>
            Priority {intel.priority}
          </StatusBadge>
        </div>
        <p className="tn-meta mt-1">
          Recommended actions only · Commander does not execute infrastructure changes
        </p>
        <ul className="mt-2">
          {(intel.plan || []).map((step) => (
            <li
              key={step.phase}
              className="border-t border-[var(--tn-line)] py-4 first:border-t-0"
            >
              <div className="flex gap-4">
                <div className="w-8 shrink-0 font-mono text-sm">{step.step}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium tracking-wide">{step.title}</div>
                  <p className="mt-1.5 text-sm leading-relaxed">{step.action}</p>
                  {step.rationale ? (
                    <p className="tn-meta mt-1.5">{step.rationale}</p>
                  ) : null}
                  <p className="tn-meta mt-1">Recommended action · not executed</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <GraphImpactBlock graph={intel.sections?.graphImpact} path={path} />
    </>
  )
}

function GraphImpactBlock({ graph, path }) {
  if (!graph && !(path?.length > 0)) return null
  return (
    <section className="tn-surface px-5 py-5">
      <h2 className="tn-section-title">Graph impact</h2>
      <p className="tn-meta mt-1">{graph?.distinction}</p>
      {path?.length > 0 ? (
        <ol className="mt-4 space-y-1 text-sm">
          {path.map((label, i) => (
            <li key={`${label}-${i}`} className="flex flex-col items-start">
              {i > 0 ? (
                <span className="px-2 font-mono text-[var(--tn-muted)]" aria-hidden>
                  ↓
                </span>
              ) : null}
              <span className={i === 0 ? 'font-medium' : ''}>
                {i === 0 ? `${label} · confirmed anomaly` : `${label} · exposed / propagated`}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {graph?.lines?.length ? (
        <ul className="tn-meta mt-4 list-disc space-y-1 pl-5">
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
        <p className="mt-2 text-sm leading-relaxed">{children}</p>
      ) : (
        children
      )}
    </div>
  )
}

function KnowledgeSection({ intel }) {
  const kc = intel?.knowledgeContext
  const status =
    kc?.knowledgeStatus ||
    kc?.knowledge_status ||
    intel?.knowledgeStatus ||
    'unavailable'
  const retrieved = kc?.retrieved === true
  const attack =
    kc?.attackUnderstanding || kc?.attack_understanding || []
  const relevant = kc?.relevantKnowledge || kc?.relevant_knowledge || []
  const prevention =
    kc?.preventionGuidance || kc?.prevention_guidance || []
  const sources = Array.isArray(kc?.sources) ? kc.sources : []

  return (
    <section className="tn-surface px-5 py-5">
      <h2 className="tn-section-title">Knowledge</h2>
      <p className="tn-meta mt-1">
        Knowledge base guidance · not live telemetry · not executable actions
      </p>
      {!retrieved ? (
        <p className="tn-meta mt-3 leading-relaxed">
          {kc?.reason ||
            'Knowledge retrieval unavailable. Incident intelligence and response plan remain available from live SOC context.'}
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {attack.length ? (
            <Block title="Attack pattern / why this is happening">
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {attack.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </Block>
          ) : null}
          {relevant.length ? (
            <Block title="What this pattern means">
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {relevant.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </Block>
          ) : null}
          {prevention.length ? (
            <Block title="Prevention / hardening">
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {prevention.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </Block>
          ) : null}
          <div>
            <div className="tn-label">Sources</div>
            {sources.length === 0 ? (
              <p className="tn-meta mt-2">No citations attached.</p>
            ) : (
              <ul className="tn-meta mt-2 space-y-2">
                {sources.map((c, i) => (
                  <li key={i}>
                    {c.document || c.source || 'Retrieved guidance'}
                    {c.section ? ` · ${c.section}` : ''}
                    {c.page != null ? ` · p.${c.page}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <p className="tn-meta mt-3">
        Knowledge retrieval: {String(status)}
        {retrieved ? ' · labeled as knowledge base, not observed detection' : ''}
      </p>
    </section>
  )
}
