import { useMemo, useState } from 'react'
import { fmt, fmtSignedPct, METRIC_KEYS } from './metrics'
import StatusBadge from '../../ui/StatusBadge'
import Toolbar from '../../ui/Toolbar'
import EmptyState from '../../ui/EmptyState'

function Sparkline({ data = [], color = 'var(--tn-text)', yDomain = [-10, 20] }) {
  if (!data.length) return <span className="font-mono text-sm text-[var(--tn-muted)]">—</span>
  const w = 72
  const h = 22
  const y0 = yDomain[0]
  const y1 = yDomain[1]
  const span = y1 - y0 || 1
  const pts = data
    .map((p, i) => {
      const x = data.length === 1 ? w / 2 : (i / (data.length - 1)) * w
      const y = h - ((Number(p.value) - y0) / span) * h
      return `${x},${Number.isFinite(y) ? y : h / 2}`
    })
    .join(' ')
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="h-[1.375rem] w-[4.5rem]"
      aria-hidden="true"
    >
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  )
}

function rowBadge({ quarantined, anomaly, catalogBaseline, drift }) {
  if (catalogBaseline) return <StatusBadge>Catalog</StatusBadge>
  if (quarantined) return <StatusBadge>Hold</StatusBadge>
  if (anomaly) return <StatusBadge tone="crit">Flag</StatusBadge>
  if (drift) return <StatusBadge tone="warn">Drift</StatusBadge>
  return <StatusBadge tone="ok">Ok</StatusBadge>
}

function railClass({ quarantined, anomaly, drift }) {
  if (quarantined) return 'bg-[var(--tn-muted)]'
  if (anomaly) return 'bg-[var(--tn-crit)]'
  if (drift) return 'bg-[var(--tn-warn)]'
  return 'bg-[var(--tn-ok)]'
}

function rowHasDrift(row) {
  if (row?.catalogBaseline || row?.anomaly || row?.quarantined) return false
  const pct = Number(row?.ppsVsExpected)
  return Number.isFinite(pct) && Math.abs(pct) >= 10
}

export default function EndpointTable({
  rows = [],
  sparkDomain = [-10, 20],
  filterId,
  onSelect,
  hideHeader = false,
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const ordered = useMemo(() => {
    const list = [...rows].sort((a, b) => {
      const rank = (r) => (r.quarantined ? 2 : r.anomaly ? 1 : 0)
      return rank(b) - rank(a)
    })
    if (!q) return list
    return list.filter(
      (r) =>
        String(r.label).toLowerCase().includes(q) ||
        String(r.type).toLowerCase().includes(q) ||
        String(r.id).toLowerCase().includes(q)
    )
  }, [rows, q])

  return (
    <section className="soc-zone overflow-hidden">
      <div className="border-b border-[var(--tn-line)] px-4 py-3">
        <Toolbar
          trailing={
            <span className="font-mono text-sm tabular-nums text-[var(--tn-muted)]">
              {ordered.length}
            </span>
          }
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search endpoints"
            className="tn-input max-w-xs px-3 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--tn-muted)]">
            <span className="inline-flex items-center gap-1">
              <span className="tn-pip bg-[var(--tn-ok)]" /> Ok
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="tn-pip bg-[var(--tn-warn)]" /> Drift
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="tn-pip bg-[var(--tn-crit)]" /> Flag
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="tn-pip bg-[var(--tn-muted)]" /> Hold
            </span>
            <span>Catalog = baseline</span>
          </div>
        </Toolbar>
        {hideHeader ? (
          <p className="tn-meta mt-2 text-[11px]">
            Missing samples show as catalog baseline, not live PPS.
          </p>
        ) : (
          <p className="tn-meta mt-2 text-[11px]">
            PPS vs expected load when Timescale samples exist.
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--tn-surface)]">
            <tr className="text-left text-xs font-medium text-[var(--tn-muted)]">
              <th className="px-3 py-2.5 pl-4">Node</th>
              <th className="px-3 py-2.5">Type</th>
              {METRIC_KEYS.map((m) => (
                <th key={m.key} className="px-3 py-2.5 text-right">
                  {m.short}
                </th>
              ))}
              <th className="px-3 py-2.5">Trend</th>
              <th className="px-3 py-2.5 pr-4">State</th>
            </tr>
          </thead>
          <tbody>
            {ordered.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    title="No infrastructure nodes"
                    body={
                      q
                        ? 'No endpoints match this search.'
                        : 'No infrastructure nodes in this room yet.'
                    }
                  />
                </td>
              </tr>
            ) : (
              ordered.map((row) => {
                const selected = filterId === row.id
                const drift = rowHasDrift(row)
                const sparkColor = row.anomaly
                  ? 'var(--tn-crit)'
                  : drift
                    ? 'var(--tn-warn)'
                    : 'var(--tn-text)'
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-t border-[var(--tn-line)]"
                    style={
                      selected
                        ? { background: 'var(--tn-select-bg)' }
                        : row.anomaly
                          ? {
                              background:
                                'color-mix(in srgb, var(--tn-crit) 6%, transparent)',
                            }
                          : drift
                            ? {
                                background:
                                  'color-mix(in srgb, var(--tn-warn) 6%, transparent)',
                              }
                            : undefined
                    }
                    onClick={() => onSelect?.(row.id)}
                  >
                    <td className="relative soc-dense-row px-3 pl-4 font-medium">
                      <span
                        className={`absolute inset-y-0 left-0 w-0.5 ${railClass({ ...row, drift })}`}
                      />
                      {row.label}
                    </td>
                    <td className="soc-dense-row px-3">
                      <StatusBadge>{row.type}</StatusBadge>
                    </td>
                    <td className="soc-dense-row px-3 text-right font-mono text-[13px] tabular-nums">
                      {row.catalogBaseline ? '—' : fmt(row.pps)}
                    </td>
                    <td className="soc-dense-row px-3 text-right font-mono text-[13px] tabular-nums">
                      {row.catalogBaseline ? '—' : fmt(row.http)}
                    </td>
                    <td className="soc-dense-row px-3 text-right font-mono text-[13px] tabular-nums">
                      {row.catalogBaseline ? '—' : fmt(row.files)}
                    </td>
                    <td className="soc-dense-row px-3 text-right font-mono text-[13px] tabular-nums">
                      {row.catalogBaseline ? '—' : fmt(row.logins)}
                    </td>
                    <td className="soc-dense-row px-3">
                      <div className="flex items-center gap-2">
                        <Sparkline
                          data={row.spark}
                          color={sparkColor}
                          yDomain={sparkDomain}
                        />
                        <span
                          className="font-mono text-[12px] tabular-nums"
                          style={{
                            color:
                              row.ppsVsExpected == null ||
                              Math.round(row.ppsVsExpected) === 0
                                ? 'var(--tn-muted)'
                                : row.ppsVsExpected > 0
                                  ? 'var(--tn-crit)'
                                  : 'var(--tn-muted)',
                          }}
                        >
                          {fmtSignedPct(row.ppsVsExpected)}
                        </span>
                      </div>
                    </td>
                    <td className="soc-dense-row px-3 pr-4">
                      {rowBadge({ ...row, drift })}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
