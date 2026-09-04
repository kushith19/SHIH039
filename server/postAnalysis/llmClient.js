/**
 * Post-analysis LLM client — reuses Ollama /api/chat (same stack as response planner).
 */

import {
  POST_ANALYSIS_SYSTEM_PROMPT,
  buildPostAnalysisUserPrompt,
} from '../../shared/postAnalysis/prompt.js'
import { parseAndValidateLlmRecommendations } from '../../shared/postAnalysis/parseLlmRecommendations.js'

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434'
export const POST_ANALYSIS_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct'
const TIMEOUT_MS = Number(process.env.POST_ANALYSIS_LLM_TIMEOUT_MS ?? 90_000) || 90_000

/** @type {null | ((payload: object) => Promise<{ content: string, httpStatus?: number }>)} */
let testCaller = null

export function setPostAnalysisLlmTestCaller(fn) {
  testCaller = typeof fn === 'function' ? fn : null
}

export function clearPostAnalysisLlmTestCaller() {
  testCaller = null
}

async function postOllamaChat(messages, { archiveId } = {}) {
  const url = `${OLLAMA_URL}/api/chat`
  const body = {
    model: POST_ANALYSIS_MODEL,
    stream: false,
    format: 'json',
    options: {
      temperature: 0.2,
      num_predict: 1024,
    },
    messages,
  }

  console.log(`[POST-ANALYSIS] incident=${archiveId} LLM_REQUEST model=${POST_ANALYSIS_MODEL}`)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await res.text()
    console.log(
      `[POST-ANALYSIS] incident=${archiveId} LLM_RESPONSE status=${res.status}`
    )
    if (!res.ok) {
      const err = new Error(`Ollama HTTP ${res.status}`)
      err.httpStatus = res.status
      err.body = text
      throw err
    }
    let data = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      throw new Error('Malformed Ollama JSON envelope')
    }
    const content = data?.message?.content ?? data?.response ?? ''
    return { content: String(content ?? ''), httpStatus: res.status, raw: data }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {object} context
 * @returns {Promise<{ ok: boolean, validated: object[], rejected: object[], rawContent?: string, error?: string }>}
 */
export async function requestPostAnalysisRecommendations(context, { archiveId = '' } = {}) {
  const messages = [
    { role: 'system', content: POST_ANALYSIS_SYSTEM_PROMPT },
    { role: 'user', content: buildPostAnalysisUserPrompt(context) },
  ]

  let content = ''
  try {
    if (testCaller) {
      const result = await testCaller({ messages, context, archiveId })
      content = String(result?.content ?? '')
      console.log(
        `[POST-ANALYSIS] incident=${archiveId} LLM_RESPONSE status=${result?.httpStatus ?? 200} (test)`
      )
    } else {
      const result = await postOllamaChat(messages, { archiveId })
      content = result.content
    }
  } catch (err) {
    console.error(
      `[POST-ANALYSIS] incident=${archiveId} LLM_ERROR ${err?.message ?? err}`
    )
    return {
      ok: false,
      validated: [],
      rejected: [],
      error: String(err?.message ?? err),
    }
  }

  let parsed = parseAndValidateLlmRecommendations(content)

  // One correction pass if everything was rejected for infrastructure reasons.
  if (
    !parsed.ok &&
    parsed.rejected?.some((r) => r.code === 'INFRASTRUCTURE_RECOMMENDATION')
  ) {
    console.log(
      `[POST-ANALYSIS] incident=${archiveId} CORRECTION_REQUEST reason=INFRASTRUCTURE_RECOMMENDATION`
    )
    try {
      const correctionMessages = [
        ...messages,
        { role: 'assistant', content },
        {
          role: 'user',
          content:
            'Your previous recommendations included infrastructure/hardware expansion. Rewrite ONLY software and configuration remediations. No new servers, routers, sensors, gateways, or physical appliances. Return JSON again.',
        },
      ]
      let corrected = ''
      if (testCaller) {
        const result = await testCaller({
          messages: correctionMessages,
          context,
          archiveId,
          correction: true,
        })
        corrected = String(result?.content ?? '')
      } else {
        const result = await postOllamaChat(correctionMessages, { archiveId })
        corrected = result.content
      }
      parsed = parseAndValidateLlmRecommendations(corrected)
      content = corrected
    } catch (err) {
      console.error(
        `[POST-ANALYSIS] incident=${archiveId} CORRECTION_ERROR ${err?.message ?? err}`
      )
    }
  }

  for (const rej of parsed.rejected ?? []) {
    console.log(
      `[POST-ANALYSIS] REJECTED reason=${rej.code || 'UNKNOWN'} detail=${rej.reason}`
    )
  }

  console.log(
    `[POST-ANALYSIS] incident=${archiveId} VALIDATED recommendations=${parsed.validated.length}`
  )

  return {
    ok: parsed.ok,
    validated: parsed.validated,
    rejected: parsed.rejected,
    rawContent: content,
    parseError: parsed.parseError,
    error: parsed.ok ? undefined : parsed.parseError || 'No valid recommendations',
  }
}
