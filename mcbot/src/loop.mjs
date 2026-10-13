/**
 * OODA LOOP — inti bot.
 *
 *   Observe (observe.mjs) → Orient (prompts.mjs) → Decide (brain/) → Act (act/)
 *   lalu ulang. Default tiap 2 detik, atau 400ms saat situasi darurat.
 *
 * Lapisan ini juga bertindak sebagai "safety supervisor": keputusan LLM
 * boleh aneh, tapi guard di sini yang menentukan aksi darurat (makan/kabur).
 */
import { observe, summarize } from './observe.mjs'
import { createExecutor, ActionAborted } from './act/index.mjs'

const OBJECTIVE_TASKS = { mine: 'mine', farm: 'farm', explore: 'explore', fight: 'fight', chop: 'mine' }

export function createLoop ({ bot, config, logger, brain }) {
  const executor = createExecutor(bot, config, logger)

  const objectives = (config.objectives || []).map(o => ({ ...o, progress: 0, done: false }))
  let history = []
  const notes = []
  let running = false
  let ticking = false
  let paused = false
  let timer = null
  let currentAbort = null
  let lastPos = null
  let stuckCounter = 0
  const stats = { decisions: 0, actions: 0, failures: 0, guardOverrides: 0, fallbacks: 0, startedAt: Date.now() }

  /** Objective yang sedang dikejar + task aktif. */
  function resolveTask () {
    if (config.task !== 'auto') {
      const obj = objectives.find(o => !o.done && OBJECTIVE_TASKS[o.kind] === config.task) || null
      return { current: config.task, objective: obj }
    }
    const obj = objectives.find(o => !o.done) || null
    if (!obj) return { current: 'explore', objective: null }
    return { current: OBJECTIVE_TASKS[obj.kind] || 'explore', objective: obj }
  }

  function markProgress (state, decision, result) {
    const obj = state.task?.objective
    if (!obj || !result?.ok) return
    const kind = obj.kind
    if (kind === 'mine' && decision.action === 'mine' && result.data?.block) {
      const target = (obj.target || '').replace('deepslate_', '')
      if (!target || result.data.block.includes(target)) obj.progress++
    } else if (kind === 'farm' && decision.action === 'farm' && result.data?.replanted !== undefined) {
      obj.progress++
    } else if (kind === 'explore' && ['explore', 'goto'].includes(decision.action) && result.ok) {
      obj.progress++
    } else if (kind === 'fight' && decision.action === 'attack' && /killed|gone/.test(result.detail || '')) {
      obj.progress++
    } else if (kind === 'chop' && decision.action === 'mine' && /log|wood/.test(result.data?.block || '')) {
      obj.progress++
    }
    if (obj.count && obj.progress >= obj.count) {
      obj.done = true
      logger.ok(`objective complete: ${obj.kind}${obj.target ? ' ' + obj.target : ''} (${obj.progress}/${obj.count})`)
      logger.event('objective-done', { objective: obj })
    }
  }

  /**
   * Safety supervisor: dipanggil SEBELUM otak. Kalau mengembalikan aksi,
   * aksi itu yang dipakai (nyawa > tugas).
   */
  function guard (state) {
    const s = config.safety
    const hpPct = state.health.pct / 100
    if (state.hazards?.nearby) {
      return { thought: `standing in ${state.hazards.nearby.type} — escaping`, action: 'flee' }
    }
    if (state.health.value <= 0) return null
    if (hpPct <= s.fleeHealthPct) {
      if (state.bestFood && state.food.value < 20) {
        return { thought: `health ${state.health.value}/20 — eating ${state.bestFood.name}`, action: 'eat', item_to_use: state.bestFood.name }
      }
      if (state.threats.nearest) {
        return { thought: `health ${state.health.value}/20 with ${state.threats.nearest.name} at ${state.threats.nearest.distance}b — fleeing`, action: 'flee' }
      }
    }
    if (state.threats.creeperClose && state.threats.creeperClose.distance <= s.creeperRadius) {
      return { thought: `creeper ${state.threats.creeperClose.distance}b away — backing off`, action: 'flee' }
    }
    if (state.oxygen.value <= 8) {
      return { thought: 'drowning — surfacing', action: 'goto', target: [state.position.x, state.position.y + 3, state.position.z], duration_ms: 3000 }
    }
    return null
  }

  /** Situasi butuh reaksi cepat? (loop dipercepat) */
  function isUrgent (state) {
    return !!state.threats.nearest || state.health.pct <= config.safety.lowHealthPct * 100 || !!state.hazards.nearby
  }

  async function tick () {
    if (!running || ticking || paused) return
    if (!bot.entity) return // belum spawn / sedang respawn
    if (Number.isFinite(bot.health) && bot.health <= 0) return // sedang mati — tunggu respawn
    ticking = true
    const cycleStart = Date.now()
    try {
      const task = resolveTask()
      const state = observe(bot, { config, task, history, notes })
      logger.observe(summarize(state))

      // Deteksi macet: hanya bermakna kalau aksi terakhir MEMANG aksi bergerak
      // (explore/goto). Panen & menambang memang diam di tempat, jadi jangan
      // dihitung "macet" hanya karena posisi tidak berubah.
      const MOVING_ACTIONS = ['explore', 'goto', 'attack', 'flee']
      const lastAction = history[history.length - 1]?.action
      if (lastPos && bot.entity.position.distanceTo(lastPos) < 0.3 && MOVING_ACTIONS.includes(lastAction)) stuckCounter++
      else stuckCounter = 0
      lastPos = bot.entity.position.clone()
      if (stuckCounter >= 5) {
        const lastAction = history[history.length - 1]?.action
        notes.push(`Bot has not moved for ${stuckCounter} cycles (last action: ${lastAction || 'none'})`)
        logger.warn(`no movement for ${stuckCounter} cycles (last action: ${lastAction || '-'})`)
      }

      const forced = guard(state)
      let decision, meta
      if (forced) {
        decision = { target: null, item_to_use: null, ...forced }
        meta = { source: 'guard' }
        stats.guardOverrides++
      } else {
        const res = await brain.decide(state)
        decision = res.decision
        meta = res.meta || {}
        if (meta.source === 'heuristic-fallback') stats.fallbacks++
      }

      logger.brain(decision, meta)

      // Eksekusi + pembatalan otomatis kalau bahaya muncul di tengah aksi
      currentAbort = new AbortController()
      const ctx = { state, signal: currentAbort.signal, config }
      const interruptible = ['mine', 'farm', 'explore', 'goto'].includes(decision.action)
      let dangerWatcher = null
      if (interruptible) {
        dangerWatcher = setInterval(() => {
          const threat = state.threats.nearest
          const fresh = bot.entities[threat?.id]
          if (!fresh) return
          const d = bot.entity.position.distanceTo(fresh.position)
          if (d <= 2.5) {
            logger.warn(`interrupting ${decision.action}: ${threat.name} at ${d.toFixed(1)}b`)
            currentAbort.abort(`${threat.name} too close`)
          }
        }, 250)
      }

      logger.act(`${decision.action}${decision.target ? ` → ${JSON.stringify(decision.target)}` : ''}`, { source: meta?.source || 'brain' })

      let result
      try {
        result = await executor.run(decision, ctx)
      } catch (err) {
        if (err instanceof ActionAborted) {
          result = { ok: false, detail: `interrupted: ${err.message}`, interrupted: true }
        } else throw err
      } finally {
        if (dangerWatcher) clearInterval(dangerWatcher)
      }

      stats.actions++
      if (!result.ok) stats.failures++
      if (result.ok) logger.result(result.detail)
      else logger.warn(`action failed: ${result.detail}`)

      history.push({ action: decision.action, target: decision.target, result: result.detail, ok: result.ok })
      history = history.slice(-8)
      markProgress(state, decision, result)

      // Catatan untuk putaran berikutnya (dipakai prompt + guard)
      if (!result.ok) notes.push(`Last action (${decision.action}) failed: ${result.detail}`)
      else if (notes.length) notes.length = Math.max(0, notes.length - 1)

      // Peristiwa khusus pertanian: supaya dashboard/trace bisa menghitung
      // panen vs tanam ulang tanpa membedah string detail.
      if (decision.action === 'farm') {
        logger.event('farm', {
          crop: result.data?.crop || null,
          harvested: !!result.ok,
          replanted: !!result.data?.replanted,
          collected: result.data?.collected ?? 0,
          pos: decision.target || null,
          detail: result.detail
        })
      }

      logger.event('cycle', {
        decision, meta, result,
        task: task.current,
        objective: task.objective ? { ...task.objective } : null,
        cycleMs: Date.now() - cycleStart
      })

      const interval = isUrgent(state) ? config.loop.urgentIntervalMs : config.loop.intervalMs
      return interval
    } catch (err) {
      logger.error(`loop error: ${err.stack || err.message}`)
      return config.loop.intervalMs
    } finally {
      ticking = false
      currentAbort = null
    }
  }

  async function runOnce () {
    const interval = await tick()
    if (!running) return
    timer = setTimeout(runOnce, interval ?? config.loop.intervalMs)
  }

  return {
    stats,
    get history () { return history },
    get objectives () { return objectives },
    start () {
      if (running) return
      running = true
      logger.info(`OODA loop start · interval ${config.loop.intervalMs}ms · task=${config.task}${config.loop.dryRun ? ' · DRY RUN' : ''}`)
      logger.event('loop-start', { config: { task: config.task, interval: config.loop.intervalMs } })
      runOnce()
    },
    stop () {
      running = false
      clearTimeout(timer)
      if (currentAbort) currentAbort.abort('loop stopped')
      executor.emergencyStop()
      logger.event('loop-stop', { stats })
    },
    /** Paksa satu putaran sekarang (mis. habis kena serangan). */
    trigger (reason = 'manual') {
      if (!running || ticking) return
      logger.debug(`immediate tick: ${reason}`)
      clearTimeout(timer)
      runOnce()
    },
    pause (reason) { paused = true; logger.warn(`loop paused: ${reason}`) },
    resume () { if (paused) { paused = false; logger.info('loop resumed') } },
    get paused () { return paused },
    executor
  }
}
