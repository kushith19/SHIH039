/**
 * Post-analysis LLM client — xAI Grok primary → Ollama fallback
 * (same stack as response planner).
 */

import {
  POST_ANALYSIS_SYSTEM_PROMPT,
  buildPostAnalysisUserPrompt,
} from '../../shared/postAnalysis/prompt.js'
import { parseAndValidateLlmRecommendations } from '../../shared/postAnalysis/parseLlmRecommendations.js'
import { chatWithGrokPrimaryOllamaFallback } from '../llm/chatProvider.js'

export const POST_ANALYSIS_MODEL = process.env.XAI_API_KEY
  ? process.env.XAI_MODEL ?? 'grok-4.6'
  : process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct'
const TIMEOUT_MS = Number(process.env.POST_ANALYSIS_LLM_TIMEOUT_MS ?? 90_000) || 90_000

/** @type {null | ((payload: object) => Promise<{ content: string, httpStatus?: number }>)} */
let testCaller = null

export function setPostAnalysisLlmTestCaller(fn) {
  testCaller = typeof fn === 'function' ? fn : null
}

export function clearPostAnalysisLlmTestCaller() {
  testCaller = null
}

async function postLlmChat(messages, { archiveId } = {}) {
  console.log(
    `[POST-ANALYSIS] incident=${archiveId} LLM_REQUEST primary=grok fallback=ollama`
  )
  const result = await chatWithGrokPrimaryOllamaFallback(messages, {
    temperature: 0.2,
    jsonMode: true,
    timeoutMs: TIMEOUT_MS,
    maxTokens: 1024,
    logLabel: `post-analysis archive=${archiveId}`,
  })
  console.log(
    `[POST-ANALYSIS] incident=${archiveId} LLM_RESPONSE status=${result.httpStatus} provider=${result.provider} fallbackUsed=${result.fallbackUsed}`
  )
  return {
    content: String(result.content ?? ''),
    httpStatus: result.httpStatus,
    raw: result.raw,
    provider: result.provider,
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
      const result = await postLlmChat(messages, { archiveId })
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
        const result = await postLlmChat(correctionMessages, { archiveId })
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
