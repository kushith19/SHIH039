/**
 * LLM Commander client — planner only.
 * Direct Ollama POST /api/chat (one planner generation). Never executes actions.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildLlmCommanderPromptPayload,
  buildPlannerRagQuery,
  emptyRetrievedKnowledge,
  estimateCommanderPromptTokens,
  knowledgeContextToRetrievedKnowledge,
  llmResponsePlanEnabled,
  LLM_COMMANDER_MERGED_SYSTEM_PROMPT,
  parseAndValidateLlmCommanderPlan,
  logCommanderPlanningInput,
  logCommanderRaw,
  logCommanderParsed,
  logCommanderFinalPlan,
  summarizeRetrievedKnowledgeForDebug,
} from '../../shared/response/llmCommanderPlan.js'
import { fetchKnowledgeContext } from '../commander/client.js'

const AI_COMMANDER_URL = process.env.AI_COMMANDER_URL ?? 'http://localhost:8000'
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct'
export const OLLAMA_NUM_CTX = 8192
export const OLLAMA_NUM_PREDICT = 1024
const PLAN_TIMEOUT_MS = Number(process.env.LLM_PLAN_TIMEOUT_MS ?? 90_000) || 90_000

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data')
const LAST_PLAN_PATH = path.join(DATA_DIR, 'llm-commander-last-plan.json')
export const LLM_RESPONSE_TXT_PATH = path.join(DATA_DIR, 'LLM_RESPONSE.txt')

export { llmResponsePlanEnabled }

/** @type {null | ((payload: object) => Promise<unknown>)} */
let testCaller = null

/**
 * Optional RAG override for tests. When null and testCaller is set, RAG is
 * skipped (offline). Production always uses fetchKnowledgeContext.
 * @type {null | ((args: object) => Promise<object>)}
 */
let testRagFetcher = null

let sessionId = null

function emptyDebugRecord() {
  return {
    sessionId,
    requestId: null,
    startedAt: null,
    completedAt: null,
    timestamp: null,
    status: 'none',
    model: OLLAMA_MODEL,
    url: `${OLLAMA_URL}/api/chat`,
    incidentId: null,
    attackPreset: null,
    availableActionIds: [],
    actionCount: 0,
    promptChars: null,
    estimatedTokens: null,
    httpStatus: null,
    durationMs: null,
    doneReason: null,
    promptEvalCount: null,
    evalCount: null,
    rawResponseChars: null,
    inputContext: null,
    rawResponse: null,
    parsedResponse: null,
    parsedActions: [],
    validatedResponse: null,
    validationResult: null,
    validation: null,
    finalPlan: null,
    error: null,
    fallbackUsed: false,
    ollamaError: null,
    ragUsed: false,
    ragChunkCount: 0,
    ragSources: [],
    ragQuery: null,
    ragStatus: null,
  }
}

let lastLlmResponse = emptyDebugRecord()
let debugRecord = { ...lastLlmResponse }

export function getLastLlmResponse() {
  return lastLlmResponse
}

export function recordLlmCommanderVisibleStatus(message) {
  writeVisibleLlmResponse(String(message ?? ''))
}

export function setLlmCommanderTestCaller(fn) {
  testCaller = typeof fn === 'function' ? fn : null
}

export function clearLlmCommanderTestCaller() {
  testCaller = null
}

export function setLlmCommanderRagFetcher(fn) {
  testRagFetcher = typeof fn === 'function' ? fn : null
}

export function clearLlmCommanderRagFetcher() {
  testRagFetcher = null
}

/**
 * Soft-fail RAG enrichment for the Orchestrate Planner.
 * Reuses existing POST /commander/knowledge via fetchKnowledgeContext.
 */
async function retrievePlannerRagKnowledge(context, { room = null } = {}) {
  const incidentId = context?.incidentId ?? context?.liveIncidentId ?? null
  say(`[PLANNER] incident=${incidentId ?? ''}`)
  say('[PLANNER] RAG retrieval started')

  let query = null
  try {
    const planned = buildPlannerRagQuery(context, { room })
    query = planned.query
    say(`[PLANNER] RAG query=${query}`)

    let knowledge
    if (testRagFetcher) {
      knowledge = await testRagFetcher({
        query,
        hints: planned.hints,
        context,
        room,
        incidentId,
      })
    } else if (testCaller) {
      // Injected LLM tests stay offline unless RAG is explicitly mocked.
      knowledge = {
        retrieved: false,
        reason: 'RAG skipped for injected LLM test',
        knowledgeStatus: 'unavailable',
        attackUnderstanding: [],
        relevantKnowledge: [],
        preventionGuidance: [],
        sources: [],
        queries: [],
      }
    } else {
      knowledge = await fetchKnowledgeContext({
        query,
        hints: planned.hints,
        incidentId,
        fingerprint: `planner:${incidentId ?? 'none'}:${query}`,
      })
    }

    const retrievedKnowledge = knowledgeContextToRetrievedKnowledge(knowledge, query)
    const debug = summarizeRetrievedKnowledgeForDebug(retrievedKnowledge)
    say(`[PLANNER] RAG retrieved=${debug.ragChunkCount} chunks`)
    for (const src of debug.ragSources) {
      say(
        `[PLANNER] RAG source=${src.source ?? ''} document=${src.documentName ?? ''} category=${src.category ?? ''}`
      )
    }
    if (!debug.ragUsed) {
      say('[PLANNER] RAG retrieval returned no usable chunks; continuing without RAG')
    }
    return { retrievedKnowledge, ...debug, ragStatus: retrievedKnowledge.status }
  } catch (err) {
    say(
      `[PLANNER] RAG retrieval failed; continuing without RAG (${err?.message ?? err})`
    )
    const retrievedKnowledge = emptyRetrievedKnowledge(
      'No relevant authoritative knowledge was retrieved.',
      query
    )
    return {
      retrievedKnowledge,
      ...summarizeRetrievedKnowledgeForDebug(retrievedKnowledge),
      ragStatus: 'unavailable',
    }
  }
}

function say(msg) {
  console.log(msg)
}

function llmLine(marker, extra = '') {
  say(extra ? `${marker} ${extra}` : marker)
}

function newRequestId() {
  return `llm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function writeVisibleLlmResponse(text) {
  const body = String(text ?? '')
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(LLM_RESPONSE_TXT_PATH, body.endsWith('\n') ? body : `${body}\n`, 'utf8')
  } catch (err) {
    console.error('[LLM COMMANDER] FAILED to write LLM_RESPONSE.txt', err)
  }
}

function stampPlanFile(patch) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const reset = patch?.status === 'planning_started' || patch?.status === 'session_reset'
    const doc = {
      ...(reset ? emptyDebugRecord() : debugRecord),
      ...patch,
      sessionId: patch?.sessionId ?? sessionId ?? debugRecord.sessionId,
      timestamp: new Date().toISOString(),
    }
    delete doc.raw
    delete doc.actions
    delete doc.notes
    delete doc.summary
    debugRecord = doc
    lastLlmResponse = doc
    writeFileSync(LAST_PLAN_PATH, JSON.stringify(doc, null, 2), 'utf8')
    const txtLines = [
      `requestId=${doc.requestId ?? ''}`,
      `status=${doc.status ?? ''}`,
      `model=${doc.model ?? ''}`,
      `startedAt=${doc.startedAt ?? ''}`,
      `completedAt=${doc.completedAt ?? ''}`,
      `httpStatus=${doc.httpStatus ?? ''}`,
      `durationMs=${doc.durationMs ?? ''}`,
      `doneReason=${doc.doneReason ?? ''}`,
      `error=${doc.error ?? ''}`,
      '',
      typeof doc.rawResponse === 'string' ? doc.rawResponse : JSON.stringify(doc.rawResponse ?? null, null, 2),
      '',
    ]
    writeFileSync(LLM_RESPONSE_TXT_PATH, `${txtLines.join('\n')}\n`, 'utf8')
  } catch (err) {
    console.error('[LLM COMMANDER] FAILED to stamp plan files', err)
  }
}

export function recordLlmCommanderSkipped(reason, {
  incidentId = null,
  availableActionIds = [],
  code = 'SKIPPED',
  requestId = null,
} = {}) {
  const message = String(reason || 'Unknown reason')
  llmLine('[LLM ERROR]', `code=${code} ${message}`)
  stampPlanFile({
    status: code,
    requestId,
    incidentId,
    availableActionIds,
    completedAt: new Date().toISOString(),
    inputContext: null,
    rawResponse: null,
    parsedResponse: null,
    parsedActions: [],
    validatedResponse: null,
    validationResult: null,
    validation: { ok: false, code, error: message },
    finalPlan: null,
    error: message,
  })
}

export function recordLlmCommanderFinalPlan(plan) {
  const actionIds = (plan?.recommendedActions ?? [])
    .filter((action) => action?.executable === true)
    .map((action) => action.actionId)
  llmLine(
    '[LLM FINAL PLAN]',
    `actions=${JSON.stringify(actionIds)} status=${plan ? 'AWAITING_APPROVAL' : 'unknown'} execution=null`
  )
  say('[LLM RESPONSE PLAN] PLAN CREATED')
  say(`requestId=${debugRecord.requestId ?? ''}`)
  say(`incidentId=${debugRecord.incidentId ?? plan?.primaryIncidentId ?? ''}`)
  say(`actions=${JSON.stringify(actionIds)}`)
  logCommanderFinalPlan(plan)
  stampPlanFile({
    status: 'plan_ready',
    completedAt: new Date().toISOString(),
    finalPlan: plan ?? null,
    error: null,
  })
}

export function recordLlmCommanderPlanningError(reason, {
  code = 'PLAN_ASSEMBLY_FAILED',
} = {}) {
  const message = String(reason || 'LLM Commander planning failed')
  llmLine('[LLM ERROR]', `code=${code} ${message}`)
  stampPlanFile({
    status: 'failed',
    code,
    completedAt: new Date().toISOString(),
    validationResult: debugRecord.validationResult,
    validation: { ok: false, code, error: message },
    finalPlan: null,
    error: message,
  })
}

function classifyFetchError(err) {
  const msg = String(err?.message ?? err)
  if (
    err?.name === 'AbortError' ||
    err?.code === 'ABORT_ERR' ||
    /timeout|timed out|aborted/i.test(msg)
  ) {
    return 'LLM_TIMEOUT'
  }
  if (err?.code === 'OLLAMA_HTTP_ERROR' || /^\d{3}\s/.test(msg)) {
    return 'OLLAMA_HTTP_ERROR'
  }
  if (err?.code === 'MALFORMED_JSON') return 'MALFORMED_JSON'
  return 'LLM_UNAVAILABLE'
}

async function fetchJson(url, { body, timeoutMs, method = 'POST', control = false } = {}) {
  if (control) {
    say(`[LLM CONTROL] ${method} ${url}`)
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      const err = new Error(`${res.status} ${text.slice(0, 240)}`)
      err.code = 'OLLAMA_HTTP_ERROR'
      err.httpStatus = res.status
      throw err
    }
    try {
      return { status: res.status, data: text ? JSON.parse(text) : {}, text }
    } catch {
      const err = new Error('Malformed Ollama JSON envelope')
      err.code = 'MALFORMED_JSON'
      err.httpStatus = res.status
      throw err
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The ONLY Ollama planner HTTP call. Logs wrap this fetch(), not a UI wrapper.
 */
async function postOllamaChat(body, {
  promptChars,
  estimatedTokens,
  timeoutMs,
  requestId = '',
  incidentId = '',
} = {}) {
  const url = `${OLLAMA_URL}/api/chat`
  say('[LLM RESPONSE PLAN] REQUEST SENT')
  say(`requestId=${requestId}`)
  say(`incidentId=${incidentId}`)
  say(`model=${OLLAMA_MODEL}`)
  say(`url=${url}`)
  say(`promptChars=${promptChars}`)
  say(`estimatedTokens=${estimatedTokens}`)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const started = Date.now()
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (err) {
    say(`[LLM RESPONSE PLAN] ERROR=${err?.message ?? err}`)
    say('[LLM RESPONSE PLAN] ERROR_STAGE=request')
    const wrapped = new Error(String(err?.message ?? err))
    wrapped.code = classifyFetchError(err)
    throw wrapped
  } finally {
    clearTimeout(timer)
  }

  const durationMs = Date.now() - started
  let text = ''
  try {
    text = await res.text()
  } catch (err) {
    say('[LLM RESPONSE PLAN] RESPONSE RECEIVED')
    say(`requestId=${requestId}`)
    say(`incidentId=${incidentId}`)
    say(`httpStatus=${res.status}`)
    say(`durationMs=${durationMs}`)
    say('doneReason=n/a')
    say('responseChars=0')
    say('promptEvalCount=n/a')
    say('evalCount=n/a')
    say(`[LLM RESPONSE PLAN] ERROR=${err?.message ?? err}`)
    say('[LLM RESPONSE PLAN] ERROR_STAGE=response')
    const wrapped = new Error(String(err?.message ?? err))
    wrapped.code = 'OLLAMA_HTTP_ERROR'
    wrapped.httpStatus = res.status
    throw wrapped
  }

  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    say('[LLM RESPONSE PLAN] RESPONSE RECEIVED')
    say(`requestId=${requestId}`)
    say(`incidentId=${incidentId}`)
    say(`httpStatus=${res.status}`)
    say(`durationMs=${durationMs}`)
    say('doneReason=n/a')
    say(`responseChars=${text.length}`)
    say('promptEvalCount=n/a')
    say('evalCount=n/a')
    say('[LLM RESPONSE PLAN] ERROR=Malformed Ollama JSON envelope')
    say('[LLM RESPONSE PLAN] ERROR_STAGE=parse')
    const err = new Error('Malformed Ollama JSON envelope')
    err.code = 'MALFORMED_JSON'
    err.httpStatus = res.status
    throw err
  }

  const content = data?.message?.content ?? null
  const doneReason = data?.done_reason ?? data?.doneReason ?? null
  const promptEvalCount = data?.prompt_eval_count ?? null
  const evalCount = data?.eval_count ?? null
  const rawChars = typeof content === 'string' ? content.length : 0

  say('[LLM RESPONSE PLAN] RESPONSE RECEIVED')
  say(`requestId=${requestId}`)
  say(`incidentId=${incidentId}`)
  say(`httpStatus=${res.status}`)
  say(`durationMs=${durationMs}`)
  say(`doneReason=${doneReason ?? 'n/a'}`)
  say(`responseChars=${rawChars}`)
  say(`promptEvalCount=${promptEvalCount ?? 'n/a'}`)
  say(`evalCount=${evalCount ?? 'n/a'}`)

  if (!res.ok) {
    const msg = `${res.status} ${text.slice(0, 240)}`
    say(`[LLM RESPONSE PLAN] ERROR=${msg}`)
    say('[LLM RESPONSE PLAN] ERROR_STAGE=response')
    const err = new Error(msg)
    err.code = 'OLLAMA_HTTP_ERROR'
    err.httpStatus = res.status
    throw err
  }

  return {
    status: res.status,
    data,
    content,
    doneReason,
    promptEvalCount,
    evalCount,
    durationMs,
    rawChars,
  }
}

async function callCommanderPlan(payload) {
  const catalog = Array.isArray(payload?.availableActions) ? payload.availableActions : []
  const body = {
    planning_context: {
      ...payload,
      allowedActionIds: catalog.map((a) => a.actionId).filter(Boolean),
    },
  }
  const { data } = await fetchJson(`${AI_COMMANDER_URL}/commander/plan`, {
    timeoutMs: PLAN_TIMEOUT_MS,
    body,
  })
  if (Array.isArray(data?.actions)) {
    return {
      summary: data.summary ?? null,
      attackInterpretation: data.attackInterpretation ?? null,
      strategy: data.strategy ?? null,
      actions: data.actions,
      riskAssessment: data.riskAssessment ?? null,
      confidence: data.confidence ?? null,
      uncertainty: data.uncertainty ?? null,
      raw: data.raw ?? null,
      provider: data.provider ?? 'ai-com-v1',
    }
  }
  if (typeof data?.raw === 'string' && data.raw.trim()) {
    return data.raw
  }
  if (typeof data?.content === 'string') {
    return data.content
  }
  return data
}

/** Exact requested model only. qwen2.5:7b is NOT qwen2.5:7b-instruct. */
export function ollamaRunnerIsRequestedModel(entry, model = OLLAMA_MODEL) {
  const name = String(entry?.name ?? entry?.model ?? '')
  const want = String(model ?? '')
  if (!name || !want) return false
  return name === want || name === `${want}:latest`
}

function contextFromPsEntry(entry) {
  const candidates = [
    entry?.context_length,
    entry?.context,
    entry?.details?.context_length,
  ]
  for (const value of candidates) {
    const n = Number(value)
    if (Number.isFinite(n) && n >= 512 && n <= 131072) return n
  }
  return null
}

async function listOllamaPs() {
  const { data } = await fetchJson(`${OLLAMA_URL}/api/ps`, {
    method: 'GET',
    timeoutMs: 8_000,
    control: true,
  })
  return Array.isArray(data?.models) ? data.models : []
}

async function unloadOllamaModel() {
  say(`[LLM CONTROL] unload ${OLLAMA_MODEL} for num_ctx=${OLLAMA_NUM_CTX}`)
  try {
    await fetchJson(`${OLLAMA_URL}/api/generate`, {
      timeoutMs: 30_000,
      control: true,
      body: {
        model: OLLAMA_MODEL,
        prompt: '',
        keep_alive: 0,
      },
    })
  } catch (err) {
    say(`[LLM CONTROL] unload generate failed (${err?.message ?? err}) — chat keep_alive=0`)
    await fetchJson(`${OLLAMA_URL}/api/chat`, {
      timeoutMs: 30_000,
      control: true,
      body: {
        model: OLLAMA_MODEL,
        messages: [],
        keep_alive: 0,
      },
    })
  }
  for (let i = 0; i < 25; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const models = await listOllamaPs().catch(() => [])
    if (!models.some((entry) => ollamaRunnerIsRequestedModel(entry, OLLAMA_MODEL))) {
      return
    }
  }
}

/**
 * Unload the exact requested model only when its loaded context is too small or unknown.
 * Does not treat sibling tags (qwen2.5:7b vs qwen2.5:7b-instruct) as the same runner.
 * One unload per Analyze, then a single planner /api/chat.
 */
export async function ensureOllamaRunnerContext(requestedCtx = OLLAMA_NUM_CTX) {
  let models = []
  try {
    models = await listOllamaPs()
  } catch (err) {
    say(`[LLM CONTROL] /api/ps unavailable (${err?.message ?? err}) — proceeding with /api/chat`)
    return { loadedContext: null, unloaded: false }
  }
  const running = models.find((entry) => ollamaRunnerIsRequestedModel(entry, OLLAMA_MODEL))
  if (!running) {
    say(`[LLM CONTROL] ${OLLAMA_MODEL} not loaded; /api/chat will allocate num_ctx=${requestedCtx}`)
    return { loadedContext: null, unloaded: false }
  }
  const loadedContext = contextFromPsEntry(running)
  const tooSmall = loadedContext != null && loadedContext < requestedCtx
  const unknown = loadedContext == null
  if (tooSmall || unknown) {
    say(
      `[LLM CONTROL] ${OLLAMA_MODEL} context=${loadedContext ?? 'unknown'} requested=${requestedCtx} — unload once`
    )
    try {
      await unloadOllamaModel()
    } catch (err) {
      say(`[LLM CONTROL] unload failed (${err?.message ?? err}) — still sending one /api/chat`)
      return { loadedContext, unloaded: false, previousContext: loadedContext }
    }
    return { loadedContext: null, unloaded: true, previousContext: loadedContext }
  }
  say(`[LLM CONTROL] ${OLLAMA_MODEL} already at context=${loadedContext}`)
  return { loadedContext, unloaded: false }
}

async function readConfiguredContextAfterChat() {
  try {
    const models = await listOllamaPs()
    const running = models.find((entry) => ollamaRunnerIsRequestedModel(entry, OLLAMA_MODEL))
    return running ? contextFromPsEntry(running) : null
  } catch {
    return null
  }
}

async function callOllamaPlan(payload, meta = {}) {
  const url = `${OLLAMA_URL}/api/chat`
  const userContent = JSON.stringify(payload)
  const promptChars =
    LLM_COMMANDER_MERGED_SYSTEM_PROMPT.length + userContent.length
  const estimatedTokens = estimateCommanderPromptTokens(
    LLM_COMMANDER_MERGED_SYSTEM_PROMPT,
    payload
  )
  const started = Date.now()
  llmLine('[LLM REQUEST START]', [
    `requestId=${meta.requestId ?? ''}`,
    `model=${OLLAMA_MODEL}`,
    `url=${url}`,
    `incident=${meta.incidentId ?? ''}`,
    `attackPreset=${meta.attackPreset ?? ''}`,
    `actionCount=${meta.actionCount ?? 0}`,
    `promptChars=${promptChars}`,
    `estimatedTokens=${estimatedTokens}`,
  ].join(' '))
  const preload = await ensureOllamaRunnerContext(OLLAMA_NUM_CTX)
  stampPlanFile({
    status: 'calling_ollama',
    source: 'ollama-direct',
    model: OLLAMA_MODEL,
    url,
    promptChars,
    estimatedTokens,
    requestedContext: OLLAMA_NUM_CTX,
    configuredContext: preload.loadedContext,
    numPredict: OLLAMA_NUM_PREDICT,
  })

  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    format: 'json',
    keep_alive: '5m',
    options: {
      temperature: 0,
      num_ctx: OLLAMA_NUM_CTX,
      num_predict: OLLAMA_NUM_PREDICT,
    },
    messages: [
      {
        role: 'system',
        content: LLM_COMMANDER_MERGED_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
  }
  llmLine('[LLM REQUEST SENT]', `requestId=${meta.requestId ?? ''} POST ${url}`)

  const ollama = await postOllamaChat(body, {
    promptChars,
    estimatedTokens,
    timeoutMs: PLAN_TIMEOUT_MS,
    requestId: meta.requestId ?? '',
    incidentId: meta.incidentId ?? '',
  })
  const status = ollama.status
  const durationMs = ollama.durationMs ?? Date.now() - started
  const configuredContext = await readConfiguredContextAfterChat()
  const content = ollama.content ?? null
  const doneReason = ollama.doneReason ?? null
  const promptEvalCount = ollama.promptEvalCount ?? null
  const evalCount = ollama.evalCount ?? null
  const rawChars = ollama.rawChars ?? (typeof content === 'string' ? content.length : 0)
  llmLine(
    '[LLM RESPONSE RECEIVED]',
    [
      `requestId=${meta.requestId ?? ''}`,
      `status=${status}`,
      `durationMs=${durationMs}`,
      `doneReason=${doneReason ?? 'n/a'}`,
      `prompt_eval_count=${promptEvalCount ?? 'n/a'}`,
      `eval_count=${evalCount ?? 'n/a'}`,
      `rawChars=${rawChars}`,
    ].join(' ')
  )
  stampPlanFile({
    status: 'ollama_raw',
    source: 'ollama-direct',
    model: OLLAMA_MODEL,
    httpStatus: status,
    durationMs,
    requestedContext: OLLAMA_NUM_CTX,
    configuredContext,
    numPredict: OLLAMA_NUM_PREDICT,
    doneReason,
    promptEvalCount,
    evalCount,
    rawResponseChars: rawChars,
    rawResponse: typeof content === 'string' ? content.slice(0, 12_000) : null,
  })
  return {
    content,
    doneReason,
    configuredContext,
    httpStatus: status,
    durationMs,
    evalCount,
    promptEvalCount,
  }
}

export async function requestLlmCommanderActions(
  context,
  { room = null, previousPlan = null, verification = null } = {}
) {
  const ragResult = await retrievePlannerRagKnowledge(context, { room })
  const payload = buildLlmCommanderPromptPayload(context, {
    room,
    previousPlan,
    verification,
    retrievedKnowledge: ragResult.retrievedKnowledge,
  })
  const requestId = newRequestId()
  const startedAt = new Date().toISOString()
  const incidentId = payload.incident?.incidentId ?? null
  const availableActionIds = (payload.availableActions ?? []).map((a) => a.actionId)
  const attackPreset = payload.attackContext?.presetId ?? null
  const promptChars =
    LLM_COMMANDER_MERGED_SYSTEM_PROMPT.length + JSON.stringify(payload).length
  const contextTokens = estimateCommanderPromptTokens(
    LLM_COMMANDER_MERGED_SYSTEM_PROMPT,
    payload
  )
  const ragUsed = ragResult.ragUsed === true
  const ragChunkCount = Number(ragResult.ragChunkCount) || 0
  const ragSources = Array.isArray(ragResult.ragSources) ? ragResult.ragSources : []
  const ragQuery = ragResult.ragQuery ?? null
  const ragStatus = ragResult.ragStatus ?? (ragUsed ? 'available' : 'unavailable')

  say('[PLANNER] sending enriched context to LLM')
  logCommanderPlanningInput(payload, {
    contextTokens,
    requestedContext: OLLAMA_NUM_CTX,
    configuredContext: 'pending',
    numPredict: OLLAMA_NUM_PREDICT,
  })

  stampPlanFile({
    status: 'planning_started',
    requestId,
    startedAt,
    source: null,
    incidentId,
    attackPreset,
    availableActionIds,
    actionCount: availableActionIds.length,
    promptChars,
    estimatedTokens: contextTokens,
    inputContext: payload,
    contextTokens,
    requestedContext: OLLAMA_NUM_CTX,
    numPredict: OLLAMA_NUM_PREDICT,
    model: OLLAMA_MODEL,
    url: `${OLLAMA_URL}/api/chat`,
    rawResponse: null,
    parsedActions: [],
    validationResult: null,
    validation: null,
    finalPlan: null,
    error: null,
    fallbackUsed: false,
    ollamaError: null,
    ragUsed,
    ragChunkCount,
    ragSources,
    ragQuery,
    ragStatus,
  })

  if (!Array.isArray(availableActionIds) || availableActionIds.length === 0) {
    llmLine('[LLM ANALYZE]', 'result=NO_AVAILABLE_ACTIONS')
    llmLine('[LLM ERROR]', 'code=NO_AVAILABLE_ACTIONS No executable repository actions')
    stampPlanFile({
      status: 'failed',
      requestId,
      completedAt: new Date().toISOString(),
      error: 'No executable repository actions for LLM to select',
      code: 'NO_AVAILABLE_ACTIONS',
      ragUsed,
      ragChunkCount,
      ragSources,
      ragQuery,
      ragStatus,
      validationResult: {
        ok: false,
        code: 'NO_AVAILABLE_ACTIONS',
        error: 'No executable repository actions for LLM to select',
      },
      validation: {
        ok: false,
        code: 'NO_AVAILABLE_ACTIONS',
        error: 'No executable repository actions for LLM to select',
      },
    })
    return {
      ok: false,
      error: 'No executable repository actions for LLM to select',
      code: 'NO_AVAILABLE_ACTIONS',
      actions: [],
    }
  }

  let raw
  let source = 'ollama-direct'
  let doneReason = null
  let configuredContext = null
  let httpStatus = null
  let durationMs = null
  let promptEvalCount = null
  let evalCount = null
  try {
    if (testCaller) {
      source = 'test'
      llmLine(
        '[LLM REQUEST START]',
        `requestId=${requestId} source=test model=${OLLAMA_MODEL} incident=${incidentId ?? ''} attackPreset=${attackPreset ?? ''} actionCount=${availableActionIds.length} promptChars=${promptChars} estimatedTokens=${contextTokens}`
      )
      say('[LLM PLANNER] request sent')
      llmLine('[LLM REQUEST SENT]', `requestId=${requestId} source=test`)
      const t0 = Date.now()
      raw = await testCaller(payload)
      durationMs = Date.now() - t0
      httpStatus = 'test'
      configuredContext = 'test'
      say('[LLM PLANNER] response received')
      say(`[LLM PLANNER] RAG context included=${ragUsed}`)
      llmLine(
        '[LLM RESPONSE RECEIVED]',
        `requestId=${requestId} status=test durationMs=${durationMs} doneReason=n/a`
      )
    } else {
      try {
        say('[LLM PLANNER] request sent')
        const ollama = await callOllamaPlan(payload, {
          requestId,
          incidentId,
          attackPreset,
          actionCount: availableActionIds.length,
        })
        source = 'ollama-direct'
        raw = ollama?.content ?? null
        doneReason = ollama?.doneReason ?? null
        configuredContext = ollama?.configuredContext ?? null
        httpStatus = ollama?.httpStatus ?? 200
        durationMs = ollama?.durationMs ?? null
        promptEvalCount = ollama?.promptEvalCount ?? null
        evalCount = ollama?.evalCount ?? null
        say('[LLM PLANNER] response received')
        say(`[LLM PLANNER] RAG context included=${ragUsed}`)
      } catch (ollamaErr) {
        const ollamaCode = classifyFetchError(ollamaErr)
        const ollamaMsg = String(ollamaErr?.message ?? ollamaErr)
        llmLine('[LLM ERROR]', `code=${ollamaCode} ${ollamaMsg}`)
        stampPlanFile({
          status: 'failed',
          code: ollamaCode,
          completedAt: new Date().toISOString(),
          error: ollamaMsg,
          httpStatus: ollamaErr?.httpStatus ?? null,
          ollamaError: ollamaMsg,
          fallbackUsed: false,
          ragUsed,
          ragChunkCount,
          ragSources,
          ragQuery,
          ragStatus,
          validationResult: { ok: false, code: ollamaCode, error: ollamaMsg },
          validation: { ok: false, code: ollamaCode, error: ollamaMsg },
        })
        return {
          ok: false,
          error: ollamaMsg,
          code: ollamaCode,
          actions: [],
        }
      }
    }
  } catch (err) {
    const msg = `LLM planning failed: ${err?.message ?? err}`
    const code = classifyFetchError(err)
    llmLine('[LLM ERROR]', `code=${code} ${msg}`)
    stampPlanFile({
      status: 'failed',
      code,
      completedAt: new Date().toISOString(),
      error: msg,
      httpStatus: err?.httpStatus ?? null,
      ragUsed,
      ragChunkCount,
      ragSources,
      ragQuery,
      ragStatus,
      validationResult: { ok: false, code, error: msg },
      validation: { ok: false, code, error: msg },
    })
    return {
      ok: false,
      error: msg,
      code,
      actions: [],
    }
  }

  const rawVisible =
    typeof raw === 'string' ? raw : JSON.stringify(raw ?? null)
  llmLine('[LLM RAW]', rawVisible.slice(0, 8000))
  logCommanderRaw(rawVisible)
  say('[LLM RESPONSE PLAN] RAW RESPONSE')
  say(`requestId=${requestId}`)
  say(rawVisible)
  const validated = parseAndValidateLlmCommanderPlan(raw, context, {
    source,
    room,
    doneReason,
  })
  llmLine(
    '[LLM PARSED]',
    `actions=${JSON.stringify(validated.parsedResponse?.actions ?? validated.actions ?? null)}`
  )
  logCommanderParsed(validated.parsedResponse ?? { error: validated.error, code: validated.code })
  say('[LLM RESPONSE PLAN] PARSED')
  say(`requestId=${requestId}`)
  const valid = validated.ok === true
  llmLine(
    '[LLM VALIDATED]',
    `valid=${valid}${valid ? '' : ` code=${validated.code} ${validated.error}`}`
  )
  say('[LLM RESPONSE PLAN] VALIDATED')
  say(`requestId=${requestId}`)
  say(`valid=${valid}`)
  if (!valid) {
    const parseStage =
      validated.code === 'MALFORMED_JSON' ||
      validated.code === 'TRUNCATED_JSON' ||
      validated.code === 'EMPTY_RESPONSE'
        ? 'parse'
        : 'validation'
    say(`[LLM RESPONSE PLAN] ERROR=${validated.error || validated.code}`)
    say(`[LLM RESPONSE PLAN] ERROR_STAGE=${parseStage}`)
    const errorCode =
      validated.code === 'MALFORMED_JSON' ||
      validated.code === 'TRUNCATED_JSON' ||
      validated.code === 'EMPTY_RESPONSE'
        ? validated.code === 'EMPTY_RESPONSE'
          ? 'MALFORMED_JSON'
          : validated.code
        : 'INVALID_PLAN'
    llmLine('[LLM ERROR]', `code=${errorCode} ${validated.error || validated.code}`)
  }

  stampPlanFile({
    status: validated.ok ? 'ok' : 'failed',
    source,
    isTest: source === 'test',
    code: validated.code ?? null,
    error: validated.error ?? null,
    completedAt: new Date().toISOString(),
    httpStatus,
    durationMs,
    requestedContext: OLLAMA_NUM_CTX,
    configuredContext,
    numPredict: OLLAMA_NUM_PREDICT,
    doneReason,
    promptEvalCount,
    evalCount,
    contextTokens,
    estimatedTokens: contextTokens,
    promptChars,
    rawResponseChars: rawVisible.length,
    rawResponse: validated.rawText ?? rawVisible,
    parsedResponse: validated.parsedResponse ?? null,
    parsedActions: validated.actions ?? [],
    validatedResponse: validated.ok
      ? {
          summary: validated.summary ?? null,
          attackInterpretation: validated.attackInterpretation ?? null,
          review: validated.review ?? null,
          strategy: validated.strategy ?? null,
          actions: validated.actions ?? [],
          riskAssessment: validated.riskAssessment ?? null,
          confidence: validated.confidence ?? null,
          uncertainty: validated.uncertainty ?? null,
        }
      : null,
    validationResult: {
      ok: validated.ok,
      code: validated.code ?? null,
      error: validated.error ?? null,
      summary: validated.summary ?? null,
      confidence: validated.confidence ?? null,
      uncertainty: validated.uncertainty ?? null,
    },
    validation: {
      ok: validated.ok,
      code: validated.code ?? null,
      error: validated.error ?? null,
    },
    ragUsed,
    ragChunkCount,
    ragSources,
    ragQuery,
    ragStatus,
  })
  return validated
}

export function logLlmCommanderBootBanner() {
  sessionId = `sess-${Date.now().toString(36)}`
  const on = llmResponsePlanEnabled()
  const startedAt = new Date().toISOString()
  stampPlanFile({
    status: 'session_reset',
    sessionId,
    requestId: null,
    startedAt,
    completedAt: startedAt,
    model: OLLAMA_MODEL,
    error: 'No Analyze yet this process',
    rawResponse: null,
  })
  say('')
  say('============================================================')
  say(`[LLM COMMANDER] session=${sessionId} LLM_RESPONSE_PLAN=${on ? 'ON' : 'OFF'}`)
  say(`[LLM COMMANDER] model=${OLLAMA_MODEL} url=${OLLAMA_URL}/api/chat`)
  say(`[LLM COMMANDER] debug: GET http://localhost:3001/debug/llm-response`)
  say('============================================================')
  say('')
}
