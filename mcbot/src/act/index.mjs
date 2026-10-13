/**
 * Dispatcher aksi: satu keputusan JSON → satu aksi game.
 *
 * Semua aksi mengembalikan { ok, detail, data? } dan tidak pernah melempar
 * error kecuali aksi dibatalkan (ActionAborted) — supaya loop OODA tetap
 * berjalan walau satu aksi gagal.
 */
import { ActionAborted } from './helpers.mjs'
import { explore, flee, goto, walkForward } from './moves.mjs'
import { mine } from './mine.mjs'
import { attack, eat } from './fight.mjs'
import { farm } from './farm.mjs'

export { setupMovements } from './moves.mjs'
export { ActionAborted } from './helpers.mjs'

export function createExecutor (bot, config, logger) {
  const actions = {
    mine: (d, ctx) => mine(bot, d, ctx),
    attack: (d, ctx) => attack(bot, d, ctx),
    eat: (d, ctx) => eat(bot, d, ctx),
    farm: (d, ctx) => farm(bot, d, ctx),
    goto: (d, ctx) => goto(bot, d.target, {
      timeoutMs: d.duration_ms || config.loop.actionTimeoutMs,
      range: 2,
      signal: ctx.signal,
      label: 'goto'
    }).then(r => ({ ...r, detail: `walked to ${d.target.join(',')} — ${r.detail}` })),
    explore: (d, ctx) => explore(bot, {
      distance: config.scan.blockRadius,
      timeoutMs: d.duration_ms || Math.min(config.loop.actionTimeoutMs, 9000),
      signal: ctx.signal
    }),
    flee: (d, ctx) => flee(bot, {
      threat: ctx.state.threats.nearest ? bot.entities[ctx.state.threats.nearest.id] : null,
      escapeTarget: d.target,
      timeoutMs: d.duration_ms || config.loop.actionTimeoutMs,
      signal: ctx.signal
    }),
    idle: async (d, ctx) => {
      const ms = Math.min(d.duration_ms || 1000, 3000)
      await new Promise(r => setTimeout(r, ms))
      return { ok: true, detail: `idled ${ms}ms` }
    }
  }

  return {
    async run (decision, ctx) {
      const handler = actions[decision.action]
      if (!handler) return { ok: false, detail: `no executor for action "${decision.action}"` }
      const started = Date.now()
      try {
        const res = await handler(decision, ctx)
        return { ...res, elapsedMs: Date.now() - started }
      } catch (err) {
        if (err instanceof ActionAborted) throw err
        logger.warn(`action ${decision.action} crashed: ${err.message}`)
        return { ok: false, detail: `${decision.action} error: ${err.message}`, elapsedMs: Date.now() - started }
      }
    },
    /** Darurat: hentikan semua gerakan yang sedang berjalan. */
    emergencyStop () {
      try { bot.pathfinder.setGoal(null) } catch { /* ignore */ }
      bot.setControlState('forward', false)
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
      bot.clearControlStates?.()
    },
    walkForward: (ms, signal) => walkForward(bot, ms, signal)
  }
}
