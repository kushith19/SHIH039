/** Visual / nav order follows SOC workflow. IDs are URL contracts — do not rename lightly. */
export const DASHBOARD_PANEL_IDS = [
  'overview',
  'incidents',
  'fleet',
  'commander',
  'orchestrate',
  'response',
]

/** Non-interactive nav groupings (layout only). */
export const DASHBOARD_NAV_GROUPS = [
  {
    id: 'monitor',
    label: 'Monitor',
    panels: ['overview', 'incidents', 'fleet'],
  },
  {
    id: 'analyze',
    label: 'Analyze',
    panels: ['commander'],
  },
  {
    id: 'act',
    label: 'Act',
    panels: ['orchestrate', 'response'],
  },
]

/** Panels that keep ?incident= focus across navigation. */
const INCIDENT_FOCUS_PANELS = new Set(['commander', 'orchestrate', 'response'])

export const DASHBOARD_PANEL_COPY = {
  overview: {
    label: 'Overview',
    blurb: 'Situational awareness: posture, primary threat, blast radius, and containment status.',
  },
  incidents: {
    label: 'Incidents',
    blurb: 'Promoted detections this tick. Inspect Level-1 evidence, then hand off to Commander or Response.',
  },
  fleet: {
    label: 'Fleet',
    blurb: 'Per-endpoint telemetry vs expected load. Catalog baseline is not live PPS.',
  },
  commander: {
    label: 'Commander',
    blurb: 'Evidence-grounded assessment and safety-checked response plan. Advisory only — does not execute.',
  },
  orchestrate: {
    label: 'Orchestrate',
    blurb:
      'Multi-agent response workflow shell. Plans require human approval before any future Response Agent execution.',
  },
  response: {
    label: 'Response',
    blurb: 'Registered containment actions for the selected incident. Execute lives here — not on Overview or Commander.',
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

export function dashboardOrchestrateIncidentHref(searchParams, incidentId) {
  const next = new URLSearchParams(searchParams)
  next.set('view', 'dashboard')
  next.set('panel', 'orchestrate')
  if (incidentId) next.set('incident', String(incidentId))
  else next.delete('incident')
  return `?${next.toString()}`
}

export function dashboardPanelMeta(panelId) {
  const id = resolveDashboardPanel(panelId)
  return DASHBOARD_PANEL_COPY[id]
}

export function isIncidentFocusPanel(panelId) {
  return INCIDENT_FOCUS_PANELS.has(resolveDashboardPanel(panelId))
}
