export const DASHBOARD_PANEL_IDS = [
  'overview',
  'commander',
  'fleet',
  'incidents',
  'response',
]

/** Panels that keep ?incident= focus across navigation. */
const INCIDENT_FOCUS_PANELS = new Set(['commander', 'response'])

export const DASHBOARD_PANEL_COPY = {
  overview: {
    label: 'Overview',
    blurb: 'Command-center posture: active threat, blast radius, business impact, and containment status.',
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
  response: {
    label: 'Response',
    blurb: 'Registered containment actions for the selected incident. Execute lives here — not on Overview.',
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
  if (!INCIDENT_FOCUS_PANELS.has(panelId)) next.delete('incident')
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

export function dashboardResponseIncidentHref(searchParams, incidentId) {
  const next = new URLSearchParams(searchParams)
  next.set('view', 'dashboard')
  next.set('panel', 'response')
  if (incidentId) next.set('incident', String(incidentId))
  else next.delete('incident')
  return `?${next.toString()}`
}

export function dashboardPanelMeta(panelId) {
  const id = resolveDashboardPanel(panelId)
  return DASHBOARD_PANEL_COPY[id]
}
