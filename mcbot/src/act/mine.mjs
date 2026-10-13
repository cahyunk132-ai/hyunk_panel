/**
 * Aksi `mine` — ambil SATU blok yang dipilih LLM.
 *
 * Tanggung jawab script (bukan LLM):
 *   - validasi blok masih ada & bisa ditambang
 *   - pilih + pegang pickaxe terbaik, cek durability
 *   - berjalan mendekat kalau terlalu jauh (pathfinder)
 *   - lapor hasil (blok apa, berapa lama) ke trace
 */
import { Vec3 } from 'vec3'
import { cropMaxAge, isCrop } from '../util/blocks.mjs'
import { durabilityOf } from '../util/items.mjs'
import { ActionAborted, equipItem, equipToolFor, fmtPos, toVec3, withTimeout } from './helpers.mjs'
import { collectDrops } from './collect.mjs'
import { goto } from './moves.mjs'

const AIR = new Set(['air', 'cave_air', 'void_air'])
/** Tool yang durability-nya dianggap kritis (jangan dipakai sampai habis). */
const MIN_TOOL_DURABILITY = 0.08

export async function mine (bot, decision, { config, signal } = {}) {
  const pos = toVec3(decision.target)
  const block = bot.blockAt(pos)
  if (!block || AIR.has(block.name)) {
    return { ok: false, detail: `no block at ${fmtPos(pos)} (already mined?)` }
  }
  if (block.name === 'bedrock' || block.name === 'barrier') {
    return { ok: false, detail: `${block.name} cannot be mined` }
  }

  // Dekatkan diri kalau perlu (pathfinder yang urus jalannya)
  const distance = bot.entity.position.distanceTo(pos.plus(new Vec3(0.5, 0.5, 0.5)))
  if (distance > 4) {
    await goto(bot, [pos.x, pos.y, pos.z], { timeoutMs: config?.loop?.actionTimeoutMs ?? 12000, range: 2, signal, label: 'mine:approach' })
  }

  // Pilih tool; kalau tool kritis → jangan pakai sampai rusak (biar bot lapor ke LLM)
  const held = await equipToolFor(bot, block)
  const heldDur = held ? durabilityOf(held) : null
  if (heldDur && heldDur.pct < MIN_TOOL_DURABILITY) {
    return { ok: false, detail: `${held.name} durability too low (${heldDur.left}/${heldDur.max}) — need a new tool` }
  }

  // Fail cepat: kalau blok butuh tool tertentu (harvestTools) dan kita tidak punya,
  // jangan buang 12 detik menggali dengan tangan kosong.
  const harvestTools = bot.registry.blocksByName[block.name]?.harvestTools
  const heldIsGood = !!(harvestTools && bot.heldItem && harvestTools[bot.heldItem.type])
  if (harvestTools && !heldIsGood) {
    const match = bot.inventory.items().find(i => harvestTools[i.type])
    if (!match) {
      return { ok: false, detail: `${block.name} needs a proper tool and the inventory has none — pick another block or get one` }
    }
    await equipItem(bot, match) // punya tool tapi tidak terpegang
  }

  if (!bot.canDigBlock(block)) {
    return { ok: false, detail: `cannot dig ${block.name} at ${fmtPos(pos)} (out of reach / wrong tool / protected)` }
  }

  const started = Date.now()
  try {
    await withTimeout(bot.dig(block, true), config?.loop?.actionTimeoutMs ?? 12000, `dig ${block.name}`, signal)
  } catch (err) {
    if (err instanceof ActionAborted) throw err
    return { ok: false, detail: `dig failed: ${err.message}` }
  }
  // Ambil drop-nya (server hanya memungut kalau bot berada dekat item)
  const pickup = await collectDrops(bot, { radius: 4, max: 3, perDropMs: 1500, signal }).catch(() => ({ collected: 0, detail: '' }))
  const after = bot.blockAt(pos)
  const dug = !after || AIR.has(after.name)
  const dur = held ? durabilityOf(bot.inventory.items().find(i => i.slot === held.slot) || {}) : null
  return {
    ok: dug,
    detail: `${dug ? 'mined' : 'may not be fully mined'} ${block.name} at ${fmtPos(pos)} in ${Date.now() - started}ms` +
      (pickup.collected ? `, +${pickup.collected} item` : '') +
      (dur ? ` (tool ${dur.left}/${dur.max})` : ''),
    data: { block: block.name, pos: [pos.x, pos.y, pos.z], collected: pickup.collected, isCrop: isCrop(block.name), maxAge: isCrop(block.name) ? cropMaxAge(block.name) : undefined }
  }
}
