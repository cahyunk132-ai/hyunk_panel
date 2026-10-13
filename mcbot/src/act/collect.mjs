/**
 * Pengumpulan drop (item entity) di sekitar bot.
 *
 * Panen & penambangan menjatuhkan item (wheat, seeds, coal, dst). Server hanya
 * memasukkan item ke inventory kalau pemain berada sangat dekat (~1 blok),
 * jadi bot harus mendekat sendiri — kalau tidak, drop menumpuk selamanya dan
 * inventory tidak pernah bertambah (benih habis → replant berhenti).
 *
 * Semua serba best-effort: gagal mendekat bukan error fatal, cukup dilaporkan
 * sebagai bagian dari detail aksi.
 */
import pathfinderPkg from 'mineflayer-pathfinder' // CJS → default import
import { sleep } from './helpers.mjs'

const { goals } = pathfinderPkg

const DROP_NAME = /^(item|item_stack)$/

/** Drop di sekitar bot, terdekat dulu. */
export function nearbyDrops (bot, radius = 6) {
  const origin = bot.entity?.position
  if (!origin) return []
  return Object.values(bot.entities || {})
    .filter(e => e && DROP_NAME.test(e.name || '') && e.position && e.position.distanceTo(origin) <= radius)
    .map(e => ({ entity: e, distance: e.position.distanceTo(origin) }))
    .sort((a, b) => a.distance - b.distance)
}

/**
 * Dekati drop terdekat supaya server memungutnya.
 * @returns {Promise<{collected:number, attempted:number, detail:string}>}
 */
export async function collectDrops (bot, { radius = 6, max = 4, perDropMs = 1800, signal } = {}) {
  const drops = nearbyDrops(bot, radius).slice(0, max)
  if (!drops.length) return { collected: 0, attempted: 0, detail: '' }

  const before = countItems(bot)
  let attempted = 0
  for (const { entity } of drops) {
    if (!entity.isValid) continue // sudah dipungut / hilang
    attempted++
    try {
      const goal = new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 1)
      bot.pathfinder.setGoal(goal, true)
      await Promise.race([
        bot.pathfinder.goto(goal),
        sleep(perDropMs).then(() => { throw new Error('drop timeout') })
      ])
    } catch {
      /* best-effort: drop lain / putaran berikutnya bisa ambil lagi */
    } finally {
      try { bot.pathfinder.setGoal(null) } catch { /* ignore */ }
    }
    await sleep(120) // biar server sempat memproses pickup
  }
  const gained = countItems(bot) - before
  return {
    collected: Math.max(0, gained),
    attempted,
    detail: attempted ? `picked up ${Math.max(0, gained)} item(s) from ${attempted} drop(s)` : ''
  }
}

function countItems (bot) {
  try {
    return bot.inventory.items().reduce((sum, i) => sum + i.count, 0)
  } catch {
    return 0
  }
}
