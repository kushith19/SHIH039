/**
 * Unit tests for cloud primary → Ollama fallback chat provider.
 */

import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import {
  chatWithGrokPrimaryOllamaFallback,
  resolveCloudLlmConfig,
  xaiApiKeyConfigured,
} from './chatProvider.js'

describe('chatProvider cloud → Ollama', () => {
  let originalFetch
  let originalXai
  let originalGroq
  let originalGroqModel

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalXai = process.env.XAI_API_KEY
    originalGroq = process.env.GROQ_API_KEY
    originalGroqModel = process.env.GROQ_MODEL
    delete process.env.GROQ_API_KEY
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalXai === undefined) delete process.env.XAI_API_KEY
    else process.env.XAI_API_KEY = originalXai
    if (originalGroq === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = originalGroq
    if (originalGroqModel === undefined) delete process.env.GROQ_MODEL
    else process.env.GROQ_MODEL = originalGroqModel
  })

  it('routes gsk_ keys to Groq, not xAI', () => {
    process.env.XAI_API_KEY = 'gsk_test_key'
    process.env.GROQ_MODEL = 'openai/gpt-oss-20b'
    const cloud = resolveCloudLlmConfig()
    assert.equal(cloud.name, 'groq')
    assert.match(cloud.baseUrl, /api\.groq\.com/)
    assert.equal(cloud.model, 'openai/gpt-oss-20b')
  })

  it('uses ollama immediately when no cloud key', async () => {
    delete process.env.XAI_API_KEY
    delete process.env.GROQ_API_KEY
    assert.equal(xaiApiKeyConfigured(), false)
    const calls = []
    globalThis.fetch = async (url) => {
      calls.push(String(url))
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ message: { content: '{"ok":true}' } })
        },
      }
    }
    const result = await chatWithGrokPrimaryOllamaFallback(
      [{ role: 'user', content: 'hi' }],
      { timeoutMs: 5_000, logLabel: 'test-missing-key' }
    )
    assert.equal(result.provider, 'ollama')
    assert.equal(result.fallbackUsed, true)
    assert.equal(calls.length, 1)
  })

  it('uses groq when gsk_ key present and API succeeds', async () => {
    process.env.XAI_API_KEY = 'gsk_test_key'
    process.env.GROQ_MODEL = 'openai/gpt-oss-20b'
    const calls = []
    globalThis.fetch = async (url, init) => {
      calls.push(String(url))
      assert.match(String(url), /api\.groq\.com/)
      const body = JSON.parse(init.body)
      assert.equal(body.model, 'openai/gpt-oss-20b')
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            choices: [{ message: { content: '{"plan":1}' }, finish_reason: 'stop' }],
          })
        },
      }
    }
    const result = await chatWithGrokPrimaryOllamaFallback(
      [{ role: 'user', content: 'hi' }],
      { timeoutMs: 5_000 }
    )
    assert.equal(result.provider, 'groq')
    assert.equal(result.fallbackUsed, false)
    assert.equal(result.content, '{"plan":1}')
    assert.equal(calls.length, 1)
  })

  it('uses xAI when non-gsk key present', async () => {
    process.env.XAI_API_KEY = 'xai-real-looking-key'
    const calls = []
    globalThis.fetch = async (url) => {
      calls.push(String(url))
      assert.match(String(url), /api\.x\.ai/)
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            choices: [{ message: { content: '{"plan":2}' }, finish_reason: 'stop' }],
          })
        },
      }
    }
    const result = await chatWithGrokPrimaryOllamaFallback(
      [{ role: 'user', content: 'hi' }],
      { timeoutMs: 5_000 }
    )
    assert.equal(result.provider, 'grok')
    assert.equal(result.content, '{"plan":2}')
    assert.equal(calls.length, 1)
  })
})
