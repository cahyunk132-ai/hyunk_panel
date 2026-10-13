/**
 * HYUNK McBOT — configuration
 *
 * Semua konfigurasi bisa lewat CLI flag, env var, atau file `mcbot/.env`.
 * Prioritas: CLI flag > process.env / .env > default.
 *
 * Contoh:
 *   node src/index.mjs --server play.example.com:25565 --task mine
 *   GROQ_API_KEY=gsk_xxx BRAIN=groq npm start
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const MCBOT_ROOT = path.resolve(here, '..')

/** Parser .env minimalis (tanpa dependency). Tidak menimpa env yang sudah ada. */
export function parseDotEnv (text) {
  const out = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/** Baca mcbot/.env (kalau ada) dan isi process.env yang belum di-set. */
export function loadDotEnv (file = path.join(MCBOT_ROOT, '.env')) {
  if (!fs.existsSync(file)) return {}
  const parsed = parseDotEnv(fs.readFileSync(file, 'utf8'))
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v
  }
  return parsed
}

/** Parse argv sederhana: --key value | --key=value | --flag | -k value */
export function parseArgs (argv) {
  const flags = {}
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('-')) { rest.push(arg); continue }
    const body = arg.replace(/^--?/, '')
    if (body.includes('=')) {
      const [k, ...v] = body.split('=')
      flags[k] = v.join('=')
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('-')) { flags[body] = next; i++ } else flags[body] = true
  }
  return { flags, rest }
}

const num = (v, d) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}
const bool = (v, d = false) => {
  if (v === undefined || v === null || v === '') return d
  if (typeof v === 'boolean') return v
  return ['1', 'true', 'yes', 'on', 'y'].includes(String(v).toLowerCase())
}
const list = (v, d = []) => {
  if (!v) return d
  if (Array.isArray(v)) return v
  return String(v).split(',').map(s => s.trim()).filter(Boolean)
}

/** "host:port" → { host, port } (port opsional, default 25565) */
export function splitHostPort (value, defaultPort = 25565) {
  if (!value) return { host: null, port: defaultPort }
  const s = String(value).replace(/^minecraft:\/\//, '')
  const idx = s.lastIndexOf(':')
  if (idx === -1) return { host: s, port: defaultPort }
  return { host: s.slice(0, idx), port: num(s.slice(idx + 1), defaultPort) }
}

export function loadConfig (argv = process.argv.slice(2)) {
  const { flags } = parseArgs(argv)
  const env = process.env
  loadDotEnv(env.MCBOT_ENV_FILE || path.join(MCBOT_ROOT, '.env'))

  const hostPort = splitHostPort(
    flags.server || flags.host || env.MC_SERVER || env.MC_HOST
      ? (flags.server || flags.host || env.MC_SERVER || env.MC_HOST)
      : '127.0.0.1',
    num(flags.port || env.MC_PORT, 25565)
  )

  const brainProvider = String(flags.brain || env.BRAIN || (env.GROQ_API_KEY ? 'groq' : 'heuristic')).toLowerCase()

  const objectivesRaw = flags.objectives || env.OBJECTIVES
  let objectives
  if (objectivesRaw) {
    try {
      objectives = typeof objectivesRaw === 'string' ? JSON.parse(objectivesRaw) : objectivesRaw
    } catch {
      objectives = undefined // biarkan default; akan dilaporkan saat start
    }
  }

  return {
    server: {
      host: flags.server ? splitHostPort(flags.server).host : (flags.host || env.MC_SERVER || env.MC_HOST || hostPort.host),
      port: flags.server ? splitHostPort(flags.server).port : hostPort.port,
      // 'auto' → biarkan mineflayer mendeteksi versi dari ping server (aman untuk server apa pun)
      version: (flags.version || env.MC_VERSION) && (flags.version || env.MC_VERSION) !== 'auto'
        ? (flags.version || env.MC_VERSION)
        : false,
      username: flags.username || env.MC_USERNAME || 'admin_gabut',
      auth: String(flags.auth || env.MC_AUTH || 'offline').toLowerCase(),
      password: flags.password || env.MC_PASSWORD || undefined,
      // Server cracked/offline: auth 'offline'. Server premium: auth 'microsoft'.
      reconnectDelayMs: num(env.MC_RECONNECT_MS, 8000),
      connectTimeoutMs: num(env.MC_CONNECT_TIMEOUT_MS, 20000),
      chatCommandPrefix: env.MC_CHAT_PREFIX || '!bot',
      // Mode PvP: pemain lain dianggap ancaman (server PvP / anarki)
      pvpMode: bool(flags.pvp || env.PVP_MODE, false)
    },
    brain: {
      provider: brainProvider, // groq | heuristic
      model: flags.model || env.GROQ_MODEL || 'openai/gpt-oss-120b',
      // Groq OpenAI-compatible endpoint. Bisa diarahkan ke mock server lokal:
      //   GROQ_BASE_URL=http://127.0.0.1:8787/openai/v1 npm start
      baseUrl: (flags['groq-url'] || env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
      apiKey: flags['groq-key'] || env.GROQ_API_KEY || '',
      temperature: num(env.GROQ_TEMPERATURE, 0.2),
      maxTokens: num(env.GROQ_MAX_TOKENS, 400),
      timeoutMs: num(env.GROQ_TIMEOUT_MS, 10000),
      retries: num(env.GROQ_RETRIES, 2),
      autodetectModel: bool(env.GROQ_AUTODETECT_MODEL, true),
      fallbackToHeuristic: bool(env.BRAIN_FALLBACK_HEURISTIC, true),
      historyLimit: num(env.BRAIN_HISTORY, 4)
    },
    loop: {
      intervalMs: num(flags.interval || env.LOOP_INTERVAL_MS, 2000),
      urgentIntervalMs: num(env.LOOP_URGENT_MS, 400),
      actionTimeoutMs: num(env.ACTION_TIMEOUT_MS, 12000),
      traceLimit: num(env.TRACE_LIMIT, 2000),
      dryRun: bool(flags['dry-run'] || env.DRY_RUN, false),
      verbose: bool(flags.verbose || env.VERBOSE, false)
    },
    task: flags.task || env.TASK || 'auto',
    objectives: objectives || [
      { kind: 'mine', target: 'coal_ore', count: 8 },
      { kind: 'mine', target: 'iron_ore', count: 6 },
      { kind: 'farm', count: 8 },
      { kind: 'explore', count: 2 }
    ],
    scan: {
      entityRadius: num(env.ENTITY_RADIUS, 16),
      blockRadius: num(env.BLOCK_RADIUS, 20),
      blockYBelow: num(env.BLOCK_Y_BELOW, 12),
      blockYAbove: num(env.BLOCK_Y_ABOVE, 4),
      maxBlocks: num(env.MAX_BLOCK_RESULTS, 40),
      cacheMs: num(env.SCAN_CACHE_MS, 1200)
    },
    safety: {
      lowHealthPct: num(env.SAFE_LOW_HP_PCT, 0.5),
      fleeHealthPct: num(env.SAFE_FLEE_HP_PCT, 0.3),
      lowFood: num(env.SAFE_LOW_FOOD, 14),
      hostileRadius: num(env.SAFE_HOSTILE_RADIUS, 10),
      creeperRadius: num(env.SAFE_CREEPER_RADIUS, 3),
      maxFallMs: num(env.SAFE_MAX_FALL_MS, 20000)
    },
    pathfinder: {
      // canDig=true: pathfinder boleh menggali kalau itu satu-satunya jalan (bot tambang).
      canDig: bool(env.PATHFINDER_CAN_DIG, true),
      allowParkour: bool(env.PATHFINDER_PARKOUR, true)
    },
    files: {
      traceFile: flags.trace || env.TRACE_FILE || path.join(MCBOT_ROOT, 'logs', 'trace.jsonl'),
      logFile: env.LOG_FILE || path.join(MCBOT_ROOT, 'logs', 'bot.log')
    }
  }
}

export function describeConfig (config) {
  const key = config.brain.apiKey ? `${config.brain.apiKey.slice(0, 6)}…${config.brain.apiKey.slice(-4)}` : '(none)'
  return [
    `bot      : ${config.server.username} → ${config.server.host}:${config.server.port} (auth=${config.server.auth}, version=${config.server.version || 'auto'})`,
    `brain    : ${config.brain.provider}${config.brain.provider === 'groq' ? ` model=${config.brain.model} url=${config.brain.baseUrl} key=${key}` : ''}`,
    `task     : ${config.task}`,
    `loop     : every ${config.loop.intervalMs}ms (urgent ${config.loop.urgentIntervalMs}ms), action timeout ${config.loop.actionTimeoutMs}ms`,
    `trace    : ${config.files.traceFile}`
  ].join('\n           ')
}
