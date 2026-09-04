import { Link, useSearchParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  GitBranch,
  LayoutDashboard,
  Server,
  Shield,
  ShieldAlert,
} from 'lucide-react'
import {
  DASHBOARD_NAV_GROUPS,
  DASHBOARD_PANEL_COPY,
  dashboardPanelHref,
} from './dashboardPanels.js'

const ICONS = {
  overview: LayoutDashboard,
  timeline: Activity,
  incidents: AlertTriangle,
  fleet: Server,
  'post-analysis': ClipboardList,
  commander: Shield,
  orchestrate: GitBranch,
  response: ShieldAlert,
}

export default function DashboardNav({
  panel = 'overview',
  incidentCount = 0,
}) {
  const [searchParams] = useSearchParams()
  const focusedIncident = Boolean(searchParams.get('incident'))
  const counts = {
    incidents: incidentCount,
  }

  return (
    <nav
      className="flex shrink-0 overflow-x-auto border-b border-[var(--tn-line)] bg-[var(--tn-surface)] md:w-52 md:flex-col md:overflow-y-auto md:border-r md:border-b-0"
      aria-label="Dashboard pages"
    >
      <ul className="flex min-w-max gap-0.5 p-2 md:min-w-0 md:flex-col md:gap-0.5 md:p-2">
        {DASHBOARD_NAV_GROUPS.map((group) => (
          <li key={group.id} className="contents md:block">
            <div className="soc-nav-group" aria-hidden>
              {group.label}
            </div>
            <ul className="contents md:flex md:flex-col md:gap-0.5">
              {group.panels.map((id) => {
                const item = DASHBOARD_PANEL_COPY[id]
                const Icon = ICONS[id]
                const active = panel === id
                const count = counts[id]
                const showFocusPip =
                  focusedIncident &&
                  (id === 'commander' || id === 'orchestrate' || id === 'response')
                return (
                  <li key={id}>
                    <Link
                      to={dashboardPanelHref(searchParams, id)}
                      replace
                      className={[
                        'flex items-center gap-2.5 rounded-md px-3 py-2',
                        active
                          ? 'bg-[var(--tn-select-bg)] text-[var(--tn-text)]'
                          : 'text-[var(--tn-muted)] hover:bg-[var(--tn-elevated)] hover:text-[var(--tn-text)]',
                      ].join(' ')}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} />
                      <span className="text-sm font-medium">{item.label}</span>
                      {showFocusPip ? (
                        <span
                          className="tn-pip ml-auto"
                          style={{ background: 'var(--tn-select)' }}
                          title="Incident focused"
                          aria-label="Incident focused"
                        />
                      ) : null}
                      {count > 0 ? (
                        <span
                          className={[
                            'font-mono text-xs tabular-nums text-[var(--tn-muted)]',
                            showFocusPip ? '' : 'ml-auto',
                          ].join(' ')}
                        >
                          {count}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  )
}
