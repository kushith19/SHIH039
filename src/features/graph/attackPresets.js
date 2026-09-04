import { NODE_METRIC_KEYS } from './nodeMetrics'
import {
  ATTACK_PRESETS,
  computePresetOverrides,
  getAttackPreset,
  listAttackPresets,
  preferredNodeIdsForPreset,
} from '@shared/attackPresets.js'

export {
  ATTACK_PRESETS,
  computePresetOverrides,
  getAttackPreset,
  listAttackPresets,
  preferredNodeIdsForPreset,
}

/**
 * @param {import('@shared/attackPresets.js').AttackPresetId | string} presetId
 * @param {Record<string, number>} baseline
 * @param {{ stageIndex?: number, variation?: number }} [opts]
 */
export function presetToNodeDataPatch(presetId, baseline, opts = {}) {
  const overrides = computePresetOverrides(presetId, baseline, opts)
  const patch = {}
  for (const key of NODE_METRIC_KEYS) {
    if (overrides[key] !== undefined) patch[key] = overrides[key]
  }
  return patch
}
