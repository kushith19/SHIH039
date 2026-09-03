import { NODE_METRIC_KEYS } from './nodeMetrics'
import { ATTACK_PRESETS, computePresetOverrides } from '@shared/attackPresets.js'

export { ATTACK_PRESETS, computePresetOverrides }

/**
 * @param {import('@shared/attackPresets.js').AttackPresetId} presetId
 * @param {Record<string, number>} baseline
 */
export function presetToNodeDataPatch(presetId, baseline) {
  const overrides = computePresetOverrides(presetId, baseline)
  const patch = {}
  for (const key of NODE_METRIC_KEYS) {
    if (overrides[key] !== undefined) patch[key] = overrides[key]
  }
  return patch
}
