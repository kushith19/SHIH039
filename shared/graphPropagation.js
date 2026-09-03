/**
 * Multi-hop graph risk propagation.
 * 
 * This module performs a bounded Breadth-First Search (BFS) starting from TGNN
 * confirmed anomaly seeds to identify potentially affected downstream dependencies.
 * It respects directed graph edges, prevents cycles, and tracks hop distances.
 */

/**
 * Propagate risk across a directed graph.
 *
 * @param {Object} options
 * @param {Array<{source: string, target: string}>} options.edges - The directed edges of the graph.
 * @param {string[]|Set<string>} options.seedNodeIds - The confirmed anomaly seeds (Hop 0).
 * @param {string[]|Set<string>} [options.validNodeIds] - Optional set of valid node IDs.
 * @param {number} [options.maxHops=3] - Maximum number of hops to propagate.
 * @param {number} [options.decayFactor=0.5] - Attenuation factor per hop.
 * @returns {{
 *   propagatedNodeIds: string[],
 *   propagationPaths: Record<string, string[]>,
 *   propagationRiskByNode: Record<string, number>
 * }}
 */
export function propagateGraphRisk({
  edges,
  seedNodeIds,
  validNodeIds,
  maxHops = 3,
  decayFactor = 0.5,
}) {
  const seeds = new Set((seedNodeIds || []).map(String))
  const valid = validNodeIds ? (validNodeIds instanceof Set ? validNodeIds : new Set((validNodeIds || []).map(String))) : null

  // Build adjacency list (directed: source -> target)
  const adjacency = new Map()
  for (const edge of edges || []) {
    const source = String(edge.source || '')
    const target = String(edge.target || '')
    if (!source || !target || source === target) continue
    if (valid && (!valid.has(source) || !valid.has(target))) continue

    if (!adjacency.has(source)) {
      adjacency.set(source, new Set())
    }
    adjacency.get(source).add(target)
  }

  const propagatedNodeIds = new Set()
  const propagationPaths = {}
  const propagationRiskByNode = {}

  // Queue for BFS: { id, path, hop }
  const queue = []

  // Initialize queue with seeds
  for (const seed of seeds) {
    if (valid && !valid.has(seed)) continue
    queue.push({
      id: seed,
      path: [seed],
      hop: 0,
    })
  }

  // Set to keep track of visited nodes to prevent cycles
  // We initialize it with seeds so we don't treat a seed as a propagated node
  const visited = new Set(seeds)

  while (queue.length > 0) {
    const current = queue.shift()

    // Process neighbors
    const neighbors = adjacency.get(current.id) || new Set()
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue // Prevents cycles and duplicate processing

      const nextHop = current.hop + 1
      if (nextHop > maxHops) continue // Enforce max hops

      visited.add(neighbor)
      propagatedNodeIds.add(neighbor)

      const nextPath = [...current.path, neighbor]
      propagationPaths[neighbor] = nextPath
      
      // Calculate attenuated risk: base risk (e.g. 100) * (decayFactor ^ hop)
      // Hop 1 = 100 * 0.5 = 50
      // Hop 2 = 100 * 0.25 = 25
      propagationRiskByNode[neighbor] = 100 * Math.pow(decayFactor, nextHop)

      queue.push({
        id: neighbor,
        path: nextPath,
        hop: nextHop,
      })
    }
  }

  return {
    propagatedNodeIds: Array.from(propagatedNodeIds).sort(),
    propagationPaths,
    propagationRiskByNode,
  }
}
