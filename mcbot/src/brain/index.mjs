/**
 * Brain factory + normalisasi keputusan LLM.
 *
 * Lapisan ini adalah "kontrak keamanan" antara LLM dan game:
 *   LLM → normalisasi/validasi → aksi tereksekusi (atau fallback heuristic).
 *
 * Bot TIDAK PERNAH macet karena LLM mengembalikan JSON aneh:
 *   - JSON rusak         → fallback heuristic
 *   - action tidak dikenal → fallback heuristic
 *   - target entity hilang → fallback heuristic
 *   - timeout / 429        → fallback heuristic (config bisa mematikan)
 */
import { ACTIONS } from '../prompts.mjs'
import { createGroqBrain, BrainError } from './groq.mjs'
import { decideHeuristic } from './heuristic.mjs'

const ACTION_ALIASES = {
  mine_block: 'mine', mining: 'mine', dig: 'mine', gather: 'mine',
  kill: 'attack', hit: 'attack', fight: 'attack', defend: 'attack',
  run: 'flee', escape: 'flee', retreat: 'flee', run_away: 'flee',
  consume: 'eat', feed: 'eat',
  harvest: 'farm', plant: 'farm', replant: 'farm', till: 'farm',
  walk: 'goto', move: 'goto', go: 'goto', travel: 'goto', navigate: 'goto',
  wander: 'explore', scout: 'explore', search: 'explore',
  wait: 'idle', none: 'idle', nothing: 'idle', rest: 'idle'
}

const clamp = (n, min, max) => Math.max(min, Math.min(max, n))

function coercePos (target) {
  if (typeof target === 'string') {
    const nums = target.match(/-?\d+(\.\d+)?/g)
    if (nums && nums.length >= 3) return nums.slice(0, 3).map(Number).map(Math.floor)
    return null
  }
  if (Array.isArray(target) && target.length >= 3) {
    const nums = target.slice(0, 3).map(Number)
    if (nums.every(Number.isFinite)) return nums.map(Math.floor)
  }
  if (target && typeof target === 'object' && 'x' in target) {
    const nums = [target.x, target.y, target.z].map(Number)
    if (nums.every(Number.isFinite)) return nums.map(Math.floor)
  }
  return null
}

function coerceEntityId (target) {
  if (typeof target === 'number' && Number.isInteger(target)) return target
  if (typeof target === 'string' && /^-?\d+$/.test(target.trim())) return Number(target.trim())
  if (target && typeof target === 'object' && Number.isInteger(target.id)) return target.id
  return null
}

/**
 * Validasi + rapikan output LLM. Return { decision, problems } — decision null
 * berarti pemanggil harus fallback.
 */
export function normalizeDecision (raw, state) {
  const problems = []
  if (!raw || typeof raw !== 'object') return { decision: null, problems: ['response is not a JSON object'] }

  const src = raw.decision && typeof raw.decision === 'object' ? { ...raw, ...raw.decision } : raw
  let action = String(src.action ?? src.next_action ?? '').trim().toLowerCase().replace(/\s+/g, '_')
  action = ACTION_ALIASES[action] || action
  if (!ACTIONS.includes(action)) {
    return { decision: null, problems: [`unknown action "${src.action}"`] }
  }

  const decision = {
    thought: String(src.thought ?? src.reason ?? src.explanation ?? '').slice(0, 240) || '(no thought given)',
    action,
    target: null,
    item_to_use: typeof src.item_to_use === 'string' ? src.item_to_use : null,
    ...(Number.isFinite(Number(src.duration_ms)) ? { duration_ms: clamp(Number(src.duration_ms), 500, 20000) } : {})
  }

  if (action === 'attack') {
    const id = coerceEntityId(src.target ?? src.entity_id ?? src.target_id)
    const known = state.entities.find(e => e.id === id)
    if (id === null) problems.push('attack without entity id')
    else if (!known) problems.push(`entity id ${id} is not in the current state`)
    else decision.target = id
  } else if (['mine', 'farm', 'goto'].includes(action)) {
    const pos = coercePos(src.target ?? src.position ?? src.coordinates)
    if (!pos) problems.push(`${action} without valid [x, y, z] target`)
    else decision.target = pos
  } else if (action === 'flee') {
    const pos = coercePos(src.target)
    if (pos) decision.target = pos
  }

  if (action === 'eat' && decision.item_to_use) {
    if (!state.inventory.counts[decision.item_to_use]) {
      problems.push(`eat requested "${decision.item_to_use}" but it is not in the inventory`)
      decision.item_to_use = state.bestFood?.name || null
    }
  }

  // Validasi lunak: kalau aksi butuh target dan tidak ada → fallback.
  if (['mine', 'farm', 'goto', 'attack'].includes(action) && decision.target === null) {
    return { decision: null, problems }
  }

  return { decision, problems }
}

export async function createBrain (config, logger) {
  const provider = config.brain.provider
  let groq = null
  if (provider === 'groq') {
    try {
      groq = createGroqBrain(config, logger)
    } catch (err) {
      logger.warn(`Groq brain unavailable: ${err.message}`)
      if (!config.brain.fallbackToHeuristic) throw err
    }
  }

  const useGroq = !!groq
  if (!useGroq) logger.info(`brain = heuristic (rule-based${provider === 'groq' ? ', groq unavailable' : ''})`)

  return {
    provider: useGroq ? 'groq' : 'heuristic',
    get model () { return groq?.model || 'rule-engine-v1' },
    async warmup () { if (groq) await groq.warmup() },
    /**
     * @returns {{decision: object, meta: object}} decision SELALU valid.
     */
    async decide (state, opts = {}) {
      if (groq) {
        try {
          const { decision: raw, meta } = await groq.decide(state, opts)
          const { decision, problems } = normalizeDecision(raw, state)
          if (decision) return { decision, meta: { ...meta, problems } }
          logger.warn(`LLM output rejected (${problems.join('; ')}) → heuristic fallback`)
          logger.event('llm-rejected', { raw, problems })
          if (!config.brain.fallbackToHeuristic) {
            throw new BrainError(`LLM output rejected: ${problems.join('; ')}`, { raw })
          }
          const fb = decideHeuristic(state, config)
          return { decision: fb, meta: { source: 'heuristic-fallback', reason: problems.join('; '), raw } }
        } catch (err) {
          if (!config.brain.fallbackToHeuristic) throw err
          logger.warn(`Groq error (${err.message}) → heuristic fallback`)
          const fb = decideHeuristic(state, config)
          return { decision: fb, meta: { source: 'heuristic-fallback', reason: err.message } }
        }
      }
      return { decision: decideHeuristic(state, config), meta: { source: 'heuristic', latencyMs: 0 } }
    }
  }
}
