import { detectionTypeLabel } from '@shared/incidents.js'
import StatusBadge from '../../ui/StatusBadge'
import { visibleHistoryCampaigns } from './campaignIntelligenceView.js'

function severityTone(severity) {
  if (severity === 'critical' || severity === 'high') return 'crit'
  if (severity === 'medium') return 'warn'
  return 'muted'
}

function statusTone(status) {
  if (status === 'suspected' || status === 'correlated' || status === 'escalating') return 'warn'
  return 'muted'
}

function formatClock(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return new Date(n).toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function timeSpanLabel(firstMs, lastMs) {
  const a = formatClock(firstMs)
  const b = formatClock(lastMs)
  if (a === b) return a
  return `${a} → ${b}`
}

/**
 * Additive SOC view of backend history-correlation campaigns.
 * Renders payload fields only — does not score or group incidents.
 */
export default function CampaignIntelligence({ campaigns = [], compact = false }) {
  const rows = visibleHistoryCampaigns(campaigns)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {!compact ? (
        <div className="shrink-0 border-b border-[var(--tn-line)] px-4 py-3">
          <div className="tn-label">Campaign intelligence</div>
          <p className="tn-meta mt-1">Backend-correlated campaigns from this match’s detections</p>
        </div>
      ) : (
        <div className="shrink-0 border-b border-[var(--tn-line)] px-4 py-2">
          <p className="tn-meta text-[11px]">
            Backend-correlated campaigns · display only, not a second detector
          </p>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {rows.length === 0 ? (
          <p className="tn-meta">No correlated campaign yet — needs multiple related incidents.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((campaign) => (
              <article key={campaign.campaignId}>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={statusTone(campaign.status)}>
                    {campaign.status || 'suspected'}
                  </StatusBadge>
                  <StatusBadge tone={severityTone(campaign.severity)}>
                    {campaign.severity || 'low'}
                  </StatusBadge>
                  <span className="tn-meta text-[11px]">
                    {campaign.incidentCount ?? campaign.sequence.length} related
                  </span>
                </div>
                <p className="tn-meta mt-1 text-[11px]">
                  {timeSpanLabel(campaign.firstDetectedAtMs, campaign.lastDetectedAtMs)}
                </p>
                <p className="mt-1 text-sm leading-snug">
                  {(campaign.affectedServices ?? [])
                    .map((svc) => svc.label || svc.id)
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>

                <ol className="mt-2">
                  {(campaign.sequence ?? []).map((step, idx) => (
                    <li key={step.incidentId || `${campaign.campaignId}-${idx}`}>
                      {idx > 0 ? (
                        <div className="py-0.5 pl-1 text-[var(--tn-muted)]" aria-hidden="true">
                          ↓
                        </div>
                      ) : null}
                      <div className="text-sm">
                        <span className="font-medium">
                          {step.affectedNodeLabel || step.affectedNodeId}
                        </span>
                        <span className="tn-meta"> · {formatClock(step.detectedAtMs)}</span>
                      </div>
                      <p className="tn-meta mt-0.5 text-[11px]">
                        {detectionTypeLabel(step.incidentType)} · {step.severity || 'low'}
                      </p>
                    </li>
                  ))}
                </ol>

                {(campaign.correlationReasons ?? []).length > 0 ? (
                  <ul className="tn-meta mt-2 list-disc space-y-0.5 pl-4 text-[11px]">
                    {(campaign.correlationReasons ?? []).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
