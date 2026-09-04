import {
  RISK_HISTORY_CAP,
  appendRiskSample,
  currentResidualScore,
  emptyRiskMomentum,
  exposedSetCount,
  momentumFromHistory,
} from '../../shared/riskMomentum.js'

export function resetRiskHistory(room) {
  if (room) room.riskHistory = []
}

export function advanceRiskMomentum(room, detection) {
  if (!detection || typeof detection !== 'object') return detection
  if (!room) {
    detection.riskMomentum = emptyRiskMomentum()
    return detection
  }
  const sample = {
    tick: Number(detection.simulationTick) || 0,
    score: currentResidualScore(detection),
    exposedCount: exposedSetCount(detection),
  }
  room.riskHistory = appendRiskSample(room.riskHistory, sample, RISK_HISTORY_CAP)
  detection.riskMomentum = momentumFromHistory(room.riskHistory)
  return detection
}
