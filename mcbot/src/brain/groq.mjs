/**
 * Brain: Groq (OpenAI-compatible chat completions).
 *
 * Kecepatan Groq (LPU) memungkinkan loop OODA ~2 detik terasa hidup.
 * Semua request dibuat defensif:
 *   - timeout + retry dengan exponential backoff (429/5xx/network)
 *   - JSON mode (`response_format: { type: 'json_object' }`) + parsen toleran
 *   - auto-detect nama model lewat GET /models kalau model di-set tidak ada
 */
import { SYSTEM_PROMPT, buildUserPrompt, buildReactivePrompt } from '../prompts.mjs'

export class BrainError extends Error {
  constructor (message, meta = {}) {
    super(message)
    this.name = 'BrainError'
    this.meta = meta
  }
}

/** Preferensi model kalau auto-detect perlu memilih (nama bisa berubah di sisi Groq). */
const MODEL_PREFERENCE = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'qwen/qwen3.6-27b',
  'minimaxai/minimax-m2.7'
]

/** Bersihkan output model: buang code fence, ambil objek JSON pertama yang valid. */
export function extractJson (text) {
  if (!text) throw new BrainError('empty response from model')
  let s = String(text).trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(s)
  } catch { /* lanjut ke ekstraksi */ }
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1))
    } catch { /* gagal juga */ }
  }
  throw new BrainError('model did not return valid JSON', { raw: s.slice(0, 400) })
}

async function fetchWithTimeout (url, opts, timeoutMs) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: ac.signal })
  } finally {
    clearTimeout(t)
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export function createGroqBrain (config, logger) {
  const { apiKey, baseUrl, model, temperature, maxTokens, timeoutMs, retries, autodetectModel } = config.brain
  if (!apiKey) throw new BrainError('GROQ_API_KEY is not set (set BRAIN=heuristic to run without it)')

  let activeModel = model
  let modelChecked = false

  async function listModels () {
    const res = await fetchWithTimeout(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    }, timeoutMs)
    if (!res.ok) throw new BrainError(`GET /models failed: ${res.status} ${res.statusText}`)
    const body = await res.json()
    return (body.data || []).map(m => m.id)
  }

  async function chat (messages, { retriesLeft = retries } = {}) {
    const body = {
      model: activeModel,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' }
    }
    let lastError
    for (let attempt = 0; attempt <= retriesLeft; attempt++) {
      const started = Date.now()
      try {
        const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }, timeoutMs)
        const latencyMs = Date.now() - started

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          const retryable = res.status === 429 || res.status >= 500
          // Model tidak ada / di-deaktivasi → coba tebak model lain (sekali)
          if ((res.status === 400 || res.status === 404) && autodetectModel && !modelChecked && /model/i.test(text)) {
            modelChecked = true
            const available = await listModels().catch(() => [])
            const pick = MODEL_PREFERENCE.find(m => available.includes(m)) || available[0]
            if (pick && pick !== activeModel) {
              logger.warn(`Groq model "${activeModel}" unavailable → switching to "${pick}"`)
              activeModel = pick
              body.model = pick
              attempt-- // request ini tidak dihitung sebagai percobaan
              continue
            }
            logger.warn(`Groq model list: ${available.slice(0, 12).join(', ') || '(empty)'}`)
          }
          lastError = new BrainError(`Groq HTTP ${res.status}: ${text.slice(0, 200)}`, { status: res.status, latencyMs })
          if (!retryable) throw lastError
        } else {
          const json = await res.json()
          const content = json.choices?.[0]?.message?.content
          const parsed = extractJson(content)
          return {
            decision: parsed,
            meta: {
              latencyMs,
              model: json.model || activeModel,
              usage: json.usage || null,
              finish: json.choices?.[0]?.finish_reason || null
            }
          }
        }
      } catch (err) {
        lastError = err instanceof BrainError ? err : new BrainError(`Groq request failed: ${err.message}`, { cause: err.message })
        const isTimeout = /timeout|aborted/i.test(err.message)
        if (attempt === retriesLeft || (!isTimeout && !/fetch failed|ENOTFOUND|ECONNREFUSED|socket/i.test(err.message))) {
          if (attempt === retriesLeft) throw lastError
        }
      }
      const backoff = 400 * 2 ** attempt
      logger.debug(`groq retry in ${backoff}ms (${lastError.message})`)
      await sleep(backoff)
    }
    throw lastError
  }

  async function warmup () {
    try {
      const models = await listModels()
      const has = models.includes(activeModel)
      logger.info(`Groq reachable · ${models.length} models · using "${activeModel}"${has ? '' : ' (NOT in model list!)'}`)
      if (!has) {
        const pick = MODEL_PREFERENCE.find(m => models.includes(m)) || models[0]
        if (pick) {
          logger.warn(`Model "${activeModel}" not offered → using "${pick}"`)
          activeModel = pick
        }
      }
      if (logger.event) logger.event('groq-models', { models, activeModel })
    } catch (err) {
      logger.warn(`Groq warmup failed: ${err.message} — akan fallback ke heuristic bila perlu`)
    }
  }

  return {
    provider: 'groq',
    get model () { return activeModel },
    warmup,
    async decide (state, opts = {}) {
      const userPrompt = opts.reactive ? buildReactivePrompt(state) : buildUserPrompt(state)
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]
      const { decision, meta } = await chat(messages)
      return { decision, meta: { ...meta, source: 'groq', promptChars: userPrompt.length } }
    }
  }
}
