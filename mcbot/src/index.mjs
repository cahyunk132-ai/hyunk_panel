#!/usr/bin/env node
/**
 * admin_gabut — AI-controlled Minecraft bot (OODA loop).
 *
 *   npm start -- --server play.example.com:25565 --task mine
 *   BRAIN=heuristic MC_SERVER=127.0.0.1:25565 npm start       # offline debug
 *   GROQ_API_KEY=gsk_... npm start                            # otak Groq
 *
 * Arsitektur:  observe → orient(prompt) → decide(groq) → act(mineflayer)
 * Detail desain: lihat mcbot/README.md
 */
import mineflayer from 'mineflayer'
import readline from 'node:readline'
import pathfinderPkg from 'mineflayer-pathfinder'

const { pathfinder } = pathfinderPkg
import toolPkg from 'mineflayer-tool'

import { loadConfig, describeConfig } from './config.mjs'
import { createLogger } from './logger.mjs'
import { createBrain } from './brain/index.mjs'
import { createLoop } from './loop.mjs'
import { installRespawn } from './respawn.mjs'
import { setupMovements } from './act/index.mjs'

const config = loadConfig()
const logger = createLogger({
  traceFile: config.files.traceFile,
  logFile: config.files.logFile,
  verbose: config.loop.verbose
})

let bot = null
let loop = null
let shuttingDown = false
let reconnectTimer = null

const controller = {
  async start () {
    logger.info('='.repeat(72))
    logger.info('admin_gabut · AI Minecraft bot (OODA: observe → decide → act)')
    logger.info(describeConfig(config))
    logger.info('='.repeat(72))

    const brain = await createBrain(config, logger)
    await brain.warmup()

    connect(brain)
  },
  status () {
    if (!bot?.entity) return 'bot not spawned yet'
    const p = bot.entity.position
    return [
      `pos ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`,
      `hp ${bot.health}/20`,
      `food ${bot.food}/20`,
      `task ${config.task}`,
      loop ? `stats ${JSON.stringify(loop.stats)}` : ''
    ].filter(Boolean).join(' · ')
  },
  setTask (task) {
    config.task = task
    logger.info(`task set to "${task}"`)
    loop?.trigger('task changed')
  },
  say (msg) { bot?.chat(msg) },
  stop () { loop?.stop() },
  resume () { loop?.resume(); loop?.start() },
  async quit () {
    shuttingDown = true
    clearTimeout(reconnectTimer)
    loop?.stop()
    try { bot?.quit('bye') } catch { /* ignore */ }
    logger.close()
    setTimeout(() => process.exit(0), 300)
  }
}

function handleCommand (line) {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  const arg = rest.join(' ')
  switch ((cmd || '').toLowerCase()) {
    case 'task': if (arg) controller.setTask(arg); else logger.info(`task = ${config.task}`); break
    case 'state': logger.info(controller.status()); break
    case 'where': logger.info(controller.status()); break
    case 'say': if (arg) controller.say(arg); break
    case 'stop': controller.stop(); break
    case 'start': controller.resume(); break
    case 'objectives': logger.info(JSON.stringify(loop?.objectives || [], null, 2)); break
    case 'stats': logger.info(JSON.stringify(loop?.stats || {}, null, 2)); break
    case 'help':
      logger.info('commands: task <auto|mine|farm|fight|survive|explore> | state | say <msg> | stop | start | objectives | stats | quit')
      break
    case 'quit':
    case 'exit': controller.quit(); break
    default:
      if (cmd) logger.warn(`unknown command "${cmd}" (try "help")`)
  }
}

function connect (brain) {
  logger.info(`connecting to ${config.server.host}:${config.server.port} as ${config.server.username} (auth=${config.server.auth})`)
  bot = mineflayer.createBot({
    host: config.server.host,
    port: config.server.port,
    username: config.server.username,
    auth: config.server.auth,
    password: config.server.password,
    version: config.server.version,
    checkTimeoutInterval: 60_000,
    hideErrors: false
  })

  bot.loadPlugin(pathfinder)
  // mineflayer-tool mengekspor { plugin, Tool } (bukan default function)
  bot.loadPlugin(toolPkg.plugin ?? toolPkg)

  let spawned = false
  const connectTimeout = setTimeout(() => {
    if (!spawned) {
      logger.error(`did not spawn within ${config.server.connectTimeoutMs}ms — retrying`)
      try { bot.quit() } catch { /* ignore */ }
    }
  }, config.server.connectTimeoutMs)

  bot.once('spawn', async () => {
    spawned = true
    clearTimeout(connectTimeout)
    setupMovements(bot, { canDig: config.pathfinder.canDig, allowParkour: config.pathfinder.allowParkour })
    const p = bot.entity.position
    logger.ok(`spawned as ${bot.username} @ ${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)} · version ${bot.version} · ${bot.game.gameMode} · ${bot.game.dimension}`)

    if (loop) loop.stop()
    loop = createLoop({ bot, config, logger, brain })
    loop.start()
  })

  // Respawn ditangani modul bersama (dipakai juga oleh smoke test).
  const respawnDriver = installRespawn(bot, { logger, loop: () => loop, intervalMs: 2000 })
  bot.on('death', () => { try { respawnDriver.requestRespawn() } catch { /* diabaikan */ } })

  bot.on('health', () => {
    if (bot.health < 20) loop?.trigger('damaged')
  })

  bot.on('entityHurt', (entity) => {
    if (entity === bot.entity) loop?.trigger('hurt')
  })

  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    if (!message.startsWith(config.server.chatCommandPrefix)) return
    const cmd = message.slice(config.server.chatCommandPrefix.length).trim()
    logger.info(`[chat] ${username}: ${message}`)
    handleCommand(cmd)
  })

  bot.on('kicked', (reason) => logger.error(`kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`))
  bot.on('error', (err) => {
    logger.error(`bot error: ${err.message}`)
    logger.debug(err.stack)
  })
  bot.on('end', (reason) => {
    clearTimeout(connectTimeout)
    logger.warn(`disconnected: ${reason}`)
    logger.event('disconnect', { reason, stats: loop?.stats })
    loop?.stop()
    loop = null
    if (shuttingDown) return
    if (config.server.host === '127.0.0.1' || config.server.host === 'localhost') {
      logger.warn('dev server — not auto-reconnecting. Start the server first (npm run dev:server), then rerun the bot.')
      return
    }
    reconnectTimer = setTimeout(() => connect(brain), config.server.reconnectDelayMs)
    logger.info(`reconnecting in ${config.server.reconnectDelayMs}ms`)
  })
}

// ── Console operator (juga bisa lewat chat in-game dengan prefix, mis. "!bot task mine")
if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on('line', handleCommand)
  rl.on('close', () => { /* stdin ditutup → bot tetap jalan */ })
} else {
  process.stdin.on('data', (chunk) => String(chunk).split('\n').forEach(l => l.trim() && handleCommand(l)))
  process.stdin.on('error', () => {})
  process.stdin.resume()
}

process.on('SIGINT', () => controller.quit())
process.on('SIGTERM', () => controller.quit())
process.on('unhandledRejection', (err) => logger.error(`unhandledRejection: ${err?.stack || err}`))

controller.start()
