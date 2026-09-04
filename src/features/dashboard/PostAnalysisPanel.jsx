/**
 * Analyze → Post-Analysis — software/configuration improvement backlog.
 */

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import StatusBadge from '../../ui/StatusBadge'
import { dashboardPanelHref, dashboardPostAnalysisHref } from './dashboardPanels.js'
import usePostAnalysis from './usePostAnalysis.js'
import {
  formatRelativeMs,
  formatShortDate,
  groupRecommendationsByPriority,
  priorityTone,
  sourceLabel,
  statusLabel,
} from './postAnalysisApi.js'

const PRIORITY_LABEL = {
  critical: 'Critical priority',
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
}

function RecCard({
  rec,
  focus,
  onStatus,
  busyId,
  searchParams,
}) {
  const [expanded, setExpanded] = useState(focus || rec.status === 'recurred')
  const tone = priorityTone(rec.priority)
  const isRecurring = rec.status === 'recurred'
  const linked = rec.linkedIncidents ?? []

  return (
    <article
      className={[
        'pa-task-card',
        focus ? 'pa-task-card--focus' : '',
        isRecurring ? 'pa-task-card--recur' : '',
      ].join(' ')}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={tone}>{String(rec.priority).toUpperCase()}</StatusBadge>
            <StatusBadge tone={isRecurring ? 'warn' : rec.status === 'completed' ? 'ok' : 'muted'}>
              {statusLabel(rec.status)}
            </StatusBadge>
            <span className="tn-meta text-xs">{sourceLabel(rec.source)}</span>
          </div>
          <h3 className="mt-2 text-lg font-medium leading-snug tracking-tight">{rec.title}</h3>
          <p className="tn-meta mt-1 text-sm">
            {(rec.attackCategory || 'Attack').replace(/_/g, ' ')}
            {rec.occurrenceCount > 1 ? ` · detected ${rec.occurrenceCount} times` : ''}
            {rec.affectedAssetId ? ` · ${rec.affectedAssetId}` : ''}
          </p>
        </div>
        <button
          type="button"
          className="text-sm text-[var(--tn-muted)] hover:text-[var(--tn-text)]"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </header>

      {isRecurring && rec.priorCompletionNote ? (
        <div className="pa-recur-banner mt-3">
          <strong>Recurring issue</strong>
          <p className="mt-0.5 text-sm">{rec.priorCompletionNote}</p>
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-4 space-y-3">
          {rec.problem ? (
            <div>
              <div className="tn-label">Problem</div>
              <p className="mt-1 text-sm leading-relaxed">{rec.problem}</p>
            </div>
          ) : null}
          <div>
            <div className="tn-label">Recommendation</div>
            <p className="mt-1 text-sm leading-relaxed">{rec.recommendation}</p>
          </div>
          {rec.reason ? (
            <div>
              <div className="tn-label">Why</div>
              <p className="mt-1 text-sm leading-relaxed text-[var(--tn-muted)]">{rec.reason}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--tn-muted)]">
            <span>Occurrences: {rec.occurrenceCount}</span>
            <span>First seen: {formatShortDate(rec.firstSeenAtMs)}</span>
            <span>Last seen: {formatShortDate(rec.lastSeenAtMs)} ({formatRelativeMs(rec.lastSeenAtMs)})</span>
            <span>Category: {rec.category}</span>
          </div>
          {linked.length ? (
            <div>
              <div className="tn-label">Linked archive ids</div>
              <ul className="mt-1 flex flex-wrap gap-2">
                {linked.map((l) => (
                  <li key={l.archiveId} className="font-mono text-xs text-[var(--tn-muted)]">
                    {l.archiveId}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 line-clamp-2 text-sm text-[var(--tn-muted)]">{rec.recommendation}</p>
      )}

      <footer className="mt-4 flex flex-wrap gap-2 border-t border-[var(--tn-line)] pt-3">
        {rec.status !== 'completed' ? (
          <button
            type="button"
            className="pa-btn pa-btn--primary"
            disabled={busyId === rec.recommendationId}
            onClick={() => onStatus(rec.recommendationId, 'completed')}
          >
            Mark done
          </button>
        ) : null}
        {rec.status !== 'in_progress' && rec.status !== 'completed' && rec.status !== 'dismissed' ? (
          <button
            type="button"
            className="pa-btn"
            disabled={busyId === rec.recommendationId}
            onClick={() => onStatus(rec.recommendationId, 'in_progress')}
          >
            In progress
          </button>
        ) : null}
        {rec.status !== 'dismissed' && rec.status !== 'completed' ? (
          <button
            type="button"
            className="pa-btn"
            disabled={busyId === rec.recommendationId}
            onClick={() => onStatus(rec.recommendationId, 'dismissed')}
          >
            Dismiss
          </button>
        ) : null}
        {rec.status === 'completed' || rec.status === 'dismissed' ? (
          <button
            type="button"
            className="pa-btn"
            disabled={busyId === rec.recommendationId}
            onClick={() => onStatus(rec.recommendationId, 'open')}
          >
            Reopen
          </button>
        ) : null}
        <Link
          to={dashboardPostAnalysisHref(searchParams, { recommendationId: rec.recommendationId })}
          className="pa-btn"
        >
          Focus
        </Link>
        <Link to={dashboardPanelHref(searchParams, 'overview')} className="pa-btn">
          Open attack overview
        </Link>
      </footer>
    </article>
  )
}

export default function PostAnalysisPanel({ roomId = '' }) {
  const [searchParams] = useSearchParams()
  const focusRec = searchParams.get('rec')
  const { overview, recommendations, error, loading, updateRecommendationStatus } =
    usePostAnalysis(roomId)
  const [busyId, setBusyId] = useState(null)
  const [filter, setFilter] = useState('active')

  const totals = overview?.totals ?? {}

  const visible = useMemo(() => {
    const list = recommendations ?? []
    if (filter === 'all') return list
    if (filter === 'completed') return list.filter((r) => r.status === 'completed')
    if (filter === 'recurred') return list.filter((r) => r.status === 'recurred')
    // active: open, in_progress, recurred
    return list.filter((r) =>
      ['open', 'in_progress', 'recurred'].includes(r.status)
    )
  }, [recommendations, filter])

  const groups = groupRecommendationsByPriority(visible)

  const onStatus = async (id, status) => {
    setBusyId(id)
    try {
      await updateRecommendationStatus(id, status)
    } finally {
      setBusyId(null)
    }
  }

  if (!roomId) {
    return <p className="tn-meta p-6">Join a room to load post-analysis tasks.</p>
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <header>
        <div className="soc-zone-title">Post-analysis</div>
        <h2 className="mt-1 text-xl font-medium tracking-tight">Security improvement tasks</h2>
        <p className="tn-meta mt-1 max-w-2xl text-sm">
          Software and configuration remediations learned from historical incidents. Never recommends
          new physical infrastructure. Demo-seeded items are labeled separately from LLM output.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <span>
            <span className="font-mono tabular-nums">{totals.incidents ?? 0}</span>{' '}
            <span className="tn-meta">incidents analyzed</span>
          </span>
          <span>
            <span className="font-mono tabular-nums">{totals.recommendations ?? 0}</span>{' '}
            <span className="tn-meta">recommendations</span>
          </span>
          <span>
            <span className="font-mono tabular-nums">{totals.completedImprovements ?? 0}</span>{' '}
            <span className="tn-meta">completed</span>
          </span>
          <span>
            <span className="font-mono tabular-nums">{totals.recurringIssues ?? 0}</span>{' '}
            <span className="tn-meta">recurring</span>
          </span>
          <span>
            <span className="font-mono tabular-nums">{totals.openRecommendations ?? 0}</span>{' '}
            <span className="tn-meta">open</span>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ['active', 'Active'],
            ['recurred', 'Recurring'],
            ['completed', 'Completed'],
            ['all', 'All'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={['pa-chip', filter === id ? 'pa-chip--on' : ''].join(' ')}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-[var(--tn-line)] bg-[var(--tn-elevated)] px-3 py-2 text-sm text-[var(--tn-crit)]">
          {error}
        </div>
      ) : null}

      {loading && !recommendations.length ? (
        <p className="tn-meta">Loading tasks…</p>
      ) : null}

      {!loading && !visible.length ? (
        <div className="soc-zone py-10 text-center">
          <p className="font-medium">No tasks in this view</p>
          <p className="tn-meta mt-1 text-sm">
            Complete an orchestration cycle or wait for post-analysis on archived incidents.
          </p>
          <Link
            to={dashboardPanelHref(searchParams, 'overview')}
            className="mt-3 inline-block text-sm text-[var(--tn-select)] hover:underline"
          >
            Open attack overview →
          </Link>
        </div>
      ) : null}

      {groups.map((g) => (
        <section key={g.priority} className="space-y-3">
          <div
            className="text-xs font-semibold uppercase tracking-[0.08em]"
            style={{
              color:
                priorityTone(g.priority) === 'crit'
                  ? 'var(--tn-crit)'
                  : priorityTone(g.priority) === 'warn'
                    ? 'var(--tn-warn)'
                    : 'var(--tn-muted)',
            }}
          >
            {PRIORITY_LABEL[g.priority] || g.priority}
          </div>
          {g.items.map((rec) => (
            <RecCard
              key={rec.recommendationId}
              rec={rec}
              focus={focusRec === rec.recommendationId}
              onStatus={onStatus}
              busyId={busyId}
              searchParams={searchParams}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
