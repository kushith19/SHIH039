export const DASHBOARD_PANEL_IDS = [
  'overview',
  'commander',
  'fleet',
  'incidents',
]

export const DASHBOARD_PANEL_COPY = {
  overview: {
    label: 'Overview',
    blurb: 'Posture, residual flags, and risk momentum for this tick.',
  },
  commander: {
    label: 'Commander',
    blurb: 'Evidence-grounded assessment and safety-checked response plan. Not the detector.',
  },
  fleet: {
    label: 'Fleet',
    blurb: 'Per-endpoint telemetry vs expected load. Catalog baseline is not live PPS.',
  },
  incidents: {
    label: 'Incidents',
    blurb: 'Promoted detections this tick. Evidence tags, not extra models.',
  },
}

const PANEL_SET = new Set(DASHBOARD_PANEL_IDS)

export function resolveDashboardPanel(raw) {
  const id = String(raw ?? '').trim()
  return PANEL_SET.has(id) ? id : 'overview'
}

export function dashboardPanelHref(searchParams, panelId) {
  const next = new URLSearchParams(searchParams)
  next.set('view', 'dashboard')
  if (panelId === 'overview') next.delete('panel')
  else next.set('panel', panelId)
  if (panelId !== 'commander') next.delete('incident')
  const qs = next.toString()
  return qs ? `?${qs}` : '?'
}

export function dashboardCommanderIncidentHref(searchParams, incidentId) {
  const next = new URLSearchParams(searchParams)
  next.set('view', 'dashboard')
  next.set('panel', 'commander')
  if (incidentId) next.set('incident', String(incidentId))
  else next.delete('incident')
  return `?${next.toString()}`
}

export function dashboardPanelMeta(panelId) {
  const id = resolveDashboardPanel(panelId)
  return DASHBOARD_PANEL_COPY[id]
}
