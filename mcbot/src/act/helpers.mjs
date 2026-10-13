/**
 * Helper untuk lapisan Act:
 *  - timeout yang sadar AbortSignal (loop OODA bisa membatalkan aksi panjang)
 *  - equip tool/senjata/makanan
 *  - konversi koordinat
 */
import { Vec3 } from 'vec3'
import { findBestWeapon, findFood, findToolFor } from '../util/items.mjs'

export const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export class ActionAborted extends Error {
  constructor (reason = 'aborted') { super(reason); this.name = 'ActionAborted' }
}
export class ActionTimeout extends Error {
  constructor (label, ms) { super(`${label} timed out after ${ms}ms`); this.name = 'ActionTimeout' }
}

/** Jalankan promise dengan timeout + dukungan pembatalan. */
export async function withTimeout (promise, ms, label, signal) {
  if (signal?.aborted) throw new ActionAborted(signal.reason)
  let timer, abortHandler
  const guards = []
  const abortPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ActionTimeout(label, ms)), ms)
    if (signal) {
      abortHandler = () => reject(new ActionAborted(signal.reason))
      signal.addEventListener('abort', abortHandler, { once: true })
    }
  })
  try {
    return await Promise.race([promise, ...guards, abortPromise])
  } finally {
    clearTimeout(timer)
    if (abortHandler && signal) signal.removeEventListener('abort', abortHandler)
  }
}

/** Cek signal & lempar kalau sudah dibatalkan (dipakai di dalam loop aksi panjang). */
export function checkAbort (signal, what = 'action') {
  if (signal?.aborted) throw new ActionAborted(`${what}: ${signal.reason || 'cancelled'}`)
}

export const toVec3 = (pos) => (pos instanceof Vec3 ? pos : new Vec3(pos[0], pos[1], pos[2]))
export const toArray = (v) => [Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)]
export const fmtPos = (v) => `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`

/** Pegang item (slot dari inventory) — aman dipanggil berulang. */
export async function equipItem (bot, item, destination = 'hand') {
  if (!item) return false
  if (bot.heldItem && bot.heldItem.name === item.name && bot.heldItem.slot === item.slot) return true
  try {
    await bot.equip(item, destination)
    return true
  } catch {
    return false
  }
}

/**
 * Siapkan tool terbaik untuk blok tertentu.
 * Pakai mineflayer-tool kalau tersedia (dia tahu harvestTools + enchant),
 * kalau tidak → fallback heuristik sendiri.
 */
export async function equipToolFor (bot, block) {
  if (bot.tool?.equipForBlock) {
    try {
      const ok = await bot.tool.equipForBlock(block, { requireHarvest: false })
      if (ok !== false) return bot.heldItem
    } catch { /* lanjut ke fallback */ }
  }
  const tool = findToolFor(bot, block)
  if (tool) await equipItem(bot, tool.item)
  return bot.heldItem
}

/** Pegang senjata terbaik (fallback: item di hotbar). */
export async function equipWeapon (bot) {
  const best = findBestWeapon(bot)
  if (best) {
    await equipItem(bot, best.item)
    return bot.heldItem
  }
  return bot.heldItem
}

/** Pegang makanan terbaik. */
export async function equipFood (bot, preferredName) {
  const items = bot.inventory.items()
  const item = (preferredName && items.find(i => i.name === preferredName)) || findFood(bot)?.item
  if (!item) return null
  await equipItem(bot, item)
  return item
}

/** Apakah bot sedang "macet" (posisi hampir tidak berubah) */
export function isStuck (bot, prevPos, tolerance = 0.6) {
  if (!prevPos) return false
  return bot.entity.position.distanceTo(prevPos) < tolerance
}
