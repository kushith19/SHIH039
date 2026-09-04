import { createContext, useContext } from 'react'

/**
 * Live-match attack layer + derived security scan (TGNN + spread).
 *
 * @typedef {{
 *   active: boolean
 *   nodeOverrides?: Record<string, Partial<Record<'packetsPerSecond' | 'httpRequestsPerMin' | 'filesDownloaded' | 'failedLoginsPerMin', number>>>
 *   edgeOverrides?: Record<string, number>
 *   nodeScenarioBaselines?: Record<string, Partial<Record<'packetsPerSecond' | 'httpRequestsPerMin' | 'filesDownloaded' | 'failedLoginsPerMin', number>> | number>
 *   edgeScenarioBaselines?: Record<string, number>
 *   isolationScoresByNodeId?: Record<string, number>
 *   tgnnCalibrating?: boolean
 *   tgnnWarmupCollected?: number
 *   tgnnWarmupTicks?: number
 *   tgnnSkippedAttackTicks?: number
 *   anomalyNodeIds?: string[] — TGNN anomaly seeds (red nodes)
 *   spreadEdgeIds?: string[] — primary propagation link; kept for compatibility
 *   compromisedNodeIds?: string[] — anomaly seeds + primary spread target
 *   atRiskNodeIds?: string[] — 1-hop neighbors of residual flags (peer exposed)
 *   atRiskEdgeIds?: string[] — real edges incident to a residual flag
 *   primarySpreadNodeId?: string | null — highest-risk spread target (purple assessment)
 *   primarySpreadEdgeId?: string | null — link to primary target
 *   primarySpreadAssessment?: object | null — component breakdown for ranking explainability
 *   simulationTick?: number
 *   cityContext?: string
 *   trustByNodeId?: Record<string, object>
 * }} HackSimulatorContextValue
 */

export const HackSimulatorContext = createContext(null)

export function useHackSimulator() {
  return useContext(HackSimulatorContext)
}
