import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  LayoutDashboard,
  Server,
  Shield,
} from 'lucide-react'
import {
  DASHBOARD_PANEL_COPY,
  DASHBOARD_PANEL_IDS,
  dashboardPanelHref,
} from './dashboardPanels.js'

const ICONS = {
  overview: LayoutDashboard,
  commander: Shield,
  fleet: Server,
  incidents: AlertTriangle,
}

export default function DashboardNav({
  panel = 'overview',
  incidentCount = 0,
}) {
  const [searchParams] = useSearchParams()
  const counts = {
    incidents: incidentCount,
  }

  return (
    <nav
      className="flex shrink-0 overflow-x-auto border-b border-[var(--tn-line)] bg-[var(--tn-surface)] md:w-56 md:flex-col md:overflow-y-auto md:border-r md:border-b-0"
      aria-label="Dashboard pages"
    >
      <ul className="flex min-w-max gap-0.5 p-2 md:min-w-0 md:flex-col md:gap-1 md:p-3">
        {DASHBOARD_PANEL_IDS.map((id) => {
          const item = DASHBOARD_PANEL_COPY[id]
          const Icon = ICONS[id]
          const active = panel === id
          const count = counts[id]
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
                {count > 0 ? (
                  <span className="ml-auto font-mono text-xs tabular-nums text-[var(--tn-muted)]">
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
