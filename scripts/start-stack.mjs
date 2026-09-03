#!/usr/bin/env node
/**
 * Bring up the local TrustNet stack: Ollama, Commander, API, UI.
 * Usage: npm start
 * Skip ingest: npm start -- --no-ingest
 * Start Qdrant for lab RAG: npm start -- --with-rag
 */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  commanderHealthRequired,
  commanderUvicornArgs,
  resolveCommanderLaunch,
} from './commanderStartup.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const aiCom = join(root, 'ai-com-v1')
const teleIng = join(root, 'tele-ingestion')
const withIngest = !process.argv.includes('--no-ingest')
const withRag = process.argv.includes('--with-rag')
const DEFAULT_MODEL = 'qwen2.5:7b-instruct'
const COMMANDER_HEALTH_TIMEOUT_MS = 120_000
const children = []
let shuttingDown = false
const npmShell = process.platform === 'win32'

const log = (msg) => console.log(`[stack] ${msg}`)
const fail = (msg) => {
  console.error(`[stack] ${msg}`)
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

function ensureEnv(exampleRel, destRel) {
  const example = join(root, exampleRel)
  const dest = join(root, destRel)
  if (!existsSync(example) || existsSync(dest)) return
  copyFileSync(example, dest)
  log(`created ${destRel} from example`)
}

function venvPython() {
  const bin = process.platform === 'win32' ? 'Scripts' : 'bin'
  const name = process.platform === 'win32' ? 'python.exe' : 'python'
  return join(aiCom, 'venv', bin, name)
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

function portBusy(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    let settled = false
    const done = (busy) => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve(busy)
    }
    const socket = net.connect({ port, host })
    socket.setTimeout(800, () => done(true))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
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

async function httpReady(url) {
  try {
    const res = await fetchTimed(url)
    return res.ok
  } catch {
    return false
  }
}

async function waitForHttp(url, { timeoutMs, label, okOnly = false, required = true }) {
  const start = Date.now()
  let last = ''
  let lastLog = 0
  log(`waiting for ${label} at ${url}`)
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchTimed(url)
      if (res.ok || (!okOnly && res.status >= 200 && res.status < 500)) {
        log(`${label} ready`)
        return true
      }
      last = `${res.status}`
    } catch (err) {
      last = err?.name === 'AbortError' ? 'timed out' : err?.cause?.code || err?.message || 'offline'
    }
    const elapsed = Date.now() - start
    if (elapsed - lastLog > 8000) {
      log(`still waiting for ${label} (${Math.round(elapsed / 1000)}s, last: ${last || 'no response'})`)
      lastLog = elapsed
    }
    await sleep(800)
  }
  if (required) fail(`${label} did not become ready at ${url} (${last})`)
  log(`${label} not ready after ${Math.round(timeoutMs / 1000)}s (${last}) — continuing without it`)
  return false
}

function spawnInherit(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd ?? root,
    env: { ...process.env, FORCE_COLOR: '1', ...opts.env },
    shell: opts.shell ?? false,
  })
  children.push(child)
  child.on('exit', (code, signal) => {
    if (shuttingDown || signal) return
    if (code && code !== 0) {
      console.error(`[stack] ${cmd} exited ${code}`)
      shutdown(code)
    }
  })
  return child
}

function runChecked(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
    shell: opts.shell ?? false,
  })
  if (r.error) fail(`failed to run ${cmd}: ${r.error.message}`)
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} failed (${r.status})`)
}

function dockerCompose(args, cwd) {
  const v2 = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' })
  if (v2.status === 0) {
    runChecked('docker', ['compose', ...args], { cwd })
    return
  }
  if (which('docker-compose')) {
    runChecked('docker-compose', args, { cwd })
    return
  }
  fail('Docker Compose not found. Install Docker Desktop, then retry.')
}

function dockerComposeStatus(args, cwd) {
  const v2 = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' })
  if (v2.status === 0) {
    return spawnSync('docker', ['compose', ...args], { cwd, encoding: 'utf8' })
  }
  return spawnSync('docker-compose', args, { cwd, encoding: 'utf8' })
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  log('stopping app processes (Docker containers stay up)')
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 400)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

async function ensureOllama(model) {
  if (!which('ollama')) {
    fail('ollama is not on PATH. Install from https://ollama.com then retry.')
  }
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags')
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    log('starting ollama serve')
    spawnInherit('ollama', ['serve'])
    await waitForHttp('http://127.0.0.1:11434/api/tags', {
      timeoutMs: 30_000,
      label: 'Ollama',
    })
  }
  const tags = await fetch('http://127.0.0.1:11434/api/tags').then((r) => r.json())
  const names = (tags.models ?? []).map((m) => String(m.name ?? ''))
  if (!modelPresent(names, model)) {
    log(`pulling Ollama model ${model} (first time can take several minutes)`)
    runChecked('ollama', ['pull', model])
  } else {
    log(`Ollama model ready (${model})`)
  }
}

function ensurePython() {
  const py = venvPython()
  if (!existsSync(py)) {
    const creator = which('python3') ? 'python3' : which('python') ? 'python' : null
    if (!creator) fail('Python 3 is required for AI Commander.')
    log('creating ai-com-v1 virtualenv')
    runChecked(creator, ['-m', 'venv', 'venv'], { cwd: aiCom })
    log('installing Commander Python deps')
    runChecked(py, ['-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: aiCom })
    return
  }
  const probe = spawnSync(py, ['-c', 'import uvicorn'], { encoding: 'utf8' })
  if (probe.status !== 0) {
    log('installing Commander Python deps')
    runChecked(py, ['-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: aiCom })
  }
}

function ensureNodeModules() {
  if (!existsSync(join(root, 'node_modules'))) {
    log('npm install (root)')
    runChecked('npm', ['install'], { shell: npmShell })
  }
  if (!existsSync(join(root, 'server', 'node_modules'))) {
    log('npm install (server)')
    runChecked('npm', ['install'], { cwd: join(root, 'server'), shell: npmShell })
  }
  if (withIngest && !existsSync(join(teleIng, 'node_modules'))) {
    log('npm install (tele-ingestion)')
    runChecked('npm', ['install'], { cwd: teleIng, shell: npmShell })
  }
}

async function waitForPostgres() {
  const start = Date.now()
  let last = ''
  while (Date.now() - start < 90_000) {
    const r = dockerComposeStatus(
      ['exec', '-T', 'postgres', 'pg_isready', '-U', 'smartcity', '-d', 'smart_city'],
      teleIng
    )
    if (r.status === 0) return
    last = (r.stderr || r.stdout || '').trim() || `exit ${r.status}`
    await sleep(1000)
  }
  fail(`TimescaleDB did not become ready (${last})`)
}

async function probeIngest() {
  try {
    return await httpReady('http://127.0.0.1:3000/health')
  } catch {
    return false
  }
}

async function ensureIngest() {
  ensureEnv('tele-ingestion/.env.example', 'tele-ingestion/.env')
  log('starting TimescaleDB (docker compose postgres)')
  dockerCompose(['up', '-d', 'postgres'], teleIng)
  await waitForPostgres()
  log('initializing tele-ingestion schema')
  runChecked('npm', ['run', 'db:init'], { cwd: teleIng, shell: npmShell })

  if (await probeIngest()) {
    log('tele-ingestion already running on :3000')
    return
  }

  log('starting tele-ingestion on :3000')
  spawnInherit('npm', ['run', 'dev'], { cwd: teleIng, shell: npmShell })
  await waitForHttp('http://127.0.0.1:3000/health', {
    timeoutMs: 60_000,
    label: 'tele-ingestion',
    okOnly: true,
  })
}

/** Kill listeners on a TCP port (wedged uvicorn that accepts TCP but never answers /health). */
function killPortListeners(port) {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
  })
  const pids = [
    ...new Set(
      (r.stdout || '')
        .trim()
        .split(/\n/)
        .flatMap((line) => line.trim().split(/\s+/))
        .filter(Boolean)
    ),
  ]
  for (const pid of pids) {
    const n = Number(pid)
    if (!Number.isFinite(n)) continue
    try {
      process.kill(n, 'SIGTERM')
      log(`sent SIGTERM to wedged process on :${port} (pid ${n})`)
    } catch (err) {
      log(`could not signal pid ${n}: ${err?.message || err}`)
    }
  }
  return pids.length
}

async function ensureCommander() {
  const commanderHealth = 'http://127.0.0.1:8000/health'
  const healthOk = await httpReady(commanderHealth)
  const busy = await portBusy(8000)
  const action = resolveCommanderLaunch({ healthOk, portBusy: busy })

  if (action === 'reuse') {
    log('AI Commander already healthy on :8000')
    return
  }

  if (action === 'replace') {
    log(
      'port 8000 is occupied but GET /health failed — treating as wedged Commander and replacing it'
    )
    killPortListeners(8000)
    await sleep(800)
    if (await portBusy(8000)) {
      killPortListeners(8000)
      await sleep(1200)
    }
    if (await portBusy(8000) && !(await httpReady(commanderHealth))) {
      fail(
        'wedged AI Commander on :8000 could not be cleared. Kill it manually (`lsof -nP -iTCP:8000 -sTCP:LISTEN`) then rerun.'
      )
    }
    if (await httpReady(commanderHealth)) {
      log('AI Commander became healthy after cleanup')
      return
    }
  }

  log('starting AI Commander on :8000 (no --reload)')
  const child = spawnInherit(venvPython(), commanderUvicornArgs(), { cwd: aiCom })
  const ready = await waitForHttp(commanderHealth, {
    timeoutMs: COMMANDER_HEALTH_TIMEOUT_MS,
    label: 'AI Commander',
    okOnly: true,
    required: false,
  })
  if (!ready) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }
    killPortListeners(8000)
    if (commanderHealthRequired()) {
      fail(
        'AI Commander did not become ready (GET /health must succeed). Not leaving a wedged process on :8000.'
      )
    }
  }
}

async function main() {
  ensureEnv('server/.env.example', 'server/.env')
  ensureEnv('ai-com-v1/.env.example', 'ai-com-v1/.env')

  if ((withIngest || withRag) && !which('docker')) {
    fail('Docker is not on PATH. Install Docker Desktop, then retry.')
  }

  ensureNodeModules()
  await ensureOllama(resolveModel())

  if (withRag) {
    log('starting Qdrant (docker compose)')
    dockerCompose(['up', '-d', 'qdrant'], aiCom)
    await waitForHttp('http://127.0.0.1:6333/readyz', {
      timeoutMs: 60_000,
      label: 'Qdrant',
    })
  } else {
    log('skipping Qdrant (pass --with-rag to start it; live /explain does not use RAG)')
  }

  if (withIngest) await ensureIngest()

  ensurePython()
  await ensureCommander()

  log('starting web UI (:5173) and game API (:3001)')
  log('')
  log('  Ollama     http://localhost:11434')
  if (withRag) log('  Qdrant     http://localhost:6333/dashboard')
  if (withIngest) {
    log('  Timescale  localhost:5432')
    log('  Ingest     http://localhost:3000/health')
  }
  log('  Commander  http://localhost:8000/health')
  log('  API        http://localhost:3001')
  log('  UI         http://localhost:5173')
  log('')

  spawnInherit(
    'npx',
    ['concurrently', '-n', 'web,api', '-c', 'blue,green', 'npm run dev', 'npm run dev:server'],
    { shell: npmShell }
  )
}

main().catch((err) => fail(err?.stack || String(err)))
