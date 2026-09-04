/**
 * Restart / durability smoke: write → new process read → match/clear preserve.
 * Uses the real metrics.sqlite file (not :memory:).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  beginMatchSession,
  listIncidentHistory,
  persistDetectionIncidents,
  aggregateIncidentHistory,
} from './incidents.js'
import { abortAndClearAttacks } from '../campaign/engine.js'
import { deleteRoomMetrics } from './store.js'

const ROOM = 'RESTART-SMOKE'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function makeRoom() {
  return {
    id: ROOM,
    currentMatchId: null,
    matchStartedAtMs: null,
    nodes: [{ id: 'pay', data: { label: 'Pay', sector: 'Finance' } }],
    edges: [],
    hackSimulator: { active: false, nodeOverrides: {}, edgeOverrides: {}, nodeAttackStates: {} },
  }
}

function det() {
  return {
    anomalyNodeIds: ['pay'],
    peerExposedNodeIds: [],
    propagatedNodeIds: [],
    incidents: [
      {
        id: 'inc-pay',
        endpointId: 'pay',
        endpointLabel: 'Pay',
        severity: 'high',
        detectionType: 'behavioural_anomaly',
        anomalyScore: 0.8,
        trustScore: 50,
        evidence: [{ code: 'tgnn_embed', detail: 'x' }],
      },
    ],
  }
}

const room = makeRoom()
beginMatchSession(room)
persistDetectionIncidents(room, det())
const before = listIncidentHistory(ROOM).length
assert.ok(before >= 1, 'expected at least one row after persist')
const statsBefore = aggregateIncidentHistory(ROOM)
assert.ok(statsBefore.total >= 1)

// Simulate API restart: child process opens SQLite fresh with no roomStore.
const child = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
    import { listIncidentHistory, aggregateIncidentHistory } from ${JSON.stringify(path.join(__dirname, 'incidents.js'))};
    const rows = listIncidentHistory(${JSON.stringify(ROOM)});
    const stats = aggregateIncidentHistory(${JSON.stringify(ROOM)});
    if (!rows.length) { console.error('NO_ROWS'); process.exit(2); }
    if (stats.total < 1) { console.error('NO_STATS'); process.exit(3); }
    console.log(JSON.stringify({ count: rows.length, total: stats.total, today: stats.today }));
    `,
  ],
  { encoding: 'utf8', cwd: path.join(__dirname, '../..') }
)

if (child.status !== 0) {
  console.error(child.stdout)
  console.error(child.stderr)
  process.exit(child.status || 1)
}
const parsed = JSON.parse(child.stdout.trim().split('\n').pop())
assert.ok(parsed.count >= before, 'child process must see persisted rows without roomStore')

beginMatchSession(room)
assert.equal(listIncidentHistory(ROOM).length, before, 'new match must keep history')

abortAndClearAttacks(room)
assert.equal(listIncidentHistory(ROOM).length, before, 'clear attacks must keep history')

deleteRoomMetrics(ROOM)
assert.equal(listIncidentHistory(ROOM).length, before, 'teardown must keep history')

persistDetectionIncidents(room, det())
const after = listIncidentHistory(ROOM).length
assert.equal(after, before + 1, 'new episode increases total')

console.log(
  JSON.stringify({
    ok: true,
    before,
    afterRestartChild: parsed.count,
    afterNewMatchAndClear: before,
    afterNewEpisode: after,
    today: aggregateIncidentHistory(ROOM).today,
  })
)
