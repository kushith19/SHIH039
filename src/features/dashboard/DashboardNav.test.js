import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DASHBOARD_NAV_GROUPS,
  dashboardCommanderIncidentHref,
  dashboardOrchestrateIncidentHref,
  dashboardPanelHref,
  dashboardPanelMeta,
  dashboardResponseIncidentHref,
  resolveDashboardPanel,
} from './dashboardPanels.js'

describe('dashboard panel routing', () => {
  it('defaults unknown panels to overview', () => {
    assert.equal(resolveDashboardPanel(null), 'overview')
    assert.equal(resolveDashboardPanel('nope'), 'overview')
    assert.equal(resolveDashboardPanel('incidents'), 'incidents')
    assert.equal(resolveDashboardPanel('timeline'), 'timeline')
    assert.equal(resolveDashboardPanel('correlation'), 'correlation')
    assert.equal(resolveDashboardPanel('response'), 'response')
    assert.equal(resolveDashboardPanel('orchestrate'), 'orchestrate')
  })

  it('omits panel query for overview and keeps view=dashboard', () => {
    const params = new URLSearchParams('view=dashboard&panel=fleet')
    const href = dashboardPanelHref(params, 'overview')
    const next = new URLSearchParams(href.replace(/^\?/, ''))
    assert.equal(next.get('view'), 'dashboard')
    assert.equal(next.get('panel'), null)
  })

  it('sets panel for inner pages', () => {
    const href = dashboardPanelHref(new URLSearchParams('view=dashboard'), 'commander')
    const next = new URLSearchParams(href.replace(/^\?/, ''))
    assert.equal(next.get('panel'), 'commander')
    assert.equal(dashboardPanelMeta('commander').label, 'Commander')
    assert.equal(dashboardPanelMeta('response').label, 'Response')
    assert.equal(dashboardPanelMeta('orchestrate').label, 'Orchestrate')
    assert.equal(dashboardPanelMeta('timeline').label, 'Timeline')
    assert.equal(dashboardPanelMeta('correlation').label, 'Live Correlation')
  })

  it('places incidents, timeline, and live correlation under Monitor', () => {
    const monitor = DASHBOARD_NAV_GROUPS.find((g) => g.id === 'monitor')
    assert.deepEqual(monitor.panels, [
      'overview',
      'incidents',
      'timeline',
      'correlation',
      'fleet',
    ])
    assert.equal(
      DASHBOARD_NAV_GROUPS.some((g) => g.id === 'incidents-group'),
      false
    )
  })

  it('places post-analysis and commander under Analyze (no Intel dashboard)', () => {
    const analyze = DASHBOARD_NAV_GROUPS.find((g) => g.id === 'analyze')
    assert.deepEqual(analyze.panels, ['post-analysis', 'commander'])
    assert.equal(dashboardPanelMeta('post-analysis').label, 'Post-Analysis')
    assert.equal(resolveDashboardPanel('post-analysis'), 'post-analysis')
    assert.equal(resolveDashboardPanel('analyze'), 'overview')
    assert.equal(dashboardPanelMeta('analyze').label, 'Overview')
  })

  it('Monitor Overview remains the sole overview panel id', () => {
    const monitor = DASHBOARD_NAV_GROUPS.find((g) => g.id === 'monitor')
    assert.ok(monitor.panels.includes('overview'))
    assert.equal(
      DASHBOARD_NAV_GROUPS.find((g) => g.id === 'analyze').panels.includes('overview'),
      false
    )
    assert.equal(
      DASHBOARD_NAV_GROUPS.find((g) => g.id === 'analyze').panels.includes('analyze'),
      false
    )
  })

  it('clears focused incident when leaving commander or response', () => {
    const fromCommander = dashboardPanelHref(
      new URLSearchParams('view=dashboard&panel=commander&incident=inc-pay:1'),
      'incidents'
    )
    assert.equal(new URLSearchParams(fromCommander.replace(/^\?/, '')).get('incident'), null)

    const fromResponse = dashboardPanelHref(
      new URLSearchParams('view=dashboard&panel=response&incident=inc-pay:1'),
      'fleet'
    )
    assert.equal(new URLSearchParams(fromResponse.replace(/^\?/, '')).get('incident'), null)
  })

  it('preserves incident when moving between commander, orchestrate, and response', () => {
    const toResponse = dashboardPanelHref(
      new URLSearchParams('view=dashboard&panel=commander&incident=inc-pay:1'),
      'response'
    )
    assert.equal(new URLSearchParams(toResponse.replace(/^\?/, '')).get('panel'), 'response')
    assert.equal(new URLSearchParams(toResponse.replace(/^\?/, '')).get('incident'), 'inc-pay:1')

    const toOrchestrate = dashboardPanelHref(
      new URLSearchParams('view=dashboard&panel=commander&incident=inc-pay:1'),
      'orchestrate'
    )
    const next = new URLSearchParams(toOrchestrate.replace(/^\?/, ''))
    assert.equal(next.get('panel'), 'orchestrate')
    assert.equal(next.get('incident'), 'inc-pay:1')
  })

  it('opens commander with structured incident id', () => {
    const href = dashboardCommanderIncidentHref(new URLSearchParams('view=dashboard'), 'inc-pay:1')
    const next = new URLSearchParams(href.replace(/^\?/, ''))
    assert.equal(next.get('panel'), 'commander')
    assert.equal(next.get('incident'), 'inc-pay:1')
  })

  it('opens response console with structured incident id', () => {
    const href = dashboardResponseIncidentHref(new URLSearchParams('view=dashboard'), 'inc-pay:1')
    const next = new URLSearchParams(href.replace(/^\?/, ''))
    assert.equal(next.get('panel'), 'response')
    assert.equal(next.get('incident'), 'inc-pay:1')
  })

  it('opens orchestrate with structured incident id', () => {
    const href = dashboardOrchestrateIncidentHref(
      new URLSearchParams('view=dashboard'),
      'inc-pay:1'
    )
    const next = new URLSearchParams(href.replace(/^\?/, ''))
    assert.equal(next.get('panel'), 'orchestrate')
    assert.equal(next.get('incident'), 'inc-pay:1')
  })
})
