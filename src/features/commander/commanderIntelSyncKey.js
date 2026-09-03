/**
 * Sync key for Commander incident-intel fetches.
 * Deliberately omits simulationTick — telemetry ticks must not re-trigger RAG.
 * Changes to flagged detection sets or incident identity still refresh intel.
 */
export function commanderIntelSyncKey(detection = null) {
  const d = detection && typeof detection === 'object' ? detection : {}
  return [
    ...(d.anomalyNodeIds ?? []),
    ...(d.peerExposedNodeIds ?? []),
    ...(d.propagatedNodeIds ?? []),
    ...(d.incidents ?? []).map((i) => i?.id || i?.endpointId || ''),
  ].join('|')
}
