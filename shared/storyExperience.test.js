import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fallbackStoryExplanation } from './attackStory.js'
import {
  ILLUSTRATIVE_BANNER,
  bindIllustrativePath,
  buildStoryExperience,
  residualToPct,
  splitCommanderBriefing,
} from './storyExperience.js'

describe('storyExperience', () => {
  it('maps live origin chapters and prefers them over the walkthrough', () => {
    const view = buildStoryExperience({
      attackStory: {
        title: 'Live detection',
        status: 'live',
        chapters: [
          {
            id: 'origin',
            kind: 'origin',
            clock: '10:00:01',
            nodeId: 'a',
            nodeLabel: 'Gateway',
            caption: 'abnormal API traffic',
            path: [{ id: 'a', label: 'Gateway' }],
          },
          {
            id: 'detect',
            kind: 'detect',
            clock: '10:00:02',
            tgnn: 0.81,
            trust: 63,
            detectionLabel: 'Behavioural anomaly',
          },
          {
            id: 'risk',
            kind: 'risk',
            clock: '10:00:04',
            impact: 'HIGH',
            financialExposed: 1,
          },
          {
            id: 'commander',
            kind: 'commander',
            clock: '10:00:05',
            text: fallbackStoryExplanation({ origin: 'Gateway' }),
            status: 'ready',
          },
        ],
      },
    })
    assert.equal(view.source, 'live')
    assert.equal(view.acts.length, 4)
    assert.equal(view.originLabel, 'Gateway')
    assert.equal(view.residualPct, 81)
    assert.equal(view.path.length, 1)
    assert.ok(!view.acts.some((a) => a.id === 'propagate'))
    assert.equal(view.banner, null)
    assert.match(view.acts[3].briefing.what, /Gateway/)
  })

  it('uses a labeled illustrative walkthrough when there is no origin chapter', () => {
    const view = buildStoryExperience({
      nodes: [
        { id: 'n1', data: { type: 'citizen_services', label: 'Citizen Services' } },
        { id: 'n2', data: { type: 'identity_access', label: 'Identity' } },
        { id: 'n3', data: { type: 'banking_financial', label: 'Banking' } },
      ],
    })
    assert.equal(view.source, 'illustrative')
    assert.equal(view.banner, ILLUSTRATIVE_BANNER)
    assert.equal(view.path[0].id, 'n1')
    assert.equal(view.path.length, 1)
  })

  it('bindIllustrativePath keeps labels when types are missing from the room', () => {
    const path = bindIllustrativePath([])
    assert.equal(path.length, 1)
    assert.equal(path[0].id, null)
    assert.ok(path[0].label)
  })

  it('residualToPct treats unit residuals as percents', () => {
    assert.equal(residualToPct(0.81), 81)
    assert.equal(residualToPct(81), 81)
    assert.equal(residualToPct(null), null)
  })

  it('splitCommanderBriefing uses the first safety-checked plan step when present', () => {
    const s = splitCommanderBriefing('Observed at A. Residual flag on this endpoint.', {
      responsePlan: [{ action: 'Restrict suspicious communications on the affected segment.' }],
    })
    assert.match(s.what, /Observed/)
    assert.match(s.why, /Residual/)
    assert.match(s.action, /Restrict/)
  })
})
