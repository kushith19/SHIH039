/**
 * Match-scoped attack spread mode (manual | auto).
 * Server-authoritative; clients display only.
 */

export const ATTACK_SPREAD_MODE_MANUAL = 'manual'
export const ATTACK_SPREAD_MODE_AUTO = 'auto'

export const ATTACK_SPREAD_MODES = Object.freeze([
  ATTACK_SPREAD_MODE_MANUAL,
  ATTACK_SPREAD_MODE_AUTO,
])

/**
 * Max successful AUTO spreadAttack hops per match/campaign.
 * Initial seed attacks do not count. Manual spreads are uncapped.
 */
export const AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN = 5

/**
 * @param {unknown} value
 * @returns {'manual' | 'auto'}
 */
export function normalizeAttackSpreadMode(value) {
  return value === ATTACK_SPREAD_MODE_AUTO
    ? ATTACK_SPREAD_MODE_AUTO
    : ATTACK_SPREAD_MODE_MANUAL
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAttackSpreadMode(value) {
  return value === ATTACK_SPREAD_MODE_MANUAL || value === ATTACK_SPREAD_MODE_AUTO
}

/**
 * @param {object | null | undefined} roomOrSim
 * @returns {'manual' | 'auto'}
 */
export function getAttackSpreadMode(roomOrSim) {
  const sim = roomOrSim?.hackSimulator ?? roomOrSim
  return normalizeAttackSpreadMode(sim?.attackSpreadMode)
}
