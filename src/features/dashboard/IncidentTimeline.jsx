import {
  Activity,
  ListChecks,
  Scan,
  Shield,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import {
  currentTimelineEvent,
  TIMELINE_CAPTION,
  TIMELINE_KIND_LABELS,
} from '@shared/incidentTimeline.js'

const KIND_COLOR = {
  telemetry: 'var(--tn-muted)',
  detection: 'var(--tn-select)',
  trust: 'var(--tn-warn)',
  escalation: 'var(--tn-crit)',
  ai: 'var(--tn-select)',
  recommendation: 'var(--tn-ok)',
}

const KIND_ICON = {
  telemetry: Activity,
  detection: Scan,
  trust: Shield,
  escalation: TriangleAlert,
  ai: Sparkles,
  recommendation: ListChecks,
}

export default function IncidentTimeline({
  events = [],
  caption = TIMELINE_CAPTION,
  pulseCurrent = false,
}) {
  const list = Array.isArray(events) ? events : []
  const current = currentTimelineEvent(list)
  const currentId = current?.id ?? null

  if (list.length === 0) return null

  return (
    <div className="min-w-0">
      <div className="tn-label">Incident timeline</div>
      {caption ? (
        <p className="tn-meta mt-1">{caption}</p>
      ) : null}
      <ol className="mt-3 min-w-0">
        {list.map((ev, i) => {
          const last = i === list.length - 1
          const isCurrent = ev.id === currentId
          const color = KIND_COLOR[ev.kind] || 'var(--tn-muted)'
          const Icon = KIND_ICON[ev.kind] || Activity
          const kindLabel = TIMELINE_KIND_LABELS[ev.kind] || ev.kind
          return (
            <li key={ev.id} className="group min-w-0">
              <div className="pl-7 font-mono text-sm tabular-nums text-[var(--tn-muted)]">
                {ev.timeLabel || '—'}
              </div>
              <div className="flex min-w-0 gap-3">
                <div className="flex w-4 shrink-0 flex-col items-center pt-1.5" aria-hidden>
                  <span
                    className={[
                      'block h-2 w-2 shrink-0 rounded-full',
                      isCurrent && pulseCurrent ? 'animate-pulse' : '',
                    ].join(' ')}
                    style={{
                      background: color,
                      boxShadow: isCurrent ? `0 0 0 3px var(--tn-select-bg)` : undefined,
                    }}
                  />
                  {last ? null : (
                    <span className="mt-1 w-px flex-1 min-h-[2.75rem] bg-[var(--tn-line)]" />
                  )}
                </div>
                <div
                  className={[
                    'min-w-0 flex-1',
                    last ? 'pb-1' : 'pb-6',
                  ].join(' ')}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <Icon
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--tn-muted)]"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={
                          isCurrent
                            ? 'text-sm font-medium leading-snug'
                            : 'text-sm font-medium leading-snug text-[var(--tn-text)]'
                        }
                      >
                        {ev.title}
                      </div>
                      <p className="tn-meta mt-0.5">
                        {kindLabel}
                      </p>
                      {ev.description ? (
                        <p className="tn-meta mt-1 leading-relaxed">
                          {ev.description}
                        </p>
                      ) : null}
                      <p
                        className="tn-meta mt-1 min-h-[1.15rem] leading-relaxed opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
                      >
                        {ev.detail || ''}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
