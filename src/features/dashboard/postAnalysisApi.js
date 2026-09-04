/**
 * Client helpers for Post-Analysis / Analyze APIs.
 */

export async function fetchAnalyzeOverview(roomId) {
  const res = await fetch(`/rooms/${encodeURIComponent(roomId)}/analyze/overview`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    return { ok: false, message: json.message ?? `HTTP ${res.status}`, overview: null }
  }
  return { ok: true, overview: json.overview }
}

export async function fetchAnalyzeIncidents(roomId, query = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') qs.set(k, String(v))
  }
  const suffix = qs.toString() ? `?${qs}` : ''
  const res = await fetch(`/rooms/${encodeURIComponent(roomId)}/analyze/incidents${suffix}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    return { ok: false, message: json.message ?? `HTTP ${res.status}`, incidents: [] }
  }
  return { ok: true, incidents: json.incidents ?? [] }
}

export async function fetchAnalyzeIncident(roomId, archiveId) {
  const res = await fetch(
    `/rooms/${encodeURIComponent(roomId)}/analyze/incidents/${encodeURIComponent(archiveId)}`
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    return { ok: false, message: json.message ?? `HTTP ${res.status}`, incident: null, recommendations: [] }
  }
  return {
    ok: true,
    incident: json.incident,
    recommendations: json.recommendations ?? [],
  }
}

export async function fetchAnalyzeRecommendations(roomId, query = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') qs.set(k, String(v))
  }
  const suffix = qs.toString() ? `?${qs}` : ''
  const res = await fetch(`/rooms/${encodeURIComponent(roomId)}/analyze/recommendations${suffix}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    return { ok: false, message: json.message ?? `HTTP ${res.status}`, recommendations: [] }
  }
  return { ok: true, recommendations: json.recommendations ?? [] }
}

export async function patchAnalyzeRecommendation(roomId, recommendationId, status) {
  const res = await fetch(
    `/rooms/${encodeURIComponent(roomId)}/analyze/recommendations/${encodeURIComponent(recommendationId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    return { ok: false, message: json.message ?? `HTTP ${res.status}`, recommendation: null }
  }
  return { ok: true, recommendation: json.recommendation }
}

export function formatShortDate(ms) {
  if (!Number.isFinite(Number(ms))) return '—'
  try {
    return new Date(Number(ms)).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

export function formatRelativeMs(ms) {
  if (!Number.isFinite(Number(ms))) return '—'
  const delta = Date.now() - Number(ms)
  if (delta < 60_000) return 'just now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return `${Math.floor(delta / 86_400_000)}d ago`
}

export function priorityTone(priority) {
  const p = String(priority ?? '').toLowerCase()
  if (p === 'critical' || p === 'high') return 'crit'
  if (p === 'medium') return 'warn'
  return 'muted'
}

export function statusLabel(status) {
  const s = String(status ?? '')
  if (s === 'in_progress') return 'In progress'
  if (s === 'completed') return 'Completed'
  if (s === 'dismissed') return 'Dismissed'
  if (s === 'recurred') return 'Recurring'
  if (s === 'open') return 'Open'
  return s || '—'
}

export function sourceLabel(source) {
  if (source === 'demo_seed') return 'Demo data'
  if (source === 'llm') return 'LLM-generated'
  if (source === 'deterministic') return 'Deterministic'
  return source || '—'
}

export function groupRecommendationsByPriority(recommendations) {
  const order = ['critical', 'high', 'medium', 'low']
  const groups = Object.fromEntries(order.map((p) => [p, []]))
  for (const rec of recommendations ?? []) {
    const p = order.includes(rec.priority) ? rec.priority : 'medium'
    groups[p].push(rec)
  }
  return order
    .filter((p) => groups[p].length)
    .map((p) => ({ priority: p, items: groups[p] }))
}
