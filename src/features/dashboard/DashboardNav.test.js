import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  dashboardCommanderIncidentHref,
  dashboardPanelHref,
  dashboardPanelMeta,
  resolveDashboardPanel,
} from './dashboardPanels.js'

describe('dashboard panel routing', () => {
  it('defaults unknown panels to overview', () => {
    assert.equal(resolveDashboardPanel(null), 'overview')
    assert.equal(resolveDashboardPanel('nope'), 'overview')
    assert.equal(resolveDashboardPanel('incidents'), 'incidents')
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
  })

  it('clears focused incident when leaving commander', () => {
    const href = dashboardPanelHref(
      new URLSearchParams('view=dashboard&panel=commander&incident=inc-pay:1'),
      'incidents'
    )
    const next = new URLSearchParams(href.replace(/^\?/, ''))
    assert.equal(next.get('panel'), 'incidents')
    assert.equal(next.get('incident'), null)
  })

  it('opens commander with structured incident id', () => {
    const href = dashboardCommanderIncidentHref(new URLSearchParams('view=dashboard'), 'inc-pay:1')
    const next = new URLSearchParams(href.replace(/^\?/, ''))
    assert.equal(next.get('panel'), 'commander')
    assert.equal(next.get('incident'), 'inc-pay:1')
  })
})
