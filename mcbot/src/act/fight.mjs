/**
 * Aksi `attack` — kejar + pukul entity sampai mati / target hilang / timeout.
 *
 * Catatan versi: sejak 1.9 ada cooldown serangan (~0.625s untuk sword).
 * Kita pakai interval 650ms dan mengejar balik kalau target menjauh.
 */
import pathfinderPkg from 'mineflayer-pathfinder'

const { goals } = pathfinderPkg
import { ActionAborted, checkAbort, equipWeapon, sleep, withTimeout } from './helpers.mjs'

const ATTACK_INTERVAL_MS = 650

export async function attack (bot, decision, { config, signal } = {}) {
  const entityId = decision.target
  const entity = bot.entities[entityId]
  if (!entity) return { ok: false, detail: `entity ${entityId} is gone` }

  // Serangan tidak boleh lama-lama: loop harus sering re-evaluasi (bisa jadi harus lari).
  const timeoutMs = Math.min(
    decision.duration_ms && decision.duration_ms > 2000 ? decision.duration_ms : 6000,
    config?.loop?.actionTimeoutMs ?? 12000
  )
  const fleeHp = (config?.safety?.fleeHealthPct ?? 0.3) * 20

  if (decision.item_to_use) {
    const item = bot.inventory.items().find(i => i.name === decision.item_to_use)
    if (item) await bot.equip(item, 'hand').catch(() => {})
  }
  await equipWeapon(bot)

  const started = Date.now()
  let hits = 0
  let lastDistance = Infinity
  let directAt = 0

  try {
    while (Date.now() - started < timeoutMs) {
      checkAbort(signal, 'attack')
      // Nyawa dulu: kalau HP kritis, hentikan serangan supaya loop bisa memilih eat/flee
      if (Number.isFinite(bot.health) && bot.health <= fleeHp) {
        return { ok: false, detail: `broke off attack: health ${bot.health}/20 is critical (hits ${hits})`, data: { hits, reason: 'low-health' } }
      }
      const target = bot.entities[entityId]
      if (!target) {
        const verb = hits > 0 ? `went down after ${hits} hit${hits === 1 ? '' : 's'}` : 'disappeared (never reached)'
        return { ok: hits > 0, detail: `target ${entityId} ${verb}`, data: { hits } }
      }
      if (target.health !== undefined && target.health <= 0) {
        return { ok: true, detail: `killed ${target.name || target.username} after ${hits} hits`, data: { hits } }
      }
      const distance = bot.entity.position.distanceTo(target.position)
      if (distance > 3.2) {
        // kejar
        if (!bot.pathfinder.goal || Math.abs(distance - lastDistance) > 2) {
          bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
        }
        // Cadangan: pathfinder kadang tidak bisa mendekat (bot terjebak di lubang
        // galian, target di balik pagar). Kalau sudah 2.5 detik tanpa satu pun
        // pukulan, jalan lurus menghadap target — cara primitif tapi sering lolos.
        if (hits === 0 && Date.now() - started > 2500 && Date.now() - (directAt || 0) > 1200) {
          directAt = Date.now()
          try { bot.pathfinder.setGoal(null) } catch { /* ignore */ }
          try { await bot.lookAt(target.position.offset(0, 1.6, 0), true) } catch { /* ignore */ }
          await walkForward(bot, 1000, signal, { jump: true }).catch(() => {})
        }
      } else {
        try { bot.pathfinder.setGoal(null) } catch { /* ignore */ }
        try { await bot.lookAt(target.position.offset(0, 1.4, 0), true) } catch { /* ignore */ }
        try {
          bot.attack(target)
          hits++
        } catch (err) {
          bot.emit('mcbot:attackError', err)
        }
      }
      lastDistance = distance
      await sleep(ATTACK_INTERVAL_MS)
    }
  } finally {
    try { bot.pathfinder.setGoal(null) } catch { /* ignore */ }
  }
  return { ok: false, detail: `could not kill ${entityId}: only ${hits} hit${hits === 1 ? '' : 's'} in ${timeoutMs}ms (target still alive)`, data: { hits } }
}

export async function eat (bot, decision, { signal } = {}) {
  checkAbort(signal, 'eat')
  if (bot.food >= 20) return { ok: true, detail: 'already full — no need to eat' }
  const items = bot.inventory.items()
  const item = (decision.item_to_use && items.find(i => i.name === decision.item_to_use)) || null
  const fallback = bot.registry.foodsByName
    ? items.filter(i => bot.registry.foodsByName[i.name])?.sort((a, b) => bot.registry.foodsByName[b.name].foodPoints - bot.registry.foodsByName[a.name].foodPoints)[0]
    : null
  const food = item || fallback
  if (!food) return { ok: false, detail: 'no food in inventory' }
  try {
    await bot.equip(food, 'hand')
    await withTimeout(bot.consume(), 4200, 'consume', signal)
    return { ok: true, detail: `ate ${food.name} (food ${bot.food}/20, hp ${bot.health}/20)` }
  } catch (err) {
    if (err instanceof ActionAborted) throw err
    return { ok: false, detail: `eat failed: ${err.message}` }
  }
}
