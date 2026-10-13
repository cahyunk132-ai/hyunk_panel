/**
 * Aksi `farm` — panen tanaman matang atau menanam benih di farmland kosong.
 *
 * Aturan (diturunkan dari desain awal):
 *   - panen  : crop.age == crop.maxAge  → hancurkan blok (dig)
 *   - tanam  : blok farmland dengan udara di atasnya + ada benih di inventory
 *   - tebu/bambu dll diabaikan (bukan "age"-based crop)
 */
import { Vec3 } from 'vec3'
import { cropAge, cropMaxAge, isCrop } from '../util/blocks.mjs'
import { ActionAborted, equipItem, fmtPos, toVec3, withTimeout, checkAbort } from './helpers.mjs'
import { collectDrops } from './collect.mjs'
import { goto } from './moves.mjs'

const SEED_NAMES = ['wheat_seeds', 'beetroot_seeds', 'carrot', 'potato', 'melon_seeds', 'pumpkin_seeds']
const AIR = new Set(['air', 'cave_air', 'void_air'])

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Tunggu sampai server mengirim drop panen ke inventory (pickup butuh ~1-2 tick
 * jaringan). Tanpa ini, replant langsung setelah dig tidak menemukan benih.
 */
async function waitForSeeds (bot, preferred, { tries = 8, gapMs = 250 } = {}) {
  for (let i = 0; i < tries; i++) {
    const seeds = findSeeds(bot, preferred)
    if (seeds) return seeds
    await sleep(gapMs)
  }
  return null
}

/**
 * Tanam benih di atas farmland, lalu VERIFIKASI blok hasilnya.
 * placeBlock bisa menolak (timeout blockUpdate) padahal server sudah menanam,
 * jadi keputusan akhir diambil dari keadaan blok, bukan dari promise.
 */
async function plantSeed (bot, farmland, seeds, timeoutMs, signal, label = 'plant') {
  const target = farmland.position.offset(0, 1, 0)
  const before = bot.blockAt(target)
  if (before && !AIR.has(before.name) && isCrop(before.name)) return true // sudah ada tanaman
  try {
    await equipItem(bot, seeds)
    await withTimeout(bot.placeBlock(farmland, new Vec3(0, 1, 0)), timeoutMs, label, signal)
  } catch (err) {
    if (err instanceof ActionAborted) throw err
    // diabaikan: verifikasi di bawah yang menentukan
  }
  for (let i = 0; i < 4; i++) {
    const now = bot.blockAt(target)
    if (now && now.name !== 'air' && !AIR.has(now.name)) return true
    await sleep(150)
  }
  return false
}

function findSeeds (bot, preferred) {
  const items = bot.inventory.items()
  if (preferred) {
    const wanted = items.find(i => i.name === preferred)
    if (wanted) return wanted
  }
  for (const name of SEED_NAMES) {
    const seed = items.find(i => i.name === name)
    if (seed) return seed
  }
  return null
}

export async function farm (bot, decision, { config, signal } = {}) {
  const pos = toVec3(decision.target)
  const block = bot.blockAt(pos)
  if (!block || AIR.has(block.name)) return { ok: false, detail: `no block at ${fmtPos(pos)}` }

  const timeoutMs = config?.loop?.actionTimeoutMs ?? 12000
  const distance = bot.entity.position.distanceTo(pos.plus(new Vec3(0.5, 0.5, 0.5)))
  if (distance > 4) {
    await goto(bot, [pos.x, pos.y, pos.z], { timeoutMs, range: 2, signal, label: 'farm:approach' })
  }

  // ── Kasus 1: blok yang dipilih adalah tanaman ───────────────────────────────
  if (isCrop(block.name)) {
    const age = cropAge(block)
    if (!age) return { ok: false, detail: `cannot read age of ${block.name}` }
    if (!age.ready) {
      return { ok: false, detail: `${block.name} at ${fmtPos(pos)} not ready (age ${age.age}/${age.maxAge})` }
    }
    const below = bot.blockAt(pos.offset(0, -1, 0))
    try {
      await withTimeout(bot.dig(block, true), timeoutMs, `harvest ${block.name}`, signal)
      checkAbort(signal, 'farm:plant')
      // Ambil drop (wheat + biji) supaya inventory benar-benar bertambah.
      const pickup = await collectDrops(bot, { radius: 5, max: 3, perDropMs: 1500, signal }).catch(() => ({ collected: 0, detail: '' }))
      // Replant otomatis: tunggu drop panen masuk inventory dulu (seeds baru),
      // lalu tanam dan verifikasi blok di atas farmland.
      const seeds = await waitForSeeds(bot, decision.item_to_use)
      const farmland = below && below.name === 'farmland' ? below : bot.blockAt(pos.offset(0, -1, 0))
      let replanted = false
      let replantNote = ''
      if (!farmland || farmland.name !== 'farmland') {
        replantNote = ' (no farmland below, skip replant)'
      } else if (!seeds) {
        replantNote = ' (no seeds, skip replant)'
      } else {
        replanted = await plantSeed(bot, farmland, seeds, timeoutMs, signal, 'replant')
        const after = bot.blockAt(pos)
        replantNote = replanted
          ? ` and replanted ${seeds.name} (${after?.name ?? '?'} age ${after ? cropAge(after)?.age ?? '?' : '?'})`
          : ` (replant failed: ${after?.name ?? 'unknown'} above farmland)`
      }
      return {
        ok: true,
        detail: `harvested ${block.name} at ${fmtPos(pos)}${pickup.collected ? `, +${pickup.collected} item` : ''}${replantNote}`,
        data: { crop: block.name, age: age.age, maxAge: age.maxAge, replanted, collected: pickup.collected }
      }
    } catch (err) {
      if (err instanceof ActionAborted) throw err
      return { ok: false, detail: `harvest failed: ${err.message}` }
    }
  }

  // ── Kasus 2: blok yang dipilih adalah farmland (lahan kosong) ───────────────
  if (block.name === 'farmland') {
    const above = bot.blockAt(pos.offset(0, 1, 0))
    if (!above || !AIR.has(above.name)) return { ok: false, detail: 'farmland is not empty' }
    const seeds = findSeeds(bot, decision.item_to_use)
    if (!seeds) return { ok: false, detail: 'no seeds in inventory' }
    try {
      const ok = await plantSeed(bot, block, seeds, timeoutMs, signal)
      const planted = bot.blockAt(pos.offset(0, 1, 0))
      return {
        ok,
        detail: `${ok ? 'planted' : 'plant failed:'} ${seeds.name} at ${fmtPos(pos.offset(0, 1, 0))} (now ${planted?.name})`,
        data: { planted: planted?.name || null }
      }
    } catch (err) {
      if (err instanceof ActionAborted) throw err
      return { ok: false, detail: `plant failed: ${err.message}` }
    }
  }

  // ── Kasus 3: tanah/dirt biasa + ada hoe → garap jadi farmland ───────────────
  if (['dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt'].includes(block.name)) {
    const hoe = bot.inventory.items().find(i => i.name.endsWith('_hoe'))
    if (!hoe) return { ok: false, detail: `${block.name} is not farmland (no hoe to till it)` }
    try {
      await equipItem(bot, hoe)
      await withTimeout(bot.activateBlock(block), timeoutMs, 'till', signal)
      const now = bot.blockAt(pos)
      return { ok: now?.name === 'farmland', detail: `tilled ${fmtPos(pos)} → ${now?.name}` }
    } catch (err) {
      if (err instanceof ActionAborted) throw err
      return { ok: false, detail: `till failed: ${err.message}` }
    }
  }

  return { ok: false, detail: `${block.name} at ${fmtPos(pos)} is not a crop, farmland or tillable soil` }
}

export { cropMaxAge }
