/** Undirected BFS hop distance on room edges. Shared by history campaign correlation. */

function adjacency(edges) {
  const adj = new Map()
  for (const e of edges ?? []) {
    if (!e?.source || !e?.target) continue
    if (!adj.has(e.source)) adj.set(e.source, [])
    if (!adj.has(e.target)) adj.set(e.target, [])
    adj.get(e.source).push(e.target)
    adj.get(e.target).push(e.source)
  }
  return adj
}

export function hopDistance(edges, a, b) {
  if (!a || !b) return Infinity
  if (a === b) return 0
  const adj = adjacency(edges)
  const q = [[a, 0]]
  const seen = new Set([a])
  while (q.length) {
    const [id, d] = q.shift()
    for (const n of adj.get(id) ?? []) {
      if (seen.has(n)) continue
      if (n === b) return d + 1
      seen.add(n)
      q.push([n, d + 1])
    }
  }
  return Infinity
}
