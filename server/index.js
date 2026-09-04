import './loadEnv.js'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import {
  DEMO_ROOM_ID,
  deleteRoomIfEmpty,
  getOrCreateRoom,
  getRoom,
  publicRoomState,
  DEFAULT_HACK_SIMULATOR,
  buildAttackLayerFromGraph,
} from './roomStore.js'
import {
  sanitizeNode,
  sanitizeEdge,
  sanitizeHackSimulator,
  isDefender,
  isAttacker,
  canEditTopology,
  canAddNode,
  canDeleteNode,
  canConnect,
  canEditSim,
  canDefenderSetBaseline,
  canQuarantine,
  canDeleteEdge,
} from './validators.js'
import {
  applyDefenderNodeBaseline,
  applyDefenderEdgeBaseline,
  isNodeMetricPatch,
  NODE_METRIC_KEYS,
  normalizeMetricPatch,
} from './nodeMetrics.js'
import { runtimeStateOf, telemetryOf } from './infrastructureNode.js'
import { applyCityModelOverlay, parseCityContextOverride } from '../shared/cityContext.js'
import '../shared/tgnnCore.js'
import { CITY_MODEL_DIR, loadCityModelFromDisk } from './loadCityModel.js'
import {
  emitTelemetryNow,
  startTelemetryLoop,
  stopTelemetryLoop,
  teardownRoomTelemetry,
} from './telemetry/generator.js'
import { getLatestDetection } from './metrics/store.js'
import {
  commanderContextFor,
  getIncident,
  listIncidentHistory,
  listHistoryCampaigns,
  listIncidents,
  normalizeHistoryOrder,
  updateIncidentStatus,
} from './metrics/incidents.js'
import {
  computeFinancialExposure,
  currentExposureForIncident,
} from '../shared/financialExposure.js'
import { deleteTgnnCalibrator, resetTgnnCalibrator } from './detection/calibrator.js'
import { emptyDetectionResult } from './detection/types.js'
import {
  abortAndClearAttacks,
  applyManualPreset,
  attachOverrideNodes,
  spreadAttack,
} from './campaign/engine.js'
import { answerCommanderQuestion } from '../shared/commanderAsk.js'
import {
  COMMANDER_MODES,
  buildIncidentIntel,
} from '../shared/commanderIncidentIntel.js'
import {
  buildKnowledgeRetrievalQuery,
  isKnowledgeFollowUpQuestion,
  liveFactsFromContext,
  attachKnowledgeContext,
} from '../shared/commanderKnowledgeQuery.js'
import { attachAvailableResponseActions } from '../shared/responseActions.js'
import { attachResponseClassification } from '../shared/responsePolicy.js'
import { setNodeQuarantined } from './response/quarantineNode.js'
import { executeResponseAction } from './response/executeAction.js'
import {
  approveOrchestrationPlan,
  executeOrchestrationPlan,
  generateOrchestrationPlan,
  refreshOrchestrationFreshness,
  replanOrchestrationPlan,
  resetRoomOrchestration,
  startNewOrchestrationCycle,
  verifyOrchestrationPlan,
} from './response/orchestrate.js'
import {
  clearSpreadTargetLocks,
  invalidateSpreadLocksForNode,
} from '../shared/spreadTargetLock.js'
import {
  clearAutoSpreadGuards,
  evaluateAutoSpread,
} from './attack/autoSpread.js'
import {
  isAttackSpreadMode,
  normalizeAttackSpreadMode,
} from '../shared/attackSpreadMode.js'
import {
  fetchKnowledgeContext,
  askWithKnowledge,
  toDetectionInput,
  fingerprintIncident,
} from './commander/client.js'
import {
  getRecentTelemetry,
  nodeIdsByCityEndpoint,
  samplesFromIngestedRows,
} from './telemetry/ingestionClient.js'

const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '0.0.0.0'
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'

/** Allow local Vite origins (localhost + any host on :5173) for multi-device demos. */
function isAllowedClientOrigin(origin) {
  if (!origin) return true
  if (origin === CLIENT_ORIGIN || origin === 'http://127.0.0.1:5173') return true
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    // Vite UI only — covers LAN / hotspot / campus IPs for now
    return port === '5173'
  } catch {
    return false
  }
}

/** Live-detection fallback when SQLite has no persistent row yet. */
function liveCommanderContext(room, incidentId) {
  const live = (room?.detection?.incidents ?? []).find(
    (inc) => inc.id === incidentId || inc.persistentId === incidentId
  )
  if (!live) return null
  const nodes = Array.isArray(room?.nodes) ? room.nodes : []
  const edges = Array.isArray(room?.edges) ? room.edges : []
  const status = live.status ?? 'open'
  const financialExposure =
    String(status).toLowerCase() === 'cleared'
      ? currentExposureForIncident(
          {
            status: 'cleared',
            financialContext: live.financialContext,
            affectedNodeId: live.endpointId,
            incidentId: live.persistentId || live.id,
            liveIncidentId: live.id,
          },
          room
        )
      : computeFinancialExposure({
          detection: {
            anomalyNodeIds: live.endpointId ? [live.endpointId] : [],
            peerExposedNodeIds: live.peerExposedNodeIds ?? [],
            propagatedNodeIds: live.propagatedNodeIds ?? [],
            incidents: [live],
            riskMomentum: room?.detection?.riskMomentum ?? null,
          },
          nodes,
          edges,
        })
  const base = {
    incidentId: live.persistentId || live.id,
    liveIncidentId: live.id,
    incidentType: live.detectionType,
    severity: live.severity,
    status,
    affectedAsset: { id: live.endpointId, summary: live.endpointLabel || live.endpointId },
    riskScore: live.anomalyScore,
    trustScore: live.trustScore,
    anomalyEvidence: live.evidence ?? [],
    peerExposure: live.peerExposedNodeIds ?? [],
    propagatedNodeIds: live.propagatedNodeIds ?? [],
    propagationPaths: live.propagationPaths ?? {},
    primaryPath: live.graphContext?.primaryPath ?? [],
    primaryPathLabels: live.graphContext?.primaryPathLabels ?? [],
    blastRadius: live.graphContext?.blastRadius ?? null,
    hopDistance: live.graphContext?.hopDistance ?? null,
    financialExposure,
    relatedIncidents: live.relatedIncidents ?? [],
    campaignId: live.campaignId ?? null,
    currentStatus: status,
    actionsAlreadyTaken: live.actionsTaken ?? [],
    isExposureIncident: live.isExposureIncident === true,
  }
  return attachAvailableResponseActions(attachResponseClassification(base, nodes))
}

function resolveCommanderContext(room, roomId, incidentId) {
  const nodes = Array.isArray(room?.nodes) ? room.nodes : []
  const edges = Array.isArray(room?.edges) ? room.edges : []
  let context = null
  try {
    context = commanderContextFor(roomId, incidentId, {
      nodes,
      edges,
      detection: room?.detection ?? null,
      room,
    })
  } catch (err) {
    console.error('[incidents] commander-context failed', err)
  }
  return context || liveCommanderContext(room, incidentId)
}

const cityModel = loadCityModelFromDisk()
if (cityModel && applyCityModelOverlay(cityModel)) {
  console.log(`City model contexts: ${cityModel.contexts.join(', ')} (${CITY_MODEL_DIR})`)
} else {
  console.warn('City model YAML not loaded; using TRUST_CONFIG city context tables')
}

const app = express()
app.use(
  cors({
    origin(origin, cb) {
      cb(null, isAllowedClientOrigin(origin))
    },
    credentials: true,
  })
)
app.use(express.json({ limit: '512kb' }))
async function probeUrl(url, timeoutMs = 800) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ac.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

app.get('/health', async (_req, res) => {
  const ingestUrl = process.env.TELE_INGESTION_URL ?? 'http://127.0.0.1:3000'
  const commanderUrl = process.env.AI_COMMANDER_URL ?? 'http://localhost:8000'
  const [ingest, commander] = await Promise.all([
    probeUrl(`${ingestUrl.replace(/\/$/, '')}/health`),
    probeUrl(`${commanderUrl.replace(/\/$/, '')}/health`),
  ])
  res.json({
    ok: true,
    process: 'up',
    ingest: ingest ? 'up' : 'down',
    commander: commander ? 'up' : 'down',
  })
})

app.get('/rooms/:id/metrics', async (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const result = await getRecentTelemetry(5)
  const nodeMap = nodeIdsByCityEndpoint(room.nodes)
  let samples = samplesFromIngestedRows(result.rows, nodeMap)
  const endpoint = req.query.endpoint ? String(req.query.endpoint) : ''
  if (endpoint) samples = samples.filter((s) => s.endpointId === endpoint)
  const fromTick = Number(req.query.fromTick)
  const toTick = Number(req.query.toTick)
  if (Number.isFinite(fromTick)) samples = samples.filter((s) => s.tick >= fromTick)
  if (Number.isFinite(toTick)) samples = samples.filter((s) => s.tick <= toTick)
  res.json({
    ok: true,
    roomId: id,
    source: 'ingestion-global',
    ingestionStatus: result.status,
    samples,
  })
})

app.get('/rooms/:id/detection', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const latest = getLatestDetection(id)
  res.json({
    ok: true,
    roomId: id,
    tick: latest?.tick ?? room.simulationTick ?? 0,
    tsMs: latest?.tsMs ?? null,
    detection: latest?.detection ?? room.detection ?? null,
  })
})

app.get('/rooms/:id/incidents', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  let stored = []
  try {
    stored = listIncidents(id)
  } catch (err) {
    console.error('[incidents] list failed', err)
  }
  res.json({
    ok: true,
    roomId: id,
    incidents: stored,
    live: room.detection?.incidents ?? [],
  })
})

app.get('/rooms/:id/incidents/history', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const order = String(req.query.order ?? 'desc')
  const limitRaw = req.query.limit
  const limit = limitRaw == null || limitRaw === '' ? undefined : Number(limitRaw)
  let incidents = []
  try {
    incidents = listIncidentHistory(id, { order, limit })
  } catch (err) {
    console.error('[incidents] history failed', err)
    return res.status(500).json({ ok: false, message: 'History query failed' })
  }
  res.json({
    ok: true,
    roomId: id,
    order: normalizeHistoryOrder(order),
    incidents,
  })
})

app.get('/rooms/:id/incidents/campaigns', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  let campaigns = []
  try {
    campaigns = listHistoryCampaigns(room)
  } catch (err) {
    console.error('[incidents] history campaigns failed', err)
    return res.status(500).json({ ok: false, message: 'Campaign query failed' })
  }
  res.json({ ok: true, roomId: id, campaigns })
})

app.get('/rooms/:id/incidents/:incidentId', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const incidentId = String(req.params.incidentId ?? '')
  let stored = null
  try {
    stored = getIncident(id, incidentId)
  } catch (err) {
    console.error('[incidents] get failed', err)
  }
  const live = (room.detection?.incidents ?? []).find(
    (inc) => inc.id === incidentId || inc.persistentId === incidentId
  )
  if (!stored && !live) {
    return res.status(404).json({ ok: false, message: 'Incident not found' })
  }
  res.json({ ok: true, roomId: id, incident: stored, live: live ?? null })
})

app.get('/rooms/:id/incidents/:incidentId/commander-context', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const incidentId = String(req.params.incidentId ?? '')
  const context = resolveCommanderContext(room, id, incidentId)
  if (!context) {
    return res.status(404).json({ ok: false, message: 'Incident not found' })
  }
  res.json({ ok: true, roomId: id, context })
})

app.post('/rooms/:id/commander/incident-intel', async (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const focusId = String(req.body?.incidentId ?? '')
  if (!focusId) {
    return res.status(400).json({ ok: false, message: 'incidentId required' })
  }
  const context = resolveCommanderContext(room, id, focusId)
  if (!context) {
    return res.status(404).json({ ok: false, message: 'Incident not found' })
  }
  const mode = String(req.body?.mode ?? COMMANDER_MODES.INVESTIGATE).toLowerCase()
  const intel = buildIncidentIntel(context, mode)
  const planBefore =
    Array.isArray(intel?.plan) ? JSON.stringify(intel.plan) : null

  const { query, hints } = buildKnowledgeRetrievalQuery(context)
  const live = (room?.detection?.incidents ?? []).find(
    (inc) =>
      inc.id === focusId ||
      inc.persistentId === focusId ||
      String(inc.id) === focusId
  )
  const detection = live ? toDetectionInput(live, room) : null
  const fp = live
    ? fingerprintIncident(live)
    : `${focusId}:${context.incidentType || ''}:${(context.anomalyEvidence || []).length}`

  let knowledge
  try {
    knowledge = await fetchKnowledgeContext({
      query,
      hints,
      detection,
      incidentId: focusId,
      fingerprint: fp,
    })
  } catch {
    knowledge = {
      retrieved: false,
      reason: 'Knowledge retrieval unavailable',
      knowledgeStatus: 'unavailable',
      attackUnderstanding: [],
      relevantKnowledge: [],
      preventionGuidance: [],
      sources: [],
      queries: [],
    }
  }

  const enriched = attachKnowledgeContext(intel, knowledge)
  if (planBefore != null && Array.isArray(enriched?.plan)) {
    // Response plan isolation: RAG must not alter deterministic plan
    if (JSON.stringify(enriched.plan) !== planBefore) {
      enriched.plan = JSON.parse(planBefore)
    }
  }

  res.json({
    ok: true,
    roomId: id,
    mode: enriched?.mode ?? mode,
    context,
    intel: enriched,
  })
})

app.post('/rooms/:id/commander/execute', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const incidentId = String(req.body?.incidentId ?? '').trim()
  const actionId = String(req.body?.actionId ?? '').trim()
  if (!incidentId) {
    return res.status(400).json({ ok: false, message: 'incidentId required' })
  }
  if (!actionId) {
    return res.status(400).json({ ok: false, message: 'actionId required' })
  }
  const context = resolveCommanderContext(room, id, incidentId)
  const result = executeResponseAction({
    room,
    roomId: id,
    incidentId,
    actionId,
    context,
    onRoomMutated: syncWithTelemetry,
  })
  if (!result.ok) {
    return res.status(result.statusCode ?? 400).json({
      ok: false,
      message: result.message ?? 'Execution failed',
    })
  }
  res.json(result)
})

app.post('/rooms/:id/orchestration/analyze', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const focusIncidentId = String(req.body?.incidentId ?? req.body?.focusIncidentId ?? '').trim() || null
  // Client-supplied actionIds are intentionally ignored (injection protection).
  const result = generateOrchestrationPlan(room, {
    focusIncidentId,
    resolveContext: resolveCommanderContext,
  })
  if (!result.ok) {
    return res.status(result.statusCode ?? 400).json({
      ok: false,
      message: result.message ?? 'Analyze failed',
      orchestration: result.orchestration ?? null,
      executed: false,
    })
  }
  broadcastState(room)
  res.json({
    ok: true,
    roomId: id,
    orchestration: result.orchestration,
    executed: false,
    executedActions: [],
  })
})

app.post('/rooms/:id/orchestration/approve', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const result = approveOrchestrationPlan(room, {
    resolveContext: resolveCommanderContext,
    clientActionIds: req.body?.actionIds ?? req.body?.recommendedActions ?? null,
    onProgress: () => broadcastState(room),
    onCompleteSync: syncWithTelemetry,
  })
  if (!result.ok) {
    broadcastState(room)
    return res.status(result.statusCode ?? 400).json({
      ok: false,
      message: result.message ?? 'Approval failed',
      orchestration: result.orchestration ?? null,
      executed: false,
    })
  }
  broadcastState(room)
  res.json({
    ok: true,
    roomId: id,
    orchestration: result.orchestration,
    executed: result.executed === true,
    executedActions: result.executedActions ?? [],
    autoContinued: result.autoContinued === true,
    episodeComplete: result.episodeComplete === true,
    pausedForApproval: result.pausedForApproval === true,
    recovered: result.recovered === true,
    continuationLog: result.continuationLog ?? [],
    mutatedQuarantine: false,
    autoRestored: false,
  })
})

app.post('/rooms/:id/orchestration/execute', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  // Client plan/action payloads are intentionally ignored.
  const result = executeOrchestrationPlan(room, {
    resolveContext: resolveCommanderContext,
    clientPlan: req.body?.plan ?? null,
    clientActionIds: req.body?.actionIds ?? req.body?.recommendedActions ?? null,
    onProgress: () => broadcastState(room),
    onCompleteSync: syncWithTelemetry,
  })
  if (!result.ok) {
    broadcastState(room)
    return res.status(result.statusCode ?? 400).json({
      ok: false,
      message: result.message ?? 'Execution failed',
      orchestration: result.orchestration ?? null,
      execution: result.execution ?? null,
    })
  }
  // onCompleteSync already broadcasts via telemetry path; ensure clients see VERIFYING
  broadcastState(room)
  res.json({
    ok: true,
    roomId: id,
    orchestration: result.orchestration,
    execution: result.execution,
    recovered: false,
    incidentsClosed: false,
    autoRestored: false,
  })
})

app.post('/rooms/:id/orchestration/verify', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const result = verifyOrchestrationPlan(room, {
    resolveContext: resolveCommanderContext,
    onProgress: () => broadcastState(room),
    onCompleteSync: syncWithTelemetry,
    autoContinue: true,
  })
  broadcastState(room)
  if (!result.ok && result.stepVerified !== true && result.pausedForApproval !== true) {
    return res.status(result.statusCode ?? 400).json({
      ok: false,
      message: result.message ?? 'Verification failed',
      verdict: result.verdict ?? null,
      orchestration: result.orchestration ?? null,
      verification: result.verification ?? null,
      recovered: false,
      incidentsClosed: false,
      autoRestored: false,
      mutatedQuarantine: false,
    })
  }
  res.json({
    ok: true,
    roomId: id,
    verdict: result.verdict,
    stepVerified: result.stepVerified === true,
    episodeComplete: result.episodeComplete === true,
    autoContinued: result.autoContinued === true,
    pausedForApproval: result.pausedForApproval === true,
    continuationLog: result.continuationLog ?? [],
    orchestration: result.orchestration,
    verification: result.verification,
    recovered: result.recovered === true,
    incidentsClosed: false,
    autoRestored: false,
    mutatedQuarantine: false,
  })
})

app.post('/rooms/:id/orchestration/replan', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  // Client-supplied actionIds / targets / plans are intentionally ignored.
  const result = replanOrchestrationPlan(room, {
    resolveContext: resolveCommanderContext,
    clientActionIds: req.body?.actionIds ?? req.body?.recommendedActions ?? null,
    clientTargets: req.body?.targets ?? req.body?.affectedNodeIds ?? null,
    clientPlan: req.body?.plan ?? null,
  })
  broadcastState(room)
  if (!result.ok) {
    return res.status(result.statusCode ?? 400).json({
      ok: false,
      message: result.message ?? 'Re-plan failed',
      orchestration: result.orchestration ?? null,
      executed: false,
      mutatedQuarantine: false,
      mutatedOverrides: false,
      autoApproved: false,
    })
  }
  res.json({
    ok: true,
    roomId: id,
    orchestration: result.orchestration,
    executed: false,
    executedActions: [],
    mutatedQuarantine: false,
    mutatedOverrides: false,
    autoApproved: false,
  })
})

app.post('/rooms/:id/orchestration/new-cycle', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const result = startNewOrchestrationCycle(room, {})
  broadcastState(room)
  if (!result.ok) {
    return res.status(result.statusCode ?? 400).json({
      ok: false,
      message: result.message ?? 'New cycle failed',
      orchestration: result.orchestration ?? null,
      executed: false,
    })
  }
  res.json({
    ok: true,
    roomId: id,
    orchestration: result.orchestration,
    executed: false,
  })
})

app.patch('/rooms/:id/incidents/:incidentId', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const incidentId = String(req.params.incidentId ?? '')
  try {
    const updated = updateIncidentStatus(id, incidentId, {
      status: req.body?.status,
      actionsTaken: req.body?.actionsTaken,
    })
    if (!updated) {
      return res.status(404).json({ ok: false, message: 'Incident not found' })
    }
    res.json({ ok: true, roomId: id, incident: updated })
  } catch (err) {
    console.error('[incidents] patch failed', err)
    res.status(500).json({ ok: false, message: 'Update failed' })
  }
})

app.post('/rooms/:id/commander/ask', async (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const focusId = req.body?.incidentId ? String(req.body.incidentId) : ''
  const incidentContext = focusId ? resolveCommanderContext(room, id, focusId) : null
  const question = req.body?.question
  const snapshot = {
    briefing: room.commanderBriefing,
    incidents: room.detection?.incidents ?? [],
    campaigns: [],
    posture: publicRoomState(room).cityPosture,
    incidentContext,
  }

  // Knowledge follow-ups: live context + RAG (never mutates response plan / execute)
  if (incidentContext && isKnowledgeFollowUpQuestion(question)) {
    const { query, hints } = buildKnowledgeRetrievalQuery(incidentContext)
    const liveFacts = liveFactsFromContext(incidentContext)
    const live = (room?.detection?.incidents ?? []).find(
      (inc) =>
        inc.id === focusId ||
        inc.persistentId === focusId ||
        String(inc.id) === focusId
    )
    const detection = live ? toDetectionInput(live, room) : null
    try {
      const rag = await askWithKnowledge({
        question: String(question ?? ''),
        query,
        hints,
        detection,
        liveFacts,
      })
      if (rag?.answer) {
        return res.json({
          ok: true,
          answer: rag.answer,
          insufficient: Boolean(rag.insufficient),
          knowledgeContext: rag.knowledgeContext ?? null,
        })
      }
    } catch {
      /* fall through to deterministic ask */
    }
  }

  const result = answerCommanderQuestion(question, snapshot)
  res.json({ ok: true, ...result })
})

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: isAllowedClientOrigin,
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 5e6,
  pingTimeout: 20000,
  pingInterval: 25000,
})

const socketRoom = new Map()

function emitError(socket, message) {
  socket.emit('error', { message })
}

function broadcastState(room) {
  io.to(room.id).emit('state:sync', publicRoomState(room))
}

/** After detection: optional auto-spread, orchestration freshness, then broadcast. */
function afterTelemetryTick(room) {
  try {
    evaluateAutoSpread(room)
  } catch (err) {
    console.error('[auto-spread] evaluate failed', err)
  }
  try {
    refreshOrchestrationFreshness(room, resolveCommanderContext)
  } catch (err) {
    console.error('[orchestration] freshness check failed', err)
  }
  broadcastState(room)
}

function syncWithTelemetry(room) {
  if (room.phase === 'playing') {
    void emitTelemetryNow(room, afterTelemetryTick)
    return
  }
  broadcastState(room)
}

function getSocketRoom(socket) {
  const roomId = socketRoom.get(socket.id)
  if (!roomId) return null
  return getRoom(roomId)
}

/** Socket.IO may pass the ack as the only arg when the client omits payload. */
function resolveAck(args) {
  for (let i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] === 'function') return args[i]
  }
  return () => { }
}

function startMatch(room) {
  if (room.phase !== 'lobby') return false
  if (!room.players.defender || !room.players.attacker) return false
  if (!Array.isArray(room.nodes) || room.nodes.length === 0) return false
  room.phase = 'playing'
  room.matchNodeIds = room.nodes.map((n) => n.id)
  room.matchEdgeIds = room.edges.map((e) => e.id)
  room.hackSimulator = buildAttackLayerFromGraph(room.nodes, room.edges)
  clearAutoSpreadGuards(room)
  resetTgnnCalibrator(room.id)
  startTelemetryLoop(room, afterTelemetryTick)
  return true
}

function resetMatch(room) {
  stopTelemetryLoop(room.id)
  abortAndClearAttacks(room)
  room.phase = 'lobby'
  room.hackSimulator = buildAttackLayerFromGraph(room.nodes, room.edges)
  clearAutoSpreadGuards(room)
  room.simulationTick = 0
  room.detection = emptyDetectionResult()
  clearSpreadTargetLocks(room)
  room.campaigns = []
  room.incidentLedger = []
  room.commanderBriefing = null
  resetRoomOrchestration(room)
  resetTgnnCalibrator(room.id)
  startMatch(room)
  return true
}

function tryAutoStartMatch(room) {
  return startMatch(room)
}

io.on('connection', (socket) => {
  socket.on('room:setCityContext', (...args) => {
    const ack = resolveAck(args)
    const payload =
      typeof args[0] === 'object' && args[0] !== null && typeof args[0] !== 'function'
        ? args[0]
        : {}
    const room = getSocketRoom(socket)
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Not in a room' })
      return emitError(socket, 'Not in a room')
    }
    const parsed = parseCityContextOverride(payload.cityContext)
    if (parsed === undefined) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Unknown city context' })
      return emitError(socket, 'Unknown city context')
    }
    room.cityContextOverride = parsed
    const state = publicRoomState(room)
    if (typeof ack === 'function') {
      ack({
        ok: true,
        cityContext: state.cityContext,
        cityContextLocked: state.cityContextLocked,
      })
    }
    syncWithTelemetry(room)
  })

  socket.on('room:join', (...args) => {
    const ack = resolveAck(args)
    const room = getOrCreateRoom(DEMO_ROOM_ID)

    const existingRole =
      room.players.defender === socket.id
        ? 'defender'
        : room.players.attacker === socket.id
          ? 'attacker'
          : null

    if (existingRole) {
      socket.join(room.id)
      socketRoom.set(socket.id, room.id)
      ack({ ok: true, role: existingRole, ...publicRoomState(room) })
      return
    }

    const r = !room.players.defender
      ? 'defender'
      : !room.players.attacker
        ? 'attacker'
        : null

    if (!r) {
      ack({ ok: false, message: 'Session full' })
      return emitError(socket, 'Session is full — two players are already connected')
    }

    room.players[r] = socket.id
    socket.join(room.id)
    socketRoom.set(socket.id, room.id)
    ack({ ok: true, role: r, ...publicRoomState(room) })
    tryAutoStartMatch(room)
    broadcastState(room)
  })

  socket.on('game:start', (...args) => {
    const ack = resolveAck(args)
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!isDefender(socket.id, room)) {
      return emitError(socket, 'Only defender can start the match')
    }
    if (!startMatch(room)) {
      if (room.phase !== 'lobby') {
        return emitError(socket, 'Match already started')
      }
      if (!room.nodes.length) {
        return emitError(socket, 'Load the default city before starting')
      }
      return emitError(socket, 'Waiting for attacker to join')
    }
    ack({ ok: true })
    broadcastState(room)
  })

  socket.on('game:reset', (...args) => {
    const ack = resolveAck(args)
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!isDefender(socket.id, room)) {
      return emitError(socket, 'Only defender can reset the match')
    }
    resetMatch(room)
    if (typeof ack === 'function') ack({ ok: true, phase: room.phase })
    broadcastState(room)
  })

  socket.on('graph:load', ({ nodes, edges, viewport }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!canEditTopology(socket.id, room)) {
      return emitError(socket, 'Cannot load topology now')
    }
    const nextNodes = (Array.isArray(nodes) ? nodes : [])
      .map(sanitizeNode)
      .filter(Boolean)
    const nextEdges = (Array.isArray(edges) ? edges : [])
      .map(sanitizeEdge)
      .filter(Boolean)
    room.nodes = nextNodes
    room.edges = nextEdges
    if (room.phase === 'playing') {
      room.matchNodeIds = room.nodes.map((n) => n.id)
      room.matchEdgeIds = room.edges.map((e) => e.id)
      room.hackSimulator = buildAttackLayerFromGraph(room.nodes, room.edges)
    }
    if (viewport && typeof viewport === 'object') {
      room.viewport = {
        x: Number(viewport.x ?? 0),
        y: Number(viewport.y ?? 0),
        zoom: Number(viewport.zoom ?? 1),
      }
    }
    if (typeof ack === 'function') ack({ ok: true })
    tryAutoStartMatch(room)
    syncWithTelemetry(room)
  })

  socket.on('graph:addNode', ({ node }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    const n = sanitizeNode(node)
    if (!n) return emitError(socket, 'Invalid node')
    if (!canAddNode(socket.id, room, n)) {
      return emitError(socket, 'Cannot add this node')
    }
    if (room.nodes.some((x) => x.id === n.id)) {
      return emitError(socket, 'Node already exists')
    }
    room.nodes.push(n)
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:updateNode', ({ nodeId, patch, position }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    const idx = room.nodes.findIndex((n) => n.id === nodeId)
    if (idx < 0) return emitError(socket, 'Node not found')

    const node = room.nodes[idx]
    const isInjected = runtimeStateOf(node.data).provenance === 'injected'

    if (room.phase === 'lobby') {
      if (!isDefender(socket.id, room)) {
        return emitError(socket, 'Defender edits topology in lobby')
      }
    } else if (room.phase === 'playing') {
      const p = patch ?? {}
      const labelOnly =
        Object.keys(p).length <= 2 &&
        (p.label !== undefined || p.quarantined !== undefined)
      if (isDefender(socket.id, room)) {
        if (canDefenderSetBaseline(socket.id, room) && isNodeMetricPatch(p)) {
          applyDefenderNodeBaseline(room, nodeId, p)
          if (typeof ack === 'function') ack({ ok: true })
          syncWithTelemetry(room)
          return
        }
        if (!labelOnly && !p.quarantined) {
          return emitError(socket, 'Defender can only quarantine during play')
        }
      } else if (isAttacker(socket.id, room)) {
        if (!isInjected && (p.label !== undefined || position)) {
          return emitError(socket, 'Attacker cannot edit defender nodes')
        }
        if (!isInjected && !canEditSim(socket.id, room)) {
          const hasDataPatch = Object.keys(p).some(
            (k) => k !== 'quarantined' && k !== 'provenance'
          )
          if (hasDataPatch && position) {
            return emitError(socket, 'Cannot edit this node')
          }
        }
      } else {
        return emitError(socket, 'Not allowed')
      }
    }

    if (position) {
      room.nodes[idx] = {
        ...room.nodes[idx],
        position: {
          x: Number(position.x ?? room.nodes[idx].position.x),
          y: Number(position.y ?? room.nodes[idx].position.y),
        },
      }
    }
    if (patch && typeof patch === 'object') {
      const prev = room.nodes[idx].data ?? {}
      const incoming = { ...patch }
      delete incoming.intrinsicTrust
      if (incoming.behaviour && typeof incoming.behaviour === 'object') {
        const { intrinsicTrust: _drop, ...restBehaviour } = incoming.behaviour
        incoming.behaviour = restBehaviour
      }
      let data = { ...prev, ...incoming }
      if (incoming.behaviour && typeof incoming.behaviour === 'object') {
        data.behaviour = { ...(prev.behaviour ?? {}), ...incoming.behaviour }
      }
      const metricPatch = normalizeMetricPatch(patch)
      if (Object.keys(metricPatch).length > 0) {
        data.telemetry = { ...telemetryOf(prev), ...metricPatch }
        for (const k of NODE_METRIC_KEYS) delete data[k]
      }
      if (patch.quarantined !== undefined || patch.provenance !== undefined || patch.runtimeState) {
        data.runtimeState = {
          ...runtimeStateOf(prev),
          ...(patch.runtimeState && typeof patch.runtimeState === 'object'
            ? patch.runtimeState
            : {}),
          ...(patch.quarantined !== undefined
            ? { quarantined: patch.quarantined === true }
            : {}),
          ...(patch.provenance !== undefined
            ? {
              provenance:
                patch.provenance === 'injected' ? 'injected' : 'legitimate',
            }
            : {}),
        }
        delete data.quarantined
        delete data.provenance
      }
      room.nodes[idx] = {
        ...room.nodes[idx],
        data,
      }
    }
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:deleteNode', ({ nodeId }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!canDeleteNode(socket.id, room, nodeId)) {
      return emitError(socket, 'Cannot delete this node')
    }
    room.nodes = room.nodes.filter((n) => n.id !== nodeId)
    room.edges = room.edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId
    )
    invalidateSpreadLocksForNode(room, nodeId)
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:addEdge', ({ edge }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!canConnect(socket.id, room)) {
      return emitError(socket, 'Cannot add connection')
    }
    const e = sanitizeEdge(edge)
    if (!e) return emitError(socket, 'Invalid edge')
    if (!room.nodes.some((n) => n.id === e.source)) {
      return emitError(socket, 'Unknown source node')
    }
    if (!room.nodes.some((n) => n.id === e.target)) {
      return emitError(socket, 'Unknown target node')
    }
    if (room.edges.some((x) => x.id === e.id)) {
      return emitError(socket, 'Edge already exists')
    }
    room.edges.push(e)
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:updateEdge', ({ edgeId, patch }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    const idx = room.edges.findIndex((e) => e.id === edgeId)
    if (idx < 0) return emitError(socket, 'Edge not found')

    if (room.phase === 'lobby') {
      if (!isDefender(socket.id, room)) {
        return emitError(socket, 'Defender edits topology in lobby')
      }
    } else if (room.phase === 'playing') {
      if (isDefender(socket.id, room)) {
        if (patch?.packetsPerSecond !== undefined) {
          applyDefenderEdgeBaseline(room, edgeId, patch.packetsPerSecond)
          if (typeof ack === 'function') ack({ ok: true })
          syncWithTelemetry(room)
          return
        }
        return emitError(socket, 'Defender can only update link telemetry during play')
      }
      if (!isAttacker(socket.id, room)) {
        return emitError(socket, 'Attacker edits links during play')
      }
    }

    if (patch && typeof patch === 'object') {
      const dataPatch = {}
      if (patch.label !== undefined) dataPatch.label = String(patch.label)
      if (patch.packetsPerSecond !== undefined) {
        dataPatch.packetsPerSecond = Math.max(0, Number(patch.packetsPerSecond) || 0)
      }
      room.edges[idx] = {
        ...room.edges[idx],
        data: { ...room.edges[idx].data, ...dataPatch },
      }
    }
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:deleteEdge', ({ edgeId }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!canDeleteEdge(socket.id, room)) {
      return emitError(socket, 'Cannot remove this link')
    }
    room.edges = room.edges.filter((e) => e.id !== edgeId)
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:nodeChanges', ({ changes }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!isDefender(socket.id, room)) {
      if (typeof ack === 'function') ack({ ok: false })
      return
    }
    for (const ch of Array.isArray(changes) ? changes : []) {
      if (ch.type === 'position' && ch.id) {
        const idx = room.nodes.findIndex((n) => n.id === ch.id)
        if (idx >= 0 && ch.position) {
          room.nodes[idx] = {
            ...room.nodes[idx],
            position: {
              x: Number(ch.position.x ?? 0),
              y: Number(ch.position.y ?? 0),
            },
          }
        }
      }
    }
    if (typeof ack === 'function') ack({ ok: true })
    broadcastState(room)
  })

  socket.on('graph:setViewport', ({ viewport }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return
    if (viewport) {
      room.viewport = {
        x: Number(viewport.x ?? 0),
        y: Number(viewport.y ?? 0),
        zoom: Number(viewport.zoom ?? 1),
      }
    }
    if (typeof ack === 'function') ack({ ok: true })
    broadcastState(room)
  })

  socket.on('sim:patch', ({ hackSimulator }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!canEditSim(socket.id, room)) {
      return emitError(socket, 'Scenario edits not allowed for your role now')
    }
    const sanitized = sanitizeHackSimulator(hackSimulator)
    const priorMode = normalizeAttackSpreadMode(room.hackSimulator?.attackSpreadMode)
    if (isDefender(socket.id, room)) {
      room.hackSimulator = {
        ...room.hackSimulator,
        active: sanitized.active,
        nodeScenarioBaselines:
          sanitized.nodeScenarioBaselines ?? room.hackSimulator.nodeScenarioBaselines,
        edgeScenarioBaselines:
          sanitized.edgeScenarioBaselines ?? room.hackSimulator.edgeScenarioBaselines,
        attackSpreadMode: priorMode,
      }
    } else {
      // Strip overrides aimed at quarantined nodes so stale client patches cannot
      // undo Response Console / defender isolation.
      const nodeOverrides = { ...(sanitized.nodeOverrides ?? {}) }
      for (const n of room.nodes ?? []) {
        if (runtimeStateOf(n?.data).quarantined === true) {
          delete nodeOverrides[n.id]
        }
      }
      const nextEdges = Object.keys(sanitized.edgeOverrides ?? {})
      room.hackSimulator = {
        ...sanitized,
        nodeOverrides,
        attackSpreadMode: priorMode,
      }
      const nextIds = Object.keys(nodeOverrides)
      if (nextIds.length === 0 && nextEdges.length === 0) {
        // Clear attack overrides only. Do not lift quarantine here —
        // campaign:abort / Clear attacks is the explicit full reset.
        room.hackSimulator = {
          ...room.hackSimulator,
          nodeOverrides: {},
          edgeOverrides: {},
          attackSpreadMode: priorMode,
        }
      } else {
        attachOverrideNodes(room, nextIds)
      }
    }
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('campaign:manual', (...args) => {
    const ack = resolveAck(args)
    const payload =
      typeof args[0] === 'object' && args[0] !== null && typeof args[0] !== 'function'
        ? args[0]
        : {}
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!isAttacker(socket.id, room) || room.phase !== 'playing') {
      return emitError(socket, 'Only the attacker can apply a campaign stage during play')
    }
    const nodeId = String(payload.nodeId ?? '')
    const presetId = payload.presetId
    const result = applyManualPreset(room, nodeId, presetId)
    if (!result.ok) return emitError(socket, result.message)
    ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('attack:spread', (...args) => {
    const ack = resolveAck(args)
    const payload =
      typeof args[0] === 'object' && args[0] !== null && typeof args[0] !== 'function'
        ? args[0]
        : {}
    const room = getSocketRoom(socket)
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Not in a room' })
      return emitError(socket, 'Not in a room')
    }
    if (!isAttacker(socket.id, room) || room.phase !== 'playing') {
      const message = 'Only the attacker can spread an attack during play'
      if (typeof ack === 'function') ack({ ok: false, message })
      return emitError(socket, message)
    }
    const result = spreadAttack(room, {
      sourceNodeId: payload.sourceNodeId,
      targetNodeId: payload.targetNodeId,
      presetId: payload.presetId,
    })
    if (!result.ok) {
      if (typeof ack === 'function') ack({ ok: false, message: result.message })
      return emitError(socket, result.message)
    }
    if (typeof ack === 'function') {
      ack({
        ok: true,
        sourceNodeId: result.sourceNodeId,
        targetNodeId: result.targetNodeId,
        edgeId: result.edgeId,
        presetId: result.presetId,
      })
    }
    syncWithTelemetry(room)
  })

  socket.on('campaign:abort', (...args) => {
    const ack = resolveAck(args)
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!isAttacker(socket.id, room) || room.phase !== 'playing') {
      return emitError(socket, 'Only the attacker can clear attack overrides during play')
    }
    abortAndClearAttacks(room)
    ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('defender:quarantine', ({ nodeId, quarantined }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!canQuarantine(socket.id, room)) {
      return emitError(socket, 'Cannot quarantine')
    }
    const result = setNodeQuarantined(room, nodeId, quarantined !== false)
    if (!result.ok) return emitError(socket, 'Node not found')
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('attack:setSpreadMode', (...args) => {
    const ack = resolveAck(args)
    const payload =
      typeof args[0] === 'object' && args[0] !== null && typeof args[0] !== 'function'
        ? args[0]
        : {}
    const room = getSocketRoom(socket)
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Not in a room' })
      return emitError(socket, 'Not in a room')
    }
    if (!isAttacker(socket.id, room)) {
      const message = 'Only the attacker can set attack spread mode'
      if (typeof ack === 'function') ack({ ok: false, message })
      return emitError(socket, message)
    }
    if (room.phase !== 'playing') {
      const message = 'Spread mode can only be changed during play'
      if (typeof ack === 'function') ack({ ok: false, message })
      return emitError(socket, message)
    }
    const mode = payload.mode
    if (!isAttackSpreadMode(mode)) {
      const message = 'Invalid attack spread mode'
      if (typeof ack === 'function') ack({ ok: false, message })
      return emitError(socket, message)
    }
    const sim = room.hackSimulator ?? { ...DEFAULT_HACK_SIMULATOR }
    room.hackSimulator = {
      ...sim,
      attackSpreadMode: normalizeAttackSpreadMode(mode),
    }
    if (typeof ack === 'function') {
      ack({ ok: true, attackSpreadMode: room.hackSimulator.attackSpreadMode })
    }
    // Mode change alone must not force an immediate spread burst; next tick evaluates.
    broadcastState(room)
  })

  socket.on('disconnect', () => {
    const roomId = socketRoom.get(socket.id)
    socketRoom.delete(socket.id)
    if (!roomId) return
    const room = getRoom(roomId)
    if (!room) return
    if (room.players.defender === socket.id) room.players.defender = null
    if (room.players.attacker === socket.id) room.players.attacker = null
    const deleted = deleteRoomIfEmpty(roomId)
    if (deleted) {
      teardownRoomTelemetry(roomId)
      deleteTgnnCalibrator(roomId)
      return
    }
    broadcastState(room)
  })
})

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Stop the other server: lsof -i :${PORT} then kill <pid>`
    )
    process.exit(1)
  }
  throw err
})

httpServer.listen(PORT, HOST, () => {
  console.log(`TrustNetAI game server on http://${HOST}:${PORT}`)
})
