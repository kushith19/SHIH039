#!/usr/bin/env node
/**
 * Start local Ollama and ensure the Commander Qwen model is present.
 * Usage: npm run ollama:qwen
 *
 * Equivalent CLI:
 *   ollama serve
 *   ollama pull qwen2.5:7b-instruct
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const aiCom = join(root, 'ai-com-v1')
const DEFAULT_MODEL = 'qwen2.5:7b-instruct'
const children = []
let shuttingDown = false

const log = (msg) => console.log(`[ollama] ${msg}`)
const fail = (msg) => {
  console.error(`[ollama] ${msg}`)
  process.exit(1)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function which(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
    encoding: 'utf8',
  })
  return r.status === 0
}

function resolveModel() {
  try {
    const text = readFileSync(join(aiCom, '.env'), 'utf8')
    const m = text.match(/^OLLAMA_MODEL=(.+)$/m)
    if (m) return m[1].trim()
  } catch {
    /* default */
  }
  return process.env.OLLAMA_MODEL || DEFAULT_MODEL
}

function modelPresent(names, model) {
  return names.some(
    (n) => n === model || n === `${model}:latest` || n.startsWith(`${model}:`)
  )
}

async function fetchTimed(url, ms = 2500) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function waitForOllama() {
  const url = 'http://127.0.0.1:11434/api/tags'
  const start = Date.now()
  let last = ''
  log(`waiting for Ollama at ${url}`)
  while (Date.now() - start < 30_000) {
    try {
      const res = await fetchTimed(url)
      if (res.ok) {
        log('Ollama ready')
        return
      }
      last = `${res.status}`
    } catch (err) {
      last = err?.name === 'AbortError' ? 'timed out' : err?.cause?.code || err?.message || 'offline'
    }
    await sleep(800)
  }
  fail(`Ollama did not become ready at ${url} (${last})`)
}

function spawnInherit(cmd, args) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, FORCE_COLOR: '1' },
  })
  children.push(child)
  child.on('exit', (code, signal) => {
    if (shuttingDown || signal) return
    if (code && code !== 0) {
      console.error(`[ollama] ${cmd} exited ${code}`)
      shutdown(code)
    }
  })
  return child
}

function runChecked(cmd, args) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env },
  })
  if (r.error) fail(`failed to run ${cmd}: ${r.error.message}`)
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed (${r.status})`)
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 400)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

async function main() {
  if (!which('ollama')) {
    fail('ollama is not on PATH. Install from https://ollama.com then retry.')
  }

  const model = resolveModel()
  let spawnedServe = false

  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags')
    if (!res.ok) throw new Error(String(res.status))
    log('Ollama already running on :11434')
  } catch {
    log('starting ollama serve')
    spawnInherit('ollama', ['serve'])
    spawnedServe = true
    await waitForOllama()
  }

  const tags = await fetch('http://127.0.0.1:11434/api/tags').then((r) => r.json())
  const names = (tags.models ?? []).map((m) => String(m.name ?? ''))
  if (!modelPresent(names, model)) {
    log(`pulling ${model} (first time can take several minutes)`)
    runChecked('ollama', ['pull', model])
  } else {
    log(`model ready (${model})`)
  }

  log('')
  log(`  Ollama  http://localhost:11434`)
  log(`  Model   ${model}`)
  log('')
  if (spawnedServe) {
    log('keeping ollama serve in the foreground — Ctrl+C to stop')
    return
  }
  log('daemon was already up; this command can exit. Optional chat:')
  log(`  ollama run ${model}`)
}

main().catch((err) => fail(err?.stack || String(err)))
