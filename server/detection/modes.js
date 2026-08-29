export const DETECTION_MODE_TGNN = 'tgnn'
export const DETECTION_MODE_FUSION = 'fusion'

export function normalizeDetectionMode(raw) {
  return raw === DETECTION_MODE_TGNN ? DETECTION_MODE_TGNN : DETECTION_MODE_FUSION
}
