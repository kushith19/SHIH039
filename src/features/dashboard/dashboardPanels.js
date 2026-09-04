/** Visual / nav order follows SOC workflow. IDs are URL contracts — do not rename lightly. */
export const DASHBOARD_PANEL_IDS = [
  'overview',
  'timeline',
  'incidents',
  'fleet',
  'post-analysis',
  'commander',
  'orchestrate',
  'response',
]

/** Non-interactive nav groupings (layout only). */
export const DASHBOARD_NAV_GROUPS = [
  {
    id: 'monitor',
    label: 'Monitor',
    panels: ['overview', 'incidents', 'timeline', 'fleet'],
  },
  {
    id: 'analyze',
    label: 'Analyze',
    panels: ['post-analysis', 'commander'],
  },
  {
    id: 'act',
    label: 'Act',
    panels: ['orchestrate', 'response'],
  },
]

/** Panels that keep ?incident= focus across navigation. */
const INCIDENT_FOCUS_PANELS = new Set([
  'commander',
  'orchestrate',
  'response',
  'post-analysis',
])

export const DASHBOARD_PANEL_COPY = {
  overview: {
    label: 'Overview',
    blurb:
      'Command-center KPIs: attack volume, severity, sector impact, response funnel, and live threat status.',
  },
  timeline: {
    label: 'Timeline',
    blurb:
      'Chronology of detections this match, plus response lifecycle when an incident is orchestrated.',
  },
  incidents: {
    label: 'Incidents',
    blurb: 'Promoted detections this tick. Inspect Level-1 evidence, then hand off to Commander or Orchestrate.',
  },
  fleet: {
    label: 'Fleet',
    blurb: 'Per-endpoint telemetry vs expected load. Catalog baseline is not live PPS.',
  },
  'post-analysis': {
    label: 'Post-Analysis',
    blurb:
      'Software and configuration improvement tasks learned from historical incidents. Survives restarts.',
  },
  commander: {
    label: 'Commander',
    blurb: 'Evidence-grounded assessment and safety-checked response plan. Advisory only — does not execute.',
  },
  orchestrate: {
    label: 'Orchestrate',
    blurb:
      'Planner → human approval → Response Agent → recovered. Processes active incidents sequentially when a cycle is started.',
  },
  response: {
    label: 'Response',
    blurb: 'Registered containment actions for the selected incident. Execution is controlled from Orchestrate after approval.',
  },
}

const PANEL_SET = new Set(DASHBOARD_PANEL_IDS)

export function resolveDashboardPanel(raw) {
  const id = String(raw ?? '').trim()
  // Legacy ?panel=analyze (removed Intel dashboard) → Monitor Overview
  if (id === 'analyze') return 'overview'
  // Legacy ?panel=correlation (removed Live Correlation) → Monitor Overview
  if (id === 'correlation') return 'overview'
  return PANEL_SET.has(id) ? id : 'overview'
}

export function dashboardPanelHref(searchParams, panelId) {
  const next = new URLSearchParams(searchParams)
  next.set('view', 'dashboard')
  const resolved = resolveDashboardPanel(panelId)
  if (resolved === 'overview') next.delete('panel')
  else next.set('panel', resolved)
  if (!INCIDENT_FOCUS_PANELS.has(resolved)) next.delete('incident')
  if (resolved !== 'post-analysis') {
    next.delete('archive')
    next.delete('rec')
  }
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

export function dashboardPostAnalysisHref(searchParams, { archiveId, recommendationId } = {}) {
  const next = new URLSearchParams(searchParams)
  next.set('view', 'dashboard')
  next.set('panel', 'post-analysis')
  if (archiveId) next.set('archive', String(archiveId))
  else next.delete('archive')
  if (recommendationId) next.set('rec', String(recommendationId))
  else next.delete('rec')
  return `?${next.toString()}`
}

/** @deprecated Removed Analyze→Intel; redirects to Monitor Overview. */
export function dashboardAnalyzeHref(searchParams) {
  return dashboardPanelHref(searchParams, 'overview')
}

export function dashboardPanelMeta(panelId) {
  const id = resolveDashboardPanel(panelId)
  return DASHBOARD_PANEL_COPY[id]
}

export function isIncidentFocusPanel(panelId) {
  return INCIDENT_FOCUS_PANELS.has(resolveDashboardPanel(panelId))
}
