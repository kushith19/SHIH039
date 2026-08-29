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
 *   anomalyNodeIds?: string[] — TGNN anomaly seeds (red nodes)
 *   spreadEdgeIds?: string[] — primary propagation link; kept for compatibility
 *   compromisedNodeIds?: string[] — anomaly seeds + primary spread target
 *   atRiskNodeIds?: string[] — downstream nodes that may be attacked (purple)
 *   atRiskEdgeIds?: string[] — links on the simulated spread path (purple)
 *   primarySpreadNodeId?: string | null — highest-risk spread target (red node)
 *   primarySpreadEdgeId?: string | null — link to primary target (red edge)
 *   simulationTick?: number
 *   cityContext?: string
 *   trustByNodeId?: Record<string, object>
 * }} HackSimulatorContextValue
 */

export const HackSimulatorContext = createContext(null)

export function useHackSimulator() {
  return useContext(HackSimulatorContext)
}
