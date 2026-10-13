#!/usr/bin/env node
/**
 * STACK — satu perintah untuk menjalankan semuanya saat debugging:
 *   [mock groq] → dev server (cracked/offline) → admin_gabut
 *
 *   npm run dev:all                 # otak heuristic (tanpa API key)
 *   npm run dev:all -- --mock       # otak groq diarahkan ke mock-groq lokal
 *   npm run dev:all -- --brain groq --key gsk_xxx
 *   npm run dev:all -- --task farm  # langsung fokus bertani
 *
 * Ctrl+C mematikan semua proses.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)

const PORT = Number(flag('port', process.env.DEV_PORT || 25565))
const MOCK_PORT = Number(flag('mock-port', process.env.MOCK_PORT || 8787))
const USE_MOCK = has('mock') || process.env.USE_MOCK === '1'
const BRAIN = flag('brain', USE_MOCK ? 'groq' : (process.env.BRAIN || 'heuristic'))
const TASK = flag('task', process.env.TASK || 'auto')
const DASH_PORT = Number(flag('dash-port', process.env.DASH_PORT || 8090))
const children = []

function start (name, args, env = {}) {
  const color = { 'mock-groq': '\x1b[35m', server: '\x1b[36m', bot: '\x1b[32m', dashboard: '\x1b[33m' }[name] || '\x1b[37m'
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const prefix = `${color}[${name}]\x1b[0m `
  const pipe = (stream) => stream.on('data', (buf) => {
    for (const line of String(buf).split('\n')) {
      if (line.trim()) process.stdout.write(prefix + line + '\n')
    }
  })
  pipe(child.stdout)
  pipe(child.stderr)
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`)
    // bot boleh mati sendiri (mis. server belum siap) tanpa mematikan stack
    if (!['bot'].includes(name)) shutdown(code ?? 0)
  })
  children.push(child)
  return child
}

function shutdown (code = 0) {
  for (const c of children) {
    try { c.kill('SIGTERM') } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(code), 400)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('\x1b[1mHYUNK DEV STACK\x1b[0m — mock=%s brain=%s task=%s dashboard=http://0.0.0.0:%d', USE_MOCK, BRAIN, TASK, DASH_PORT)

if (USE_MOCK) start('mock-groq', ['dev-server/mock-groq.mjs', '--port', String(MOCK_PORT)])
start('dashboard', ['dev-server/dashboard.mjs', '--port', String(DASH_PORT), '--mc-port', String(flag('port', String(PORT)))])

const KIT = flag('kit', process.env.DEV_KIT || 'warrior') // --kit farmer|miner|warrior|naked
const server = start('server', ['dev-server/server.mjs', '--port', String(PORT), '--auto-mob', flag('auto-mob', '60000'), '--kit-on-join', KIT, '--verbose'])

// Tunggu server benar-benar siap, baru bot masuk (biar tidak spam reconnect)
server.stdout.on('data', (buf) => {
  if (!String(buf).includes('DEV SERVER siap')) return
  if (children.length > (USE_MOCK ? 3 : 2)) return // sudah pernah start
  const botArgs = ['src/index.mjs', '--server', `127.0.0.1:${PORT}`, '--task', TASK, '--interval', flag('interval', '2000')]
  if (flag('username', '')) botArgs.push('--username', flag('username', ''))
  start('bot', botArgs, {
    BRAIN,
    ...(USE_MOCK ? { GROQ_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/openai/v1`, GROQ_API_KEY: 'mock-key' } : {}),
    ...(flag('key', '') ? { GROQ_API_KEY: flag('key', '') } : {}),
    ...(has('pvp') ? { PVP_MODE: '1' } : {}),
    ...(has('verbose') ? { VERBOSE: '1' } : {})
  })
})
