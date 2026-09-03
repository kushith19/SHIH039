import assert from 'node:assert/strict'
import test from 'node:test'
import {
  commanderHealthRequired,
  commanderUvicornArgs,
  resolveCommanderLaunch,
} from './commanderStartup.mjs'

test('commander uvicorn args omit --reload for demo stack', () => {
  const args = commanderUvicornArgs()
  assert.ok(!args.includes('--reload'))
  assert.ok(args.includes('src.main:app'))
  assert.ok(args.includes('--port'))
  assert.ok(args.includes('8000'))
})

test('startup requires successful GET /health (not port listen alone)', () => {
  assert.equal(commanderHealthRequired(), true)
  assert.equal(resolveCommanderLaunch({ healthOk: true, portBusy: true }), 'reuse')
  assert.equal(resolveCommanderLaunch({ healthOk: false, portBusy: true }), 'replace')
  assert.equal(resolveCommanderLaunch({ healthOk: false, portBusy: false }), 'start')
})
