/**
 * Shared node quarantine mutation — used by defender:quarantine and
 * commander response EXECUTE (isolate-node → executionTarget quarantine).
 *
 * When quarantining (true), also clears that node's active attack metric
 * override so telemetry/detection can recover naturally. Does not clear
 * other nodes' overrides and does not restore overrides on unquarantine.
 */
import { runtimeStateOf } from '../infrastructureNode.js'
import { clearNodeAttackOverride } from '../campaign/engine.js'
import { invalidateSpreadLocksForNode } from '../../shared/spreadTargetLock.js'

/**
 * Set or clear runtimeState.quarantined on a room node.
 * Mutates room.nodes in place. Does not broadcast.
 *
 * @returns {{ ok: true, already: boolean, nodeId: string, node: object, overrideCleared?: boolean }
 *   | { ok: false, code: 'NODE_NOT_FOUND' }}
 */
export function setNodeQuarantined(room, nodeId, quarantined = true) {
  if (!room || !Array.isArray(room.nodes)) {
    return { ok: false, code: 'NODE_NOT_FOUND' }
  }
  const id = String(nodeId ?? '')
  if (!id) return { ok: false, code: 'NODE_NOT_FOUND' }
  const idx = room.nodes.findIndex((n) => n.id === id)
  if (idx < 0) return { ok: false, code: 'NODE_NOT_FOUND' }

  const prev = room.nodes[idx].data ?? {}
  const next = quarantined !== false
  const was = runtimeStateOf(prev).quarantined === true
  if (was === next) {
    return {
      ok: true,
      already: true,
      nodeId: id,
      node: room.nodes[idx],
      overrideCleared: false,
    }
  }

  room.nodes[idx] = {
    ...room.nodes[idx],
    data: {
      ...prev,
      runtimeState: { ...runtimeStateOf(prev), quarantined: next },
    },
  }
  const overrideCleared = next ? clearNodeAttackOverride(room, id) : false
  // Quarantining a locked next-target (or its seed) releases sticky spread locks.
  if (next) invalidateSpreadLocksForNode(room, id)
  return {
    ok: true,
    already: false,
    nodeId: id,
    node: room.nodes[idx],
    overrideCleared,
  }
}
