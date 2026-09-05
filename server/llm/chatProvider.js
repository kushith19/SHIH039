/**
 * Shared server-side LLM chat: cloud primary (xAI Grok or Groq) → Ollama fallback.
 * Never expose API keys to the browser; this module is Node-only.
 *
 * Key routing:
 * - XAI_API_KEY that does NOT start with gsk_ → https://api.x.ai/v1 (Grok)
 * - GROQ_API_KEY, or XAI_API_KEY starting with gsk_ → https://api.groq.com/openai/v1 (Groq)
 *   (gsk_ keys are Groq keys; xAI rejects them)
 */

const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1'
const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
export const DEFAULT_XAI_MODEL = 'grok-4.6'
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b'

function trimEnv(name) {
  return String(process.env[name] ?? '').trim()
}

/**
 * Resolve the cloud OpenAI-compatible endpoint from env.
 * @returns {null | { name: 'grok' | 'groq', apiKey: string, baseUrl: string, model: string }}
 */
export function resolveCloudLlmConfig() {
  const xaiKey = trimEnv('XAI_API_KEY')
  const groqKey = trimEnv('GROQ_API_KEY')

  // Explicit Groq key wins when set.
  if (groqKey) {
    return {
      name: 'groq',
      apiKey: groqKey,
      baseUrl: (trimEnv('GROQ_BASE_URL') || DEFAULT_GROQ_BASE_URL).replace(/\/$/, ''),
      model: trimEnv('GROQ_MODEL') || DEFAULT_GROQ_MODEL,
    }
  }

  // gsk_ keys are Groq — do not send them to api.x.ai.
  // Never reuse XAI_MODEL (e.g. grok-4.6) against Groq.
  if (xaiKey.startsWith('gsk_')) {
    return {
      name: 'groq',
      apiKey: xaiKey,
      baseUrl: (trimEnv('GROQ_BASE_URL') || DEFAULT_GROQ_BASE_URL).replace(/\/$/, ''),
      model: trimEnv('GROQ_MODEL') || DEFAULT_GROQ_MODEL,
    }
  }

  if (xaiKey) {
    return {
      name: 'grok',
      apiKey: xaiKey,
      baseUrl: (trimEnv('XAI_BASE_URL') || DEFAULT_XAI_BASE_URL).replace(/\/$/, ''),
      model: trimEnv('XAI_MODEL') || DEFAULT_XAI_MODEL,
    }
  }

  return null
}

export function xaiModel() {
  const cloud = resolveCloudLlmConfig()
  if (cloud) return cloud.model
  return trimEnv('XAI_MODEL') || DEFAULT_XAI_MODEL
}

/** @deprecated Prefer xaiModel() / resolveCloudLlmConfig() */
export const XAI_MODEL = process.env.XAI_MODEL ?? DEFAULT_XAI_MODEL

function ollamaUrl() {
  return process.env.OLLAMA_URL ?? 'http://localhost:11434'
}

export function ollamaModel() {
  return process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct'
}

/** @deprecated Prefer ollamaModel() */
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct'

export function xaiApiKeyConfigured() {
  return Boolean(resolveCloudLlmConfig())
}

export function cloudLlmConfigured() {
  return xaiApiKeyConfigured()
}

function classifyError(err) {
  const msg = String(err?.message ?? err)
  if (
    err?.name === 'AbortError' ||
    err?.code === 'ABORT_ERR' ||
    /timeout|timed out|aborted/i.test(msg)
  ) {
    return 'LLM_TIMEOUT'
  }
  if (err?.code === 'HTTP_ERROR' || err?.code === 'OLLAMA_HTTP_ERROR' || /^\d{3}\s/.test(msg)) {
    return 'HTTP_ERROR'
  }
  if (err?.code === 'EMPTY_RESPONSE' || err?.code === 'MALFORMED_JSON') {
    return err.code
  }
  return 'LLM_UNAVAILABLE'
}

/**
 * @param {Array<{ role: string, content: string }>} messages
 * @param {{
 *   temperature?: number,
 *   jsonMode?: boolean,
 *   timeoutMs?: number,
 *   maxTokens?: number,
 *   ollamaOptions?: object,
 *   ollamaFormat?: string | object | null,
 *   ollamaKeepAlive?: string | number | null,
 *   logLabel?: string,
 * }} [opts]
 */
export async function chatWithGrokPrimaryOllamaFallback(messages, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs ?? 90_000) || 90_000
  const temperature =
    opts.temperature != null && Number.isFinite(Number(opts.temperature))
      ? Number(opts.temperature)
      : 0
  const jsonMode = opts.jsonMode !== false
  const maxTokens =
    opts.maxTokens != null && Number.isFinite(Number(opts.maxTokens))
      ? Number(opts.maxTokens)
      : 1024
  const label = opts.logLabel ? ` ${opts.logLabel}` : ''
  const cloud = resolveCloudLlmConfig()

  if (!cloud) {
    console.log(`[LLM] provider=ollama_fallback reason=missing_cloud_api_key${label}`)
    const ollama = await callOllamaChat(messages, {
      temperature,
      jsonMode,
      timeoutMs,
      maxTokens,
      ollamaOptions: opts.ollamaOptions,
      ollamaFormat: opts.ollamaFormat,
      ollamaKeepAlive: opts.ollamaKeepAlive,
    })
    return {
      ...ollama,
      provider: 'ollama',
      fallbackUsed: true,
      fallbackReason: 'missing_cloud_api_key',
    }
  }

  try {
    const primary = await callCloudChat(messages, {
      cloud,
      temperature,
      jsonMode,
      timeoutMs,
      maxTokens,
    })
    console.log(`[LLM] provider=${cloud.name}${label}`)
    return {
      ...primary,
      provider: cloud.name,
      fallbackUsed: false,
      fallbackReason: null,
    }
  } catch (err) {
    const reason = classifyError(err)
    const detail = String(err?.message ?? err).slice(0, 180)
    console.log(
      `[LLM] provider=ollama_fallback reason=${reason}${label} detail=${detail}`
    )
    const ollama = await callOllamaChat(messages, {
      temperature,
      jsonMode,
      timeoutMs,
      maxTokens,
      ollamaOptions: opts.ollamaOptions,
      ollamaFormat: opts.ollamaFormat,
      ollamaKeepAlive: opts.ollamaKeepAlive,
    })
    return {
      ...ollama,
      provider: 'ollama',
      fallbackUsed: true,
      fallbackReason: reason,
    }
  }
}

/**
 * Cloud-only chat (Grok or Groq). Throws when key missing / HTTP error / empty body.
 */
export async function chatGrokOrThrow(messages, opts = {}) {
  const cloud = resolveCloudLlmConfig()
  if (!cloud) {
    const err = new Error('Cloud LLM API key not configured (XAI_API_KEY or GROQ_API_KEY)')
    err.code = 'MISSING_XAI_API_KEY'
    throw err
  }
  const timeoutMs = Number(opts.timeoutMs ?? 90_000) || 90_000
  const temperature =
    opts.temperature != null && Number.isFinite(Number(opts.temperature))
      ? Number(opts.temperature)
      : 0
  const jsonMode = opts.jsonMode !== false
  const maxTokens =
    opts.maxTokens != null && Number.isFinite(Number(opts.maxTokens))
      ? Number(opts.maxTokens)
      : 1024
  return callCloudChat(messages, {
    cloud,
    temperature,
    jsonMode,
    timeoutMs,
    maxTokens,
  })
}

async function callCloudChat(
  messages,
  { cloud, temperature, jsonMode, timeoutMs, maxTokens }
) {
  const url = `${cloud.baseUrl}/chat/completions`
  const body = {
    model: cloud.model,
    messages,
    temperature,
    stream: false,
    max_tokens: maxTokens,
  }
  if (jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cloud.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await res.text()
    const durationMs = Date.now() - started
    if (!res.ok) {
      const err = new Error(`${res.status} ${text.slice(0, 240)}`)
      err.code = 'HTTP_ERROR'
      err.httpStatus = res.status
      throw err
    }
    let data = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      const err = new Error(`Malformed ${cloud.name} JSON envelope`)
      err.code = 'MALFORMED_JSON'
      err.httpStatus = res.status
      throw err
    }
    const content = String(data?.choices?.[0]?.message?.content ?? '').trim()
    if (!content) {
      const err = new Error(`Empty ${cloud.name} response`)
      err.code = 'EMPTY_RESPONSE'
      err.httpStatus = res.status
      throw err
    }
    return {
      content,
      model: cloud.model,
      providerName: cloud.name,
      httpStatus: res.status,
      durationMs,
      raw: data,
      doneReason: data?.choices?.[0]?.finish_reason ?? null,
      promptEvalCount: data?.usage?.prompt_tokens ?? null,
      evalCount: data?.usage?.completion_tokens ?? null,
      url,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function callOllamaChat(
  messages,
  {
    temperature,
    jsonMode,
    timeoutMs,
    maxTokens,
    ollamaOptions = null,
    ollamaFormat = undefined,
    ollamaKeepAlive = undefined,
  }
) {
  const model = ollamaModel()
  const url = `${ollamaUrl()}/api/chat`
  const body = {
    model,
    stream: false,
    messages,
    options: {
      temperature,
      num_predict: maxTokens,
      ...(ollamaOptions && typeof ollamaOptions === 'object' ? ollamaOptions : {}),
    },
  }
  if (ollamaFormat !== null && ollamaFormat !== undefined) {
    body.format = ollamaFormat
  } else if (jsonMode) {
    body.format = 'json'
  }
  if (ollamaKeepAlive !== undefined && ollamaKeepAlive !== null) {
    body.keep_alive = ollamaKeepAlive
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await res.text()
    const durationMs = Date.now() - started
    let data = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      const err = new Error('Malformed Ollama JSON envelope')
      err.code = 'MALFORMED_JSON'
      err.httpStatus = res.status
      throw err
    }
    if (!res.ok) {
      const err = new Error(`${res.status} ${text.slice(0, 240)}`)
      err.code = 'OLLAMA_HTTP_ERROR'
      err.httpStatus = res.status
      throw err
    }
    const content = String(data?.message?.content ?? data?.response ?? '').trim()
    if (!content) {
      const err = new Error('Empty Ollama response')
      err.code = 'EMPTY_RESPONSE'
      err.httpStatus = res.status
      throw err
    }
    return {
      content,
      model,
      httpStatus: res.status,
      durationMs,
      raw: data,
      doneReason: data?.done_reason ?? data?.doneReason ?? null,
      promptEvalCount: data?.prompt_eval_count ?? null,
      evalCount: data?.eval_count ?? null,
    }
  } finally {
    clearTimeout(timer)
  }
}
