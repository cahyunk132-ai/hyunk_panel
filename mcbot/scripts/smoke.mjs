#!/usr/bin/env node
/**
 * SMOKE TEST — buktikan seluruh pipeline jalan di satu mesin, tanpa server asli
 * dan tanpa internet:
 *
 *   [mock groq] → dev server (cracked/offline) → admin_gabut → OODA loop → trace
 *
 *   npm run smoke                    # otak heuristic
 *   npm run smoke -- --brain mock    # otak Groq diarahkan ke mock-groq lokal
 *   npm run smoke -- --seconds 60 --keep
 *
 * Exit code 0 hanya kalau semua asersi lolos.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import toolPkg from 'mineflayer-tool'

import { loadConfig } from '../src/config.mjs'
import { createLogger } from '../src/logger.mjs'
import { createBrain } from '../src/brain/index.mjs'
import { createLoop } from '../src/loop.mjs'
import { setupMovements } from '../src/act/index.mjs'
import { installRespawn } from '../src/respawn.mjs'

const { pathfinder } = pathfinderPkg
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)

const PORT = Number(flag('port', 25566))
const MOCK_PORT = Number(flag('mock-port', 8788))
const SECONDS = Number(flag('seconds', 45))
const BRAIN = flag('brain', 'heuristic') // heuristic | mock
const TRACE = path.join(ROOT, 'logs', 'smoke-trace.jsonl')
const USE_MOCK = BRAIN === 'mock'
const FARM_PHASE = !has('no-farm')
const KILL_PHASE = !has('no-kill')
const FARM_SECONDS = Number(flag('farm-seconds', 30))

const children = []
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function spawnChild (name, args, env = {}, { waitFor } = {}) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let output = ''
  const onData = (buf) => {
    output += String(buf)
    if (has('verbose')) process.stdout.write(`[${name}] ${buf}`)
    if (waitFor && output.includes(waitFor)) resolveReady()
  }
  let resolveReady
  const ready = new Promise(resolve => { resolveReady = resolve })
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('exit', (code) => { if (code && code !== 0 && has('verbose')) console.log(`[${name}] exit ${code}`) })
  return { child, ready }
}

function cleanup (code) {
  for (const c of children) { try { c.kill('SIGTERM') } catch { /* ignore */ } }
  setTimeout(() => process.exit(code), 500)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main () {
  console.log(`\nSMOKE TEST — brain=${BRAIN} port=${PORT} durasi=${SECONDS}s\n`)
  fs.mkdirSync(path.dirname(TRACE), { recursive: true })
  fs.writeFileSync(TRACE, '')

  if (USE_MOCK) {
    const mock = spawnChild('mock-groq', ['dev-server/mock-groq.mjs', '--port', String(MOCK_PORT), '--latency', '60'], {}, { waitFor: 'listening' })
    await mock.ready
    console.log('  · mock-groq siap')
  }

  const smokeWorld = path.join('dev-server', 'world-smoke')
  const server = spawnChild('server', ['dev-server/server.mjs', '--port', String(PORT), '--kit-on-join', '--verbose', '--world', smokeWorld], {}, { waitFor: 'DEV SERVER siap' })
  await server.ready
  console.log('  · dev server (cracked/offline) siap')

  // ── bot (in-process supaya hasilnya bisa diperiksa langsung) ────────────────
  const config = loadConfig(['--server', `127.0.0.1:${PORT}`, '--task', 'auto', '--interval', '1500'])
  config.brain.apiKey = 'smoke-test-key'
  if (USE_MOCK) {
    config.brain.provider = 'groq'
    config.brain.baseUrl = `http://127.0.0.1:${MOCK_PORT}/openai/v1`
  } else {
    config.brain.provider = 'heuristic'
  }
  config.files.traceFile = TRACE
  config.files.logFile = path.join(ROOT, 'logs', 'smoke-bot.log')

  const logger = createLogger({ traceFile: config.files.traceFile, logFile: config.files.logFile, verbose: has('verbose') })
  const brain = await createBrain(config, logger)
  await brain.warmup()

  const bot = mineflayer.createBot({
    host: '127.0.0.1',
    port: PORT,
    username: 'admin_gabut',
    auth: 'offline',
    version: false,
    hideErrors: false
  })
  bot.loadPlugin(pathfinder)
  bot.loadPlugin(toolPkg.plugin ?? toolPkg)

  const spawned = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 30000)
    bot.once('spawn', () => { clearTimeout(timer); resolve(true) })
  })
  check('bot admin_gabut berhasil spawn di server cracked', spawned)

  let loop = null
  let respawnDriver = null
  let died = false
  let aliveAgain = false
  let positions = new Set()
  if (spawned) {
    setupMovements(bot, { canDig: config.pathfinder.canDig })
    loop = createLoop({ bot, config, logger, brain })
    // Driver respawn yang sama dengan yang dipakai index.mjs — inilah yang
    // dulu hilang sehingga bot bisa tersangkut di hp 0 tanpa ketahuan.
    respawnDriver = installRespawn(bot, { logger, loop: () => loop, intervalMs: 2000 })
    loop.start()
    const watcher = setInterval(() => {
      if (bot.entity) positions.add(`${bot.entity.position.x.toFixed(0)},${bot.entity.position.y.toFixed(0)},${bot.entity.position.z.toFixed(0)}`)
    }, 500)
    await sleep(SECONDS * 1000)

    // ── Fase uji kematian: bunuh bot, pastikan ia bangun lagi ────────────────
    if (KILL_PHASE) {
      console.log('\n  · fase kematian: /kill admin_gabut lalu tunggu respawn')
      const hpBefore = bot.health
      bot.chat(`/kill ${bot.username}`)
      await sleep(4000)
      died = bot.health <= 0 || (respawnDriver?.respawns ?? 0) > 0
      for (let i = 0; i < 12 && !(bot.health > 0 && aliveAgain); i++) {
        await sleep(1000)
        if (bot.health > 0) aliveAgain = true
      }
      console.log(`    hp sebelum ${hpBefore} → setelah ${bot.health} (respawns: ${respawnDriver?.respawns ?? 0})`)
    }

    // ── Fase tambahan: uji panen + tanam ulang (regresi bug placeBlock) ───────
    if (has('farm-phase') || FARM_PHASE) {
      console.log('\n  · fase pertanian: /kit farmer + /farmhere lalu memanen 30s')
      bot.chat('/kit farmer')
      await sleep(1500)
      bot.chat('/farmhere')
      await sleep(2500)
      config.task = 'farm'
      await sleep(FARM_SECONDS * 1000)
    }

    clearInterval(watcher)
    loop.stop()
  }

  // ── analisa trace ──────────────────────────────────────────────────────────
  const events = fs.readFileSync(TRACE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const decisions = events.filter(e => e.type === 'decision')
  const results_ = events.filter(e => e.type === 'result')
  const acts = events.filter(e => e.type === 'action')
  const errors = events.filter(e => e.type === 'error')
  const sources = new Set(decisions.map(d => d.source))
  const actions = new Set(decisions.map(d => d.decision?.action))

  check('OODA loop menghasilkan ≥ 4 keputusan', decisions.length >= 4, `${decisions.length} keputusan`)
  check('aksi benar-benar dieksekusi', acts.length >= 3, `${acts.length} aksi`)
  check('ada aksi sukses (mine/explore/farm/attack)', results_.length >= 2, `${results_.length} sukses: ${[...actions].join(', ')}`)
  check('bot benar-benar bergerak', positions.size >= 3, `${positions.size} posisi berbeda`)
  if (USE_MOCK) {
    check('otak memakai jalur HTTP Groq (mock)', sources.has('groq'), `sources: ${[...sources].join(', ')}`)
  } else {
    check('otak heuristic aktif', sources.has('heuristic'), `sources: ${[...sources].join(', ')}`)
  }
  check('tidak ada error fatal di loop', errors.length === 0, errors.map(e => e.msg).slice(0, 2).join(' | '))
  check('trace JSONL ditulis', events.length > 10, `${events.length} event`)

  if (KILL_PHASE) {
    const deathEvents = events.filter(e => e.type === 'death')
    const respawnEvents = events.filter(e => e.type === 'respawn')
    check('fase kematian: server benar-benar membunuh bot', died || deathEvents.length > 0, `${deathEvents.length} event death`)
    check('fase kematian: bot hidup lagi setelah respawn', aliveAgain && bot.health > 0, `hp akhir ${bot.health}, ${respawnEvents.length} respawn`)
  }

  if (FARM_PHASE) {
    const farmEvents = events.filter(e => e.type === 'farm')
    const harvested = farmEvents.filter(e => e.harvested).length
    const replanted = farmEvents.filter(e => e.replanted).length
    check('fase pertanian: ada panen', harvested >= 1, `${harvested} panen`)
    check('fase pertanian: benih ditanam ulang', replanted >= 1, `${replanted} tanam ulang`)
  }

  logger.close()
  try { bot.quit('smoke done') } catch { /* ignore */ }

  const failed = results.filter(r => !r.ok)
  console.log(`\n${failed.length ? '✘' : '✔'} smoke: ${results.length - failed.length}/${results.length} asersi lulus`)
  if (!has('keep')) {
    try { fs.rmSync(path.join(ROOT, 'dev-server', 'world-smoke'), { recursive: true, force: true }) } catch { /* ignore */ }
    console.log('  · world dev dihapus (pakai --keep untuk menyimpannya)')
  }
  cleanup(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error('smoke gagal:', err.stack || err.message)
  cleanup(1)
})
