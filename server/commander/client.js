import { detectionTypeLabel, formatEvidenceItem } from '../../shared/incidents.js'

const AI_COMMANDER_URL = process.env.AI_COMMANDER_URL ?? 'http://localhost:8000'
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct'
const MAX_IN_FLIGHT = 1
const MAX_QUEUE = 5
const COMMANDER_TIMEOUT_MS = 45_000
const COMMANDER_HEALTH_TIMEOUT_MS = 3_000
const HEALTH_TTL_MS = 5_000
const OLLAMA_TIMEOUT_MS = 60_000
const OLLAMA_NUM_PREDICT = 120
const ERROR_RETRY_MS = 15_000
const FALLBACK_TOP_N = 5
const FALLBACK_ALWAYS_PREFIXES = Object.freeze([
  'tgnn_embed',
  'context_mismatch',
  'critical_infrastructure',
  'override',
  'origin_spread',
  'edge_contract',
])

let commanderDownUntil = 0
let commanderHealthyUntil = 0
let circuitOpenLogged = false

const TYPE_MAP = {
  behavioural_anomaly: 'behavioral_anomaly',
}

/** @type {Map<string, Map<string, { fingerprint: string, status: string, summary: string, lastAttempt: number }>>} */
const caches = new Map()
/** @type {Array<{ room: object, incident: object, fingerprint: string, onAfter?: Function }>} */
const queue = []
let inFlight = 0

export function ollamaFallbackEnabled() {
  const v = String(process.env.OLLAMA_FALLBACK ?? '0').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function mapDetectionType(type) {
  const t = String(type ?? '')
  if (TYPE_MAP[t]) return TYPE_MAP[t]
  return t || 'unknown'
}

function evidenceFingerprint(evidence) {
  return (Array.isArray(evidence) ? evidence : [])
    .map((ev) => [ev?.code ?? '', ev?.metric ?? ''].join('|'))
    .sort()
    .join(';')
}

export function fingerprintIncident(incident) {
  return `${incident?.id ?? ''}:${incident?.detectionType ?? ''}:${evidenceFingerprint(incident?.evidence)}`
}

function isAlwaysFallbackCode(code) {
  const c = String(code ?? '')
  return FALLBACK_ALWAYS_PREFIXES.some((p) => c === p || c.startsWith(`${p}:`) || c.startsWith(`${p}_`))
}

function pickFallbackLines(evidence) {
  const items = Array.isArray(evidence) ? evidence : []
  const seen = new Set()
  const lines = []

  function add(ev) {
    const line = formatEvidenceItem(ev)
    if (!line || seen.has(line)) return false
    seen.add(line)
    lines.push(line)
    return true
  }

  for (const ev of items) {
    if (isAlwaysFallbackCode(ev?.code)) add(ev)
  }

  const ranked = [...items].sort(
    (a, b) => Math.abs(Number(b?.deviationPct) || 0) - Math.abs(Number(a?.deviationPct) || 0)
  )
  let metricCount = 0
  for (const ev of ranked) {
    if (metricCount >= FALLBACK_TOP_N) break
    if (isAlwaysFallbackCode(ev?.code)) continue
    if (add(ev)) metricCount += 1
  }
  return lines
}

export function fallbackExplanation(incident) {
  const endpoint = incident?.endpointLabel || incident?.endpointId || 'Endpoint'
  const type = detectionTypeLabel(incident?.detectionType)
  const lines = pickFallbackLines(incident?.evidence)
  const severity = incident?.severity || 'low'
  if (lines.length === 0) {
    return `${endpoint} was flagged as ${type} at ${severity} severity.`
  }
  return `${endpoint} was flagged as ${type} (${severity}) because ${lines.join('; ')}.`
}

export function toDetectionInput(incident) {
  const ts = incident?.timestamp
  const timestamp =
    typeof ts === 'string' && ts
      ? ts
      : new Date().toISOString()
  const confidence = Number(incident?.confidence)
  const risk = Number(incident?.anomalyScore)
  const deps = Array.isArray(incident?.affectedDependencies) ? incident.affectedDependencies : []
  const neighborIds = deps.flatMap((d) => [d?.source, d?.target]).filter(Boolean)
  const affected = [
    ...new Set(
      [incident?.endpointId, incident?.cityEndpointId, ...neighborIds].filter(Boolean).map(String)
    ),
  ]
  return {
    incidentId: String(incident?.id ?? ''),
    timestamp,
    detectionType: mapDetectionType(incident?.detectionType),
    severity: incident?.severity || 'low',
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    riskScore: Number.isFinite(risk) ? Math.max(0, risk) : 0,
    affectedEndpoints: affected,
    evidence: Array.isArray(incident?.evidence) ? incident.evidence : [],
    metadata: {
      source: 'trustnet_detection',
      endpointLabel: incident?.endpointLabel ?? incident?.endpointId ?? '',
      cityContext: incident?.cityContext ?? '',
      criticality: incident?.criticality ?? '',
      sector: incident?.sector ?? '',
      cityEndpointId: incident?.cityEndpointId ?? '',
      affectedDependencies: deps,
    },
  }
}

export function toOllamaExplainPayload(incident) {
  const evidence = (Array.isArray(incident?.evidence) ? incident.evidence : []).map((ev) => ({
    code: ev?.code ?? '',
    metric: ev?.metric ?? '',
    detail: ev?.detail ?? '',
  }))
  return {
    incidentId: String(incident?.id ?? ''),
    detectionType: mapDetectionType(incident?.detectionType),
    severity: incident?.severity || 'low',
    evidence,
  }
}

function cacheFor(roomId) {
  const id = String(roomId ?? '')
  if (!caches.has(id)) caches.set(id, new Map())
  return caches.get(id)
}

export function clearExplanationCache(roomId) {
  if (roomId) caches.delete(String(roomId))
}

function circuitIsOpen() {
  return Date.now() < commanderDownUntil
}

function openCircuit(reason) {
  const alreadyOpen = circuitIsOpen()
  commanderDownUntil = Date.now() + ERROR_RETRY_MS
  commanderHealthyUntil = 0
  if (!alreadyOpen || !circuitOpenLogged) {
    circuitOpenLogged = true
    console.warn('[commander] circuit open:', reason?.message ?? reason)
  }
}

function markCommanderHealthy() {
  commanderDownUntil = 0
  commanderHealthyUntil = Date.now() + HEALTH_TTL_MS
  circuitOpenLogged = false
}

/** @param {'ready' | 'pending' | 'error' | 'fallback' | string | undefined} status */
function explanationStatusOf(status, fallback = 'fallback') {
  if (status === 'ready' || status === 'pending' || status === 'error' || status === 'fallback') {
    return status
  }
  return fallback
}

export function attachExplanations(room, incidents) {
  const cache = cacheFor(room?.id)
  for (const inc of incidents ?? []) {
    const fp = fingerprintIncident(inc)
    const row = cache.get(inc.id)
    const fallback = fallbackExplanation(inc)
    if (row && row.fingerprint === fp && row.summary) {
      inc.explanation = row.summary
      inc.explanationStatus = explanationStatusOf(row.status)
    } else if (row?.status === 'ready' && row.summary) {
      inc.explanation = row.summary
      inc.explanationStatus = 'ready'
    } else if (row?.summary) {
      inc.explanation = row.summary
      inc.explanationStatus = explanationStatusOf(row.status)
    } else {
      inc.explanation = fallback
      inc.explanationStatus = explanationStatusOf(row?.status)
    }
  }
}

function mergeExplanation(room, incidentId, _fp, { status, summary }) {
  const incidents = room?.detection?.incidents
  if (!Array.isArray(incidents)) return
  for (const inc of incidents) {
    if (inc.id !== incidentId) continue
    inc.explanation = summary ?? fallbackExplanation(inc)
    inc.explanationStatus = status
  }
}

function applyFallback(room, incident, fingerprint, { status = 'fallback' } = {}) {
  const summary = fallbackExplanation(incident)
  cacheFor(room.id).set(incident.id, {
    fingerprint,
    status,
    summary,
    lastAttempt: Date.now(),
  })
  mergeExplanation(room, incident.id, fingerprint, { status, summary })
  incident.explanation = summary
  incident.explanationStatus = status
}

function parseSummary(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  let body = text
  if (body.startsWith('```')) {
    body = body.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  }
  try {
    const data = JSON.parse(body)
    if (data && typeof data.summary === 'string' && data.summary.trim()) return data.summary.trim()
  } catch {
    const match = body.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        const data = JSON.parse(match[0])
        if (data && typeof data.summary === 'string' && data.summary.trim()) return data.summary.trim()
      } catch {
        /* ignore */
      }
    }
  }
  return text
}

async function fetchJson(url, { body, timeoutMs, method = 'POST', signal: outer } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const onAbort = () => ctrl.abort()
  outer?.addEventListener?.('abort', onAbort)
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 240)}`)
    return text ? JSON.parse(text) : {}
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener?.('abort', onAbort)
  }
}

async function commanderAvailable() {
  if (circuitIsOpen()) return false
  if (Date.now() < commanderHealthyUntil) return true
  try {
    await fetchJson(`${AI_COMMANDER_URL}/health`, {
      method: 'GET',
      timeoutMs: COMMANDER_HEALTH_TIMEOUT_MS,
    })
    commanderHealthyUntil = Date.now() + HEALTH_TTL_MS
    return true
  } catch (err) {
    openCircuit(err ?? new Error('health check failed'))
    return false
  }
}

async function explainViaCommander(incident) {
  if (!(await commanderAvailable())) throw new Error('commander circuit open')
  try {
    const data = await fetchJson(`${AI_COMMANDER_URL}/commander/explain`, {
      timeoutMs: COMMANDER_TIMEOUT_MS,
      body: {
        incidentId: incident.id,
        detection: toDetectionInput(incident),
      },
    })
    const summary = String(data?.summary ?? '').trim()
    if (!summary) throw new Error('empty commander summary')
    markCommanderHealthy()
    return summary
  } catch (err) {
    openCircuit(err)
    throw err
  }
}

async function explainViaOllama(incident) {
  const payload = toOllamaExplainPayload(incident)
  const data = await fetchJson(`${OLLAMA_URL}/api/chat`, {
    timeoutMs: OLLAMA_TIMEOUT_MS,
    body: {
      model: OLLAMA_MODEL,
      stream: false,
      format: 'json',
      keep_alive: 0,
      options: { num_predict: OLLAMA_NUM_PREDICT },
      messages: [
        {
          role: 'system',
          content:
            'You explain why a detection engine fired. Use ONLY numeric facts in evidence[]. Write 2-4 sentences. Do not invent CPU, latency, malware, or attackers. Return JSON {"summary":"..."}.',
        },
        {
          role: 'user',
          content: `Explain why this detection fired.\n${JSON.stringify(payload)}`,
        },
      ],
    },
  })
  const summary = parseSummary(data?.message?.content)
  if (!summary) throw new Error('empty ollama summary')
  return summary
}

async function tryOllamaExplanation(incident) {
  if (!ollamaFallbackEnabled()) return null
  try {
    const summary = await explainViaOllama(incident)
    return { summary, status: 'ready' }
  } catch (err) {
    console.warn('[commander] ollama fallback failed:', err?.message ?? err)
    return { summary: fallbackExplanation(incident), status: 'error' }
  }
}

async function explainIncident(incident) {
  if (circuitIsOpen()) {
    return (await tryOllamaExplanation(incident)) ?? {
      summary: fallbackExplanation(incident),
      status: 'fallback',
    }
  }
  try {
    const summary = await explainViaCommander(incident)
    return { summary, status: 'ready' }
  } catch {
    return (
      (await tryOllamaExplanation(incident)) ?? {
        summary: fallbackExplanation(incident),
        status: 'fallback',
      }
    )
  }
}

function settleDroppedJob(job) {
  const cache = cacheFor(job.room.id)
  const row = cache.get(job.incident.id)
  if (!row || row.status !== 'pending') return
  applyFallback(job.room, job.incident, job.fingerprint, { status: 'fallback' })
}

function trimQueue() {
  while (queue.length > MAX_QUEUE) {
    settleDroppedJob(queue.shift())
  }
}

function pump() {
  if (inFlight >= MAX_IN_FLIGHT || queue.length === 0) return
  const job = queue.shift()
  inFlight += 1
  const cache = cacheFor(job.room.id)
  const row = cache.get(job.incident.id)
  if (!row || row.status !== 'pending') {
    inFlight -= 1
    pump()
    return
  }
  explainIncident(job.incident)
    .then(({ summary, status }) => {
      cache.set(job.incident.id, {
        fingerprint: job.fingerprint,
        status,
        summary,
        lastAttempt: Date.now(),
      })
      mergeExplanation(job.room, job.incident.id, job.fingerprint, {
        status,
        summary,
      })
      job.onAfter?.(job.room)
    })
    .catch((err) => {
      console.warn('[commander] explain failed:', err?.message ?? err)
      applyFallback(job.room, job.incident, job.fingerprint, { status: 'error' })
      job.onAfter?.(job.room)
    })
    .finally(() => {
      inFlight -= 1
      pump()
    })
}

export function enqueueIncidentExplanations(room, onAfter) {
  const incidents = room?.detection?.incidents
  if (!room?.id || !Array.isArray(incidents) || incidents.length === 0) return
  const cache = cacheFor(room.id)
  const now = Date.now()
  const open = circuitIsOpen()
  for (const inc of incidents) {
    if (!inc?.id) continue
    const fp = fingerprintIncident(inc)
    const row = cache.get(inc.id)
    if (row?.status === 'ready' || row?.status === 'pending') continue
    if (
      (row?.status === 'error' || row?.status === 'fallback') &&
      now - (row.lastAttempt || 0) < ERROR_RETRY_MS
    ) {
      continue
    }
    if (open && !ollamaFallbackEnabled()) {
      applyFallback(room, inc, fp, { status: 'fallback' })
      continue
    }
    const seed = row?.summary ? row.summary : fallbackExplanation(inc)
    cache.set(inc.id, {
      fingerprint: fp,
      status: 'pending',
      summary: seed,
      lastAttempt: now,
    })
    inc.explanation = seed
    inc.explanationStatus = 'pending'
    queue.push({ room, incident: inc, fingerprint: fp, onAfter })
  }
  trimQueue()
  pump()
}

export function _openCommanderCircuitForTests(ms = ERROR_RETRY_MS) {
  commanderDownUntil = Date.now() + ms
  commanderHealthyUntil = 0
  circuitOpenLogged = true
}

export function _resetCommanderCircuitForTests() {
  commanderDownUntil = 0
  commanderHealthyUntil = 0
  circuitOpenLogged = false
  queue.length = 0
  inFlight = 0
}

export function _seedExplanationCacheForTests(roomId, incidentId, row) {
  cacheFor(roomId).set(incidentId, {
    fingerprint: row?.fingerprint ?? '',
    status: row?.status ?? 'ready',
    summary: row?.summary ?? '',
    lastAttempt: row?.lastAttempt ?? Date.now(),
  })
}

export function _explanationQueueLengthForTests() {
  return queue.length
}
