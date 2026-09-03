import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
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
})
