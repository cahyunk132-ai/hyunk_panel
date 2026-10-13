/**
 * Logger + JSONL trace.
 *
 * Console = enak dibaca manusia (untuk debugging langsung), file JSONL =
 * untuk diparse panel / analisa (setiap keputusan otak, tiap aksi, tiap error).
 */
import fs from 'node:fs'
import path from 'node:path'

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m'
}

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined
const paint = (color, s) => (useColor ? `${C[color]}${s}${C.reset}` : s)

function stamp () {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export function createLogger ({ traceFile, logFile, verbose = false, ringSize = 100 } = {}) {
  const ring = []
  let traceStream = null
  let fileStream = null

  for (const [streamName, target] of [['traceStream', traceFile], ['fileStream', logFile]]) {
    if (!target) continue
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      const s = fs.createWriteStream(target, { flags: 'a' })
      if (streamName === 'traceStream') traceStream = s; else fileStream = s
    } catch (err) {
      console.error(`[logger] cannot open ${target}: ${err.message}`)
    }
  }

  let closed = false
  const write = (line) => {
    if (closed) return
    try {
      process.stdout.write(line + '\n')
      if (fileStream) fileStream.write(line.replace(/\x1b\[[0-9;]*m/g, '') + '\n')
    } catch { /* stream sudah ditutup saat shutdown */ }
  }

  /** catat ke ring buffer + file JSONL */
  function event (type, data = {}) {
    const entry = { t: new Date().toISOString(), type, ...data }
    ring.push(entry)
    if (ring.length > ringSize) ring.shift()
    if (traceStream && !closed) {
      try { traceStream.write(JSON.stringify(entry) + '\n') } catch { /* ditutup */ }
    }
    return entry
  }

  const api = {
    event,
    recent: (n = 5) => ring.slice(-n),
    ring,
    close () {
      closed = true
      try { traceStream?.end() } catch { /* ignore */ }
      try { fileStream?.end() } catch { /* ignore */ }
    },
    get closed () { return closed },
    raw: write,
    debug (msg, meta) {
      if (verbose) write(`${paint('gray', stamp())} ${paint('gray', '[debug]')} ${msg}`)
      if (meta) event('debug', { msg, ...meta })
    },
    info (msg) { write(`${paint('gray', stamp())} ${paint('blue', '[info ]')} ${msg}`) },
    warn (msg, meta) { write(`${paint('gray', stamp())} ${paint('yellow', '[warn ]')} ${msg}`); if (meta) event('warn', { msg, ...meta }) },
    error (msg, meta) { write(`${paint('gray', stamp())} ${paint('red', '[error]')} ${msg}`); event('error', { msg, ...(meta || {}) }) },
    ok (msg) { write(`${paint('gray', stamp())} ${paint('green', '[ ok  ]')} ${msg}`) },
    observe (summary) {
      write(`${paint('gray', stamp())} ${paint('cyan', '[state]')} ${summary}`)
      event('observe', { summary })
    },
    brain (decision, meta = {}) {
      const t = decision?.thought ? paint('dim', `"${decision.thought}"`) : ''
      write(`${paint('gray', stamp())} ${paint('magenta', '[brain]')} ${paint('bold', decision?.action || '?')} ${t}`)
      event('decision', { decision, ...meta })
    },
    act (desc, meta = {}) {
      write(`${paint('gray', stamp())} ${paint('green', '[ act ]')} ${desc}`)
      event('action', { desc, ...meta })
    },
    result (desc, meta = {}) {
      write(`${paint('gray', stamp())} ${paint('green', '[result]')} ${desc}`)
      event('result', { desc, ...meta })
    }
  }
  return api
}
